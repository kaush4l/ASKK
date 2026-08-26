/**
 * The measured half of the design gate — DESIGN.md §10, contrast.
 *
 *   bun run scripts/check-contrast.js
 *
 * It measures **real rendered pairs**, not the token table: a table can be
 * perfect while a panel sits on the wrong surface, and the pair a person reads
 * is the one the browser composited. So it builds the export, opens it in
 * `Bun.WebView` (Bun 1.4 — headless, CDP, no dependency, BUN-FACTS §5), and
 * walks every element owning a text node, on all four destinations, in both
 * themes, at rest and hovered. Three things naive checkers get wrong:
 *
 * - **Transparency.** `background-color` is `rgba(0,0,0,0)` on most elements,
 *   so the effective background is the ancestor chain composited down to an
 *   opaque layer, each ancestor's `opacity` folded into its own alpha. A chain
 *   that never reaches one is itself a failure — the "a body with no background
 *   borrows the host's theme" bug, caught rather than measured against an
 *   assumed white.
 * - **The themes.** Both, through CDP `Emulation.setEmulatedMedia` — the real
 *   `prefers-color-scheme` query, not the data-theme override that happens to
 *   declare the same values.
 * - **Hover and focus.** Forced with `CSS.forcePseudoState`: the last contrast
 *   bug shipped here was a hovered row whose label went unreadable, which a
 *   rest-state-only checker cannot see.
 *
 * The worst ratio per pass goes to a ratchet that only goes up — the only kind
 * of ratchet that survives contact with a deadline. */

import { existsSync, readFileSync, writeFileSync } from "node:fs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const RATCHET = `${ROOT}/scripts/contrast-ratchet.json`
const FLOOR = 4.5
const SLACK = 0.01 // a ratchet that fires on the tenth decimal gets disabled
const ROUTES = ["converse", "flow", "roster", "bench"]
const THEMES = ["light", "dark"]
const INTERACTIVE = "a, button, summary, input, select, textarea, [tabindex], [role='button'], [role='tab']"

/** @typedef {{ label: string, text: string, fg: string, chain: { bg: string, opacity: number }[] }} Pair */
/** @typedef {{ where: string, label: string, text: string, ratio: number, fg: string, bg: string }} Finding */
/** @param {string} value @returns {[number, number, number, number]} */
function parseRgb(value) {
  const [r, g, b, a] = (value.match(/-?\d*\.?\d+/g) ?? []).map(Number)
  if (r === undefined || g === undefined || b === undefined) throw new Error(`cannot read the colour ${JSON.stringify(value)}`)
  return [r, g, b, a ?? 1]
}

/** Source-over composite. @param {number[]} top @param {number[]} under @returns {[number, number, number, number]} */
function over(top, under) {
  const [ta, ua] = [top[3] ?? 1, under[3] ?? 1]
  const a = ta + ua * (1 - ta)
  if (a === 0) return [0, 0, 0, 0]
  const mix = (/** @type {number} */ i) => ((top[i] ?? 0) * ta + (under[i] ?? 0) * ua * (1 - ta)) / a
  return [mix(0), mix(1), mix(2), a]
}

/** WCAG 2.1 relative luminance and ratio. @param {number[]} rgb @returns {number} */
function luminance(rgb) {
  const c = (/** @type {number} */ i) => (rgb[i] ?? 0) / 255
  const lin = (/** @type {number} */ v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(c(0)) + 0.7152 * lin(c(1)) + 0.0722 * lin(c(2))
}

/** Runs in the page: every element owning a text node, with the chain of
    backgrounds above it. SVG text takes its colour from `fill`, which is the
    only reason the phase graph is measured at all. @returns {Pair[]} */
function collectPairs() {
  const out = /** @type {Pair[]} */ ([])
  for (const el of document.body.querySelectorAll("*")) {
    let text = ""
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue ?? ""
    text = text.replace(/\s+/g, " ").trim()
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (!text || !rect.width || !rect.height || style.visibility === "hidden") continue
    const chain = /** @type {{ bg: string, opacity: number }[]} */ ([])
    for (let node = /** @type {Element | null} */ (el); node; node = node.parentElement) {
      const s = getComputedStyle(node)
      chain.push({ bg: s.backgroundColor, opacity: Number(s.opacity) })
    }
    const cls = el.getAttribute("class")
    const label = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (cls ? `.${cls.trim().split(/\s+/).join(".")}` : "")
    const svg = el.namespaceURI === "http://www.w3.org/2000/svg"
    out.push({ label, text: text.slice(0, 40), fg: svg ? style.fill : style.color, chain })
  }
  return out
}

/** @param {Pair} pair @param {string} where @returns {Finding} */
function measure(pair, where) {
  let ground = /** @type {[number, number, number, number]} */ ([0, 0, 0, 0])
  // Root first: the running product of opacities is what fades this layer, and
  // an ancestor's opacity fades its own background as much as its text.
  let fade = 1
  for (const layer of [...pair.chain].reverse()) {
    fade *= layer.opacity
    const [r, g, b, a] = parseRgb(layer.bg)
    ground = over([r, g, b, a * fade], ground)
  }
  const found = { where, label: pair.label, text: pair.text, fg: pair.fg }
  if (ground[3] < 0.999) return { ...found, ratio: 0, bg: "no opaque background in the ancestor chain" }
  const [r, g, b, a] = parseRgb(pair.fg)
  const [hi, lo] = [luminance(over([r, g, b, a * fade], ground)), luminance(ground)].sort((x, y) => y - x)
  return { ...found, ratio: ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05), bg: `rgb(${ground.slice(0, 3).map(Math.round).join(", ")})` }
}

