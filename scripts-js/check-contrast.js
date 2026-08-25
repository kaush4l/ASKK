#!/usr/bin/env bun
/**
 * DESIGN.md §3 CARRIES MEASURED RATIOS AND §10 IS A CRITIC'S REJECT LIST.
 * Neither was executable, and that is why a nav a person cannot read shipped
 * (I17). This is the executable half: it builds the real export, serves it
 * under the real base path, opens every destination in BOTH rooms, and walks
 * every text node and every control edge against the backdrop the browser
 * actually composited for it.
 *
 * WCAG 1.4.3 for text (4.5:1) and 1.4.11 for a control's boundary (3:1). One
 * threshold for all text and not the large-text relaxation: the display plate
 * is the only thing on this page big enough to earn 3:1, it measures 7.2:1, and
 * a second threshold is a second thing to argue about.
 *
 * AND A RATCHET. The worst ratio per room per destination is recorded in
 * `contrast-floor.json` and may only go UP. A gate that only holds the standard
 * lets a design walk from 8:1 to 4.6:1 one careful exception at a time; the
 * predecessor's `ramp-audit.js` ratcheted exactly this way and caught its own
 * author twice. An improvement rewrites the file, so raising the floor is
 * visible in the diff of the change that earned it.
 *
 * The driver is gstack's `browse`, as `smoke.js` uses it — not vendored, and
 * ABSENT MEANS FAIL, because a gate that quietly does not run is the defect it
 * exists for.
 */
import { PROBE, TEXT_MIN, EDGE_MIN } from './contrast-probe.js'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.HARNESS_BASE_PATH ?? '/ASKK'
const PORT = Number(process.env.HARNESS_CONTRAST_PORT ?? 4319)
const BROWSE = process.env.HARNESS_BROWSE ?? `${process.env.HOME}/.claude/skills/gstack/browse/dist/browse`
const OUT = ROOT + 'apps/web/out'
const FLOORS = ROOT + 'scripts-js/contrast-floor.json'
const ROOMS = ['dark', 'light']
const DESTINATIONS = ['', 'agents/', 'setup/', 'design-system/']

/** @typedef {{r: number, on: string, el: string, fg: string, size: string, says: string}} Sample */
/** @typedef {{text: Sample[], edges: Sample[], seen: number, bad: {text: number, edges: number}}} Report */

/** The screen is not ready until the core has filled it — `smoke.js`'s wait,
 *  for the same reason: the booting sentence is in the exported HTML. */
const SETTLED = `new Promise((done) => {
  const deadline = Date.now() + 8000
  const look = () => {
    const region = document.querySelector('#region')
    const filled = region && !/Reading this browser/.test(region.innerText)
    if (filled) return done(1)
    return Date.now() > deadline ? done(0) : setTimeout(look, 100)
  }
  look()
})`

/** Run one command, or throw with everything it printed. */
async function run(/** @type {string[]} */ cmd, /** @type {string} */ stdin = '') {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdin: new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed:\n${out}\n${err}`)
  return out
}

/**
 * One destination, in one room. The room is stamped the way a person's choice
 * is stamped — into the storage `theme-boot.js` reads before the first paint —
 * so what is measured is the real boot path and not an attribute this script
 * set afterwards.
 */
function chain(/** @type {string} */ room, /** @type {string} */ slug) {
  const url = `http://localhost:${PORT}${BASE}/${slug}`
  return JSON.stringify([
    ['goto', url],
    ['js', `localStorage.setItem('harness.theme', ${JSON.stringify(room)}); 1`],
    ['goto', url],
    ['wait', '#region'],
    ['js', SETTLED],
    ['js', PROBE],
  ])
}

/** Did the region fill, off the settle step's own `[js]` line — the last bare
 *  digit, since the theme step answers 1 too and the probe answers JSON. Read
 *  back because the shell is server-rendered: a route whose core never boots
 *  still shows a dozen measurable things and would be ratcheted as if it ran. */
function filled(/** @type {string} */ output) {
  const line = output.split('\n').filter((l) => /^\[js\] [01]$/.test(l)).pop()
  if (!line) throw new Error(`the settle step never reported:\n${output}`)
  return line.endsWith('1')
}

/** The probe's answer, off the driver's last `[js]` line. */
function readBack(/** @type {string} */ output) {
  const line = output.split('\n').filter((l) => l.startsWith('[js] {"text"')).pop()
  if (!line) throw new Error(`the probe never reported:\n${output}`)
  return /** @type {Report} */ (JSON.parse(line.slice('[js] '.length)))
}

/** One line a person can act on: the element, both colours, and the number. */
function say(/** @type {Sample} */ s, /** @type {number} */ min) {
  return `${s.r.toFixed(2)}:1 (needs ${min}) — ${s.el} at ${s.size}, ${s.fg} on rgb(${s.on}) — "${s.says}"`
}

/** One file off the disk, per request; `/x/` is `/x/index.html` (smoke.js). */
async function serve(/** @type {Request} */ request) {
  const path = new URL(request.url).pathname
  const bare = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path
  const file = Bun.file(OUT + (bare.endsWith('/') ? bare + 'index.html' : bare))
  return (await file.exists()) ? new Response(file) : new Response('not here', { status: 404 })
}

