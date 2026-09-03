#!/usr/bin/env bun
/**
 * Boot the built artifact in a browser and make three realms answer — the page
 * and its module workers, the classic sandbox worker, and the real guest
 * through the tree's own `C2wSandbox`.
 *
 * The other three steps of the gate cannot see a module that parses, resolves
 * and passes its unit tests yet cannot run in the realm it was written for.
 * docs/GATE.md has the fault table that measures exactly which faults reach
 * this step and which are caught earlier, and the designs rejected for it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import config, { SANDBOX_IMAGE_PATH } from '../next.config.js'
import { attachBrowser, findChrome } from './browser.js'
import { TINY_GUEST_STDOUT, tinyGuest } from './wasm/tinyGuest.js'

const OUT = join(import.meta.dir, '..', 'out')

// Read from the config rather than repeated here. A smoke test served at a
// different prefix from the one built in would prove the wrong page works.
const BASE = config.basePath

/**
 * Everything that needs tearing down, so one failure path can close all of it.
 *
 * The browser half lives in `scripts/browser.js`, which owns the profile leak
 * and the port-file race for both checks that drive one. What is left here is
 * this file's own host.
 */
const open = { server: null, browser: null }

async function shutdown() {
  await open.browser?.close()
  open.server?.stop(true)
}

// An interrupted run — a tool timeout, a Ctrl-C, an agent that gave up waiting —
// otherwise orphans a browser process tree that holds its profile for ever, and
// this is a step every agent runs many times an hour.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdown().then(() => process.exit(130))
  })
}

async function fail(message, details = []) {
  await shutdown()
  console.error(`\nsmoke: ${message}`)
  for (const line of details) console.error(`  ${line}`)
  process.exit(1)
}

if (!existsSync(OUT)) await fail('there is no out/ to boot — run `bun run build` first')

const chrome = findChrome()
if (chrome.problem) await fail(chrome.problem, chrome.details)

// --- the host ---------------------------------------------------------------

// Under the base path so the worker fetches it exactly the way it fetches a
// real guest image: same origin, same prefix, same `fetch` in the same realm.
const GUEST_URL = `${BASE}/__smoke/guest.wasm`

/**
 * The repository's own `src/` tree, served verbatim, so realm three below can
 * import the module under test rather than a copy of it.
 *
 * This is only possible because there is NO TRANSPILE over `src/`: the file a
 * browser imports from here is the file on disk, byte for byte, with its own
 * relative imports resolving to the neighbouring real files. Two waves measured
 * this guest from scratch copies of the host half and a refuter killed both
 * claims for exactly that, so the copy is the one thing this step must not be.
 *
 * It is not the bundle, and the difference is stated rather than glossed: the
 * bundle is what the chunk scan below checks, and it checks the one thing a
 * source import cannot — that the URL `composition.js` derives survived into
 * the artifact a visitor downloads.
 */
const SRC_URL = `${BASE}/__src`
const SRC = join(import.meta.dir, '..', 'src')

/**
 * Where the export puts what `public/sandbox/` holds, and what the page asks for.
 *
 * The GZIPPED image, because that is the one a repository can carry and
 * therefore the only one a deploy has. Pointing this at the raw module would
 * prove the emulator runs and prove nothing about the artifact that ships — and
 * the raw module is exactly what the live page 404-ed on.
 */
const IMAGE_FILE = join(OUT, SANDBOX_IMAGE_PATH.slice(1))
const IMAGE_URL = `${BASE}${SANDBOX_IMAGE_PATH}`

/**
 * A model endpoint, and a page for a tool to go and read.
 *
 * Realm four below runs a REAL sub-agent thread, and a real agent needs an
 * endpoint to think with. This is an OpenAI-compatible one that answers with a
 * script rather than a model: two replies, chosen by what the prompt it was
 * sent already contains. That is what makes the check deterministic while
 * leaving every layer under it — the transport, the contract, the parser, the
 * loop, the toolbox — the tree's own.
 *
 * It is not a mock of the tree's code. Nothing here is imported by the app;
 * this is a server the app talks to over HTTP exactly as it would talk to LM
 * Studio, and the one thing it stands in for is the model.
 */
const MODEL_URL = `${BASE}/__model/v1`
const PAGE_PATH = `${BASE}/__model/page`
/**
 * The ABSOLUTE address of that page, filled in once the host is listening.
 *
 * `FetchTool` refuses a relative path — "Write the whole address, including
 * https://" — which is a real refusal in the shipped tool and cost this check
 * its first run. So the script hands the sub-agent the address a person would
 * type, and the port is not known until the server has bound one.
 */
let PAGE_URL = PAGE_PATH
/** What the sub-agent's own `fetch` tool has to bring back for the check to pass. */
const PAGE_TEXT = 'the delegated tool reached the host'
/** What the sub-agent has to answer with once it has read that page. */
const DELEGATED_ANSWER = 'researcher-9f3c1: read one page and answered'
/** What the PARENT has to finish with, once its sub-agent has answered it. */
const PARENT_ANSWER = 'main-2b7e4: the researcher came back'
/** The typed question that makes the parent hand work over instead of waiting. */
const HANDOVER_QUESTION = 'hand it over: 8c1f2'
/** What the parent says on the turn it hands the work over. */
const HANDOVER_STARTED = 'main-4a9d0: started it and carried on'
/** What the parent says once it has read the handed-over answer back. */
const HANDOVER_READ = 'main-51e7c: the handed-over answer came back'
/** What a scheduled question says, so it can be found in the transcript. */
const SCHEDULED_MARK = 'scheduled-6d24b'
/** What an OVERDUE schedule says — one whose period elapsed while nobody was here. */
const OVERDUE_MARK = 'overdue-31c7a'
/** A line only the researcher's own file carries, which is how a child prompt is known. */
const CHILD_MARK = 'answering one question for another agent'

/**
 * The two writers, and the file they are made to disagree over.
 *
 * `FilesService` refuses a save whose precondition has moved, and the only way
 * to watch that refusal happen for real is to have the agent move it — which
 * needs the person's edit to be OPEN while a turn runs. That is the scenario
 * the page's own suppressed re-read exists for, so a fake second writer would
 * be testing a different thing from the one that ships.
 */
const CONFLICT_PATH = 'shared-note.md'
const CONFLICT_READ = 'what the person opened: 3ba71'
const CONFLICT_AGENT = 'what the agent wrote instead: 6ce20'
const CONFLICT_QUESTION = 'rewrite the shared note: 0d4fa'
const CONFLICT_DONE = 'main-7f21b: the note is rewritten'
const EDITED_TEXT = 'what the person typed while the agent was writing: b41e9'
const CONFLICT_ACCEPTED = 'the same edit, put back on top of what is there: 91c7d'

/**
 * The scripted reply, in the contract the tree's own `ReActResponse` renders.
 *
 * Turn one sends it to the page above; turn two, recognised by that page's text
 * already being in the prompt as an observation, answers. A reply that arrived
 * in the wrong order would answer without ever fetching, so the two are told
 * apart by evidence in the prompt rather than by a counter this file keeps.
 */
function scriptedReply(prompt) {
  // WHOSE turn this is, read off the prompt itself: only the researcher's own
  // file carries that sentence, so a child request identifies itself by the
  // system text it was built with rather than by a counter this file keeps.
  const child = prompt.includes(CHILD_MARK)
  if (child) {
    return prompt.includes(PAGE_TEXT)
      ? `think: [the page said what it says]\n\nplan: []\n\nact: answer\n\nresult: ${DELEGATED_ANSWER}`
      : `think: [read the page]\n\nplan: [fetch it]\n\nact: tool\n\nresult: fetch({"url": "${PAGE_URL}"})`
  }
  // The one turn that writes a file, and it is first because its question is a
  // literal marker: every branch below reads evidence that a delegating run
  // leaves behind, and this run delegates nothing.
  if (prompt.includes(CONFLICT_QUESTION)) {
    return prompt.includes(CONFLICT_AGENT)
      ? `think: [written]\n\nplan: []\n\nact: answer\n\nresult: ${CONFLICT_DONE}`
      : `think: [rewrite it]\n\nplan: [write the file]\n\nact: tool\n\nresult: write_file({"path": "${CONFLICT_PATH}", "content": "${CONFLICT_AGENT}"})`
  }
  // The parent, in four states, and each is read off evidence in the prompt
  // rather than off a counter this file keeps — a reply that arrived in the
  // wrong order would otherwise be indistinguishable from the right one.
  //
  //   it has read a handed-over answer back      -> finish
  //   the context block says something is done   -> read it with check_task
  //   the question asked it to hand work over    -> hand it over, then finish
  //   it has a researcher observation in hand    -> finish
  //   anything else                              -> delegate and wait
  // `action: check_task(` is the SCRATCHPAD's rendering of a call this run made.
  // Matching a bare `check_task(` matched the tools block instead, which every
  // prompt carries, so the very first delegating turn answered as though it had
  // already read something back.
  if (prompt.includes('action: check_task(') && prompt.includes(DELEGATED_ANSWER)) {
    return `think: [it came back]\n\nplan: []\n\nact: answer\n\nresult: ${HANDOVER_READ}`
  }
  const handed = /\bt\d+\b/.exec(prompt.slice(prompt.indexOf('handed over')))
  if (prompt.includes('handed over') && prompt.includes('finished') && handed) {
    return `think: [read it]\n\nplan: []\n\nact: tool\n\nresult: check_task({"id": "${handed[0]}"})`
  }
  if (prompt.includes(HANDOVER_QUESTION) && !prompt.includes('handed to researcher')) {
    return `think: [start it and carry on]\n\nplan: []\n\nact: tool\n\nresult: researcher({"task": "Read the page and say what it said.", "wait": false})`
  }
  if (prompt.includes('handed to researcher')) {
    return `think: [started]\n\nplan: []\n\nact: answer\n\nresult: ${HANDOVER_STARTED}`
  }
  return prompt.includes(DELEGATED_ANSWER)
    ? `think: [it answered]\n\nplan: []\n\nact: answer\n\nresult: ${PARENT_ANSWER}`
    : `think: [ask the researcher]\n\nplan: [delegate]\n\nact: tool\n\nresult: researcher({"task": "Read the page and say what it said."})`
}