/** Hover and focus, forced on everything interactive at once and cleared by the
    same call with `[]`. Those rules are scoped to the element that carries them,
    so forcing them together is a superset check, not a fiction.
    @param {any} view @param {string[]} classes @returns {Promise<void>} */
async function forceStates(view, classes) {
  // One at a time: a `Promise.all` of two cdp() calls throws ERR_INVALID_STATE.
  await view.cdp("DOM.enable", {})
  await view.cdp("CSS.enable", {})
  const { root } = await view.cdp("DOM.getDocument", { depth: -1 })
  const { nodeIds } = await view.cdp("DOM.querySelectorAll", { nodeId: root.nodeId, selector: INTERACTIVE })
  for (const nodeId of nodeIds) await view.cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes })
}

/** One destination, in the theme already emulated, at rest and then hovered.
    The route is set through `location.hash`, not `navigate()`: a same-document
    navigation fires no load event, so `navigate()` to a URL differing only in
    its hash never resolves. Measured, after it hung.
    @param {any} view @param {string} route @param {string} theme @returns {Promise<Finding[]>} */
async function visit(view, route, theme) {
  const findings = /** @type {Finding[]} */ ([])
  await view.evaluate(`location.hash = "#/${route}"`)
  await Bun.sleep(700)
  for (const state of ["rest", "hover+focus"]) {
    await forceStates(view, state === "rest" ? [] : ["hover", "focus", "focus-visible"])
    const pairs = /** @type {Pair[]} */ (await view.evaluate(`(${String(collectPairs)})()`))
    for (const pair of pairs) findings.push(measure(pair, `${route}/${theme}/${state}`))
  }
  return findings
}

/** The export as it is now, not what a previous build left behind. @returns {Promise<void>} */
async function build() {
  const proc = Bun.spawn(["bun", "run", "scripts/build.js"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) {
    console.error(`${out}${err}\ncontrast FAILED — the export did not build, so there is nothing to measure.`)
    process.exit(1)
  }
}

/** @returns {Promise<Finding[]>} */
async function measureAll() {
  const server = Bun.serve({
    port: 0, // 404 below, not a thrown ENOENT: a stack trace per request buries the numbers.
    fetch: async (req) => {
      const path = new URL(req.url).pathname
      const file = Bun.file(`${ROOT}/dist${path === "/" ? "/index.html" : path}`)
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 })
    },
  })
  const view = new Bun.WebView({ headless: true, backend: "chrome", width: 1440, height: 960 })
  const all = /** @type {Finding[]} */ ([])
  try {
    await view.navigate(`http://localhost:${server.port}/`)
    await Bun.sleep(1500)
    for (const theme of THEMES) {
      await view.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] })
      for (const route of ROUTES) all.push(...(await visit(view, route, theme)))
    }
  } finally {
    view.close()
    server.stop(true)
  }
  return all
}

console.log("contrast\n")
await build()
const all = await measureAll()

const worstOf = /** @type {Record<string, number>} */ ({})
for (const f of all) worstOf[f.where] = Math.min(worstOf[f.where] ?? Infinity, f.ratio)
const stored = existsSync(RATCHET) ? JSON.parse(readFileSync(RATCHET, "utf8")) : { floor: FLOOR, worst: 0, passes: {} }
const was = (/** @type {string} */ where) => Number(stored.passes?.[where] ?? 0)

// Failures name the element, the pair and the ratio: without them a message
// starts an investigation instead of ending one.
const problems = all.filter((f) => f.ratio < FLOOR).sort((a, b) => a.ratio - b.ratio).map((f) => `${f.where}  ${f.ratio.toFixed(2)}:1  ${f.label} — "${f.text}"  ${f.fg} on ${f.bg}`)
for (const [w, worst] of Object.entries(worstOf)) if (worst < was(w) - SLACK) problems.push(`${w} regressed: worst pair was ${was(w).toFixed(2)}:1, now ${worst.toFixed(2)}:1`)

for (const [where, worst] of Object.entries(worstOf).sort()) console.log(`  ${where.padEnd(30)} ${worst.toFixed(2)}:1`)
const measured = Math.min(...Object.values(worstOf))
console.log(`\n${all.length} rendered pairs, worst ${measured.toFixed(2)}:1, floor ${FLOOR}`)
for (const problem of problems) console.log(` FAIL  ${problem}`)
if (problems.length) {
  console.log(`\n${problems.length} contrast failure(s)`)
  process.exit(1)
}

const worst = Math.max(measured, Number(stored.worst ?? 0))
// Three decimals: readable in a diff, and finer than SLACK can act on anyway.
const passes = Object.fromEntries(Object.entries(worstOf).map(([k, v]) => [k, Number(Math.max(v, was(k)).toFixed(3))]))
writeFileSync(RATCHET, `${JSON.stringify({ floor: FLOOR, worst: Number(worst.toFixed(3)), passes }, null, 2)}\n`)
console.log(`  ok   ratchet at ${worst.toFixed(2)}:1`)
