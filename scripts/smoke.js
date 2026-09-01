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
       const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES } =
         await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
       const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
       const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
       const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
       const { ShellTool } = await import(${JSON.stringify(`${SRC_URL}/core/tools/ShellTool.js`)})
       const { Outcome } = await import(${JSON.stringify(`${SRC_URL}/core/Outcome.js`)})

       const db = new IndexedDb(DB_NAME, DB_VERSION, [STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES])
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
  const sizes = real.first.notes.find((note) => note.startsWith('the sandbox image is'))
  const transfer = sizes?.match(/is (\d+) bytes, fetched once for this tab as (\d+) compressed/)
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
      `${transfer[2]} bytes fetched, inflated to ${transfer[1]}`,
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
       const { DB_NAME, DB_VERSION, STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES } =
         await import(${JSON.stringify(`${SRC_URL}/backend/composition.js`)})
       const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
       const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})
       const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
       const db = new IndexedDb(DB_NAME, DB_VERSION, [STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES])
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
