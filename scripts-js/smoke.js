#!/usr/bin/env bun
/**
 * THE GATE THAT DRIVES THE THING THAT SHIPS (I17).
 *
 * A page that renders and DOES NOTHING passed 426 host tests and five checks:
 * the export built, every chunk answered 200, the shell painted, and the
 * application behind it never started. Nothing in the gate opened it. So this
 * builds the real export, serves it under the real base path, drives it in a
 * real browser, and fails unless a person could type into it AND SOMETHING CAME
 * BACK. The outbound half alone proves boot, record and re-render, and says
 * nothing about the return leg — which is where every defect of the last three
 * rounds lived. With no model server on the machine what comes back is the
 * port's refusal, and a refusal on the screen is the return leg working.
 *
 * FOUR DESTINATIONS AND A RELOAD were added the increment the screens were
 * finished, because those are the two things a person does first: they look at
 * every page once, and they refresh. Neither was checked by anything, and both
 * are states this product has shipped broken — a destination that admitted it
 * was unwired, and a transcript that came back empty.
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
const ANSWER_MS = Number(process.env.HARNESS_SMOKE_ANSWER_MS ?? 8000)

/** Every destination a person can go to (docs/SEAM.md, the address table). */
const DESTINATIONS = ['', 'agents/', 'setup/', 'design-system/']

/** The transcript's rows as their KINDS, newest last (`components/views/chat.jsx`
 *  stamps `data-row`/`data-kind` on every one). */
const KINDS = `[...document.querySelectorAll('[data-row=said]')].map((n) => n.dataset.kind)`

/**
 * THE RETURN LEG: something arrived after the message this run typed, and it is
 * not that message. Measured against the count taken BEFORE the send, because
 * the log outlives the browser profile — a run that sent nothing would find a
 * previous run's sentence still on the screen and call it an answer. What comes
 * back on a machine with no model server is the port's refusal, which is the
 * point: a refusal on the screen is the whole return leg working.
 */
const ANSWERED = `(() => { const k = ${KINDS}; return k.length > window.__before + 1 && k[k.length - 1] !== 'user' })()`

/** What the page must be able to tell us about itself, from inside itself. */
const REPORT = `JSON.stringify({
  textareas: document.querySelectorAll('textarea').length,
  transcript: document.body.innerText.includes(${JSON.stringify(SAID)}),
  models: performance.getEntriesByType('resource').some((r) => r.name.endsWith('models.json')),
  answered: ${ANSWERED},
})`

/**
 * WHETHER A DESTINATION REPLACED ITS CONTENT WITH A FAILURE.
 *
 * Read off `[data-view=problem]` inside `#region`, which is the destination's
 * own content — a BANNER is a row over a screen that is otherwise fine (a
 * redirect note, a refused save) and is deliberately not counted, and neither
 * is a companion pane in the rail, which sits outside the region on purpose:
 * a build with no workspace is a build a person can still talk to.
 *
 * The kind is reported and not just the count, because "this destination is
 * broken" and "it is broken like THIS" are two different mornings.
 */
const REGION_FAILED = `JSON.stringify({
  at: location.pathname,
  region: Boolean(document.querySelector('#region')),
  failures: [...document.querySelectorAll('#region [data-view=problem][data-placement=region]')]
    .filter((n) => !n.closest('[data-specimen]'))
    .map((n) => n.dataset.kind),
  booting: /Reading this browser/.test(document.querySelector('#region').innerText),
  text: document.body.innerText.slice(0, 200),
})`

/**
 * A SCREEN IS READY WHEN THE CORE HAS FILLED IT, and the region's own heading
 * does not count: it is in the exported HTML, so `innerText.length > 0` is true
 * before a single line of the log has been read. What is waited for is the
 * BOOTING sentence being gone — that string is `apps/web/lib/copy.js`'s and it
 * is the one thing on the page that means "the log has not been read yet".
 */
const SETTLED = `new Promise((done) => {
  const deadline = Date.now() + ${ANSWER_MS}
  const look = () => {
    const region = document.querySelector('#region')
    const filled = region && !/Reading this browser/.test(region.innerText)
    return filled || Date.now() > deadline ? done(1) : setTimeout(look, 100)
  }
  look()
})`

/**
 * WAIT FOR THE TURN TO BE OVER, NOT FOR THE ANSWER TO APPEAR.
 *
 * The two are not the same moment and the difference is measurable: the facts
 * reach the DOM while `drive` is still running and are written to storage after
 * it returns (`packages/adapters-web/src/attach.js`), so a reload fired the
 * instant an answer is on screen loses the whole turn — this gate failed
 * exactly that way, which is a real finding and is filed for the SPINE lane.
 * What is modelled here is a person who reads the answer and THEN refreshes:
 * the transcript stops growing, and a beat later the page is reloaded.
 */
const QUIET = `new Promise((done) => {
  const deadline = Date.now() + ${ANSWER_MS}
  let was = -1
  let still = 0
  const look = () => {
    const now = ${KINDS}.length
    still = now === was ? still + 1 : 0
    was = now
    return still >= 10 || Date.now() > deadline ? done(1) : setTimeout(look, 100)
  }
  look()
})`

/** …and on the reload, ready means the sentence this run sent is back on screen. */
const RESTORED = `new Promise((done) => {
  const deadline = Date.now() + ${ANSWER_MS}
  const look = () => (document.body.innerText.includes(${JSON.stringify(SAID)}) || Date.now() > deadline
    ? done(1) : setTimeout(look, 100))
  look()
})`

/** Wait for the answer, to a bound, then report whatever is true. A fixed sleep
 *  cannot tell an answer that never came from one that was slow, and those are
 *  two different defects — this fails the slow one AS slow. */