open.server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === GUEST_URL) return new Response(tinyGuest())
    if (path === PAGE_PATH)
      return new Response(PAGE_TEXT, { headers: { 'content-type': 'text/plain' } })
    // What this endpoint serves, which is the one thing a newcomer cannot know
    // and the reason the settings form has a check at all.
    if (path === `${MODEL_URL}/models`) {
      return Response.json({ object: 'list', data: [{ id: 'scripted' }, { id: 'other' }] })
    }
    if (path === `${MODEL_URL}/chat/completions`) {
      const body = await request.json()
      // The whole prompt as it arrived, which is the only thing the script
      // branches on. `messages` is what the transport sends; reading it here
      // rather than a field of our own means a change to how the prompt is
      // assembled reaches this check instead of going around it.
      const prompt = JSON.stringify(body?.messages ?? '')
      const said = scriptedReply(prompt)
      // The page STREAMS — `ChatService` passes an `onDelta` whenever anyone is
      // watching the call — so the endpoint a real turn reaches is the SSE one.
      // Answering only the plain-JSON form made this check fail with the app's
      // own honest complaint, "the stream carried no text", which is the
      // transport being right about a server that was wrong.
      if (body?.stream) {
        const frames = [
          { choices: [{ index: 0, delta: { role: 'assistant', content: said } }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
        ]
        return new Response(
          `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return Response.json({
        id: 'smoke',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: said },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    }
    if (path.startsWith(`${SRC_URL}/`)) {
      // Nothing above `src/` is reachable: a `..` in a specifier would resolve
      // in the URL before it ever arrives, but the join is still constrained
      // because this server is handed whatever a page asks for.
      const file = Bun.file(join(SRC, path.slice(SRC_URL.length + 1)))
      return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
    }
    // Chrome asks the ORIGIN root for this, outside the base path, and a static
    // host at a subpath answers 404 in production too. Answered here so the one
    // request that means nothing does not have to be filtered out by name later.
    if (path === '/favicon.ico') return new Response(null, { status: 204 })
    if (!path.startsWith(BASE)) return new Response('not found', { status: 404 })

    let rel = path.slice(BASE.length)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = Bun.file(join(OUT, rel))
    if (await file.exists()) return new Response(file)
    return new Response('not found', { status: 404 })
  },
})
const url = `http://127.0.0.1:${open.server.port}${BASE}/`
PAGE_URL = `http://127.0.0.1:${open.server.port}${PAGE_PATH}`

// --- the driver -------------------------------------------------------------

open.browser = await attachBrowser({ chromePath: chrome.path, whenLost: fail })
const { session, send, evaluate, problems } = open.browser

// --- realm one: the module workers behind the page --------------------------

const navigated = Date.now()
await send('Page.navigate', { url }, session)

let live = 'none'
while (Date.now() - navigated < 15000) {
  live = await evaluate(`document.querySelector('.wordmark')?.dataset.live ?? 'none'`, session)
  if (live === 'true') break
  // A reported error already fails this run at the bottom, so waiting out the
  // ceiling would only make the answer later. Measured: an uncaught throw in
  // the worker turns the 15 s ceiling into a 251 ms failure, and the difference
  // is whether an agent reads the reason or kills the run first.
  if (problems.length) break
  await Bun.sleep(50)
}
const bootMs = Date.now() - navigated

if (live !== 'true') {
  // What the page itself says, which is not the same thing as what the browser
  // reported. It is filled in by the client's own give-up path, and that path
  // listens on the worker's `error` event — which a module worker's top-level
  // throw does NOT fire, arriving instead as an unhandled rejection. Measured:
  // of the faults in docs/GATE.md only a missing chunk under
  // `out/_next/static/chunks/` reaches this line; the rest are silent here and
  // loud in `problems`.
  const shown = await evaluate(
    `document.querySelector('[data-testid="error"]')?.textContent ?? ''`,
    session,
  )
  await fail(`the backend never reached ready (data-live=${live}) after ${bootMs}ms`, [
    ...(shown ? [`the page says: ${shown}`] : []),
    ...problems,
  ])
}

// --- the owner's view of the agent's files -----------------------------------
//
// The claim this half of the slice makes is "the human can open, list and read
// one file", and NOTHING in lint, test or build can see it: measured by
// mutation on 2026-09-01, a `FilesPanel` that never calls `files.list`, a
// `MAX_COLOURED_TOKENS` of 1, an `INSTRUMENTS` without `files` and a page that
// never mounts the component at all were four separate deletions of the
// feature and the gate stayed green at 665/665 over every one of them. There is
// no DOM in `bun test` and no component renderer in this tree, so the only
// place the view can be executed is here, where the built page is already up.
//
// Placed BEFORE the guest so it runs on a clone that has no image: the file
// view needs a store and a browser and neither needs the emulator.
const ANCHOR = 'owner-view-4d1f0a: the reader is real'
const planted = await evaluate(
  `(async () => {
     const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES, STORE_SCHEDULES } =
       await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
     const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
     const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
     const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
     const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       // Every store this version HAS. Naming three of four opened a v4
       // database with no schedules store on any run that reached here before
       // the app did — and an upgrade only runs once, so the app would never
       // create it either.
       STORE_SCHEDULES,
     ])
     await db.open()
     // A .js name on purpose: this is the one assertion that the colours are
     // drawn, and a language the scanner does not know renders one plain run.
     const files = new Workspace(new IndexedDbRepository('File', db, STORE_FILES))
     const written = await files.write(
       'owner-view.js',
       'const seen = ' + JSON.stringify(${JSON.stringify(ANCHOR)}) + '\\n',
     )
     // A second file under a name nothing here can place. The view has a branch
     // for it — say which languages have rules, so a reader is not left deciding
     // whether the highlighter is broken — and a branch nothing opens is the
     // defect this whole section exists to make visible.
     const unknown = await files.write('owner-view.rst', 'plain and proud\\n')
     return { written: written.toJSON(), unknown: unknown.toJSON() }
   })()`,
  session,
  true,
)
if (!planted?.written?.ok || !planted?.unknown?.ok)
  await fail(`could not put a file in front of the view: ${JSON.stringify(planted)}`, problems)

// Driven by clicking, not by calling the component's own functions: what is in
// question is the wiring — a rail button, a mounted pane, a route name spelled
// the same in both realms — and every one of those is a thing only a click
// crosses.
const view = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get) => {
       for (let i = 0; i < 100; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     // The four panels are sections of ONE drawer now rather than four
     // buttons across the top of the screen, so a section toggle does not
     // exist until the drawer is open. docs/INTERFACE.md has the argument;
     // what it costs a check is this line. No backticks in this comment: it
     // lives inside a template literal, and one would end the string.
     const openDrawer = async (id) => {
       if (!pick(id)) pick('drawer-toggle')?.click()
       return await until(() => pick(id))
     }
     const toggle = await openDrawer('files-toggle')
     if (!toggle) return { where: 'the rail has no files button' }
     toggle.click()
     const list = await until(() => pick('file-list'))
     if (!list) return { where: 'the files pane never rendered a listing' }
     const entry = await until(() => pick('file-owner-view.js'))
     if (!entry) return { where: 'the listing never showed the file', listing: list.textContent }
     entry.click()
     const body = await until(() => pick('file-text'))
     if (!body) return { where: 'the file never opened', listing: list.textContent }
     // The download, taken at the seam rather than at the disk. save() builds
     // an object URL and clicks an anchor, so standing in for both says what
     // bytes and what filename the reader would actually have been handed —
     // and a headless browser that really downloaded it would only prove a
     // file appeared somewhere. Both are put back before anything else runs.
     // No backticks in here: this whole block is a template literal, and one
     // would end it.
     const createObjectURL = URL.createObjectURL
     const anchorClick = HTMLAnchorElement.prototype.click
     let handed = null
     let named = ''
     URL.createObjectURL = (blob) => {
       handed = blob
       return createObjectURL.call(URL, blob)
     }
     HTMLAnchorElement.prototype.click = function () {
       named = this.download
     }
     pick('file-download')?.click()
     URL.createObjectURL = createObjectURL
     HTMLAnchorElement.prototype.click = anchorClick

     return {
       where: '',
       opened: pick('file-open')?.textContent ?? '',
       text: body.textContent,
       handed: handed ? await handed.text() : null,
       named,
       // The colours, counted rather than described. A cap that refuses to draw
       // them, or a highlighter that returned one plain run, is this number
       // going to zero while everything above still passes.
       coloured: body.querySelectorAll('span.tok').length,
       plain: Boolean(pick('file-plain')),
       // The rule a save is subject to, said where a person is about to press
       // save. The wording changed because the old one could not be read;
       // what is asserted is that the readout still states the RULE.
       terms: (pick('files-readout')?.textContent ?? '').includes(
         'a save is refused if this file has changed',
       ),
       unknown: await (async () => {
         pick('file-owner-view.rst')?.click()
         const said = await until(() => pick('file-unknown-language'))
         return said?.textContent ?? ''
       })(),
     }
   })()`,
  session,
  true,
)

if (view?.where) await fail(`the owner cannot see the agent's files: ${view.where}`, problems)
if (view.opened !== 'owner-view.js')
  await fail(
    `the pane opened ${JSON.stringify(view.opened)}, not the file that was clicked`,
    problems,
  )
// The BYTES, not a name. A view that lists a file and shows somebody else's
// text is the failure this anchor exists to catch, and it is the failure a
// listing-only assertion passes over.
if (!view.text.includes(ANCHOR))
  await fail(`the file view showed the wrong bytes: ${JSON.stringify(view.text)}`, problems)
if (!view.coloured || view.plain)
  await fail(`the file was shown with no colours (${view.coloured} spans, plain=${view.plain})`, [
    'See MAX_COLOURED_TOKENS in src/app/FilesPanel.jsx and RULES in src/client/highlight.js.',
  ])
// The copy the reader is handed. Same anchor as the pane, because the whole
// claim of the button is that it hands over the file that is on screen; a
// download that quietly carries the path, or the previous file, is a defect no
// listing assertion and no `file-text` assertion can see.
if (view.handed !== view.text)
  await fail(
    `the download handed over different bytes from the ones on screen: ${JSON.stringify(view.handed)}`,
    ['See save() in src/app/FilesPanel.jsx.'],
  )
// And under a name that says which file it was. A browser's download directory
// is flat, so the slashes become dashes and `src/deep.txt` does not arrive as
// somebody else's `deep.txt`.
if (view.named !== 'owner-view.js')
  await fail(`the download would be saved as ${JSON.stringify(view.named)}`, problems)
// The languages, named where the question comes up. `LANGUAGES` is exported for
// this one sentence, so a check that never renders it would leave the export
// dark under a test that only proves the list is well formed.
if (!view.unknown.includes('owner-view.rst') || !view.unknown.includes('js, json, md'))
  await fail(`a file in no known language said ${JSON.stringify(view.unknown)}`, [
    'See LANGUAGES in src/client/highlight.js and the hint that prints it in',
    'src/app/FilesPanel.jsx.',
  ])
// Said on screen, because a person who can now change their files is owed the
// terms they are changed under. It is a sentence, and a sentence nobody renders
// is this tree's signature defect — this one replaced `read-only`, which was
// true for two waves and stopped being true the moment a save button existed.
if (!view.terms) await fail('the file view never says what a save is checked against', problems)

console.log(
  `smoke: the owner opened ${view.opened} through the rail — ${view.coloured} coloured runs`,
)

// --- realm four: a sub-agent's own thread ------------------------------------
//
// `agentWorker.js` was the one realm on the architecture's diagram that nothing
// had ever entered, and the cause was one line: the roster held a single agent,
// so `ChatService` computed no peers, no `tools:` entry could resolve to one,
// and the pool was never asked for a thread. `agents/researcher/agent.md` is
// the second agent, and this is the check that it is a THREAD and not a story:
// nothing in lint or `bun test` can start a Worker, so this is the only place
// the realm can be executed at all.
//
// What it proves, in one run: a named thread starts; it fetches its own agent
// file from the base path the PARENT realm handed it, rather than a constant it
// read for itself; it builds the tools its own file declares — `search` and
// `fetch`, the two `delegable.js` allows a second realm to hold; it runs its own
// declared budget; the `fetch` it was given actually reaches the host; and the
// answer comes back to the caller as an ordinary `Outcome`.
const delegated = await evaluate(
  `(async () => {
     const { AgentWorkerPool } = await import(${JSON.stringify(`${SRC_URL}/backend/AgentWorkerPool.js`)})
     const pool = new AgentWorkerPool({ basePath: ${JSON.stringify(BASE)}, timeout: 20000 })
     const progress = []
     const answered = await pool.ask(
       'researcher',
       'Read the page and say what it said.',
       {
         kind: 'openai',
         model: 'scripted',
         baseUrl: ${JSON.stringify(`http://127.0.0.1:${open.server.port}${MODEL_URL}`)},
         apiKey: '',
       },
       null,
       (report) => progress.push(report),
     )
     const threads = pool.threads()
     pool.terminate()
     return { answered: answered.toJSON(), threads, progress }
   })()`,
  session,
  true,
)

if (!delegated?.answered?.ok)
  await fail(`the sub-agent thread did not answer: ${JSON.stringify(delegated)}`, [
    'The thread is src/backend/agentWorker.js, started by src/backend/AgentWorkerPool.js.',
    'It fetches agents/researcher/agent.md from the base path the pool handed it.',
    ...problems,
  ])
if (!String(delegated.answered.value).includes(DELEGATED_ANSWER))
  await fail(`the sub-agent answered ${JSON.stringify(delegated.answered.value)}`, [
    `It was scripted to fetch ${PAGE_URL} and then answer with ${DELEGATED_ANSWER}.`,
    'Answering without the second turn means its `fetch` tool never ran, so the',
    'thread was built with no tools — see delegableTools in src/core/agent/delegable.js.',
    ...problems,
  ])
// Something was said BEFORE the answer, which is the half a thread does not
// buy on its own. A delegated run is minutes of a second agent working, and
// until this channel existed the only realm anyone watches saw nothing at all
// until it finished — a thread reading its fourth page and a thread that was
// wedged were the same picture.
const reports = delegated.progress ?? []
if (reports.length < 2)
  await fail(`the thread reported ${reports.length} pass(es) before answering`, [
    'Each finished pass should arrive as one message: see onStep in',
    'src/backend/agentWorker.js and the progress branch in AgentWorkerPool.js.',
    ...problems,
  ])
if (!reports[0]?.doing?.includes('fetch') || reports.at(-1)?.answered !== true)
  await fail(`the reported passes were ${JSON.stringify(reports)}`, [
    'The first pass called fetch and the last one answered; the reports should say so.',
    ...problems,
  ])
// The same fact, kept where a page that was NOT watching can still read it —
// after a reload, or in a second tab, through `agents.threads`.
if (delegated.threads?.[0]?.status?.answered !== true)
  await fail(`the thread kept no status: ${JSON.stringify(delegated.threads)}`, problems)

// `confirmedName` is what the worker reported `self.name` to be once it was
// alive. A thread we intended and a thread that exists are different claims,
// and this is the one that is evidence.
const thread = (delegated.threads ?? []).find((one) => one.name === 'researcher')
if (thread?.confirmedName !== 'researcher')
  await fail(`the thread never confirmed its own name: ${JSON.stringify(delegated.threads)}`, [
    'The name is the agent identity in devtools and in `agents.threads`.',
    ...problems,
  ])

console.log(
  `smoke: the researcher answered on its own thread (self.name=${thread.confirmedName}, ` +
    `${thread.calls} call) after its own fetch tool read ${PAGE_URL}, ` +
    `reporting ${reports.length} passes on the way`,
)

// --- the app is ready and the model is not ----------------------------------
//
// "ready" has always meant the app started, and a first visit reads it as "ask
// me something" — then meets a transport failure, because the default address
// is a server on this machine that most people are not running. The empty state
// now asks the model first, and this is the only place that answer can be
// rendered: there is no DOM in `bun test`.
//
// The address planted here is the discard port, which refuses a connection
// immediately. Pointing it at the default would make this check depend on
// whether the person running the gate happens to have a model server up.
const dead = await evaluate(
  `(async () => {
     const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES, STORE_SCHEDULES } =
       await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
     const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
     const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
     const { DEFAULT_SETTINGS, SETTINGS_ID } = await import(${JSON.stringify(`${SRC_URL}/backend/services/SettingsService.js`)})
     const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       // Every store this version HAS. Naming three of four opened a v4
       // database with no schedules store on any run that reached here before
       // the app did — and an upgrade only runs once, so the app would never
       // create it either.
       STORE_SCHEDULES,
     ])
     await db.open()
     const saved = await new IndexedDbRepository('Settings', db, STORE_SETTINGS).put({
       ...DEFAULT_SETTINGS,
       id: SETTINGS_ID,
       // A model AND an address. The defaults name neither since a fictional
       // one shipped for eight waves and the header advertised it as real, so
       // spreading them alone now plants an UNCONFIGURED app — which reports
       // itself in different words and would leave this check green over a
       // probe that never ran.
       model: 'a-model-that-is-not-there',
       baseUrl: 'http://127.0.0.1:9/v1',
     })
     return saved.toJSON()
   })()`,
  session,
  true,
)
if (!dead?.ok) await fail(`could not plant a dead endpoint: ${JSON.stringify(dead)}`, problems)

await send('Page.navigate', { url }, session)
const unconfigured = await evaluate(
  `(async () => {
     for (let i = 0; i < 300; i++) {
       const said = document.querySelector('[data-testid="no-model"]')
       if (said) return said.textContent
       await new Promise((r) => setTimeout(r, 50))
     }
     return document.querySelector('.empty')?.textContent ?? '(no empty state at all)'
   })()`,
  session,
  true,
)
if (!String(unconfigured).includes('127.0.0.1:9'))
  await fail(`the page did not say the model is unreachable: ${JSON.stringify(unconfigured)}`, [
    'The probe is health.model in src/backend/services/HealthService.js and the',
    'empty state that renders it is in src/app/page.jsx.',
    ...problems,
  ])

console.log(
  `smoke: with no model reachable the page says so — ${JSON.stringify(String(unconfigured).slice(0, 60))}…`,
)

// --- the one thing a newcomer cannot know -----------------------------------
//
// What a stranger's server calls its model. The address they can be told; the
// name exists only inside that server, and this app's settings form is the only
// place it can come from. It used to REFUSE to ask: with the address filled and
// the name blank the check answered "Open settings and name the model that
// server should run", to somebody standing in settings, and the only route to
// the list was to type a name that did not exist and read the alternatives out
// of the complaint. A reviewer's verdict on whether a stranger could get from a
// cold page to an answer was "no, not reliably", and this was the reason.
//
// Driven through the form, because what is in question is the whole path: the
// button, the probe, the sentence and the field turning into a list.
const discovery = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 6000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     const protoFor = (node) =>
       node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
     const set = (node, value) => {
       Object.getOwnPropertyDescriptor(protoFor(node), 'value').set.call(node, value)
       node.dispatchEvent(new Event('input', { bubbles: true }))
     }

     pick('settings-toggle')?.click()
     const address = await until(() => pick('base-url'))
     if (!address) return { where: 'settings never opened' }
     // The address ALONE, which is all a person can be told.
     set(address, ${JSON.stringify(MODEL_URL)})
     set(pick('model'), '')
     await new Promise((r) => setTimeout(r, 60))

     pick('test-connection')?.click()
     const said = await until(() => pick('test-result')?.textContent)
     const field = pick('model')
     const answer = {
       said: said ?? '',
       tag: field?.tagName ?? '',
       offered: field?.tagName === 'SELECT' ? [...field.options].map((o) => o.value) : [],
     }
     // Closed again, and this is not tidiness: the next check opens this sheet
     // itself, and a toggle pressed on an already-open sheet closes it — which
     // made the phone check report that escape had failed.
     pick('settings-close')?.click()
     await until(() => !pick('settings'))
     return answer
   })()`,
  session,
  true,
)

