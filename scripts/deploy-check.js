#!/usr/bin/env bun
/**
 * Open the DEPLOY OUTPUT in a real browser and make it answer four questions
 * nothing else in this tree can ask.
 *
 * `bun run smoke` boots `out/` from a server that also serves `src/` and hands
 * the sandbox two URLs of its own. That is the right shape for a gate — it
 * proves the modules run — and it is the wrong shape for a deploy, because the
 * page it drives is helped in two ways a visitor is not. This drives `dist/`
 * over a host that sends NOTHING: no COOP, no COEP, no CORP, no
 * `Content-Encoding` on the guest, which is what GitHub Pages measurably sends.
 * Nothing here reads `src/`.
 *
 * The four questions, and why each needed a browser:
 *
 *   ISOLATION. A static host cannot set COOP or COEP, so a deployed page is not
 *   cross-origin isolated and has no `SharedArrayBuffer`. The architecture says
 *   it does not need either. That is a claim about a browser, and it is checked
 *   in one — page realm and worker realm both — against the deploy, not against
 *   a probe page.
 *
 *   WHAT A VISITOR PAYS ON FIRST LOAD. Counted off the wire, as
 *   `encodedDataLength`, from navigation to the moment the page reports ready.
 *   The guest is most of the deploy — `docs/GATE.md` holds the sizes — and
 *   whether it arrives before anything runs is the difference between a page
 *   that opens and a page that downloads.
 *
 *   WHEN THE GUEST ARRIVES. `composition.js` states, where it constructs the
 *   sandbox, that "the first `shell` call is what pays for it". Nothing had ever
 *   watched. Two turns are sent — one that needs no tool, one that needs the
 *   shell — and the network log says which of them fetched it.
 *
 *   THE LOOP. A shell command, run through the page's own agent: composer,
 *   backend worker, ReAct engine, real model, ShellTool, C2wSandbox, classic
 *   worker, emulator, and back into the transcript. The smoke imports
 *   `C2wSandbox` from `src/` and constructs it by hand; this one never touches
 *   it, so it is the only thing that proves `composition.js` yields a working
 *   sandbox INSIDE the artifact. The model in that sentence is a real one, on
 *   the operator's own machine — see `MODEL_URL` below, which is where the
 *   address comes from and where it is checked before anything is spent.
 *
 * Usage:  bun scripts/deploy-check.js [--dir dist]
 *         MODEL_URL=http://host:port/v1 MODEL_NAME=<id> bun scripts/deploy-check.js
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { attachBrowser, findChrome } from './browser.js'

const REPO = join(import.meta.dir, '..')

// `parseArgs`, which refuses `--dir` with no value where seven lines of
// `indexOf` handed `undefined` on to `existsSync` and then to a stack.
let values
try {
  ;({ values } = parseArgs({ options: { dir: { type: 'string' } } }))
} catch (cause) {
  console.error(`\ndeploy-check: ${cause.message}`)
  console.error('  Usage: bun scripts/deploy-check.js [--dir <dir>]')
  console.error('  MODEL_URL and MODEL_NAME name the model the two turns are driven against.')
  process.exit(1)
}
const DIST = values.dir ?? join(REPO, 'dist')

/**
 * The model this check drives the page against, and where it is.
 *
 * `MODEL_URL` is an OpenAI-compatible base address and `MODEL_NAME` the id sent
 * as `model`; the defaults are the testbed `docs/TESTBED.md` records, so an
 * operator who already ran this needs to change nothing and one with a server
 * elsewhere needs to change no file.
 *
 * They are read HERE, and named at all, because they used to be read nowhere.
 * `SettingsService.DEFAULT_SETTINGS` shipped exactly this address and exactly
 * this model, so a page opened with no configuration was already pointed at a
 * real server and this check inherited that silently — it configured nothing
 * and proved the loop anyway. Those defaults are gone: they were one machine's,
 * and the app advertised that model in its header as live while the page under
 * it said there was none. What was an unstated default of the application is
 * now a stated default of the check that needs it.
 *
 * `||` rather than `??` so that an exported-but-empty variable means the
 * default, instead of an empty address the probe below then has to name.
 */
const MODEL_URL = process.env.MODEL_URL || 'http://127.0.0.1:8873/v1'
const MODEL_NAME = process.env.MODEL_NAME || 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp'

/**
 * Long enough for a laptop's own server to wake, short enough to be a check.
 *
 * The same ceiling `HealthService` gives its own probe, because this asks the
 * same server the same question and a check that gave up sooner than the app
 * does would refuse a setup the app is happy with.
 */
