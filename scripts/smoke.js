#!/usr/bin/env bun
/**
 * Boot the built artifact in a browser and wait for both realms to answer.
 *
 * The other three steps of the gate cannot see a module that parses, resolves
 * and passes its unit tests yet cannot run in the realm it was written for.
 * docs/GATE.md has the fault table that measures exactly which faults reach
 * this step and which are caught earlier, and the designs rejected for it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../next.config.js'
import { TINY_GUEST_STDOUT, tinyGuest } from './wasm/tinyGuest.js'

const OUT = join(import.meta.dir, '..', 'out')

// Read from the config rather than repeated here. A smoke test served at a
// different prefix from the one built in would prove the wrong page works.
const BASE = config.basePath

/** Where a Chromium usually is, when nobody has said. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

/** Everything that needs tearing down, so one failure path can close all of it. */
const open = { server: null, chrome: null, socket: null, profile: null }

async function shutdown() {
  open.socket?.close()
  // SIGKILL and then WAIT. Measured: on SIGTERM Chrome writes its profile out
  // while shutting down, so an immediate `rmSync` deletes a directory the
  // browser then recreates — 14 runs left 14 profiles behind, and this machine
  // had 167 of them by the time anyone counted.
  open.chrome?.kill('SIGKILL')
  await open.chrome?.exited
  open.server?.stop(true)
  if (open.profile) rmSync(open.profile, { recursive: true, force: true })
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

// An explicit CHROME that is not there is an error, not a hint to look
// elsewhere. Falling back would run the check against a browser other than the
// one that was asked for and say nothing about it, which is how a green result
// stops meaning what its reader thinks.
const named = process.env.CHROME
if (named && !existsSync(named)) await fail(`CHROME is set to ${named}, and there is nothing there`)

const chromePath = named ?? CHROME_CANDIDATES.find((path) => existsSync(path))
if (!chromePath)
  await fail('no browser found', [
    'This step boots the built page in a real browser, because that is the only',
    'way to see a worker that cannot start. Install Chrome, or set CHROME to a',
    'Chromium binary.',
  ])

// --- the host ---------------------------------------------------------------

// Under the base path so the worker fetches it exactly the way it fetches a
// real guest image: same origin, same prefix, same `fetch` in the same realm.
const GUEST_URL = `${BASE}/__smoke/guest.wasm`

open.server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === GUEST_URL) return new Response(tinyGuest())
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

// --- the driver -------------------------------------------------------------

open.profile = mkdtempSync(join(tmpdir(), 'askk-smoke-'))
open.chrome = Bun.spawn(
  [
    chromePath,
    '--headless=new',
    // Port 0 means the OS picks one, so two agents checking at once do not
    // collide. Chrome writes the port it took into the profile directory.
    '--remote-debugging-port=0',
    // Fresh and discarded, so nothing needs suppressing. Do not add
    // `--disable-gpu` here: measured, it cost 0.93 s of a 1.8 s step.
    `--user-data-dir=${open.profile}`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
)

const portFile = join(open.profile, 'DevToolsActivePort')
const launched = Date.now()
while (!existsSync(portFile) && Date.now() - launched < 20000) await Bun.sleep(20)
if (!existsSync(portFile)) await fail('the browser did not start within 20s')
const [port, endpoint] = readFileSync(portFile, 'utf8').trim().split('\n')

open.socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`)
await new Promise((resolve) => {
  open.socket.addEventListener('open', resolve)
  // Reported, not rejected. A rejection here reaches the top level of a module
  // with nothing above it to catch, so the process would die around `shutdown`
  // and leave the browser it had just launched running with its profile.
  open.socket.addEventListener('error', () => fail('the browser refused a debugger connection'))
})

let seq = 0
const pending = new Map()

/**
 * Anything the browser reported that a user would call broken.
 *
 * Collected rather than thrown on, so a failing run names every problem at once
 * instead of the first one. A worker that fails to parse shows up here as a
 * `worker:` entry — that is the channel this whole file was written for.
 */
const problems = []

open.socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    pending.get(message.id)?.(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const { exception, text } = message.params.exceptionDetails
    problems.push(`page: ${exception?.description ?? text}`)
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    const { source, text, url: where } = message.params.entry
    problems.push(`${source}: ${text}${where ? ` <${where}>` : ''}`)
  }
})

/**
 * One request, one reply, and a ceiling on the wait.
 *
 * The two realm waits have their own ceilings; the protocol between them had
 * none, so the single failure that could hang `bun run check` for ever was a
 * browser that stopped answering. Ten seconds is far longer than any call here
 * takes and far shorter than an agent's patience.
 */
const send = (method, params, sessionId) =>
  new Promise((resolve) => {
    const id = ++seq
    const ceiling = setTimeout(() => fail(`the browser never answered ${method}`), 10000)
    pending.set(id, (message) => {
      clearTimeout(ceiling)
      resolve(message)
    })
    open.socket.send(JSON.stringify({ id, method, params, sessionId }))
  })

const evaluate = async (expression, session, awaitPromise = false) => {
  const reply = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise },
    session,
  )
  return reply.result?.result?.value
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: attached } = await send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
})
const session = attached.sessionId
await send('Runtime.enable', {}, session)
await send('Log.enable', {}, session)

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
     worker.onmessage = (event) => {
       const data = event.data ?? {}
       if (data.type === 'booted') {
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
if (problems.length) await fail('the page booted but the browser reported errors', problems)

await shutdown()
console.log(`smoke: ready in ${bootMs}ms, the sandbox ran a guest, no console errors`)
