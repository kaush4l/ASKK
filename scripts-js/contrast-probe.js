/**
 * THE MEASUREMENT, AS IT RUNS INSIDE THE PAGE.
 *
 * Its own file because it is a STRING here and a program there: nothing in it
 * can be imported, typed or tested from this side, and mixing it into the
 * driver hides that boundary. `check-contrast.js` is the only reader.
 *
 * WHAT A BACKDROP IS. A text node's background is almost never the fill on the
 * element that holds it: it is that fill composited over its parent's, over its
 * parent's, down to the first opaque one — and under the ground, down to a
 * GRADIENT, which is not one colour but a range. `bases()` returns every colour
 * a text box could be standing on, and the ratio reported is the WORST of them.
 * That is DESIGN.md §10 item 1's "at the lightest lobe": the ground is a lit
 * field, and a colour that reads on its floor can vanish on its brightest point.
 *
 * Every stop of every gradient is read out of the COMPUTED
 * `background-image`, so the lobes are measured as the browser resolved them
 * rather than re-derived from token names this file would then have to keep in
 * step (I16).
 *
 * WHAT IS EXEMPT, and why each one is not a hole: a control the build has
 * disabled (WCAG 2.x exempts inactive components, and this product states its
 * refusals in prose beside them, which is not exempt and is measured); anything
 * with no box on screen; and anything whose text is one character or less,
 * which is punctuation between two things that were each measured.
 */

/** WCAG 1.4.3 for text and 1.4.11 for a control's boundary. They are here and
 *  not in the driver because the probe COUNTS what fails before it truncates,
 *  and a second copy of a threshold is a second thing that can drift. */
export const TEXT_MIN = 4.5
export const EDGE_MIN = 3

/** Colour arithmetic: parse, composite, relative luminance, WCAG ratio. */
const COLOR = `
  const parse = (s) => {
    const t = (s || '').trim()
    const h = /^#([0-9a-f]{3,8})$/i.exec(t)
    if (h) { const d = h[1].length <= 4 ? h[1].split('').map((c) => c + c) : h[1].match(/../g)
      return [parseInt(d[0],16), parseInt(d[1],16), parseInt(d[2],16), d[3] === undefined ? 1 : parseInt(d[3],16)/255] }
    const m = /rgba?\\(([^)]+)\\)/.exec(t)
    if (!m) return null
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  const over = (top, base) => { const a = top[3]
    return [top[0]*a + base[0]*(1-a), top[1]*a + base[1]*(1-a), top[2]*a + base[2]*(1-a), 1] }
  const lum = (c) => { const f = (v) => { const x = v/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4) }
    return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
`

/** Every opaque colour a box could be standing on, worst case included. */
const BASES = `
  const stops = (img) => (img === 'none' ? []
    : (img.match(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}/gi) || []).map(parse).filter((c) => c && c[3] > 0.02))
  const bases = (node) => {
    if (!node) return [[255, 255, 255, 1]]
    const cs = getComputedStyle(node)
    const own = parse(cs.backgroundColor)
    const below = own && own[3] === 1 ? [own]
      : bases(node.parentElement).map((b) => (own && own[3] > 0 ? over(own, b) : b))
    const g = stops(cs.backgroundImage)
    // A gradient sits OVER the fill below it, so each stop is another candidate
    // rather than a replacement. Capped, because the ground alone has thirteen.
    return g.length ? below.concat(...g.map((s) => below.map((b) => over(s, b)))).slice(0, 24) : below
  }
  const worst = (fg, beds) => {
    let low = Infinity, bed = beds[0]
    for (const b of beds) { const r = ratio(over(fg, b), b); if (r < low) { low = r; bed = b } }
    return { r: Math.round(low * 100) / 100, on: bed.map(Math.round).slice(0, 3).join(',') }
  }
  const where = (el) => { const bits = []
    for (let n = el; n && n !== document.body; n = n.parentElement)
      bits.unshift(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className
        ? '.' + n.className.trim().split(/\\s+/).map((c) => c.replace(/^.*__/, '')).join('.') : ''))
    return bits.slice(-2).join(' > ') }
`

/** Elements that hold their own words, and controls that draw their own edge. */
const SUBJECTS = `
  const SPEAKS = /^(DIV|SPAN|P|A|H1|H2|H3|LI|BUTTON|LABEL|STRONG|EM|CODE|PRE|DT|DD|SUMMARY|TD|TH|SMALL|B)$/
  const CONTROLS = 'button, input, textarea, select, a[href], summary, [role=button]'
  const dead = (el) => el.closest('[disabled], [aria-disabled="true"]') !== null
  const shown = (el) => el.getClientRects().length > 0 && !dead(el)
`

/**
 * The whole probe, as one expression. It answers with the failures it found and
 * the worst ratio it saw, because "contrast is bad" teaches nobody: the driver
 * prints the element, the two colours and the number.
 */
export const PROBE = `(() => {
${COLOR}${BASES}${SUBJECTS}
  const text = [], edges = []
  for (const el of document.querySelectorAll('body *')) {
    if (!SPEAKS.test(el.tagName) || !shown(el)) continue
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue
    const cs = getComputedStyle(el)
    const fg = parse(cs.color)
    if (!fg) continue
    const { r, on } = worst(fg, bases(el))
    text.push({ r, on, el: where(el), fg: cs.color, size: cs.fontSize, says: el.textContent.trim().slice(0, 32) })
  }
  // A CONTROL'S EDGE IS A NON-TEXT BOUNDARY (WCAG 1.4.11, DESIGN.md §10 item
  // 2), and it is measured against what is BEHIND the control — the edge
  // separates it from the surface it stands on, not from its own fill. A
  // hairline inside a filled surface is a light catch and is deliberately not
  // one of these: only what a person presses is here.
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!shown(el)) continue
    const cs = getComputedStyle(el)
    const edge = parse(cs.borderTopColor)
    if (!edge || edge[3] === 0 || cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) continue
    const beds = bases(el.parentElement)
    const { r, on } = worst(edge, beds)
    edges.push({ r, on, el: where(el), fg: cs.borderTopColor, size: cs.fontSize, says: el.textContent.trim().slice(0, 32) })
  }
  const by = (a, b) => a.r - b.r
  // THE COUNTS ARE NOT THE SAMPLES. Only the eight worst of each are carried
  // back, and a person handed eight failures fixes eight and reruns into eight
  // more unless the answer says how many there were.
  const bad = { text: text.filter((t) => t.r < ${TEXT_MIN}).length, edges: edges.filter((e) => e.r < ${EDGE_MIN}).length }
  return JSON.stringify({ text: text.sort(by).slice(0, 8), edges: edges.sort(by).slice(0, 8), seen: text.length + edges.length, bad })
})()`