const MODEL_PROBE_MS = 4000

/**
 * The two turns, and neither is decoration.
 *
 * The first must NOT need a tool. It is the control for the whole
 * fetched-on-demand claim: if the guest arrives during a turn that asked for
 * nothing, then it is the turn and not the tool call that pays, and the comment
 * in `composition.js` is wrong about what a visitor is charged for.
 *
 * The second must need the shell and must have an answer this file cannot
 * write. `uname -a` prints a kernel string the emulator's own Alpine chose.
 */
const CONTROL_TURN = 'Reply with exactly: OK'
const SHELL_TURN = 'Run `uname -a` in the sandbox and show me exactly what it printed.'

/** The host is this file's; the browser belongs to `scripts/browser.js`. */
const open = { server: null, browser: null }

async function shutdown() {
  await open.browser?.close()
  open.server?.stop(true)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdown().then(() => process.exit(130))
  })
}

async function fail(message, details = []) {
  await shutdown()
  console.error(`\ndeploy-check: ${message}`)
  for (const line of details) console.error(`  ${line}`)
  process.exit(1)
}

if (!existsSync(DIST))
  await fail(`there is no ${DIST} to check — run \`bun scripts/deploy.js\` first`)

/**
 * What the artifact says about itself, written into it by `scripts/deploy.js`.
 *
 * NOT `../next.config.js`. This file used to take the prefix it serves at from
 * the developer's working tree, which is the leak `git archive` exists to close,
 * occurring inside the check that reports on it. Measured: changing only
 * `basePath` in the working-tree config and re-running this against an
 * unmodified, CORRECT `dist/` condemned it — "the deployed page never reached
 * ready in 56ms", with a 404 on a chunk, blaming the page for the reader's edit.
 * A `dist/` built from any ref is now checked at the prefix it was built for.
 */
const manifestFile = join(DIST, 'deploy.json')
if (!existsSync(manifestFile))
  await fail(`${DIST} has no deploy.json, so it cannot say what prefix it was built for`, [
    'Every directory `bun scripts/deploy.js` writes carries one. A directory',
    'without it was made some other way, and serving it at a guessed prefix is',
    'how a correct deploy gets condemned.',
  ])
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const BASE = manifest.basePath

// A deploy pointed at a foreign host has no guest to serve and no guest to
// watch arrive, so almost every cell below would be measuring nothing. Said
// rather than half-run.
if (!manifest.sandboxImage.startsWith('/'))
  await fail(`${DIST} was built to load its guest from ${manifest.sandboxImage}`, [
    'This check drives a SELF-CONTAINED export: it serves the guest itself, over',
    'both header profiles, and counts who fetched it. A foreign host is measured',
    'by scripts/probe/, and has never been measured through this page.',
  ])

const chrome = findChrome()
if (chrome.problem) await fail(chrome.problem, chrome.details)

// --- the model, asked before a browser is launched --------------------------

/**
 * Is there anything at that address at all?
 *
 * This is the one precondition that used to be discovered at the END. With no
 * model the two turns below never answer, each waits out its own 300 s ceiling,
 * and the run closes by reporting that the loop never surfaced the guest's
 * output — which blames the loop, the sandbox and the emulator for a server
 * nobody started. Ten minutes to say "there is no model" is not a check, so it
 * is asked here, for four seconds, before a Chromium is spawned or a byte is
 * served.
 *
 * A GET on `/models` and nothing else: the same request `HealthService` makes,
 * so a server this refuses is a server the page would refuse too. Not a
 * completion, which would spend tokens to find out; not a HEAD, which several
 * OpenAI-compatible servers answer 405 to.
 */
const endpoint = await (async () => {
  try {
    const said = await fetch(`${MODEL_URL}/models`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(MODEL_PROBE_MS),
    })
    return { status: said.status, body: await said.text() }
  } catch (cause) {
    // Refused, unresolvable, or four seconds of silence — all the same fact to
    // a reader, and the message is kept because "ECONNREFUSED" and "timed out"
    // are different things to do next.
    return { problem: cause?.message ?? String(cause) }
  }
})()

