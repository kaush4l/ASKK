#!/usr/bin/env bun
/**
 * Prove that what `scripts/wasm/image/Dockerfile` installs is actually IN the
 * shipped guest, by making the guest use it.
 *
 * This exists because nothing else can see it, and it is now a step of
 * `bun run check` rather than a file somebody remembers to run. Measured on
 * 2026-09-01 by putting the pre-Python guest back under the current tree:
 * `bun run smoke` passed, unchanged, in every particular — it boots the same
 * image and asserts `uname`, an exit status and a file round trip, and none of
 * those names Python, so all three stay green over an image with the whole
 * runtime missing. This step exited 1 on that same tree with `the guest has no
 * python3`. And a grep over the Dockerfile proves only that a line was written:
 * the image is built on another machine by another toolchain, and the file that
 * ships is a wasm module of some hundreds of megabytes that nobody greps.
 *
 * Two things are checked and they fail for different reasons:
 *
 *   the size    the deployed artifact is `sandbox.wasm.gz`, and GitHub blocks a
 *               file over 100 MiB AT REST. This project has already shipped a
 *               page whose guest was a 404 for a year on exactly that. The
 *               check is cheap, it is the one that a package added to the image
 *               will break first, and it needs no browser.
 *   the runtime  a real Chromium, the real export, this tree's own
 *               `C2wSandbox`, `Workspace` and `ShellTool`, and a task with
 *               three separate guests in it — write a module, write a test over
 *               it, run the test, read the result out of a LATER guest. Each
 *               command boots its own guest and the filesystem does not
 *               survive, so a workflow that only works inside one command would
 *               pass a single-command check and fail a user.
 *
 * Usage:  bun scripts/wasm/toolchain-check.js      (after `bun run build`)
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import config, { SANDBOX_IMAGE_PATH } from '../../next.config.js'
import { attachBrowser, findChrome } from '../browser.js'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = join(ROOT, 'out')
const SRC = join(ROOT, 'src')
const BASE = config.basePath
const SRC_URL = `${BASE}/__src`
const IMAGE_URL = `${BASE}${SANDBOX_IMAGE_PATH}`
const IMAGE_FILE = join(OUT, SANDBOX_IMAGE_PATH.slice(1))

/**
 * GitHub's per-file block, in the units GitHub uses.
 *
 * Written as the product rather than as 104857600 because the sentence a reader
 * needs is "100 MiB", and a bare eight-digit constant is the shape of a number
 * nobody re-derives.
 */
const GITHUB_FILE_LIMIT = 100 * 1024 * 1024

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
  console.error(`\ntoolchain: ${message}`)
  for (const line of details) console.error(`  ${line}`)
  process.exit(1)
}

if (!existsSync(OUT)) await fail('there is no out/ to check — run `bun run build` first')
if (!existsSync(IMAGE_FILE))
  await fail(`there is no guest at ${IMAGE_FILE}`, [
    'Build it with scripts/wasm/build.sh and copy both files into public/sandbox/.',
  ])

// --- the size, before anything expensive ------------------------------------

const shipped = statSync(IMAGE_FILE).size
if (shipped > GITHUB_FILE_LIMIT)
  await fail(
    `the deployed guest is ${shipped.toLocaleString('en-US')} bytes, over GitHub's ${GITHUB_FILE_LIMIT.toLocaleString('en-US')}-byte block`,
    [
      'A file this size cannot be in the repository the Pages site is served',
      'from, so the deploy would answer 404 for the guest and every shell call',
      'would fail with the image never arriving. Take something out of',
      'scripts/wasm/image/Dockerfile.',
    ],
  )

const chrome = findChrome()
if (chrome.problem) await fail(chrome.problem, chrome.details)

// --- the host ---------------------------------------------------------------

// `src/` served verbatim, so the browser imports the repository's own modules
// rather than a copy. Only possible because there is no transpile over src/.
open.server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith(`${SRC_URL}/`)) {
      const file = Bun.file(join(SRC, path.slice(SRC_URL.length + 1)))
      return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
    }
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

open.browser = await attachBrowser({ chromePath: chrome.path, whenLost: fail })
const { session, send, evaluate, problems } = open.browser
await send('Page.navigate', { url }, session)

// --- the task ---------------------------------------------------------------
//
// A module and a test over it, both written to the agent's own store, then run
// from a guest that has never seen either, then read back from a third guest.
// `ShellTool` stages in only the files the command NAMES, which is why the run
// command names both.
//
// The two names are chosen so that NEITHER is a substring of the other, and
// that is the whole point of them rather than a stylistic preference. See the
// comment on the run command below: an earlier version of this check used
// `money.py` and `test_money.py`, and `python3 test_money.py` contains the
// characters `money.py`, so the module staged by accident of its name and the
// check could not see the defect it was written to demonstrate.
const SOURCE = 'ledger.py'
const SUITE = 'suite_cents.py'
const RESULT = 'result.txt'