if (discovery?.where) await fail(`the discovery path: ${discovery.where}`, problems)
if (!discovery.offered?.includes('scripted'))
  await fail(`the check did not offer what the server serves: ${JSON.stringify(discovery)}`, [
    'HealthService.model asks the endpoint when no model is named, and',
    'Settings.jsx turns the field into a list of what came back.',
    ...problems,
  ])

console.log(
  `smoke: an address alone was enough — the check answered ${JSON.stringify(String(discovery.said).slice(0, 80))} and offered ${discovery.offered.length} model(s)`,
)

// --- the settings sheet, on a phone -----------------------------------------
//
// The four blockers a usability reviewer found in one sitting were all in this
// screen, and none of them could be seen from a test that does not lay a page
// out. The worst: one `<option>` carried an agent's whole 258-character
// description, an option's text sizes its select, a select sizes its grid
// column, and the column dragged the heading, every field and the close button
// past the right edge — 1,813px of content on a 390px phone, where the sheet
// began at x=651 and the screen was black. There was no scrollbar to say so and
// no way out: escape did nothing, the backdrop did nothing, and the button that
// opened it was underneath the form. Since the only route to naming a model
// goes through here, a phone could never be made to work at all.
//
// So this is measured, at the width where it broke, on every run.
await send(
  'Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  session,
)
// The POINTER as well as the width, and they are two different overrides.
// `setDeviceMetricsOverride` resizes and nothing more: every touch-target rule
// in the stylesheet sits behind `@media (hover: none)`, and a check that only
// resized would measure the DESKTOP's controls at the phone's width and report
// them as passing. Measured: with the width alone,
// `matchMedia('(hover: none)').matches` is false.
//
// And it is touch emulation that flips it, not `setEmulatedMedia` — that
// command takes `prefers-color-scheme` and friends, and answers `false` for
// hover and pointer. Measured the same way, which is the only reason this line
// is the one it is.
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, session)
const phone = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 6000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     pick('settings-toggle')?.click()
     const sheet = await until(() => document.querySelector('form.sheet'))
     if (!sheet) return { where: 'settings never opened' }

     const wrap = pick('settings')
     const close = pick('settings-close').getBoundingClientRect()
     const widest = Math.max(
       ...[...sheet.querySelectorAll('*')].map((node) => node.getBoundingClientRect().right),
     )
     const out = {
       overflow: wrap.scrollWidth - wrap.clientWidth,
       page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
       closeRight: Math.round(close.right),
       widest: Math.round(widest),
       width: window.innerWidth,
     }

     // Escape, which is the exit every modal owes a person and the one this
     // sheet had none of.
     globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
     await new Promise((r) => setTimeout(r, 250))
     out.escaped = !pick('settings')

     // What a finger has to hit. Measured across everything on screen at once
     // rather than named control by control, because the finding was that the
     // LARGEST interactive element in the whole app was 44x40 and three were
     // under even 24x24 — a remove-attachment cross at 14x12, a dismiss at
     // 16x18. A list of names would have measured the ones somebody remembered.
     out.small = [...document.querySelectorAll('button, [role="tab"], input, select, textarea, summary, a')]
       .map((node) => ({ node, box: node.getBoundingClientRect() }))
       .filter(({ node, box }) => {
         if (!box.width || !box.height) return false
         // A hidden control is not a target: the skip link sits off-screen until
         // it takes focus, and a file picker is deliberately invisible. No
         // backticks in comments inside these bodies — the body is a template
         // literal and one ends the string. It has cost this file three runs.
         const style = getComputedStyle(node)
         if (style.visibility === 'hidden' || Number(style.opacity) === 0 || node.hidden)
           return false
         // Off-screen is not a target either: the skip link is parked above the
         // viewport until it takes focus, which is what a skip link is.
         return box.bottom > 0 && box.right > 0 && box.top < innerHeight
       })
       .filter(({ box }) => box.height < 44 || box.width < 24)
       // Concatenation, not a template literal: this whole body is one, and a
       // nested backtick ends the string. Third time in this file.
       .map(
         ({ node, box }) =>
           node.tagName +
           '.' +
           (node.className || node.type) +
           ' ' +
           Math.round(box.width) +
           'x' +
           Math.round(box.height),
       )
       .slice(0, 8)
     return out
   })()`,
  session,
  true,
)
await send('Emulation.clearDeviceMetricsOverride', {}, session)
await send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)

if (phone?.where) await fail(`the settings sheet ${phone.where} on a phone`, problems)
if (phone.overflow > 0 || phone.page > 0)
  await fail(`the settings sheet overflows a 390px phone: ${JSON.stringify(phone)}`, problems)
if (phone.closeRight > phone.width || phone.widest > phone.width)
  await fail(`part of the settings sheet is off the right edge: ${JSON.stringify(phone)}`, problems)
if (!phone.escaped)
  await fail('escape does not close the settings sheet, and on a phone nothing else did', problems)
if (phone.small?.length)
  await fail(`controls under a finger's size on a phone: ${phone.small.join(', ')}`, [
    'The floor is 44px tall on a coarse pointer; the rules are in globals.css',
    'under @media (hover: none).',
    ...problems,
  ])