if (endpoint.problem)
  await fail(`nothing answered at ${MODEL_URL}`, [
    `GET ${MODEL_URL}/models said: ${endpoint.problem}`,
    'This check needs a real model BY DESIGN. It is the only thing in this tree',
    'that drives the whole loop through the artifact a stranger downloads, and',
    'there is no scripted endpoint in it standing in for one, as there is in',
    'scripts/smoke.js — a scripted model would prove the page can talk to this',
    'file rather than to a model.',
    'Start a server at that address, or name the one you have:',
    `  MODEL_URL   the OpenAI-compatible base address, now ${MODEL_URL}`,
    `  MODEL_NAME  the model id to ask for, now ${MODEL_NAME}`,
  ])

/**
 * What that server says it serves, when it says so in the usual shape.
 *
 * Printed and NOT asserted. Plenty of OpenAI-compatible servers ignore the
 * `model` field entirely and answer with whatever is loaded, so refusing a name
 * that is not in the listing would refuse setups that work — but a mismatch is
 * also the second way this run can spend ten minutes on nothing, and a reader
 * who can see both lines finds it in one.
 */
const serves = (() => {
  try {
    const listed = JSON.parse(endpoint.body)?.data
    return Array.isArray(listed) ? listed.map((one) => one?.id).filter(Boolean) : []
  } catch {
    return []
  }
})()

console.log(`deploy-check: ${MODEL_URL} answered ${endpoint.status}, driving ${MODEL_NAME}`)
if (serves.length && !serves.includes(MODEL_NAME))
  console.log(
    `  note: that endpoint lists ${serves.length} model(s) and this is not one of them — ${serves.slice(0, 5).join(', ')}`,
  )

// --- a host that sends nothing ----------------------------------------------

/** The same bytes, served the OTHER way a host may answer a `.gz`. See below. */
const ENCODED_PATH = `${BASE}/__encoded/sandbox.wasm.gz`
const CONTROL_404 = `${BASE}/__no_such_file`
const GUEST_PATH = `${BASE}${manifest.sandboxImage}`

const guestFile = join(DIST, manifest.sandboxImage.slice(1))
// Said as a sentence, not as an ENOENT stack. A deploy directory without the
// guest is the exact state this whole slice exists to end — it is what is on
// `gh-pages` today — so it is the one input most likely to be handed here, and
// answering it with a `statSync` trace names the wrong thing entirely.
if (!existsSync(guestFile))
  await fail(`${DIST} has no ${manifest.sandboxImage.slice(1)}`, [
    'That is a deploy of the page without its environment, which is the state',
    'the live site is in. Rebuild it with `bun scripts/deploy.js`, which refuses',
    'to produce one.',
  ])
const guestBytes = statSync(guestFile).size

open.server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname

    // Named, so a cell can prove which process answered and what it did not
    // send. A pass against a host that was quietly adding COOP and COEP would
    // be a measurement of the wrong thing, and this is the line that rules it out.
    const stamped = (body, extra = {}) =>
      new Response(body, { headers: { server: 'askk-deploy/1', ...extra } })

    if (path === CONTROL_404)
      return new Response('not found', { status: 404, headers: { server: 'askk-deploy/1' } })

    // The arm where the host DOES declare the encoding. GitHub Pages measurably
    // does not — it answers a `.gz` as `application/gzip` with no
    // `Content-Encoding`, so `fetch` hands the loader raw gzip bytes and the
    // magic-byte sniff fires. A host that declares it has already inflated the
    // body, the sniff correctly does nothing, and the loader must still work.
    // Both arms are measured because the loader claims to serve both and only
    // one of them has ever been run.
    if (path === ENCODED_PATH)
      return stamped(Bun.file(guestFile), {
        'content-type': 'application/wasm',
        'content-encoding': 'gzip',
      })

    if (path === '/favicon.ico') return new Response(null, { status: 204 })
    if (!path.startsWith(BASE))
      return new Response('not found', { status: 404, headers: { server: 'askk-deploy/1' } })

    let rel = path.slice(BASE.length)
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const file = Bun.file(join(DIST, rel))
    if (!(await file.exists()))
      return new Response('not found', { status: 404, headers: { server: 'askk-deploy/1' } })

    // A `.gz` as raw gzip bytes with NO `Content-Encoding`, which is what a real
    // GitHub Pages site sends — measured on one that already serves a `.gz`,
    // recorded in `docs/GATE.md`. Bun would otherwise label it `application/gzip`
    // itself; it is set here so the answer does not depend on a library's guess.
    if (rel.endsWith('.gz')) return stamped(file, { 'content-type': 'application/gzip' })
    return stamped(file)
  },
})
const origin = `http://127.0.0.1:${open.server.port}`
const url = `${origin}${BASE}/`

