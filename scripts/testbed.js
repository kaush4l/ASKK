#!/usr/bin/env bun
/**
 * A long-running host for the exported page, with a model attached.
 *
 * `scripts/smoke.js` already boots the export and drives it, but it starts a
 * browser of its own, asserts, and exits — there is no way to open the built
 * page and USE it. That is the thing a usability review needs and the thing
 * this file is: one command that serves `out/` at the base path the build was
 * compiled for, and answers the OpenAI wire protocol beside it so a person, or
 * an agent driving a browser, can ask questions and watch the whole loop run.
 *
 * The model is a script, not a model. It reads the prompt it was sent and
 * answers in the contract `core/response/ReActResponse.js` parses, choosing a
 * branch by what the question asks for — a search, a file, a command, a second
 * agent — so every path through the interface can be reached deterministically
 * and without a GPU. Nothing here is imported by the app: this is a server the
 * page talks to over HTTP exactly as it would talk to LM Studio.
 *
 * Usage:  bun scripts/testbed.js [--port 4321] [--quiet]
 *
 * Then open  http://127.0.0.1:4321/ASKK/  and point settings at
 * http://127.0.0.1:4321/ASKK/__model/v1  with any model name.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import config from '../next.config.js'

const OUT = join(import.meta.dir, '..', 'out')
const BASE = config.basePath ?? ''
const MODEL_URL = `${BASE}/__model/v1`
const PAGE_PATH = `${BASE}/__model/page`

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { port: { type: 'string', default: '4321' }, quiet: { type: 'boolean' } },
})
const PORT = Number(values.port)

if (!existsSync(join(OUT, 'index.html'))) {
  console.error('There is no export to serve. Run `bun run build` first.')
  process.exit(1)
}

/** What the fetch tool brings back, so a tool call has something real to read. */
const PAGE_TEXT = [
  'Ceramic filtration removes particles down to about 0.2 microns.',
  'It does not remove dissolved salts, and it is slower than a membrane.',
].join(' ')

/**
 * Everything the browser must be allowed to do to talk to this host.
 *
 * The page is served from this same origin, so this is belt and braces — but a
 * reviewer will point the app at this address from a page served somewhere
 * else (a `next dev` on another port), and a CORS failure there looks exactly
 * like a broken app rather than a misconfigured host.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
}

const react = (think, plan, call) =>
  `think: [${think}]\n\nplan: [${plan.join(', ')}]\n\nact: tool\n\nresult: ${call}`
const answer = (text) => `think: [answerable now]\n\nplan: []\n\nact: answer\n\nresult: ${text}`

/**
 * The last thing the person said, dug out of the prompt the app assembled.
 *
 * `[USER]:` is what `core/engine/Engine.js` writes for a user turn, and the
 * prompt reaches here JSON-encoded inside one message, so the line ends at an
 * escaped newline rather than a real one. Reading the conversation block is
 * what lets this script branch on the QUESTION: every keyword it looks for —
 * search, file, shell — also appears in the tools block of every prompt, so a
 * match against the whole body would take the same branch every time.
 */
