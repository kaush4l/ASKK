#!/usr/bin/env bun
/**
 * Boot the built artifact in a browser and make three realms answer — the page
 * and its module workers, the classic sandbox worker, and the real 107 MB guest
 * through the tree's own `C2wSandbox`.
 *
 * The other three steps of the gate cannot see a module that parses, resolves
 * and passes its unit tests yet cannot run in the realm it was written for.
 * docs/GATE.md has the fault table that measures exactly which faults reach
 * this step and which are caught earlier, and the designs rejected for it.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

/** Where the export puts what `public/sandbox/` holds, and what the page asks for. */
const IMAGE_FILE = join(OUT, 'sandbox', 'sandbox.wasm')
const IMAGE_URL = `${BASE}/sandbox/sandbox.wasm`

open.server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === GUEST_URL) return new Response(tinyGuest())
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
const send = (method, params, sessionId, ceilingMs = 10000) =>
  new Promise((resolve) => {
    const id = ++seq
    const ceiling = setTimeout(() => fail(`the browser never answered ${method}`), ceilingMs)
    pending.set(id, (message) => {
      clearTimeout(ceiling)
      resolve(message)
    })
    open.socket.send(JSON.stringify({ id, method, params, sessionId }))
  })

const evaluate = async (expression, session, awaitPromise = false, ceilingMs) => {
  const reply = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise },
    session,
    ceilingMs,
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

// --- realm three: the real 107 MB guest, through the tree's own port ---------

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
//                    the 107 MB emulator actually run a command, hand back what
//                    it printed, and hand back the status it exited with.
//
// The string searched for is the one THIS build was configured with, read from
// the same config the build read. Hardcoding `/sandbox/sandbox.wasm` made the
// gate red on the one procedure `composition.js` argues for — a
// `SANDBOX_IMAGE=<url> bun run build` compiled the override into the chunk, the
// scan could not find the default, and the step blamed a file that was correct.
const CONFIGURED_IMAGE = config.env.NEXT_PUBLIC_SANDBOX_IMAGE || '/sandbox/sandbox.wasm'
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
  // SAID, not skipped silently. The image is gitignored — 107 MB — so a fresh
  // clone genuinely has none, and failing here would make the gate impossible
  // to run before `scripts/wasm/build.sh` has ever been run. What is NOT
  // skipped is the chunk scan above: a build that forgot where its guest lives
  // is a source fault and fails on any machine.
  console.log(
    `smoke: SKIPPED the real guest — ${IMAGE_FILE} is not there (it is gitignored; build it with scripts/wasm/build.sh). The wiring was still checked: ${carriers.join(', ')} names it.`,
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
       // The first call pays for the whole 107 MB: fetch, compile, instantiate
       // and boot the guest. The second pays for an instance and a boot only,
       // which is the number that says what a second command costs.
       const first = await box.run('uname -a')
       const cold = Math.round(performance.now() - at)
       const warm = performance.now()
       const failing = await box.run('ls /definitely-not-here')
       const hot = Math.round(performance.now() - warm)
       await box.close()
       return { available, cold, hot, first: first.toJSON(), failing: failing.toJSON() }
     })()`,
    session,
    true,
    // The ceiling is the whole 107 MB fetch, compile and two guest boots, not a
    // protocol round trip. Measured on this machine at ~1.7 s over loopback.
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

  console.log(
    `smoke: the real guest answered ${said(real.first.value.stdout.trim())} in ${real.cold}ms cold, ` +
      `then a failing command in ${real.hot}ms warm (exit ${real.failing.value.code})`,
  )
}

if (problems.length) await fail('the page booted but the browser reported errors', problems)

await shutdown()
console.log(`smoke: ready in ${bootMs}ms, the sandbox ran a guest, no console errors`)