// --- the driver -------------------------------------------------------------

/** Flattened, so every realm's events arrive on the one connection. */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }

/** Every request any realm made, by id, with what it actually cost on the wire. */
const wire = new Map()
/** The response headers of the 404 control, which is how the host's silence is proved. */
let controlHeaders = null

open.browser = await attachBrowser({
  chromePath: chrome.path,
  whenLost: fail,
  onEvent: (message, send) => {
    // A WORKER TARGET, and this is the whole reason the network numbers below
    // mean anything. The guest is fetched by the classic sandbox worker, two
    // realms down from the page — page -> module worker -> classic worker — and
    // a `Network.enable` on the page session cannot see one byte of it. The
    // first run of this file reported the guest fetched ZERO times in a turn
    // whose answer was the guest's own `uname` output, which is what a blind
    // instrument looks like when it is not asked to fail. Each new target is
    // attached and asked for its own network, and asked to do the same for
    // whatever it spawns, because the realm that matters here is the nested one.
    if (message.method === 'Target.attachedToTarget') {
      const child = message.params.sessionId
      send('Network.enable', {}, child).catch(() => {})
      send('Target.setAutoAttach', AUTO_ATTACH, child).catch(() => {})
      send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {})
      return
    }
    const p = message.params
    if (message.method === 'Network.requestWillBeSent')
      wire.set(p.requestId, { url: p.request.url, bytes: 0, at: Date.now(), done: 0 })
    if (message.method === 'Network.responseReceived' && p.response.url.endsWith(CONTROL_404))
      controlHeaders = p.response.headers
    if (message.method === 'Network.loadingFinished') {
      const record = wire.get(p.requestId)
      if (record) {
        record.bytes = p.encodedDataLength
        record.done = Date.now()
      }
    }
  },
})

const { session, send, evaluate, problems: reported } = open.browser

/**
 * What the browser complained about, minus the complaint this file asked for.
 *
 * The 404 control is requested on purpose — it is how the host is proved to be
 * sending no COOP and no COEP — so Chrome's console error about it is the check
 * working rather than the page failing. Excluded by URL and not by wording,
 * because the wording is Chrome's to change.
 */
const problems = () => reported.filter((line) => !line.includes(CONTROL_404))

await send('Network.enable', {}, session)
await send('Target.setAutoAttach', AUTO_ATTACH, session)

/** Everything on the wire so far, in the shape every cell below reads it. */
const traffic = () => [...wire.values()]
const fetched = (needle) => traffic().filter((r) => r.url.includes(needle))
const spent = (records) => records.reduce((sum, r) => sum + r.bytes, 0)

// --- the page ---------------------------------------------------------------

console.log(`deploy-check: ${DIST} served at ${url} with no COOP, no COEP, no CORP`)

const navigated = Date.now()
await send('Page.navigate', { url }, session)

let live = 'none'
while (Date.now() - navigated < 20000) {
  live = await evaluate(`document.querySelector('.wordmark')?.dataset.live ?? 'none'`, session)
  if (live === 'true') break
  if (problems().length) break
  await Bun.sleep(50)
}
const readyMs = Date.now() - navigated
if (live !== 'true') await fail(`the deployed page never reached ready in ${readyMs}ms`, problems())

// Counted here, before a single interaction, because this is the number a
// visitor pays to see anything at all.
const onLoad = traffic()
const loadBytes = spent(onLoad)
const guestOnLoad = fetched('sandbox.wasm')

// --- the isolation cells ----------------------------------------------------

const control = await evaluate(
  `fetch(${JSON.stringify(CONTROL_404)}).then(r => r.status)`,
  session,
  true,
)
const isolation = await evaluate(
  `(async () => {
     const page = { coi: crossOriginIsolated, sab: typeof SharedArrayBuffer }
     // A classic worker in this page's realm, asked for its OWN isolation rather
     // than the page's — the page's is not a statement about its workers, and
     // inheritance was exactly the assumption worth checking. Classic and from a
     // blob because the question is about the realm, not about which file is in it.
     const source = 'self.postMessage({coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer})'
     const worker = new Worker(URL.createObjectURL(new Blob([source])))
     const inWorker = await new Promise((resolve) => {
       worker.onmessage = (e) => resolve(e.data)
       setTimeout(() => resolve({ coi: 'no answer', sab: 'no answer' }), 5000)
     })
     worker.terminate()
     const workers = await navigator.serviceWorker.getRegistrations()
     return { page, worker: inWorker, serviceWorkers: workers.length }
   })()`,
  session,
  true,
)