const POLL = `new Promise((done) => {
  const deadline = Date.now() + ${ANSWER_MS}
  const look = () => (${ANSWERED} || Date.now() > deadline ? done(1) : setTimeout(look, 100))
  look()
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
 * DRIVE IT LIKE A PERSON: open it, wait for the box, mark where the transcript
 * stood, type, send, wait for the answer, read back. `wait` is what makes this
 * a real assertion — it fails the gate by TIMING OUT when the composer never
 * arrives, which is exactly the defect being gated.
 */
function script() {
  const url = `http://localhost:${PORT}${BASE}/`
  return JSON.stringify([
    ['goto', url],
    ['wait', 'textarea'],
    ['js', `window.__before = ${KINDS}.length`],
    ['fill', 'textarea', SAID],
    ['click', 'button[type=submit]'],
    ['js', POLL],
    ['js', REPORT],
    ['js', QUIET],
    // …AND THE MESSAGE IS STILL THERE AFTER A RELOAD. The transcript is a fold
    // of a log in IndexedDB, so a reload that comes back empty means the facts
    // never reached storage — which is the first thing a person does and the
    // last thing this gate used to check.
    ['goto', url],
    ['wait', 'textarea'],
    ['js', RESTORED],
    ['js', REPORT],
  ])
}

/**
 * A DELEGATION, END TO END, IN THE BUILT ARTIFACT.
 *
 * `?agent=critic` addresses the second shipped agent, so the message crosses
 * the seam as an errand rather than as this page's own turn: the composition
 * root starts a Worker for `critic`, that Worker boots the same build under
 * that name, runs a turn against the model port and posts its ending home.
 *
 * WITH NO MODEL SERVER ON THE MACHINE the sub-agent's turn ends `failed`, and
 * that is the assertion — a failure carried back from a Worker is the whole
 * path working, and it is a DIFFERENT sentence from the one a build with no
 * delegation produces. `NO_WORKER` below is that other sentence: seeing it
 * means the port fell back to the honest refusal and no Worker ever started.
 */
const NO_WORKER = 'There is no agent called'

/** The last row's text, whatever kind it is — the sentence the errand brought back. */
const LAST_SAID = `(() => {
  const rows = [...document.querySelectorAll('[data-row=said]')]
  return rows.length ? rows[rows.length - 1].innerText : ''
})()`

const DELEGATED = `JSON.stringify({
  answered: ${ANSWERED},
  said: ${LAST_SAID}.slice(0, 300),
})`

/** Send one message to another agent and read back what came home. */
function delegate() {
  return JSON.stringify([
    ['goto', `http://localhost:${PORT}${BASE}/?agent=critic`],
    ['wait', 'textarea'],
    ['js', `window.__before = ${KINDS}.length`],
    ['fill', 'textarea', 'smoke: check this claim'],
    ['click', 'button[type=submit]'],
    ['js', POLL],
    ['js', DELEGATED],
  ])
}

/** One destination, opened cold, asked whether its own content is a failure. */
function walk(/** @type {string} */ slug) {
  return JSON.stringify([
    ['goto', `http://localhost:${PORT}${BASE}/${slug}`],
    ['wait', '#region'],
    ['js', SETTLED],
    ['js', REGION_FAILED],
  ])
}

/** Every `[js]` line of a chain's output that carries an object, parsed. */
function readBack(/** @type {string} */ output) {
  const lines = output.split('\n').filter((l) => l.startsWith('[js] {'))
  if (lines.length === 0) throw new Error(`the driver never reported:\n${output}`)
  return lines.map((line) => JSON.parse(line.slice('[js] '.length)))
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
  const [seen, reloaded] = readBack(await run([BROWSE, 'chain'], script()))
  if (!seen || !reloaded) throw new Error('the driver reported fewer times than the chain asked it to')
  if (seen.textareas < 1) failures.push('the composer never reached the screen: no textarea after boot')
  if (!seen.models) failures.push('models.json was never fetched, so the core never booted')
  if (!seen.transcript) failures.push('a sent message did not reach the transcript without a reload')
  if (!seen.answered) failures.push(`nothing came back: the model port's refusal never reached the transcript within ${ANSWER_MS}ms`)
  if (reloaded.textareas < 1) failures.push('the composer did not survive a reload: no textarea on the second load')
  if (!reloaded.transcript) failures.push('the transcript did not survive a reload — the facts never reached storage')

  const [errand] = readBack(await run([BROWSE, 'chain'], delegate()))
  if (!errand || !errand.answered) failures.push(`a message addressed to critic brought nothing back within ${ANSWER_MS}ms — no Worker answered`)
  else if (errand.said.includes(NO_WORKER)) failures.push(`delegation fell back to the refusal: no Worker was started (${errand.said})`)

  for (const slug of DESTINATIONS) {
    const [landed] = readBack(await run([BROWSE, 'chain'], walk(slug)))
    const at = `/${slug}`
    if (!landed || !landed.region) failures.push(`${at} rendered no region at all`)
    else if (landed.booting) failures.push(`${at} never read the log — it is still on the booting sentence after ${ANSWER_MS}ms`)
    else if (landed.failures.length) failures.push(`${at} replaced its content with a failure: ${landed.failures.join(', ')}`)
    else if (landed.text.trim() === '') failures.push(`${at} came up with an empty region and said nothing about why`)
  }
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
console.log(`smoke ok — the export boots, a message reaches the transcript and survives a reload, what the model port answered reaches it too, a delegation to another agent runs in its own Worker and comes home, and all ${DESTINATIONS.length} destinations render their own content rather than a failure`)