function lastQuestion(prompt) {
  const matches = [...prompt.matchAll(/\[USER\]:\s*(.*?)(?:\\n|\\"|"|$)/g)]
  const last = matches.at(-1)?.[1] ?? ''
  return last.replace(/\\"/g, '"').trim().slice(0, 300)
}

/**
 * The scripted reply, in the contract this tree's own parser reads.
 *
 * Branching is on EVIDENCE in the prompt rather than on a counter kept here: a
 * turn that arrived out of order would otherwise be answered as though it were
 * the one before it. `observation:` in the scratchpad means a tool has already
 * run and its result is in hand, which is the signal to answer.
 */
function scriptedReply(prompt) {
  const asked = lastQuestion(prompt)
  const done = prompt.includes('observation:')

  if (/\b(search|look up|latest|news)\b/i.test(asked) && !done) {
    return react(
      'the web will have this',
      ['search for it'],
      `search({"query": ${JSON.stringify(asked)}})`,
    )
  }
  if (/\b(read|fetch|page|url|http)\b/i.test(asked) && !done) {
    return react(
      'there is a page to read',
      ['fetch it'],
      `fetch({"url": "http://127.0.0.1:${PORT}${PAGE_PATH}"})`,
    )
  }
  if (/\b(write|save|note|file)\b/i.test(asked) && !done) {
    return react(
      'this belongs in the workspace',
      ['write the file'],
      `write_file({"path": "notes.md", "content": ${JSON.stringify(`# Notes\n\n${asked}\n`)}})`,
    )
  }
  if (/\b(run|shell|command|terminal|linux)\b/i.test(asked) && !done) {
    return react('a command answers this', ['run it'], 'shell({"command": "uname -a && echo ok"})')
  }
  if (/\b(research|investigate|find out|dig)\b/i.test(asked) && !done) {
    return react(
      'this is going and finding out, not recalling',
      ['hand it to the researcher'],
      `researcher({"task": ${JSON.stringify(asked)}})`,
    )
  }

  return answer(
    done
      ? `Here is what came back. ${PAGE_TEXT} That answers what you asked, and the step above shows where it came from.`
      : `${asked ? `On "${asked}": ` : ''}I can search the web, read a page, run a command in a private Linux guest, write into the workspace, or hand the question to a second agent. Ask for any of those and you will see the step appear before the answer does.`,
  )
}

/**
 * Stream it the way a real endpoint does — in pieces, with a pause between.
 *
 * A reply delivered in one frame arrives faster than any model and hides every
 * defect that only shows while text is arriving: a transcript that does not
 * follow, a stop button that never gets pressed, a layout that jumps as the
 * bubble grows. The pacing is what makes those visible.
 */
function streamed(said) {
  const pieces = said.match(/\S+\s*/g) ?? [said]
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (frame) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })
      for (const piece of pieces) {
        send({ choices: [{ index: 0, delta: { content: piece } }] })
        await Bun.sleep(18)
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      send({
        choices: [],
        usage: {
          prompt_tokens: 812,
          completion_tokens: pieces.length,
          total_tokens: 812 + pieces.length,
        },
      })
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS },
  })
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 240,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    if (path === PAGE_PATH)
      return new Response(PAGE_TEXT, { headers: { 'content-type': 'text/plain', ...CORS } })

    if (path === `${MODEL_URL}/models`)
      return Response.json(
        { object: 'list', data: [{ id: 'testbed', object: 'model', owned_by: 'testbed' }] },
        { headers: CORS },
      )

    if (path === `${MODEL_URL}/chat/completions`) {
      const body = await request.json()
      const prompt = JSON.stringify(body?.messages ?? '')
      const said = scriptedReply(prompt)
      if (!values.quiet) console.log(`  -> ${said.split('\n')[0]}`)
      if (body?.stream) return streamed(said)
      return Response.json(
        {
          id: 'testbed',
          choices: [
            { index: 0, message: { role: 'assistant', content: said }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876 },
        },
        { headers: CORS },
      )
    }

    if (path === '/favicon.ico') return new Response(null, { status: 204 })
    if (path === '/') return Response.redirect(`${BASE}/`, 302)
    if (!path.startsWith(BASE)) return new Response('not found', { status: 404 })

    let rel = path.slice(BASE.length)
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const file = Bun.file(join(OUT, rel))
    if (await file.exists()) return new Response(file)
    const asHtml = Bun.file(join(OUT, `${rel}.html`))
    if (await asHtml.exists()) return new Response(asHtml)
    return new Response('not found', { status: 404 })
  },
})

console.log(`page   http://127.0.0.1:${server.port}${BASE}/`)
console.log(`model  http://127.0.0.1:${server.port}${MODEL_URL}`)