// The other half of the same question, and the half a browser cannot answer:
// whether a service worker that synthesises COOP and COEP is even in the
// artifact. `scripts/probe/page/coi-serviceworker.js` exists in this repository
// and the probe README claims the build cannot reach it. Checked against the
// deploy rather than trusted.
// `dot: true` because `.nojekyll` and `deploy.json` are part of what shipped,
// and a scan of the export that silently skips files is the wrong instrument for
// a question of the form "is X in the export".
const shipped = [...new Bun.Glob('**/*').scanSync({ cwd: DIST, dot: true })]
const isolationSources = shipped.filter((name) => {
  if (!/\.(js|mjs|html|json)$/.test(name)) return false
  const text = readFileSync(join(DIST, name), 'utf8')
  return text.includes('coi-serviceworker') || text.includes('serviceWorker.register')
})

console.log('')
console.log('## isolation, on the deploy')
console.log(
  // All THREE, because the banner above claims all three. CORP was named in the
  // claim and missing from the proof, and this line exists precisely so the pass
  // is not taken on trust.
  `  404 CONTROL          status=${control} server=${controlHeaders?.server ?? '(none)'} coop=${controlHeaders?.['cross-origin-opener-policy'] ?? '(absent)'} coep=${controlHeaders?.['cross-origin-embedder-policy'] ?? '(absent)'} corp=${controlHeaders?.['cross-origin-resource-policy'] ?? '(absent)'}`,
)
console.log(
  `  page                 crossOriginIsolated=${isolation.page.coi}  SharedArrayBuffer=${isolation.page.sab}`,
)
console.log(
  `  classic worker       crossOriginIsolated=${isolation.worker.coi}  SharedArrayBuffer=${isolation.worker.sab}`,
)
console.log(
  `  service workers      registered=${isolation.serviceWorkers}  files in the export that register one=${isolationSources.length || 'none'}`,
)

console.log('')
console.log('## what a first visit pays, cold cache')
console.log(
  `  ready in ${readyMs}ms after ${onLoad.length} requests, ${loadBytes} bytes on the wire`,
)
console.log(
  `  the export is ${shipped.length} files, ${shipped.reduce((sum, name) => sum + statSync(join(DIST, name)).size, 0)} bytes on disk`,
)
console.log(
  `  the guest (${guestBytes} bytes) was requested ${guestOnLoad.length} time(s) before the first turn`,
)

// --- the settings the two turns are driven on -------------------------------

/**
 * The model, written into the store the app boots from, and a reload onto it.
 *
 * HERE and not sooner, which is the whole reason the cells above are worth
 * reading: everything before this line was measured on the page exactly as a
 * stranger gets it, with nothing configured, because that is what "what a first
 * visit pays" means. Only the two turns need a model, so only they get one.
 *
 * Written to the database rather than typed into the settings form because what
 * is under test is the turn and not the form — `scripts/smoke.js` plants the
 * same record for the same reason, and this is that block with its imports
 * taken out. It cannot import `SettingsService` or `composition.js`: this file
 * serves `dist/` over a host that offers nothing else, and reading the working
 * tree to describe an artifact built from some other ref is the exact leak
 * `deploy.json` exists to close. So the database, its version, its stores and
 * the record's id are spelled out below — and every way the database can
 * disagree with one of them comes back as a sentence rather than as silence.
 */