console.log(
  `smoke: the settings sheet fits a 390px phone (widest ${phone.widest}px) and escape closes it`,
)

// --- the delegating turn, through the page a visitor gets --------------------
//
// Realm four above proves the thread; this proves the WHOLE path a person
// takes: settings the app boots with, a question typed into the composer, the
// parent agent choosing to delegate, a second thread answering it, the parent
// answering the person, and the rail saying what was happening while it did.
// Every layer here is the built artifact — the bundle, not the source tree —
// and the only thing standing in for reality is the model.
//
// The settings are planted in the store the app reads at boot rather than typed
// into the form, because what is under test is the turn and not the form; the
// page is reloaded onto them so nothing here depends on a state the running
// page already holds.
const planted2 = await evaluate(
  `(async () => {
     const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES, STORE_SCHEDULES } =
       await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
     const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
     const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
     const { DEFAULT_SETTINGS, SETTINGS_ID } = await import(${JSON.stringify(`${SRC_URL}/backend/services/SettingsService.js`)})
     const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       // Every store this version HAS. Naming three of four opened a v4
       // database with no schedules store on any run that reached here before
       // the app did — and an upgrade only runs once, so the app would never
       // create it either.
       STORE_SCHEDULES,
     ])
     await db.open()
     const settings = new IndexedDbRepository('Settings', db, STORE_SETTINGS)
     const saved = await settings.put({
       ...DEFAULT_SETTINGS,
       id: SETTINGS_ID,
       model: 'scripted',
       baseUrl: ${JSON.stringify(`http://127.0.0.1:${open.server.port}${MODEL_URL}`)},
     })
     return saved.toJSON()
   })()`,
  session,
  true,
)
if (!planted2?.ok)
  await fail(`could not plant the model settings: ${JSON.stringify(planted2)}`, problems)

const relaunched = Date.now()
await send('Page.navigate', { url }, session)
let up = 'none'
while (Date.now() - relaunched < 15000) {
  up = await evaluate(`document.querySelector('.wordmark')?.dataset.live ?? 'none'`, session)
  if (up === 'true') break
  if (problems.length) break
  await Bun.sleep(50)
}
if (up !== 'true')
  await fail(`the page did not come back for the delegating turn (${up})`, problems)

const turn = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 8000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     const input = pick('input')
     if (!input) return { where: 'there is no composer' }
     // Typed the way React hears it: the value setter on the ELEMENT's own
     // prototype, then an input event. Assigning .value alone updates the DOM
     // and not the state, so the form would submit an empty draft and the turn
     // would never start. The composer is a textarea now — it has to be, for a
     // page whose agent writes files — and HTMLInputElement's setter throws
     // "Illegal invocation" on one, which cost this check a run.
     const protoFor = (node) =>
       node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
     Object.getOwnPropertyDescriptor(protoFor(input), 'value').set.call(
       input,
       'Ask the researcher what the page says.',
     )
     input.dispatchEvent(new Event('input', { bubbles: true }))
     input.form.requestSubmit()

     // What the rail said WHILE it ran. WATCHED rather than sampled: a
     // delegated run against a scripted endpoint is over in milliseconds, and a
     // poll on a timer read the rail either side of the line it was there to
     // find. An observer sees every state the rail was ever in.
     const seen = new Set()
     /**
      * Whether the reply's CONTRACT was ever on screen while it arrived.
      *
      * Measured by a reviewer: somebody who asked what 17 times 4 is watched the
      * three scaffolding lines of the reply contract stream into the transcript
      * for the whole time they were paying most attention, and then watched all
      * three vanish. It cannot be sampled — the window is the length of one
      * streamed reply against a scripted endpoint — so the transcript is
      * watched for as long as the turn takes.
      *
      * No backticks in this comment: it lives inside a template literal, and
      * one would end the string.
      */
     const leaked = new Set()
     const readTranscript = () => {
       const text = pick('transcript')?.textContent ?? ''
       for (const field of ['think:', 'plan:', 'act:', 'result:']) {
         if (text.includes(field)) leaked.add(field)
       }
     }
     const leakWatcher = new MutationObserver(readTranscript)
     // The BODY, not the transcript. On a cold page there are no messages, so
     // the empty screen is what is mounted and the transcript element does not
     // exist yet — observing it would attach to null and this check would pass
     // by never having run. Measured: it did, on its first attempt.
     leakWatcher.observe(document.body, {
       childList: true,
       subtree: true,
       characterData: true,
     })

     const rail = pick('status')
     const watcher = new MutationObserver(() => {
       const text = rail?.textContent ?? ''
       if (text) seen.add(text)
     })
     if (rail) watcher.observe(rail, { subtree: true, childList: true, characterData: true })
     const sampling = setInterval(() => {
       const text = rail?.textContent ?? ''
       if (text) seen.add(text)
     }, 100)
     const answered = await until(
       () => [...document.querySelectorAll('.turn.assistant .text')].find((node) =>
         node.textContent.includes(${JSON.stringify(PARENT_ANSWER)}),
       ),
     )
     clearInterval(sampling)
     watcher.disconnect()
     readTranscript()
     leakWatcher.disconnect()
     return {
       answered: Boolean(answered),
       leaked: [...leaked],
       rail: [...seen],
       transcript: (pick('transcript')?.textContent ?? '').slice(-400),
       error: pick('error')?.textContent ?? '',
       notes: pick('notes')?.textContent ?? '',
     }
   })()`,
  session,
  true,
)

if (!turn?.answered)
  await fail(`the delegating turn never reached an answer: ${JSON.stringify(turn)}`, [
    'The parent agent was scripted to call researcher() and then answer with',
    `${PARENT_ANSWER}. See tools: in agents/main/agent.md and the peers list in`,
    'src/backend/services/ChatService.js.',
    ...problems,
  ])
