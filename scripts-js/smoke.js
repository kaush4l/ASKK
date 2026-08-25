#!/usr/bin/env bun
/**
 * THE GATE THAT DRIVES THE THING THAT SHIPS (I17).
 *
 * A page that renders and DOES NOTHING passed 426 host tests and five checks:
 * the export built, every chunk answered 200, the shell painted, and the
 * application behind it never started. Nothing in the gate opened it. So this
 * builds the real export, serves it under the real base path, drives it in a
 * real browser, and fails unless a person could type into it.
 *
 * IT SERVES FILES ITSELF, PER REQUEST, AND THAT IS LOAD-BEARING. A `Bun.serve`
 * `dir` route was measured answering the page 200 and every chunk under it 404
 * — the files were on disk and named exactly as the HTML asked for them — and a
 * page whose chunks all 404 renders the exported HTML, hydrates nothing, runs no
 * effect, and says nothing about any of it. Three rounds of this project's
 * history went into debugging that measurement rather than the product, so the
 * one gate that drives the artifact reads the artifact off the disk.
 *
 * The driver is gstack's `browse`. It is not vendored here — override it with
 * `HARNESS_BROWSE`, and when it is absent this FAILS rather than skipping,
 * because a gate that quietly does not run is the defect this file exists for.
 */

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.HARNESS_BASE_PATH ?? '/ASKK'
const PORT = Number(process.env.HARNESS_SMOKE_PORT ?? 4318)
const BROWSE = process.env.HARNESS_BROWSE ?? `${process.env.HOME}/.claude/skills/gstack/browse/dist/browse`
const OUT = ROOT + 'apps/web/out'
const SAID = 'smoke: say something'

/** What the page must be able to tell us about itself, from inside itself. */
const REPORT = `JSON.stringify({
  textareas: document.querySelectorAll('textarea').length,
  transcript: document.body.innerText.includes(${JSON.stringify(SAID)}),
  models: performance.getEntriesByType('resource').some((r) => r.name.endsWith('models.json')),
})`

/** Run one command and hand back its output, or throw with what it printed. */
async function run(/** @type {string[]} */ cmd, /** @type {string} */ stdin = '') {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdin: new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed:\n${out}\n${err}`)
  return out
}

/** The export, from nothing, with the base path the deploy uses. */
async function build() {
  await run(['rm', '-rf', OUT, ROOT + 'apps/web/.next'])
  await run(['bun', 'run', '--cwd', ROOT + 'apps/web', 'build'])
  if (!(await Bun.file(`${OUT}/index.html`).exists())) throw new Error('the export produced no index.html')
}

/**
 * DRIVE IT LIKE A PERSON: open it, wait for the box, type, send, read back.
 * `wait` is what makes this a real assertion — it fails the gate by TIMING OUT
 * when the composer never arrives, which is exactly the defect being gated.
 */
function script() {
  const url = `http://localhost:${PORT}${BASE}/`
  return JSON.stringify([
    ['goto', url],
    ['wait', 'textarea'],
    ['fill', 'textarea', SAID],
    ['click', 'button[type=submit]'],
    ['js', 'new Promise((r) => setTimeout(() => r(1), 3000))'],
    ['js', REPORT],
  ])
}

/** The last `[js]` line of a chain's output, parsed. */
function readBack(/** @type {string} */ output) {
  const line = output.split('\n').filter((l) => l.startsWith('[js] {')).pop()
  if (!line) throw new Error(`the driver never reported:\n${output}`)
  return JSON.parse(line.slice('[js] '.length))
}

if (!(await Bun.file(BROWSE).exists())) {
  console.error(`SMOKE FAIL — no browser driver at ${BROWSE}. Set HARNESS_BROWSE to one.`)
  process.exit(1)
}

await build()
const server = Bun.serve({ port: PORT, fetch: serve })

/** One file off the disk, per request. `/x/` is `/x/index.html`: a static
 *  export is directories, and GitHub Pages resolves them the same way. */
async function serve(/** @type {Request} */ request) {
  const path = new URL(request.url).pathname
  const bare = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path
  const file = Bun.file(OUT + (bare.endsWith('/') ? bare + 'index.html' : bare))
  return (await file.exists()) ? new Response(file) : new Response('not here', { status: 404 })
}

/** @type {string[]} */
const failures = []
try {
  const seen = readBack(await run([BROWSE, 'chain'], script()))
  if (seen.textareas < 1) failures.push('the composer never reached the screen: no textarea after boot')
  if (!seen.models) failures.push('models.json was never fetched, so the core never booted')
  if (!seen.transcript) failures.push('a sent message did not reach the transcript without a reload')
} catch (failure) {
  // The driver's own timeout IS the assertion failing: `wait textarea` gives up
  // when the composer never arrives, which is the whole defect being gated.
  failures.push('the composer never reached the screen, or the driver could not read it back')
  failures.push(String(failure instanceof Error ? failure.message : failure))
} finally {
  await server.stop(true)
}

if (failures.length) {
  console.error(`SMOKE FAIL — the built page does not work:`)
  for (const line of failures) console.error('  ' + line)
  process.exit(1)
}
console.log('smoke ok — the export boots, the composer is on screen, and a message reaches the transcript')