const planted = await evaluate(
  `(() => new Promise((resolve) => {
     // The database and version buildKernel opens. A version that has moved on
     // arrives here as a VersionError from the open, which is said rather than
     // silently worked around: this file cannot know what a newer schema wants.
     const request = indexedDB.open('askk', 4)
     request.onupgradeneeded = () => {
       const db = request.result
       // Every store this version has, not only the one being written. Naming
       // one of four would leave the app opening a database with no
       // conversations, no files and no schedules — an upgrade runs once, so it
       // would never create them either.
       for (const store of ['conversations', 'settings', 'files', 'schedules'])
         if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
     }
     request.onerror = () =>
       resolve({ where: 'the database would not open: ' + (request.error?.message ?? 'refused') })
     // The page is holding this database open, so a version bump would block
     // rather than fail. Answered as a sentence instead of waiting out the
     // caller's ceiling with no reason attached.
     request.onblocked = () => resolve({ where: 'the page is holding the database open' })
     request.onsuccess = () => {
       const db = request.result
       // An id and two fields. SettingsService.get merges what it reads over
       // DEFAULT_SETTINGS, so a record carrying only the two the defaults no
       // longer hold IS a complete configuration — and writing the other twenty
       // from here would be this file keeping its own copy of somebody else's
       // defaults, wrong from the first one that changes.
       const record = {
         id: 'inference',
         model: ${JSON.stringify(MODEL_NAME)},
         baseUrl: ${JSON.stringify(MODEL_URL)},
       }
       const change = db.transaction('settings', 'readwrite')
       change.objectStore('settings').put(record)
       // On complete, not on the request's own success: a put that succeeds in
       // a transaction that then aborts has written nothing.
       change.oncomplete = () => {
         db.close()
         resolve({ saved: record })
       }
       change.onabort = () =>
         resolve({ where: 'the write was abandoned: ' + (change.error?.message ?? 'aborted') })
       change.onerror = () =>
         resolve({ where: 'the settings store refused it: ' + (change.error?.message ?? '') })
     }
   }))()`,
  session,
  true,
)
if (!planted?.saved)
  await fail(`could not plant the model settings: ${planted?.where ?? JSON.stringify(planted)}`, [
    'The store is STORE_SETTINGS in src/backend/composition.js and the record is',
    'the one SETTINGS_ID names in src/backend/services/SettingsService.js.',
    ...problems(),
  ])

const relaunched = Date.now()
await send('Page.navigate', { url }, session)
let configured = 'none'
while (Date.now() - relaunched < 20000) {
  configured = await evaluate(
    `document.querySelector('.wordmark')?.dataset.live ?? 'none'`,
    session,
  )
  if (configured === 'true') break
  if (problems().length) break
  await Bun.sleep(50)
}
if (configured !== 'true')
  await fail(
    `the page did not come back on the planted settings (data-live=${configured}) after ${Date.now() - relaunched}ms`,
    problems(),
  )

// And the page agrees there is a model, which is the half a write cannot prove.
// `page.jsx` sets `ready` strictly after `health.model` answers — there is an
// await between the two — so a page reporting live has already rendered its own
// verdict, and one read is enough. It renders it in the empty frame, which is on
// screen because `scripts/browser.js` launches into a throwaway profile: the
// conversation this page has just made itself has nothing in it yet. Without
// this line a record planted under a name the app does not read, or an endpoint
// the browser cannot reach for a reason this process cannot see, is again a
// discovery made ten minutes later and attributed to the loop.
const saidNoModel = await evaluate(
  `document.querySelector('[data-testid="no-model"]')?.textContent ?? ''`,
  session,
)
if (saidNoModel)
  await fail('the page cannot reach the model that was planted for it', [
    `The page says: ${saidNoModel}`,
    `${MODEL_URL} answered THIS process, so what is between them is the browser:`,
    'a server that will not answer a page from another origin (the testbed sends',
    'access-control-allow-origin: *), or a record that landed somewhere the app',
    'does not read.',
    ...problems(),
  ])

console.log('')
console.log('## the model the turns are driven on')
console.log(`  ${MODEL_NAME} at ${MODEL_URL}, planted in settings and the page reloaded onto it`)

// --- turn one: the control, which needs no tool -----------------------------

const compose = (text) => `(() => {
  const input = document.querySelector('[data-testid="input"]')
  // The native setter, not \`input.value =\`. React installs its own property on
  // the element and reads the change off its own event; assigning through the
  // instance updates the DOM and leaves React's state holding the empty string,
  // so the send button stays disabled and the form submits nothing.
  // The setter of the element's OWN prototype. The composer is a textarea now
  // and HTMLInputElement's setter throws "Illegal invocation" on one.
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify('')} + ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.form.requestSubmit()
  return true
})()`

const snapshot = `(() => {
  const turns = [...document.querySelectorAll('.turn')].map((t) => ({
    who: t.querySelector('.who')?.textContent ?? '',
    text: t.querySelector('.text')?.textContent ?? '',
  }))
  return {
    pending: Boolean(document.querySelector('[data-testid="pending"]')),
    turns,
    steps: [...document.querySelectorAll('[data-testid^="step-"]')].map((s) => s.textContent),
    // The page's own account of the turn, and where the sandbox's boot note
    // lands — the two image sizes, and the ENOTSUP list. It is the only witness
    // to the boot that lives inside the artifact rather than in this file's
    // instruments, so a page and a browser that disagree are visible.
    notes: [...document.querySelectorAll('[data-testid="notes"] li')].map((n) => n.textContent),
    error: document.querySelector('[data-testid="error"]')?.textContent ?? '',
  }
})()`

