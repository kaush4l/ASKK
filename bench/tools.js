/**
 * The tools. ONE implementation, shared by every scaffold.
 *
 * This file is the fairness guarantee. Every scaffold in this rig reaches the
 * real filesystem and the real shell through exactly these four functions, so a
 * difference in the results is a difference in scaffolding — the system prompt,
 * the tool contract, the loop, the observation format — and never a difference
 * in what the tools can actually do.
 *
 * A scaffold is allowed to NAME these differently, because a tool contract is
 * part of the scaffold under test (agent-zero calls file writing
 * `text_editor{action:"write"}`; ours calls it `write_file`). What a scaffold is
 * not allowed to do is bring its own implementation. Every adapter in
 * `scaffolds/*.js` ends at one of the four functions below.
 *
 * Everything runs on the host under bun, in a per-run temp directory. The
 * browser-substrate question — whether these can run inside a static page — is
 * a different question from whether our scaffold is better, and mixing them
 * would make both unanswerable.
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** How much output a model can usefully read before it is all context and no answer. */
export const MAX_OUTPUT = 4000

/** Wall-clock ceiling for one shell command. */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Cut long output down, NOTICE INCLUDED IN THE CEILING.
 *
 * The notice used to be appended past `MAX_OUTPUT`, which made every clipped
 * string 4,000-and-a-bit characters long. `ShellTool` clips at 4,000 of its
 * own, so our arm's shell output was clipped twice and the second clip ate the
 * first one's count: the model read "45 more characters" where 1,014 had been
 * dropped, while agent-zero read the true number from the same command. One
 * clip, one count, both arms.
 */
function clip(text) {
  const body = String(text ?? '')
  if (body.length <= MAX_OUTPUT) return body
  const notice = (dropped) => `\n[... ${dropped} more characters, output truncated]`
  // `body.length` has at least as many digits as anything smaller than it, so
  // reserving room for its notice is enough for the real one.
  const keep = MAX_OUTPUT - notice(body.length).length
  return `${body.slice(0, keep)}${notice(body.length - keep)}`
}

/**
 * A result every tool returns and every adapter reads.
 *
 * `ok` is about whether the tool ran, not about whether the agent got what it
 * wanted: a command that exits non-zero is `ok: true` with the exit code in the
 * output, because "that failed" is information the agent can act on. `ok:
 * false` is reserved for the tool itself being unusable — a path outside the
 * workspace, a missing argument.
 */
function ok(output) {
  return { ok: true, output: clip(output) }
}
function bad(output) {
  return { ok: false, output: clip(output) }
}

/**
 * Tools for one run, rooted at one directory.
 *
 * Every path argument is resolved against `workdir` and refused if it escapes.
 * A model that wanders out of its workspace would corrupt the next run's
 * fixtures and the machine check would then be measuring the wrong thing.
 */
export function makeTools(workdir) {
  const root = resolve(workdir)
  mkdirSync(root, { recursive: true })

  /** @returns {string|null} the absolute path, or null when it escapes the workspace. */
  function inside(path) {
    const raw = String(path ?? '').trim()
    if (!raw) return null
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return abs
  }

  const calls = []

  const tools = {
    /** The directory every tool is rooted at. Scaffolds put this in their prompt. */
    workdir: root,

    /** Every call made this run, in order. The transcript and the audit read it. */
    calls,

    async read_file({ path } = {}) {
      const abs = inside(path)
      if (!abs) return bad(`path is required and must stay inside ${root}`)
      try {
        const text = await readFile(abs, 'utf8')
        return ok(text === '' ? '(the file is empty)' : text)
      } catch (error) {
        return ok(`could not read ${path}: ${error.message}`)
      }
    },

    async write_file({ path, content } = {}) {
      const abs = inside(path)
      if (!abs) return bad(`path is required and must stay inside ${root}`)
      const body = typeof content === 'string' ? content : String(content ?? '')
      try {
        mkdirSync(dirname(abs), { recursive: true })
        await writeFile(abs, body, 'utf8')
        return ok(`wrote ${body.length} bytes to ${relative(root, abs) || '.'}`)
      } catch (error) {
        return ok(`could not write ${path}: ${error.message}`)
      }
    },

    async list_files({ path } = {}) {
      const abs = inside(path ?? '.')
      if (!abs) return bad(`path must stay inside ${root}`)
      try {
        const names = readdirSync(abs).sort()
        if (!names.length) return ok('(the directory is empty)')
        const lines = names.map((name) => {
          try {
            const info = statSync(join(abs, name))
            return info.isDirectory() ? `${name}/` : `${name}  ${info.size} bytes`
          } catch {
            return name
          }
        })
        return ok(lines.join('\n'))
      } catch (error) {
        return ok(`could not list ${path ?? '.'}: ${error.message}`)
      }
    },

    /**
     * A real shell command, in the workspace, with a timeout.
     *
     * stdout and stderr are interleaved into one stream because that is what a
     * terminal shows and what every scaffold's prompt implies. The exit code is
     * always stated: a model that cannot tell success from failure will claim
     * both.
     */
    async run({ command, timeout_ms } = {}) {
      const line = String(command ?? '').trim()
      if (!line) return ok('no command was given, so nothing ran')
      const limit = Number(timeout_ms) > 0 ? Number(timeout_ms) : DEFAULT_TIMEOUT_MS

      const proc = Bun.spawn(['/bin/sh', '-c', line], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PATH: process.env.PATH, HOME: root, PWD: root },
      })

      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        try {
          proc.kill(9)
        } catch {
          /* already gone */
        }
      }, limit)

      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearTimeout(timer)

      const body = [out, err].filter((part) => part?.length).join('')
      if (timedOut) {
        return {
          ...ok(`${body}\n[the command was killed after ${limit}ms without finishing]`),
          code,
        }
      }
      const shown = body.trim() ? body : '(no output)'
      // The exit code is a FIELD as well as a line of the text. It used to be
      // only the line, and `ours.js` parsed it back out of the end of the
      // string — but `clip` truncates from the end, so a failing command with
      // more than MAX_OUTPUT of output arrived at our arm as exit 0 while
      // agent-zero read the same text unchanged. A status that is not inside
      // the truncated thing cannot be truncated away.
      return { ...ok(`${shown}\n[exit code ${code}]`), code }
    },
  }

  // Wrap each of the four so every call is recorded once, in one place, rather
  // than at each of the adapters that could forget.
  for (const name of ['read_file', 'write_file', 'list_files', 'run']) {
    const impl = tools[name]
    tools[name] = async (args) => {
      const started = Date.now()
      const result = await impl(args)
      calls.push({ name, args, ok: result.ok, ms: Date.now() - started })
      return result
    }
  }

  return tools
}