if (!(await Bun.file(BROWSE).exists())) {
  console.error(`CONTRAST FAIL — no browser driver at ${BROWSE}. Set HARNESS_BROWSE to one.`)
  process.exit(1)
}
if (!process.env.HARNESS_CONTRAST_BUILT) {
  await run(['rm', '-rf', OUT, ROOT + 'apps/web/.next'])
  await run(['bun', 'run', '--cwd', ROOT + 'apps/web', 'build'])
}
if (!(await Bun.file(`${OUT}/index.html`).exists())) throw new Error('the export produced no index.html')

/** @typedef {{text: number | null, edge: number | null}} Floor Either is null
 *  where a screen drew none of that kind — `/design-system/` renders most of
 *  its controls disabled on purpose — and a route with nothing to measure must
 *  not record a floor of zero and call it a floor. */
/** @type {Record<string, Floor>} */
const floor = await Bun.file(FLOORS).json()
/** @type {Record<string, Floor>} */
const measured = {}
/** @type {string[]} */
const failures = []
let seen = 0

/** The probe returns only the eight worst of each kind; where it truncated, its
 *  count is the part a person cannot get from the lines it did print. */
function capped(/** @type {string} */ at, /** @type {string} */ kind, /** @type {number} */ bad, /** @type {number} */ shown) {
  if (bad > shown) failures.push(`${at}: showing the ${shown} worst of ${bad} failing ${kind} elements`)
}
const server = Bun.serve({ port: PORT, fetch: serve })
try {
  for (const room of ROOMS) {
    for (const slug of DESTINATIONS) {
      const at = `${room} /${slug}`
      const output = await run([BROWSE, 'chain'], chain(room, slug))
      if (!filled(output)) failures.push(`${at}: the region never filled inside 8s — nothing measured here is a measurement`)
      const report = readBack(output)
      seen += report.seen
      const badText = report.text.filter((t) => t.r < TEXT_MIN)
      const badEdges = report.edges.filter((e) => e.r < EDGE_MIN)
      for (const s of badText) failures.push(`${at}: text at ${say(s, TEXT_MIN)}`)
      for (const s of badEdges) failures.push(`${at}: control edge at ${say(s, EDGE_MIN)}`)
      capped(at, 'text', report.bad.text, badText.length)
      capped(at, 'control edge', report.bad.edges, badEdges.length)
      // TEXT AND EDGES RATCHET SEPARATELY. One number for both hides the case
      // this gate exists for: on a route whose worst thing is a 3.9:1 control
      // edge, prose sliding from 9:1 to 4.6:1 moves no floor at all.
      // NOTHING TO MEASURE IS NOT A ZERO: a floor of 0 is one every future run
      // satisfies, so recording it would make the one route where the probe
      // found no text the one route the ratchet is permanently blind on.
      measured[at] = { text: report.text[0]?.r ?? null, edge: report.edges[0]?.r ?? null }
    }
  }
} finally {
  await server.stop(true)
}

/** THE RATCHET. A floor may be raised by the change that earns it and never
 *  lowered; a room or route missing from the file is new, and its first
 *  measurement becomes its floor. */
const raised = []
for (const [at, now] of Object.entries(measured)) {
  for (const kind of /** @type {const} */ (['text', 'edge'])) {
    const is = now[kind]
    const was = floor[at]?.[kind]
    if (is === null) continue
    if (was === undefined || was === null) raised.push(`${at} ${kind}: new, floor set at ${is.toFixed(2)}:1`)
    else if (is < was - 0.01) failures.push(`${at}: the worst ${kind} ratio fell from ${was.toFixed(2)}:1 to ${is.toFixed(2)}:1 — the ratchet only goes up`)
    else if (is > was + 0.01) raised.push(`${at} ${kind}: ${was.toFixed(2)}:1 → ${is.toFixed(2)}:1`)
  }
}

if (failures.length) {
  console.error('CONTRAST FAIL — what the design system promised is not on the screen:')
  for (const line of failures) console.error('  ' + line)
  process.exit(1)
}
if (raised.length) {
  // MERGED FORWARD, NEVER REPLACED. A run where a route drew no measurable edge
  // measures null there, and writing that over a recorded 3.94 would let the
  // next build set a "new" floor at 3.10 and print it as a raise — a loss
  // announced as a win, riding on whatever unrelated raise wrote the file.
  const next = Object.fromEntries(Object.entries(measured)
    .map(([at, m]) => [at, { text: m.text ?? floor[at]?.text ?? null, edge: m.edge ?? floor[at]?.edge ?? null }])
    .sort())
  await Bun.write(FLOORS, JSON.stringify(next, null, 2) + '\n')
  console.log('contrast ratchet raised:')
  for (const line of raised) console.log('  ' + line)
}
const texts = Object.values(measured).map((m) => m.text).filter((t) => t !== null)
const edges = Object.values(measured).map((m) => m.edge).filter((e) => e !== null)
const screens = Object.keys(measured).length
console.log(`contrast ok — ${ROOMS.length} rooms x ${DESTINATIONS.length} destinations, ${seen} things measured; worst text ${Math.min(...texts).toFixed(2)}:1 (floor ${TEXT_MIN}, over ${texts.length} of ${screens} screens) and worst control edge ${Math.min(...edges).toFixed(2)}:1 (floor ${EDGE_MIN}, over the ${edges.length} of ${screens} that draw one)`)