/** Send one message and wait for the turn to finish, however long the model takes. */
async function turn(text, ceilingMs) {
  const before = (await evaluate(snapshot, session)).turns.length
  await evaluate(compose(text), session)
  const started = Date.now()
  // Kept as they arrive, not read at the end. `page.jsx` clears the live view the
  // moment a turn resolves — from then on the transcript IS the record — so a
  // reader that only looks afterwards finds an empty list and reports that a
  // multi-pass run took one pass.
  const steps = new Map()
  let state = null
  while (Date.now() - started < ceilingMs) {
    state = await evaluate(snapshot, session)
    for (const [index, step] of state.steps.entries()) steps.set(index, step)
    // Finished means the pending article is gone AND the transcript grew — a
    // stopped or failed turn clears the first without the second, and reading
    // only `pending` would call that a reply.
    if (!state.pending && state.turns.length > before) break
    if (state.error) break
    await Bun.sleep(250)
  }
  return { ...state, steps: [...steps.values()], ms: Date.now() - started }
}

console.log('')
console.log('## turn one — a question that needs no tool')
const controlTurn = await turn(CONTROL_TURN, 300000)
const guestAfterControl = fetched('sandbox.wasm')
console.log(`  sent  ${JSON.stringify(CONTROL_TURN)}`)
console.log(
  `  said  ${JSON.stringify((controlTurn.turns.at(-1)?.text ?? '').slice(0, 200))} in ${controlTurn.ms}ms`,
)
if (controlTurn.error) console.log(`  page error: ${controlTurn.error}`)
for (const note of controlTurn.notes) console.log(`  note  ${note}`)
console.log(`  the guest was requested ${guestAfterControl.length} time(s) by the end of this turn`)
// The claim, named and answered, rather than left as a count for a reader to
// interpret — and named at the file that HOLDS it. This printed
// `src/backend/sandbox/C2wSandbox.js` on every run, where the sentence is not:
// that file says only "an agent that never runs a command must not have
// downloaded it", which is TRUE, because MCP discovery is a command through
// that sandbox. The false sentence is in `src/backend/composition.js`, where the
// sandbox is constructed. A reader sent to the sandbox finds a correct comment
// and closes the finding, while the wrong one stays — which is how a tree learns
// to ignore its own alarms, printed here once per run.
//
// What is false: `src/core/mcp/discover.js` runs `printf … | <server>` through
// the same sandbox once per turn, before the prompt is rendered, so ANY first
// message pays for the image — including one that asks for nothing.
//
// Reported and not failed while it is false: the fix is a change in `src/`,
// which this check does not own, and a red here would only mean nobody could
// run it. The verdict below is what stops it going quiet.
console.log(
  guestAfterControl.length
    ? `  CLAIM REFUTED — "the first \`shell\` call is what pays for it" (src/backend/composition.js): a turn that called no tool fetched the image, because an agent declaring an mcp server runs one guest command per turn to list its tools`
    : `  CLAIM CONFIRMED — a turn that called no tool did not fetch the image`,
)

// --- turn two: the loop, with a real command --------------------------------

console.log('')
console.log('## turn two — a question that needs the sandbox')
const shellTurn = await turn(SHELL_TURN, 300000)
const guestRequests = fetched('sandbox.wasm')
console.log(`  sent  ${JSON.stringify(SHELL_TURN)}`)
for (const step of shellTurn.steps) console.log(`  step  ${JSON.stringify(step.slice(0, 300))}`)
const answer = shellTurn.turns.at(-1)?.text ?? ''
console.log(`  said  ${JSON.stringify(answer.slice(0, 500))} in ${shellTurn.ms}ms`)
if (shellTurn.error) console.log(`  page error: ${shellTurn.error}`)
for (const note of shellTurn.notes) console.log(`  note  ${note}`)

for (const record of guestRequests)
  console.log(
    `  guest ${record.url.replace(origin, '')} ${record.bytes} bytes in ${record.done - record.at}ms`,
  )

// --- the second host profile ------------------------------------------------

/**
 * The page's own worker, booted from one URL, in the page's own realm.
 *
 * Run TWICE, against the two ways a host may answer a `.gz`, because the loader
 * claims to serve both and only one of them was ever executed. The arm that
 * ships used to be a sentence this file wrote on the reader's behalf — "the
 * loader sniffed 1f 8b and inflated" — beside a cell that was measured, four
 * lines above an assertion whose own comment says a step that prints what
 * nobody compares passes over an empty answer.
 */
