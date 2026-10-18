// The observation desk's graphs as geometry (2026-10-17 owner: "observation desk, graphs and observations" — the kit's
// charts artifact, backend/kernel/builtin/charts.js, view `chart`). Pure (no React, no host), so the chart view
// (components/views/chart.jsx) only draws what chartLayout returns and the tests read the same numbers: the scaling,
// the ticks, the downsampling and the hover lookup live here.
//
//   chart (the twin's): { id, title, kind: line | scatter | bar, x, y: name | [names], file, by,
//                         series: [{name, points: [[x, y, label?]…]}], updatedAt, error }
//   chartLayout(chart, {width, height, maxPoints, maxBars}) → {
//     kind, width, height, plot: {left, top, right, bottom}, empty, clipped (bar groups left out, oldest first),
//     series: [{name, slot (1..8, 0 = past the palette: drawn muted), n, last: [x, y, label?] | null, d (line path),
//               points: [{x, y, label, px, py}] (what is drawn), bars: [{x, y, label, px, py, w, h}]}],
//     yTicks: [{v, text, py}] (the y range's min and max), baseline: py of y = 0 inside the range | null,
//     xTicks: [{v, text, px, anchor: start | middle | end}] (the x range's min and max, or the points' labels) }
//   downsample(points, max) → at most `max` points: the first, the last and each bucket's min and max, in order
//   cleanPoints(points) → [[x, y, label?]] with every non-numeric point dropped
//   tickTexts(values) → each value as short text, with as many digits as it takes to tell them apart
//   nearestPoints(layout, px) → per series the drawn point nearest the pointer's x (the hover readout)
//   newestChart(charts) → the chart a closed card shows (the newest updated)
//   axisText(chart) → "loss, val_bpb vs step"

export const SERIES_SLOTS = 8 // categorical colours in fixed order (chart.jsx); a 9th series is drawn muted, never a new hue
export const KINDS = ["line", "scatter", "bar"]

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN)

// The kernel drops non-numeric points already; a twin from an older server, or a hand-written one, may not.
export function cleanPoints(points) {
  const out = []
  for (const p of Array.isArray(points) ? points : []) {
    if (!Array.isArray(p)) continue
    const x = num(p[0])
    const y = num(p[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push(p[2] != null && p[2] !== "" ? [x, y, String(p[2])] : [x, y])
  }
  return out
}

// Largest-triangle needs more than a card needs: per bucket its lowest and highest point (in their order), so a spike
// or a dip never disappears from a small chart, plus the first and the last point.
export function downsample(points, max) {
  const n = points.length
  if (n <= max) return points
  if (max < 1) return []
  if (max < 4) return max === 1 ? [points[n - 1]] : [points[0], points[n - 1]]
  const inner = n - 2
  const buckets = Math.floor((max - 2) / 2)
  const out = [points[0]]
  for (let b = 0; b < buckets; b++) {
    const from = 1 + Math.floor((b * inner) / buckets)
    const to = 1 + Math.floor(((b + 1) * inner) / buckets)
    if (to <= from) continue
    let lo = from
    let hi = from
    for (let i = from + 1; i < to; i++) {
      if (points[i][1] < points[lo][1]) lo = i
      if (points[i][1] > points[hi][1]) hi = i
    }
    if (lo === hi) out.push(points[lo])
    else out.push(points[Math.min(lo, hi)], points[Math.max(lo, hi)])
  }
  out.push(points[n - 1])
  return out
}

// One number as tick text: 3 significant digits, 12.3K for large, 1.2e-5 for tiny.
function short(v, digits = 3) {
  if (!Number.isFinite(v)) return ""
  if (v === 0) return "0"
  const a = Math.abs(v)
  if (a < 1e-3) return v.toExponential(Math.max(0, digits - 2))
  if (a >= 1e4) return new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: digits }).format(v)
  // below 10K every integer digit stays (a step axis ending at 1234 must not read 1230)
  const whole = Math.floor(Math.log10(a)) + 1
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: Math.min(21, Math.max(digits, whole)), useGrouping: false }).format(v)
}