// The rail SAID a second agent was working, in words, while it was. Without
// this the whole channel — agentWorker's onStep, the pool's progress branch,
// the DELEGATE event, the line in page.jsx — can be deleted with every test
// still green, because no test outside a browser can render a component.
// And the reply's CONTRACT was never on screen while it arrived. `phrasing.js`
// answers one question — where does the answer begin — and shows nothing before
// it; without this check the whole of that can be deleted and every other test
// stays green, because no test outside a browser watches text stream.
if (turn.leaked?.length)
  await fail(`the reply's contract was drawn in the transcript: ${turn.leaked.join(' ')}`, [
    'visibleStream in src/app/phrasing.js decides what is shown while a reply',
    'is still arriving, and Transcript.jsx draws it.',
    ...problems,
  ])

const railSaid = (turn.rail ?? []).join(' | ')
// In words. The line used to read `researcher: fetch (3)` — a name, a function
// and a number — and now reads "researcher is reading a page", which is the
// same three facts as one sentence. What is asserted is unchanged: the DELEGATE
// event reached a surface a person can read while the sub-agent was working.
if (!railSaid.includes('researcher is '))
  await fail(`the rail never named the sub-agent while it worked: ${railSaid}`, [
    'Expected a line like "researcher is reading a page" from the DELEGATE event.',
    ...problems,
  ])
// And a clock that moved, which is the difference between an app that is
// working and an app that is wedged, for a reader who cannot see either.
// The separator is a middle dot now — "working · 12s" — because the line is a
// sentence rather than a chip. The number is what this asserts and it is
// unchanged.
const clocks = new Set(
  (turn.rail ?? []).flatMap((text) =>
    [...text.matchAll(/working\s*·?\s*(\d+)s/g)].map((m) => m[1]),
  ),
)
if (!clocks.size) await fail(`the rail never showed an elapsed time: ${railSaid}`, problems)

console.log(
  `smoke: a typed question was delegated and answered through the built page; ` +
    `the rail said ${JSON.stringify([...new Set((turn.rail ?? []).filter((t) => t.includes('researcher is ')))][0] ?? '')} while it worked`,
)

// --- work that outlives the turn that asked for it ---------------------------
//
// A delegated call blocks the parent for as long as the child takes, which is
// the right shape when the answer IS the reply and the wrong one when it is
// not. `researcher({..., "wait": false})` hands the question over and comes
// straight back with a receipt; the context block reports it from the next turn
// onward, and `check_task` spends a call to read what it said.
//
// Two typed questions, because that is what the feature IS: the notification
// can only arrive on a turn, and there is no turn between turns. The first
// hands the work over and answers immediately; the second is where the context
// block says it is done and the parent reads it back.
const handover = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 15000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     // The setter of the element's OWN prototype. The composer is a
     // textarea now — it has to be, for a page whose agent writes files —
     // and HTMLInputElement's setter throws "Illegal invocation" on one.
     const protoFor = (node) =>
       node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
     const say = async (text, expected) => {
       const input = await until(() => {
         const field = pick('input')
         return field && !field.disabled ? field : null
       })
       if (!input) return null
       Object.getOwnPropertyDescriptor(protoFor(input), 'value').set.call(input, text)
       input.dispatchEvent(new Event('input', { bubbles: true }))
       input.form.requestSubmit()
       return until(() =>
         [...document.querySelectorAll('.turn.assistant .text')].find((node) =>
           node.textContent.includes(expected),
         ),
       )
     }

     const started = await say(${JSON.stringify(HANDOVER_QUESTION)}, ${JSON.stringify(HANDOVER_STARTED)})
     if (!started) return { where: 'the parent never answered the hand-over turn' }
     const read = await say('and what did it say?', ${JSON.stringify(HANDOVER_READ)})
     if (!read) {
       return {
         where: 'the parent never read the handed-over answer back',
         transcript: (pick('transcript')?.textContent ?? '').slice(-300),
       }
     }
     return { started: true, read: true }
   })()`,
  session,
  true,
)

if (!handover?.read)
  await fail(`the handed-over task never came back: ${JSON.stringify(handover)}`, [
    'The receipt comes from AgentWorkerPool.start, the line naming it comes from',
    'ChatService._backgroundContext, and check_task reads it back. The agent must',
    'name check_task in agents/main/agent.md tools: for any of that to be reachable.',
    ...problems,
  ])

console.log(
  'smoke: a question was handed to another agent, answered while the parent carried on, ' +
    'and read back on a later turn through the context block',
)

// --- a question that asks itself --------------------------------------------
//
// The scheduler is a timer in the page, a lease on `navigator.locks` so that
// two tabs do not both fire, and a route that says what is due. None of that
// can be executed anywhere but here: `bun test` has no page, no lock manager
// and no clock anyone is watching.
//
// A one-minute period is the floor, and waiting one is not something a gate may
// do. It USED to be free: `create` wrote `lastRanAt: 0`, which made every new
// schedule 56 years overdue and fired a turn into the open conversation on the
// button press — a reviewer set "every hour" and watched it run at once. That
// is fixed, so what this half proves is the panel and the route: the schedule
// is made through the form and comes back listed, with a time it will next run.
// The firing is proved by the OVERDUE case below, which is the one that
// actually happens anyway.
const scheduled = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 8000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     // Through the panel, not through the route: what is in question is the
     // wiring — a rail button, a mounted pane, a form that reaches the backend
     // — and only a click crosses all of it.
     // The four panels are sections of ONE drawer now rather than four
     // buttons across the top of the screen, so a section toggle does not
     // exist until the drawer is open. docs/INTERFACE.md has the argument;
     // what it costs a check is this line. No backticks in this comment: it
     // lives inside a template literal, and one would end the string.
     const openDrawer = async (id) => {
       if (!pick(id)) pick('drawer-toggle')?.click()
       return await until(() => pick(id))
     }
     const toggle = await openDrawer('schedule-toggle')
     if (!toggle) return { where: 'the rail has no plans button' }
     toggle.click()
     const field = await until(() => pick('plan-text'))
     if (!field) return { where: 'the plans pane never rendered' }
     // The setter of the element's OWN prototype. The composer is a
     // textarea now — it has to be, for a page whose agent writes files —
     // and HTMLInputElement's setter throws "Illegal invocation" on one.
     const protoFor = (node) =>
       node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
     Object.getOwnPropertyDescriptor(protoFor(field), 'value').set.call(
       field,
       ${JSON.stringify(`say ${SCHEDULED_MARK}`)},
     )
     field.dispatchEvent(new Event('input', { bubbles: true }))
     pick('plan-add').click()
     const listed = await until(() => pick('plan-list'))
     if (!listed) return { where: 'the schedule was not listed after adding it' }
     // Two facts about the row, and the second is what a person needs from a
     // recurring job: the panel said "never run yet" and then "last ran just
     // now" and never once said when it would happen again.
     return {
       listed: listed.textContent,
       asked: [...document.querySelectorAll('.turn.user .text')].some((node) =>
         node.textContent.includes(${JSON.stringify(SCHEDULED_MARK)}),
       ),
     }
   })()`,
  session,
  true,
)
if (!scheduled?.listed)
  await fail(`the schedule was not made through the panel: ${JSON.stringify(scheduled)}`, problems)
if (!String(scheduled.listed).includes('next '))
  await fail(`the schedule row never says when it next runs: ${JSON.stringify(scheduled)}`, [
    'ScheduleService.whenNext is the answer and SchedulePanel renders it.',
    ...problems,
  ])
// And it did NOT run on the press. "every hour" plainly means the first one is
// an hour away, and a question appearing in the open transcript at that moment
// is content the person did not ask for, in the conversation they are reading.
if (scheduled.asked)
  await fail('making a schedule asked its question immediately', [
    'A new schedule counts from when it was written; see ScheduleService.whenNext.',
    ...problems,
  ])

console.log(
  `smoke: a schedule was made through the panel, says when it next runs, and did not fire on the press — ${JSON.stringify(String(scheduled.listed).slice(0, 90))}`,
)

// --- and the overdue one, which is the case a closed tab makes ---------------
//
// The check above proves a NEW schedule fires. It cannot prove the case that
// actually happens — a schedule whose period elapsed while the tab was shut —
// because a fresh record carries `lastRanAt: 0` and is due for a different
// reason. This plants a record that ran two hours ago on an hourly period, which
// is only reachable by writing the store directly: a gate may not wait an hour.
const overdue = await evaluate(
  `(async () => {
     const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES, STORE_SCHEDULES } =
       await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
     const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
     const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
     const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       STORE_SCHEDULES,
     ])
     await db.open()
     // The conversation the page will open, which is the first one it lists.
     // A schedule belonging to any other conversation is correctly ignored, so
     // planting one there would prove the opposite of what this checks.
     const conversations = await new IndexedDbRepository('Conversation', db, STORE_CONVERSATIONS).list()
     const conversationId = conversations.value?.[0]?.id
     if (!conversationId) return { where: 'there is no conversation to schedule into' }
     const hour = 60 * 60 * 1000
     const saved = await new IndexedDbRepository('Schedule', db, STORE_SCHEDULES).put({
       id: 'overdue-check',
       text: 'say ' + ${JSON.stringify(OVERDUE_MARK)},
       everySeconds: 3600,
       conversationId,
       createdAt: Date.now() - 4 * hour,
       lastRanAt: Date.now() - 2 * hour,
     })
     return { planted: saved.ok, conversationId }
   })()`,
  session,
  true,
)
if (!overdue?.planted)
  await fail(`could not plant an overdue schedule: ${JSON.stringify(overdue)}`, problems)

await send('Page.navigate', { url }, session)
const asked = await evaluate(
  `(async () => {
     for (let i = 0; i < 400; i++) {
       const said = [...document.querySelectorAll('.turn.user .text')].find((node) =>
         node.textContent.includes(${JSON.stringify(OVERDUE_MARK)}),
       )
       if (said) return { asked: said.textContent }
       await new Promise((r) => setTimeout(r, 50))
     }
     return { asked: '' }
   })()`,
  session,
  true,
)
if (!asked?.asked)
  await fail('a schedule that came due while the tab was shut was never asked', [
    'What is due comes from ScheduleService.due, which compares now against',
    'lastRanAt — see the overdue-not-skipped argument in that file.',
    ...problems,
  ])