const bootFrom = (path) =>
  evaluate(
    `new Promise((resolve) => {
       const worker = new Worker(${JSON.stringify(`${BASE}/sandbox/vm-worker.js`)})
       worker.onmessage = (e) => { worker.terminate(); resolve(e.data) }
       worker.onerror = (e) => { worker.terminate(); resolve({ type: 'worker-error', message: e.message }) }
       worker.postMessage({ type: 'boot', wasmUrl: ${JSON.stringify(path)} })
       setTimeout(() => resolve({ type: 'no answer in 120s' }), 120000)
     })`,
    session,
    true,
    180000,
  )

const rawArm = await bootFrom(GUEST_PATH)
const encodedArm = await bootFrom(ENCODED_PATH)

console.log('')
console.log('## the two ways a host may answer a .gz')
console.log(`  no Content-Encoding (GitHub Pages)   ${JSON.stringify(rawArm)}`)
console.log(`  Content-Encoding: gzip               ${JSON.stringify(encodedArm)}`)

// --- verdict ----------------------------------------------------------------

const failures = []
if (isolation.page.coi !== false)
  failures.push(`the deployed page reported crossOriginIsolated=${isolation.page.coi}`)
if (isolation.page.sab !== 'undefined')
  failures.push(`SharedArrayBuffer exists on the deployed page (${isolation.page.sab})`)
if (guestOnLoad.length)
  failures.push(
    `the guest was fetched on page load — a visitor pays ${guestBytes} bytes to open the page`,
  )
if (!guestRequests.length)
  failures.push('no request for the guest image was ever made, so nothing here ran a real command')
// The kernel string the emulator's own Alpine prints. It is asserted rather
// than printed because a step that prints what nobody compares passes over an
// empty answer — and this file could not have written this line.
if (!answer.includes('Linux ') && !shellTurn.steps.some((s) => s.includes('Linux ')))
  failures.push(
    `the loop never surfaced the guest's output: ${JSON.stringify(answer.slice(0, 200))}`,
  )
// THE ARM GITHUB PAGES SENDS. Two different sizes or the magic-byte sniff did
// not fire — which is either a loader that stopped inflating or a raw module
// shipped under the `.gz` name, and the second one sends every visitor the
// uncompressed image. This is the property `scripts/smoke.js` already asserts
// for `out/`, asserted at last for the directory that reaches a stranger.
if (rawArm.type !== 'booted' || rawArm.transferred >= rawArm.bytes)
  failures.push(`the shipping arm was not inflated: ${JSON.stringify(rawArm)}`)
if (encodedArm.type !== 'booted')
  failures.push(
    `the guest did not boot from a host that declares Content-Encoding: ${JSON.stringify(encodedArm)}`,
  )
if (encodedArm.type === 'booted' && encodedArm.bytes !== encodedArm.transferred)
  failures.push(
    `a pre-inflated body was inflated twice: ${encodedArm.transferred} -> ${encodedArm.bytes}`,
  )
// A RECORDED EXPECTATION, and it fails on the day it comes true. The CLAIM
// REFUTED line above could only ever go quiet: make `discover.js` lazy and it
// flips to CONFIRMED with nothing holding it there, so the sentence in
// `composition.js` — wrong for every artifact shipped in between — is never
// rewritten. Measured 2026-09-01 against 25c8750: one request, on a turn that
// called no tool. When this fires, delete it and the line it guards.
if (!guestOnLoad.length && !guestAfterControl.length)
  failures.push(
    'the claim in src/backend/composition.js is now TRUE — a turn that called no tool did not ' +
      'fetch the guest. Delete this expectation and the CLAIM REFUTED line above with it.',
  )
// A throw inside an evaluation used to stop this run on the spot. It is now
// collected by `scripts/browser.js`, with every other thing the browser
// complained about, and answered here — so a page that threw cannot reach the
// closing paragraph, and every problem is named at once instead of the first.
for (const problem of problems()) failures.push(problem)

console.log('')
if (failures.length) await fail('the deploy did not clear the bar', failures)

await shutdown()
console.log('\ndeploy-check: the deployed page is not isolated, needs no SharedArrayBuffer,')
console.log('costs nothing extra to open, and ran a real command in a real Linux guest.')