// Each value as text, more digits until two different values read differently (a loss from 2.3412 to 2.3448 must not
// show "2.34" at both ends).
export function tickTexts(values) {
  for (let digits = 3; digits <= 8; digits++) {
    const texts = values.map((v) => short(v, digits))
    const clash = values.some((v, i) => values.some((w, j) => j > i && w !== v && texts[j] === texts[i]))
    if (!clash) return texts
  }
  return values.map((v) => String(v))
}

export const numberText = (v) => short(v)

function range(values, { zero = false } = {}) {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) return [0, 1]
  if (zero) {
    lo = Math.min(lo, 0)
    hi = Math.max(hi, 0)
  }
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 1
    return [lo - pad, hi + pad]
  }
  return [lo, hi]
}

const scale = ([d0, d1], [r0, r1]) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
const round1 = (v) => Math.round(v * 10) / 10
const yNames = (chart) => (Array.isArray(chart?.y) ? chart.y : chart?.y ? [chart.y] : [])

export const axisText = (chart) => {
  const ys = yNames(chart).join(", ")
  return ys ? `${ys} vs ${chart?.x || "row"}` : ""
}

// The newest updated chart (a closed card shows one).
export function newestChart(charts) {
  const list = Array.isArray(charts) ? charts : []
  const at = (c) => Date.parse(c?.updatedAt ?? "") || 0
  return list.reduce((best, c) => (best == null || at(c) > at(best) ? c : best), null)
}

// The x labels to draw: at most `room` of them, evenly over the labelled x values, the first and the last always.
function pickLabels(entries, room) {
  if (entries.length <= room) return entries
  if (room <= 1) return [entries[entries.length - 1]]
  return Array.from({ length: room }, (_, i) => entries[Math.round((i * (entries.length - 1)) / (room - 1))])
}

const CHAR_PX = 6 // a 10px tick character, wide enough for digits
const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text)