const ran = await evaluate(
  `(async () => {
     const { C2wSandbox } = await import(${JSON.stringify(`${SRC_URL}/backend/sandbox/C2wSandbox.js`)})
     const { ShellTool } = await import(${JSON.stringify(`${SRC_URL}/core/tools/ShellTool.js`)})
     const { Workspace } = await import(${JSON.stringify(`${SRC_URL}/backend/files/Workspace.js`)})
     const { IndexedDb } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDb.js`)})
     const { IndexedDbRepository } = await import(${JSON.stringify(`${SRC_URL}/backend/repositories/IndexedDbRepository.js`)})

     // Its own database, deleted first: this check must not read a file some
     // earlier run left behind and call it a pass.
     const NAME = 'askk-toolchain-check'
     await new Promise((resolve) => {
       const gone = indexedDB.deleteDatabase(NAME)
       gone.onsuccess = gone.onerror = gone.onblocked = () => resolve()
     })
     const db = new IndexedDb(NAME, 1, ['files'])
     const opened = await db.open()
     if (!opened.ok) return { problem: 'IndexedDB would not open' }
     const files = new Workspace(new IndexedDbRepository('File', db, 'files'))

     const box = new C2wSandbox({
       imageUrl: ${JSON.stringify(IMAGE_URL)},
       workerUrl: ${JSON.stringify(`${BASE}/sandbox/vm-worker.js`)},
     })
     const tool = new ShellTool({ sandbox: box, files })

     await files.write(${JSON.stringify(SOURCE)}, 'def cents(d):\\n    return round(d * 100)\\n')
     await files.write(
       ${JSON.stringify(SUITE)},
       'import unittest\\nfrom ledger import cents\\n' +
         'class T(unittest.TestCase):\\n' +
         '    def test_round(self): self.assertEqual(cents(1.115), 112)\\n' +
         '    def test_zero(self): self.assertEqual(cents(0), 0)\\n' +
         "if __name__ == '__main__': unittest.main()\\n",
     )

     const at = performance.now()
     const version = await tool.call({ command: 'python3 -V' })
     const versionMs = Math.round(performance.now() - at)

     // The suite, in a guest with nothing in it but the two staged files.
     //
     // The leading \`ls\` is not decoration and it is not a tidy-up: it is the
     // only thing that STAGES the module the suite imports. The staging rule is
     // one line of \`ShellTool\` — \`line.includes(file.path)\` — so a file is
     // placed when its path appears ANYWHERE in the command as a substring, and
     // an \`import\` is not a mention. Measured against the real \`ShellTool\`
     // with a recording sandbox, 2026-09-01:
     //
     //     python3 suite_cents.py            places suite_cents.py only
     //     ls ledger.py >/dev/null; python3 suite_cents.py
     //                                       places both
     //     python3 -m unittest suite_cents   places NOTHING — the line spells
     //                                       no path at all
     //
     // The first of those is why the guest answers \`ModuleNotFoundError\`
     // without the \`ls\`, and deleting the \`ls\` from this line is the mutation
     // that must turn this check red. It did not used to: the names were
     // \`money.py\` and \`test_money.py\`, \`python3 test_money.py\` contains
     // \`money.py\`, and the module was staged by an accident of spelling that
     // the comment then credited to the workaround. The rule an agent has to
     // live with is the general one: every module a program imports must be
     // named on the command line by hand, and costs its own name out of the
     // same budget.
     //
     // The redirect is what makes the third guest's job real: unittest writes to
     // stderr, and the harvest only carries what the command left on disk. It is
     // LAST on the line so the status the tool reports is Python's and not the
     // \`ls\`'s.
     const suiteAt = performance.now()
     const suite = await tool.call({
       command: \`ls \${${JSON.stringify(SOURCE)}} >/dev/null; python3 \${${JSON.stringify(SUITE)}} -v 2>\${${JSON.stringify(RESULT)}}\`,
     })
     const suiteMs = Math.round(performance.now() - suiteAt)

     // A THIRD guest, which never ran the suite, reading what the second one
     // left in the store.
     const read = await tool.call({ command: \`cat \${${JSON.stringify(RESULT)}}\` })

     await box.close()
     return {
       budget: box.commandBudget,
       versionMs,
       suiteMs,
       version: version.value,
       suite: suite.value,
       suiteNotes: suite.notes,
       read: read.value,
     }
   })()`,
  session,
  true,
  300000,
)

const said = (what) => JSON.stringify(what)
if (ran?.problem) await fail(ran.problem, problems)

// The runtime is THERE. Asserted on the version banner rather than on an exit
// status, because busybox answers an unknown command with a non-zero status and
// so does a Python that ran and failed.
if (!/^Python 3\./.test(String(ran.version).trim()))
  await fail(`the guest has no python3: ${said(ran.version)}`, [
    'scripts/wasm/image/Dockerfile installs it. Either the image in',
    'public/sandbox/ was built before that line, or the build did not take it.',
    ...problems,
  ])

// The runtime RAN THE AGENT'S CODE — two tests, both passing, over a module the
// store held and the guest did not.
if (!String(ran.read).includes('OK'))
  await fail(`the suite did not pass in the guest: ${said(ran.read)}`, [
    `What the running guest printed: ${said(ran.suite)}`,
    ...problems,
  ])
if (!String(ran.read).includes('Ran 2 tests'))
  await fail(`the guest ran a different number of tests: ${said(ran.read)}`, problems)
// And it came out through the STORE, from a guest that never ran the suite.
// Without this the whole check would pass over a sandbox that keeps one guest
// alive, which is not the sandbox this tree has.
if (!String(ran.read).includes('test_round'))
  await fail(`the result did not survive into a later guest: ${said(ran.read)}`, [
    'ShellTool harvests every file left in the working directory back into the',
    "agent's store, and stages it into the next command that names it.",
    ...problems,
  ])

console.log(
  `toolchain: ${String(ran.version).trim()} in the guest (${ran.versionMs}ms), ` +
    `two tests ran in a second guest (${ran.suiteMs}ms) and a third read the result back; ` +
    `image ${shipped.toLocaleString('en-US')} bytes of GitHub's ${GITHUB_FILE_LIMIT.toLocaleString('en-US')}; ` +
    `command budget ${ran.budget}`,
)

await shutdown()