console.log(
  `smoke: a schedule overdue by an hour asked itself on reopening — ${JSON.stringify(asked.asked)}`,
)

// --- a person writing into the agent's files, against the agent -------------

// The reading half of the workspace was proved above. This is the way IN, and
// it is proved against the writer it was built to lose to: the agent rewrites
// the same file while a person has it open in the editor, and the save is
// refused rather than silently taking the agent's work with it. A unit test can
// show the precondition returning false; only this can show that the page holds
// the text the edit STARTED from and not the text a turn-end re-read replaced
// it with, which is the one way this design can be got wrong and still pass.
const edit = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     const until = async (get, ms = 6000) => {
       for (let i = 0; i < ms / 50; i++) {
         const value = get()
         if (value) return value
         await new Promise((r) => setTimeout(r, 50))
       }
       return null
     }
     const type = (node, text) => {
       const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
       Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(node, text)
       node.dispatchEvent(new Event('input', { bubbles: true }))
     }

     if (!pick('file-list')) {
       if (!pick('files-toggle')) pick('drawer-toggle')?.click()
       const toggle = await until(() => pick('files-toggle'))
       if (!toggle) return { where: 'the rail has no files button' }
       toggle.click()
       if (!(await until(() => pick('file-list')))) return { where: 'the files pane never opened' }
     }

     // IN, through the control a person actually has: a file off their machine,
     // handed to the picker the way the browser hands one over.
     const picker = pick('file-picker')
     if (!picker) return { where: 'there is no way to add a file' }
     const carrier = new DataTransfer()
     carrier.items.add(
       new File([${JSON.stringify(CONFLICT_READ)}], ${JSON.stringify(CONFLICT_PATH)}, {
         type: 'text/plain',
       }),
     )
     picker.files = carrier.files
     picker.dispatchEvent(new Event('change', { bubbles: true }))

     const shown = await until(() => {
       const body = pick('file-text')
       return body && body.textContent.includes(${JSON.stringify(CONFLICT_READ)})
         ? body.textContent
         : null
     })
     if (!shown) return { where: 'the added file never came back through the store' }

     // The edit begins HERE, and this text is the precondition from now on.
     const start = pick('file-edit')
     if (!start) return { where: 'an open file offers no way to edit it' }
     start.click()
     const editor = await until(() => pick('file-editor'))
     if (!editor) return { where: 'the editor never rendered' }
     type(editor, ${JSON.stringify(EDITED_TEXT)})

     // And now the other writer runs, with the edit still open. The turn-end
     // re-read is suppressed while a draft exists — if it were not, the pane
     // would take the agent's text and the save below would sail through.
     const input = pick('input')
     if (!input) return { where: 'there is no composer' }
     type(input, ${JSON.stringify(CONFLICT_QUESTION)})
     input.form.requestSubmit()
     const finished = await until(() =>
       [...document.querySelectorAll('.turn .text')].some((node) =>
         node.textContent.includes(${JSON.stringify(CONFLICT_DONE)}),
       ),
     )
     if (!finished) return { where: 'the agent never rewrote the file' }

     const stillEditing = pick('file-editor')?.value ?? ''

     // The save, which must be refused.
     pick('file-save')?.click()
     const refusal = await until(() => {
       const said = pick('files-problem')
       return said && said.textContent.includes('changed since') ? said.textContent : null
     })

     // Give it up, re-read, and see whose text survived.
     pick('file-cancel')?.click()
     const after = await until(() => {
       const body = pick('file-text')
       return body && body.textContent.includes(${JSON.stringify(CONFLICT_AGENT)})
         ? body.textContent
         : null
     })

     // Then the same edit, on the text that is actually there, which must land.
     pick('file-edit')?.click()
     const second = await until(() => pick('file-editor'))
     if (!second) return { where: 'the editor never came back' }
     type(second, ${JSON.stringify(CONFLICT_ACCEPTED)})
     pick('file-save')?.click()
     const saved = await until(() => {
       const body = pick('file-text')
       return body && body.textContent.includes(${JSON.stringify(CONFLICT_ACCEPTED)})
         ? body.textContent
         : null
     })

     return { shown, stillEditing, refusal: refusal ?? '', after: after ?? '', saved: saved ?? '' }
   })()`,
  session,
  true,
  // Six waits, a real turn and a store round trip in one expression: the
  // default ceiling is ten seconds and this block can legitimately spend more
  // than that before it has anything to say.
  60_000,
)

if (edit?.where) await fail(`the way in to the agent's files: ${edit.where}`, problems)
// The editor still holds the person's own text, and not the agent's. This is
// the assertion the whole block exists for: a re-read that fired here would
// make every other line below pass while the design was broken.
if (edit.stillEditing !== EDITED_TEXT)
  await fail(
    `the editor's text moved under the person: ${JSON.stringify(edit.stillEditing)}`,
    problems,
  )
if (!edit.refusal.includes(CONFLICT_PATH))
  await fail(
    `a save over the agent's rewrite was not refused — the page said ${JSON.stringify(edit.refusal)}`,
    [
      'Workspace.write takes { expect } and FilesService refuses a write without one.',
      'FilesPanel keeps draft.base, which is the text the edit started from.',
      ...problems,
    ],
  )
if (!edit.refusal.includes('Re-read it'))
  await fail(
    `the refusal never said what to do about it: ${JSON.stringify(edit.refusal)}`,
    problems,
  )
// The agent's work is still there, which is what the refusal was protecting.
if (!edit.after.includes(CONFLICT_AGENT))
  await fail(`the refused save took the agent's text with it anyway`, problems)
if (!edit.saved.includes(CONFLICT_ACCEPTED))
  await fail(`a save against the current text was refused as well`, problems)

console.log(
  `smoke: a file was handed in through the picker, the agent rewrote it under an open editor, ` +
    `the save was refused (${JSON.stringify(edit.refusal.slice(0, 58))}…) and the same edit landed on a re-read`,
)

// --- two tabs, one transcript, one writer -----------------------------------

// The lock is held by a promise that never settles, which is the whole
// mechanism and the one part of it that cannot be unit tested: `navigator.locks`
// releases when the callback's promise SETTLES, so a callback that returns
// holds the lock for a microtask and hands it to everybody. Two real tabs is
// the only place that difference is visible.
const { result: secondTab } = await send('Target.createTarget', { url })
const { result: secondAttached } = await send('Target.attachToTarget', {
  targetId: secondTab.targetId,
  flatten: true,
})
const other = secondAttached.sessionId
await send('Runtime.enable', {}, other)

const readerState = async (which) =>
  evaluate(
    `(async () => {
       const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
       for (let i = 0; i < 200; i++) {
         if (document.querySelector('.wordmark')?.dataset.live === 'true') break
         await new Promise((r) => setTimeout(r, 50))
       }
       // One more settle, because the election is a lock request and the first
       // paint after the live flag can be either side of its answer.
       await new Promise((r) => setTimeout(r, 400))
       // The lock itself, so a disagreement between the two tabs can be read as
       // what it is: two tabs on two DIFFERENT conversations are both writers
       // and that is correct, which a banner assertion alone cannot tell from
       // an election that simply did not happen.
       const state = await navigator.locks.query()
       const mine = (list) =>
         list.filter((entry) => entry.name.startsWith('askk-conversation:')).map((e) => e.name)
       return {
         says: pick('reader-only')?.textContent ?? '',
         disabled: Boolean(pick('input')?.disabled),
         placeholder: pick('input')?.placeholder ?? '',
         held: mine(state.held ?? []),
         waiting: mine(state.pending ?? []),
       }
     })()`,
    which,
    true,
    30_000,
  )

const reader = await readerState(other)
const holder = await readerState(session)

if (!reader.says.includes('Another tab has this conversation open'))
  await fail(
    `a second tab on the same conversation was not made a reader: ${JSON.stringify(reader)}`,
    [
      'The election is the useEffect in src/app/page.jsx that requests',
      'askk-conversation:<id> and holds it with a promise that never settles.',
      ...problems,
    ],
  )
if (!reader.disabled) await fail('the second tab could still type into the transcript', problems)
if (holder.says) await fail('the tab that holds the lock also called itself a reader', problems)
if (holder.disabled) await fail('the tab that holds the lock cannot write either', problems)

// And the promotion, which is why the request queues instead of asking
// `ifAvailable` once: the tab that was waiting becomes the writer when the one
// holding it goes away, without being reloaded.
await send('Page.navigate', { url: 'about:blank' }, session)
const promoted = await evaluate(
  `(async () => {
     const pick = (id) => document.querySelector('[data-testid="' + id + '"]')
     for (let i = 0; i < 200; i++) {
       if (!pick('reader-only') && pick('input') && !pick('input').disabled) return { promoted: true }
       await new Promise((r) => setTimeout(r, 50))
     }
     const state = await navigator.locks.query()
     const names = (list) => (list ?? []).map((entry) => entry.name + ':' + entry.clientId)
     return {
       promoted: false,
       reader: Boolean(pick('reader-only')),
       disabled: Boolean(pick('input')?.disabled),
       held: names(state.held),
       waiting: names(state.pending),
     }
   })()`,
  other,
  true,
  30_000,
)
if (!promoted?.promoted)
  await fail(
    `the waiting tab never became the writer after the holder went away: ${JSON.stringify(promoted)}`,
    [
      'A request with ifAvailable answers once and leaves the second tab read-only',
      'until it is reloaded; this one queues. See the election in src/app/page.jsx.',
      ...problems,
    ],
  )

await send('Target.closeTarget', { targetId: secondTab.targetId })
await send('Page.navigate', { url }, session)
{
  const back = Date.now()
  let live = 'none'
  while (Date.now() - back < 15000) {
    live = await evaluate(`document.querySelector('.wordmark')?.dataset.live ?? 'none'`, session)
    if (live === 'true') break
    await Bun.sleep(50)
  }
  if (live !== 'true') await fail('the page did not come back after the two-tab check', problems)
}

console.log(
  'smoke: two tabs on one conversation elected one writer, the other said so and could not type, ' +
    'and it was promoted when the holder went away',
)

// --- realm two: the classic worker nothing bundles --------------------------

