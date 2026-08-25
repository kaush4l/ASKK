/**
 * THE TOOLS THIS BUILD ACTUALLY HAS: a DESCRIPTOR the model reads and a RUNNER
 * the driver calls, declared together so neither can exist without the other.
 *
 * The predecessor kept the two apart — a catalogue in one crate and a match arm
 * in another — and the failure mode was exactly what you would expect: a tool
 * described to the model that nothing answered to, and a tool that ran but was
 * never offered. The `/tools` pane says which of those a name is; this file is
 * why the answer is normally "neither".
 *
 * EVERY RUNNER ANSWERS. A port that throws comes back as `ok: false` with the
 * error's own sentence, because the loop is waiting on this call and a throw is
 * a round that never closes (`batch.js` catches too — this one names the tool).
 * @module
 */

import { arg, tool } from '@harness/agent'
import { ARTIFACT_TOOLS } from '@harness/core'

import { searchTool } from './search.js'

/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('@harness/agent').Tool} Tool */
/** @typedef {import('@harness/core').ToolRun} ToolRun */

/** What the model is told it can call. `/tools` renders this; the model's affordances are built from it. */
export const CATALOGUE = /** @type {Tool[]} */ ([
  tool({
    name: 'web_search',
    description: 'search the web and read back titles, links and snippets',
    args: [arg('query', 'string', 'what to look for, in words')],
    needs: 'net',
  }),
  tool({
    name: 'exec',
    description: 'run a shell command in the workspace and read its output',
    args: [arg('command', 'string', 'the command line to run')],
    mutates: true,
    evidence: true,
    needs: 'workspace',
  }),
  tool({
    name: 'read_file',
    description: 'read a file from the workspace',
    args: [arg('path', 'string', 'the path to read')],
    needs: 'workspace',
  }),
  tool({
    name: 'write_file',
    description: 'write a whole file into the workspace, replacing what was there',
    args: [arg('path', 'string', 'where to write it'), arg('contents', 'string', 'the whole file')],
    mutates: true,
    needs: 'workspace',
  }),
  tool({
    name: 'list_files',
    description: 'list one folder of the workspace',
    args: [arg('path', 'string', 'the folder to list', { required: false })],
    needs: 'workspace',
  }),
  ...ARTIFACT_TOOLS,
])

/**
 * The runners, wired to the ports this browser gave us.
 * `read_result` is NOT here: it is core's, installed by `boot`, because the
 * thing that shelved the bytes owns the way back to them.
 * @param {Ports} ports
 * @param {{keyFor: (entry: string) => string}} broker where a BYOK search key comes from, attached downstream of every grant (I6)
 * @returns {Record<string, ToolRun>}
 */
export function toolRunners(ports, broker) {
  return {
    web_search: searchTool({ net: ports.net, keyFor: broker.keyFor }),
    exec: answered('exec', async (args, opts) => {
      const ran = await ports.workspace.exec(String(args.command ?? ''), { signal: opts.signal })
      // THE EXIT CODE DECIDES, not the presence of stderr: a command that warns
      // on stderr and succeeds is a success, and the predecessor read every
      // byte on stderr as a failure the model then tried to repair.
      return { ok: ran.code === 0, output: `${ran.stdout}${ran.stderr}`.trim() || `exited ${ran.code}` }
    }),
    read_file: answered('read_file', async (args) => {
      const read = await ports.workspace.read(String(args.path ?? ''))
      return { ok: true, output: read.text }
    }),
    write_file: answered('write_file', async (args) => {
      const path = String(args.path ?? '')
      await ports.workspace.write(path, String(args.contents ?? ''))
      return { ok: true, output: `wrote ${path}` }
    }),
    list_files: answered('list_files', async (args) => {
      const at = String(args.path ?? '.')
      const entries = await ports.workspace.list(at)
      // `ls -1Ap`'s own shape, because `folder.js` reads a trailing slash as the
      // KIND. Guessing a kind from the name is how "list, and read if the
      // listing failed" opened nothing and re-listed everything.
      return { ok: true, output: entries.map((e) => `${e.name}${e.dir ? '/' : ''}`).join('\n') }
    }),
  }
}

/**
 * One runner, with its arguments read and its failures said. The JSON parse
 * lives here so no runner repeats it, and a call whose arguments will not parse
 * is a RESULT the model can act on rather than a throw it never sees.
 * @param {string} name
 * @param {(args: Record<string, unknown>, opts: {signal: AbortSignal}) => Promise<{ok: boolean, output: string}>} run
 * @returns {ToolRun}
 */
function answered(name, run) {
  return async (raw, opts) => {
    /** @type {unknown} */
    let said
    try {
      said = JSON.parse(raw === '' ? '{}' : raw)
    } catch {
      return { ok: false, output: `${name} needs JSON arguments, and "${raw.slice(0, 80)}" is not JSON.` }
    }
    if (!said || typeof said !== 'object') return { ok: false, output: `${name} needs a JSON object of arguments.` }
    try {
      return await run(/** @type {Record<string, unknown>} */ (said), opts)
    } catch (cause) {
      return { ok: false, output: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}
