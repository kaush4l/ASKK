// The stage visuals' geometry (kernel builtin/visual.js specs → positions, scales, colours), pure so it is tested without
// a tab; components/stage/visual.jsx draws and animates what these return. Every scale is fixed over all of a visual's
// frames, so a replay compares like with like.

// Map [d0, d1] onto [r0, r1] (a flat domain maps to the middle).
export function scale([d0, d1], [r0, r1]) {
  const span = d1 - d0
  return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
}

// [min, max] of the finite numbers in a nested list, or [0, 1] when there are none.
export function extent(values) {
  let lo = Infinity
  let hi = -Infinity
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === "number" && Number.isFinite(v)) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  walk(values)
  return lo === Infinity ? [0, 1] : [lo, hi]
}

// A matrix visual's colour range: its own range, else every frame's extent (diverging: symmetric around 0).
export function matrixRange(v) {
  if (v.range) return v.range
  const [lo, hi] = extent(v.frames.map((f) => f.values))
  if (!v.diverging) return [lo, hi]
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
  return [-m, m]
}

// A cell's colour on a black screen: sequential dark violet → bright pink-orange; diverging blue ← black → red.
export function cellColor(value, [lo, hi], diverging = false) {
  if (value == null || !Number.isFinite(value)) return "oklch(0.25 0 0)"
  if (diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
    const t = Math.max(-1, Math.min(1, value / m))
    const a = Math.abs(t)
    return `oklch(${(0.16 + 0.6 * a).toFixed(3)} ${(0.02 + 0.17 * a).toFixed(3)} ${t < 0 ? 250 : 25})`
  }
  const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
  return `oklch(${(0.18 + 0.7 * t).toFixed(3)} ${(0.05 + 0.16 * t).toFixed(3)} ${(290 - 70 * t).toFixed(1)})`
}

// A flow laid out in columns: a node's group is its column (in the order groups first appear), else its depth (longest
// path from a node nothing points to; a cycle stops at the node count). Rows spread evenly in each column. direction
// down swaps the axes. → {nodes: [{...node, x, y, col}], edges: [{...edge, path}], order: [ids], cols}
export function flowLayout(v, { width = 640, height = 360, pad = 48 } = {}) {
  const nodes = v.nodes ?? []
  const edges = v.edges ?? []
  const col = new Map()
  if (nodes.some((n) => n.group != null)) {
    const groups = []
    for (const n of nodes) if (!groups.includes(n.group ?? "")) groups.push(n.group ?? "")
    for (const n of nodes) col.set(n.id, groups.indexOf(n.group ?? ""))
  } else {
    for (const n of nodes) col.set(n.id, 0)
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false
      for (const e of edges) {
        if (e.from === e.to) continue
        const want = col.get(e.from) + 1
        if (want > col.get(e.to) && want < nodes.length) {
          col.set(e.to, want)
          moved = true
        }
      }
      if (!moved) break
    }
  }
  const cols = Math.max(1, ...[...col.values()].map((c) => c + 1))
  const byCol = Array.from({ length: cols }, () => [])
  for (const n of nodes) byCol[col.get(n.id)].push(n)
  const down = v.direction === "down"
  const [along, across] = down ? [height, width] : [width, height]
  const placed = new Map()
  byCol.forEach((list, c) =>
    list.forEach((n, r) => {
      const a = cols === 1 ? along / 2 : pad + (c * (along - 2 * pad)) / (cols - 1)
      const b = (across * (r + 1)) / (list.length + 1)
      placed.set(n.id, { ...n, col: c, x: down ? b : a, y: down ? a : b })
    }),
  )
  const out = nodes.map((n) => placed.get(n.id))
  const f = (n) => n.toFixed(1)
  const path = (p, q) => {
    if (down) {
      const my = (p.y + q.y) / 2
      return `M${f(p.x)},${f(p.y)} C${f(p.x)},${f(my)} ${f(q.x)},${f(my)} ${f(q.x)},${f(q.y)}`
    }
    const mx = (p.x + q.x) / 2
    return `M${f(p.x)},${f(p.y)} C${f(mx)},${f(p.y)} ${f(mx)},${f(q.y)} ${f(q.x)},${f(q.y)}`
  }
  const order = v.order?.length ? v.order : [...out].sort((a, b) => a.col - b.col || (down ? a.x - b.x : a.y - b.y)).map((n) => n.id)
  return { nodes: out, edges: edges.map((e) => ({ ...e, path: path(placed.get(e.from), placed.get(e.to)) })), order, cols }
}

// A line visual's scales and paths: one x and one y domain over every series (marks included in x).
export function linePaths(v, { width = 640, height = 300, pad = 40 } = {}) {
  const xs = extent([v.series.map((s) => s.points.map((p) => p[0])), (v.marks ?? []).map((m) => m.x)])
  const ys = extent(v.series.map((s) => s.points.map((p) => p[1])))
  const sx = scale(xs, [pad, width - pad / 2])
  const sy = scale(ys, [height - pad, pad / 2])
  const series = v.series.map((s) => {
    const pts = s.points.filter((p) => p[0] != null && p[1] != null)
    return { name: s.name, d: pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" "), last: pts.at(-1) ?? null, end: pts.length ? [sx(pts.at(-1)[0]), sy(pts.at(-1)[1])] : null }
  })
  return { series, xs, ys, sx, sy, marks: (v.marks ?? []).filter((m) => m.x != null).map((m) => ({ ...m, px: sx(m.x) })) }
}

// A scatter visual's scales over every frame, so points move between frames on one map.
export function scatterScales(v, { width = 640, height = 360, pad = 32 } = {}) {
  const all = v.frames.flatMap((fr) => fr.points)
  const sx = scale(extent(all.map((p) => p.x)), [pad, width - pad])
  const sy = scale(extent(all.map((p) => p.y)), [height - pad, pad])
  return { sx, sy }
}

// How many frames a visual replays (1: nothing to replay).
export const frameCount = (v) => (Array.isArray(v?.frames) ? v.frames.length : 1)

// A stable colour per series or group name (a small palette that reads on black and on white).
export const PALETTE = ["#d946ef", "#38bdf8", "#f59e0b", "#34d399", "#f87171", "#a78bfa", "#fb923c", "#22d3ee", "#facc15", "#4ade80", "#f472b6", "#60a5fa"]
export function paletteOf(names) {
  const seen = []
  for (const n of names) if (!seen.includes(n)) seen.push(n)
  return (name) => PALETTE[Math.max(0, seen.indexOf(name)) % PALETTE.length]
}