// Booted with a guest and asked to run it, not merely asked to refuse. The
// refusal path this used to take returns before `runOnce` touches one shim
// symbol: measured, emptying `wasi-util.js` — and emptying the file that
// defines `WASI` — both passed the whole gate. Running the tiny guest drives
// `new WASI`, `Ciovec`, `Subscription`, `Event` and `EventType`, so a missing
// one arrives here as a name that is not defined.
const sandbox = await evaluate(
  `new Promise((resolve) => {
     const worker = new Worker(${JSON.stringify(`${BASE}/sandbox/vm-worker.js`)}, { name: 'smoke' })
     const settle = (answer) => { worker.terminate(); resolve(answer) }
     worker.onerror = (event) => settle('did not load: ' + (event.message || 'no message'))
     let announced = 0
     worker.onmessage = (event) => {
       const data = event.data ?? {}
       // The download, reported as it arrives. It is counted rather than
       // ignored: the whole point of the message is that the largest fetch
       // this app makes said nothing at all for as long as it took, and a
       // check that skipped it would go green over a silent one again.
       if (data.type === 'boot-progress') { announced += 1; return }
       if (data.type === 'booted') {
         if (!announced) { settle('booted without saying a byte had arrived'); return }
         worker.postMessage({ type: 'run', id: 'smoke', argv: ['smoke'] })
         return
       }
       if (data.type !== 'result') { settle('answered ' + JSON.stringify(data)); return }
       // The trap and the message are carried through verbatim. A shim class
       // that is not there fails inside the guest run, and the only place that
       // says so is the string the worker hands back.
       settle(
         data.ok && data.stdout === ${JSON.stringify(TINY_GUEST_STDOUT)} && data.code === 0
           ? 'ok'
           : 'ran the guest and returned ' + JSON.stringify(data),
       )
     }
     worker.postMessage({ type: 'boot', wasmUrl: ${JSON.stringify(GUEST_URL)} })
     setTimeout(() => settle('no answer in 5s'), 5000)
   })`,
  session,
  true,
)

if (sandbox !== 'ok') await fail(`the sandbox worker ${sandbox}`, problems)

// --- realm three: the real guest, through the tree's own port ---------------

// The whole claim of this project is a static page with its own environment
// that can get work done inside it. Everything above proves the wiring; only
// this proves the environment. Two waves measured this guest and neither ever
// ran it through `src/backend/sandbox/C2wSandbox.js`, so the one thing this
// step must not do is measure a copy: the module below is imported from the
// repository's own `src/`, and the image and worker come out of the export.
//
// Two halves, because neither alone is the claim:
//
//   the chunk scan   proves the URL `composition.js` DERIVES reached the
//                    artifact. Before this slice `imageUrl` came from a
//                    variable nothing set, so the built bundle contained
//                    `imageUrl:""` and the string `sandbox.wasm` appeared
//                    nowhere in `out/_next/` at all. Source-level proof cannot
//                    see that, because the source was always readable and
//                    always wrong.
//   the browser run  proves the module, the classic worker, the WASI shim and
//                    the emulator actually run a command, hand back what
//                    it printed, and hand back the status it exited with.
//
// The string searched for is the one THIS build was configured with, read from
// the same config the build read. Hardcoding `/sandbox/sandbox.wasm` made the
// gate red on the one procedure `composition.js` argues for — a
// `SANDBOX_IMAGE=<url> bun run build` compiled the override into the chunk, the
// scan could not find the default, and the step blamed a file that was correct.
const CONFIGURED_IMAGE = config.env.NEXT_PUBLIC_SANDBOX_IMAGE || SANDBOX_IMAGE_PATH
const chunks = join(OUT, '_next', 'static', 'chunks')
const carriers = readdirSync(chunks)
  .filter((name) => name.endsWith('.js'))
  .filter((name) => readFileSync(join(chunks, name), 'utf8').includes(CONFIGURED_IMAGE))
if (!carriers.length)
  await fail(`no built chunk names the guest image (${CONFIGURED_IMAGE})`, [
    'The backend was compiled with no image URL in it, so every shell call in',
    'this artifact returns UNAVAILABLE without fetching a byte. See the sandbox',
    'wiring in src/backend/composition.js.',
  ])

// An override names a host this gate cannot serve, so the browser run below
// uses the copy in the export and says so. What it proves is unchanged — the
// module, the classic worker, the shim and the emulator all run a command —
// and what it does not prove, that the override's host answers, is a property
// of a deploy rather than of this tree.
if (config.env.NEXT_PUBLIC_SANDBOX_IMAGE)
  console.log(
    `smoke: this build points at ${CONFIGURED_IMAGE}; the browser run below uses the copy in out/.`,
  )