export function chartLayout(chart, { width = 320, height = 120, maxPoints = null, maxBars = 48 } = {}) {
  const kind = KINDS.includes(chart?.kind) ? chart.kind : "line"
  let series = (Array.isArray(chart?.series) ? chart.series : []).map((s, i) => {
    const points = cleanPoints(s?.points)
    // A line is drawn in x order (a file's rows may not be); a stable sort keeps equal x in file order.
    if (kind === "line") points.sort((a, b) => a[0] - b[0])
    return { name: String(s?.name ?? `series ${i + 1}`), slot: i < SERIES_SLOTS ? i + 1 : 0, points }
  })
  // Bars: one group per x value; past maxBars the newest groups stay (the clipped count says how many went).
  let groups = []
  let clipped = 0
  if (kind === "bar") {
    groups = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b)
    clipped = Math.max(0, groups.length - maxBars)
    if (clipped) {
      groups = groups.slice(clipped)
      const keep = new Set(groups)
      series = series.map((s) => ({ ...s, points: s.points.filter((p) => keep.has(p[0])) }))
    }
  }
  const all = series.flatMap((s) => s.points)
  const labels = new Map()
  for (const p of all) if (p[2] != null && !labels.has(p[0])) labels.set(p[0], p[2])

  const yRange = range(all.map((p) => p[1]), { zero: kind === "bar" })
  const xRange = range(all.map((p) => p[0]))
  const yTickTexts = tickTexts(yRange)
  const left = Math.min(Math.round(width / 3), Math.max(24, Math.max(...yTickTexts.map((t) => t.length)) * CHAR_PX + 8))
  const plot = { left, top: 6, right: Math.max(left + 10, width - 8), bottom: Math.max(16, height - 18) }
  const sy = scale(yRange, [plot.bottom, plot.top])
  const plotWidth = plot.right - plot.left
  const band = kind === "bar" && groups.length ? plotWidth / groups.length : 0
  const sx = kind === "bar" ? (x) => plot.left + band * (groups.indexOf(x) + 0.5) : scale(xRange, [plot.left, plot.right])
  const cap = maxPoints ?? Math.max(16, Math.round(kind === "scatter" ? plotWidth * 2 : plotWidth))

  const zeroPy = sy(0)
  const inside = (py) => py > plot.top + 0.5 && py < plot.bottom - 0.5
  const baseline = kind === "bar" ? round1(Math.min(plot.bottom, Math.max(plot.top, zeroPy))) : inside(zeroPy) ? round1(zeroPy) : null
  const inner = band * 0.8
  const drawn = series.filter((s) => s.points.length)
  const barW = drawn.length ? Math.max(1, inner / drawn.length - (drawn.length > 1 ? 1 : 0)) : 0

  const out = series.map((s) => {
    const shown = kind === "bar" ? s.points : downsample(s.points, cap)
    const points = shown.map((p) => ({ x: p[0], y: p[1], label: p[2] ?? null, px: round1(sx(p[0])), py: round1(sy(p[1])) }))
    const d = kind === "line" && points.length ? points.map((p, i) => `${i ? "L" : "M"}${p.px} ${p.py}`).join(" ") : ""
    const k = drawn.indexOf(s)
    const bars =
      kind === "bar" && k >= 0
        ? points.map((p) => {
            const x0 = plot.left + band * groups.indexOf(p.x) + (band - inner) / 2 + k * (inner / drawn.length)
            const top = Math.min(p.py, baseline)
            return { ...p, px: round1(x0), py: round1(top), w: round1(barW), h: round1(Math.max(1, Math.abs(p.py - baseline))) }
          })
        : []
    return { name: s.name, slot: s.slot, n: s.points.length, last: s.points.at(-1) ?? null, d, points, bars }
  })

  const yTicks = [
    { v: yRange[0], text: yTickTexts[0], py: plot.bottom },
    { v: yRange[1], text: yTickTexts[1], py: plot.top },
  ]
  // x: the points' labels when they carry them (a run id as x), else the range's min and max.
  let xTicks
  if (labels.size) {
    const xs = (kind === "bar" ? groups : [...labels.keys()].sort((a, b) => a - b)).filter((x) => labels.has(x))
    const room = Math.max(1, Math.floor(plotWidth / 64))
    const picked = pickLabels(xs, room)
    xTicks = picked.map((x, i) => ({
      v: x,
      text: clip(labels.get(x), 10),
      px: round1(sx(x)),
      anchor: picked.length === 1 ? "middle" : i === 0 && kind !== "bar" ? "start" : i === picked.length - 1 && kind !== "bar" ? "end" : "middle",
    }))
  } else if (all.length) {
    // the data's own ends (one x value: one tick in the middle, not the padded range around it)
    const ends = kind === "bar" ? [groups[0], groups.at(-1)] : all.reduce(([lo, hi], p) => [Math.min(lo, p[0]), Math.max(hi, p[0])], [Infinity, -Infinity])
    const texts = tickTexts(ends)
    xTicks = ends[0] === ends[1] ? [{ v: ends[0], text: texts[0], px: round1(sx(ends[0])), anchor: "middle" }] : [
      { v: ends[0], text: texts[0], px: round1(kind === "bar" ? sx(ends[0]) : plot.left), anchor: kind === "bar" ? "middle" : "start" },
      { v: ends[1], text: texts[1], px: round1(kind === "bar" ? sx(ends[1]) : plot.right), anchor: kind === "bar" ? "middle" : "end" },
    ]
  } else xTicks = []

  return { kind, width, height, plot, empty: all.length === 0, clipped, series: out, yTicks, baseline, xTicks }
}

// Per series, the drawn point (bar: the bar) nearest the pointer's x — what the hover readout lists.
export function nearestPoints(layout, px) {
  const out = []
  for (const s of layout?.series ?? []) {
    const marks = layout.kind === "bar" ? s.bars.map((b) => ({ ...b, px: b.px + b.w / 2 })) : s.points
    let best = null
    for (const p of marks) if (!best || Math.abs(p.px - px) < Math.abs(best.px - px)) best = p
    if (best) out.push({ name: s.name, slot: s.slot, x: best.x, y: best.y, label: best.label, px: best.px, py: best.py })
  }
  return out
}