if (!existsSync(IMAGE_FILE)) {
  // SAID, not skipped silently. The image is a BUILD OUTPUT — the raw module it
  // is compressed from is gitignored and the container build that makes both is
  // not cheap — so a fresh clone genuinely has none, and failing here would make
  // the gate impossible to run before `scripts/wasm/build.sh` has ever been run.
  // What is NOT skipped is the chunk scan above: a build that forgot where its
  // guest lives is a source fault and fails on any machine.
  console.log(
    `smoke: SKIPPED the real guest — ${IMAGE_FILE} is not there (build it with scripts/wasm/build.sh). The wiring was still checked: ${carriers.join(', ')} names it.`,
  )
} else {
  // Imported, not reimplemented. `C2wSandbox.js` is plain JavaScript with no
  // transpile over it, so the browser loads the file this repository holds,
  // with its own `../../core/Outcome.js` resolving to the real one beside it.
  const real = await evaluate(
    `(async () => {
       const { C2wSandbox } = await import(${JSON.stringify(`${SRC_URL}/backend/sandbox/C2wSandbox.js`)})
       const box = new C2wSandbox({
         imageUrl: ${JSON.stringify(IMAGE_URL)},
         workerUrl: ${JSON.stringify(`${BASE}/sandbox/vm-worker.js`)},
       })
       const available = box.available
       const at = performance.now()
       // The first call pays for the whole image: fetch, inflate, compile,
       // instantiate and boot. The second pays for an instance and a boot only,
       // which is the number that says what a second command costs.
       const first = await box.run('uname -a')
       const cold = Math.round(performance.now() - at)
       const warm = performance.now()
       const failing = await box.run('ls /definitely-not-here')
       const hot = Math.round(performance.now() - warm)

       // --- the agent's files, in a real IndexedDB, through the real guest ---
       //
       // One boot does all three halves of the claim, because a boot is ~750 ms
       // and this step is run many times an hour: the command READS a file that
       // was in the store before it started, CREATES one that has to end up
       // there afterwards, and EXITS NON-ZERO so that the status still belongs
       // to the command rather than to the base64 the frame runs after it.
       const {
         DB_NAME,
         DB_VERSION,
         STORE_CONVERSATIONS,
         STORE_SETTINGS,
         STORE_FILES,
         STORE_SCHEDULES,
       } =
         await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
       const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
       const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
       const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
       const { ShellTool } = await import(${JSON.stringify(`${SRC_URL}/core/tools/ShellTool.js`)})
       const { Outcome } = await import(${JSON.stringify(`${SRC_URL}/core/Outcome.js`)})

       const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       // Every store this version HAS. Naming three of four opened a v4
       // database with no schedules store on any run that reached here before
       // the app did — and an upgrade only runs once, so the app would never
       // create it either.
       STORE_SCHEDULES,
     ])
       const opened = await db.open()
       const files = new Workspace(new IndexedDbRepository('File', db, STORE_FILES))
       const kept = await files.write('smoke-note.md', 'written before the reload')
       // Nested, because a path with a folder in it is the first thing a real
       // src/ workspace hits and the only thing that drives the mkdir prelude in
       // ShellTool._stage. The guest's working directory starts empty, so
       // without it this file's printf writes into a folder that is not there.
       const nested = await files.write('src/deep.txt', 'deep')

       // A RECORDER, not a fake: every member delegates to the real sandbox and
       // the only thing added is that the line handed to the guest is kept. It
       // is what lets the assertion below be about the budget rather than about
       // a number this file copied out of ShellTool.
       const seen = []
       const recording = (run) => ({
         get available() {
           return box.available
         },
         get commandBudget() {
           return box.commandBudget
         },
         cost: (text) => box.cost(text),
         run: (line, options) => {
           seen.push(line)
           return run(line, options)
         },
       })

       // The command is padded to spend the guest's WHOLE budget, and the pad is
       // measured rather than written down: one call through a recorder that
       // boots nothing says exactly what the frame and the two staged files took,
       // and the rest is the pad. Written down it would be a second copy of
       // ShellTool's own frame, in a file that cannot see the first.
       const base =
         'cat smoke-note.md src/deep.txt; echo harvested >made-in-the-guest.txt; false #'
       const dry = recording(async () => Outcome.ok({ stdout: '', code: 0 }))
       await new ShellTool({ sandbox: dry, files }).call({ command: base })
       const pad = box.commandBudget - box.cost(seen[0])
       seen.length = 0

       const bridged = await new ShellTool({ sandbox: recording((line, options) => box.run(line, options)), files }).call({
         command: base + 'x'.repeat(Math.max(0, pad)),
       })
       const sent = box.cost(seen[0] ?? '')

       await box.close()
       return {
         available,
         cold,
         hot,
         first: first.toJSON(),
         failing: failing.toJSON(),
         storage: opened.ok,
         kept: kept.toJSON(),
         nested: nested.toJSON(),
         bridged: bridged.toJSON(),
         budget: box.commandBudget,
         pad,
         sent,
       }
     })()`,
    session,
    true,
    // The ceiling is the whole image fetch, inflate, compile and two guest
    // boots, not a protocol round trip. Measured here at ~1.7 s over loopback.
    120000,
  )

  const said = (what) => JSON.stringify(what)
  // Over the two URLs THIS FILE wrote, so it is not evidence about the built
  // page and is not offered as any: the chunk scan above is the whole of that,
  // and it is a substring rather than an observation. Asserted anyway because
  // the getter is real — turning it into `return false` fails here. What no
  // step proves is that `composition.js` yields a true `available` INSIDE the
  // artifact; importing it here dies on `process is not defined`, because only
  // the bundler inlines NEXT_PUBLIC_*.
  if (!real?.available) await fail(`the real sandbox reported available=${said(real)}`, problems)
  if (!real.first.ok)
    await fail(`the real guest did not run: ${said(real.first.failure)}`, problems)
  // A real Linux, not a string this file could have written. Asserted rather
  // than printed, because a step that prints what nobody compares passes over
  // an empty answer.
  if (!real.first.value.stdout.startsWith('Linux '))
    await fail(`the guest did not answer uname: ${said(real.first.value)}`, problems)

  // The failing command. Its diagnostic comes back because the worker sends
  // fd 2 to the same buffer as fd 1, so a command that failed is readable at all.
  if (!real.failing.value.stdout.includes('No such file or directory'))
    await fail(`a failing command said nothing: ${said(real.failing)}`, problems)

  // The status, which until this slice could only ever be 0: c2w's `proc_exit`
  // is the emulator's, so `ls /nope`, `false` and `exit 7` all reported success
  // and `Sandbox.js`'s promise that a non-zero exit is a readable RESULT was
  // never kept. `C2wSandbox` now asks the shell for what it knows. This is the
  // assertion that stands where a red-on-repair pin used to; it is asserted
  // HERE and not in a unit test because a fake sandbox proves nothing about
  // what the real guest's shell prints.
  if (real.failing.value.code !== 1)
    await fail(`the guest reported exit ${real.failing.value.code}, not 1`, [
      'A command that failed is being reported to the agent as a success.',
      'See the STATUS marker in src/backend/sandbox/C2wSandbox.js.',
    ])
  // And the marker itself is stripped: an agent must never read it as output.
  if (real.failing.value.stdout.includes('__askk_rc'))
    await fail(`the status marker reached the caller: ${said(real.failing.value.stdout)}`, problems)

  // The image was COMPRESSED on the wire and the worker inflated it. Asserted
  // from the note the sandbox announces once per boot, because that note is the
  // only place either number is observable, and the two must differ: a gzip
  // stream does not start with `\0asm`, so a build that shipped the raw module
  // under this name, or a loader that stopped inflating, fails here rather than
  // silently sending a visitor the whole uncompressed module. The numbers
  // themselves are the guest's own, not this file's.
  //
  // This asserts a property of THIS SERVER as much as of the artifact. Two sizes
  // appear only because this file's own server answers the `.gz` with no
  // `Content-Encoding`; a host that sets it has already inflated the body, the
  // loader's magic-byte sniff correctly does nothing, and one size is the right
  // answer there. Do not "fix" the sniff to satisfy this line — the assertion is
  // narrower than the loader on purpose, and it is narrow because this file owns
  // the server it is measuring.
  const sizes = real.first.notes.find((note) =>
    note.startsWith('the Linux machine in this tab was downloaded'),
  )
  const transfer = sizes?.match(
    /downloaded once: (\d+) bytes over the network, (\d+) bytes unpacked/,
  )
  if (!transfer)
    await fail(`the guest did not report a compressed transfer: ${said(real.first.notes)}`, [
      'The image the page loads is gzipped, because the raw module is over',
      "GitHub's 100 MiB per-file limit and the compressed one is under it.",
      'See inflated() in public/sandbox/vm-worker.js, and the derived URL',
      'in src/backend/composition.js.',
    ])

  console.log(
    `smoke: the real guest answered ${said(real.first.value.stdout.trim())} in ${real.cold}ms cold, ` +
      `then a failing command in ${real.hot}ms warm (exit ${real.failing.value.code}); ` +
      `${transfer[1]} bytes fetched, inflated to ${transfer[2]}`,
  )

  // --- the agent's own files -------------------------------------------------
  //
  // The claim is that the agent has files: that they outlive a command, that
  // the shell can both READ and WRITE them, and that they are still there after
  // the tab is reloaded. None of it can be proved anywhere but here — a unit
  // test's store is a Map, and a unit test's guest is a fake that returns
  // whatever the test wrote into it.
  if (!real.storage)
    await fail('the browser would not open IndexedDB, so nothing was proved', problems)
  if (!real.kept.ok) await fail(`the file was not written: ${said(real.kept.failure)}`, problems)
  if (!real.nested.ok)
    await fail(`the nested file was not written: ${said(real.nested.failure)}`, problems)

  // THE WHOLE BUDGET, spent. This first check is a PRECONDITION and not the
  // claim: it says the padding really landed on the ceiling, so that the guest
  // assertions below are being made about the largest line this tool will ever
  // send rather than about a comfortable one. It can only fail if growing the
  // command pushed a staged file back out of the line.
  if (real.sent !== real.budget)
    await fail(`the padded command spent ${real.sent} of a ${real.budget} budget`, [
      'The pad is computed from a dry run through a recorder, so this can only',
      'differ if the staging no longer fits beside it. See _stage() in',
      'src/core/tools/ShellTool.js.',
    ])
  // THE CLAIM. At that ceiling the guest either runs the line or answers
  // `too many write (1025 > 1024)`, and only a guest can say which — so
  // `MAX_COMMAND_COST`, `cost`, `wrap` and `frame` are settled together here
  // and nowhere else. WATCHED FAILING: `MAX_COMMAND_COST` at 1012 puts this
  // line past what the guest takes and this is the line that reports it. The
  // guard is conservative by up to eight on a real line, so a mutation of one
  // or two does not reach here; the sweep that fixes the ceiling is in
  // `C2wSandbox`, and this is the assertion that the declared budget is
  // SPENDABLE rather than a number nothing ever reaches.
  //
  // The unit test that used to claim this borrowed the budget NUMBER off a fake
  // and certified a limit the real guest would not take: the guest charges a
  // space twice, and 800 bytes of ordinary shell came back as the emulator's
  // refusal, handed to the agent as its own command's output.
  if (real.bridged.value.includes('too many write'))
    await fail(`the guest refused a command inside its own budget: ${said(real.bridged.value)}`, [
      'The budget is priced in bytes, plus one for every space and newline, by',
      'cost() in src/backend/sandbox/C2wSandbox.js. The guest disagrees with it.',
    ])

  // Staged IN. Both files existed only in the database when the command
  // started, and the guest printed both — so the command line carried them
  // across, and the nested one proves the `mkdir -p` prelude, since the guest's
  // working directory starts empty and `src/` is not in it.
  if (!real.bridged.value.includes('written before the reload'))
    await fail(`the guest could not read the agent's file: ${said(real.bridged.value)}`, [
      'A file the command named was not placed in the working directory.',
      'See _stage() in src/core/tools/ShellTool.js.',
      ...problems,
    ])
  if (!real.bridged.value.includes('deep'))
    await fail(`the guest could not read a file in a folder: ${said(real.bridged.value)}`, [
      'src/deep.txt was named by the command and its folder was never made.',
      'See the mkdir prelude in _stage(), src/core/tools/ShellTool.js.',
      ...problems,
    ])
  // The status is still the COMMAND's. `find` and `base64` run after it inside
  // the same line, so without `exit $_r` every failing command that touched a
  // file would be reported to the agent as a success.
  if (!real.bridged.value.includes('(exit 1)'))
    await fail(`the status was lost inside the file frame: ${said(real.bridged.value)}`, problems)
  // And the frame's own chatter is not shown as output.
  if (real.bridged.value.includes('__askk_f'))
    await fail(`the harvest markers reached the agent: ${said(real.bridged.value)}`, problems)
  // A file the command CREATED, not one it was handed: the staged file comes
  // back in the same note because it is still in the working directory, and an
  // assertion on the whole sentence would be an assertion about that instead.
  if (
    !real.bridged.notes.some(
      (note) => note.startsWith('saved to your files:') && note.includes('made-in-the-guest.txt'),
    )
  )
    await fail(`the guest's file was not saved: ${said(real.bridged.notes)}`, problems)

  // --- and after a reload ----------------------------------------------------
  //
  // A second page load against the same origin, so the database is the one the
  // first load wrote and not a fresh one. This is the whole of "survives a
  // reload": everything above would pass identically over a Map.
  const reloaded = Date.now()
  await send('Page.navigate', { url }, session)
  let back = 'none'
  while (Date.now() - reloaded < 15000) {
    back = await evaluate(`document.querySelector('.wordmark')?.dataset.live ?? 'none'`, session)
    if (back === 'true') break
    if (problems.length) break
    await Bun.sleep(50)
  }
  if (back !== 'true')
    await fail(`the page did not come back after a reload (data-live=${back})`, problems)

  const survived = await evaluate(
    `(async () => {
       const {
         DB_NAME,
         DB_VERSION,
         STORE_CONVERSATIONS,
         STORE_SETTINGS,
         STORE_FILES,
         STORE_SCHEDULES,
       } =
         await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
       const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
       const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
       const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
       const db = new IndexedDb(DB_NAME, DB_VERSION, [
       STORE_CONVERSATIONS,
       STORE_SETTINGS,
       STORE_FILES,
       // Every store this version HAS. Naming three of four opened a v4
       // database with no schedules store on any run that reached here before
       // the app did — and an upgrade only runs once, so the app would never
       // create it either.
       STORE_SCHEDULES,
     ])
       const files = new Workspace(new IndexedDbRepository('File', db, STORE_FILES))
       return { listed: (await files.list()).toJSON(), guest: (await files.read('made-in-the-guest.txt')).toJSON() }
     })()`,
    session,
    true,
  )

  const names = (survived?.listed?.value ?? []).map((file) => file.path)
  if (!names.includes('smoke-note.md'))
    await fail(`the agent's file did not survive the reload: ${said(survived)}`, [
      'It was written to IndexedDB before the reload and the store is empty after it.',
      'See the files store in src/backend/composition.js.',
      ...problems,
    ])
  // The one the GUEST wrote, which is the half a store alone cannot prove: it
  // came back out of the emulator on stdout, was decoded here, and is in a
  // database that has since been closed and reopened by a new page load.
  if (survived?.guest?.value?.text !== 'harvested\n')
    await fail(
      `what the guest wrote did not survive the reload: ${said(survived?.guest)}`,
      problems,
    )

  console.log(
    `smoke: the agent's files survived a reload — ${names.join(', ')}; ` +
      `the guest read two off a command line spending all ${real.budget} of its budget ` +
      `(${real.pad} of it padding) and wrote one back out`,
  )
}

if (problems.length) await fail('the page booted but the browser reported errors', problems)

await shutdown()
console.log(`smoke: ready in ${bootMs}ms, the sandbox ran a guest, no console errors`)
