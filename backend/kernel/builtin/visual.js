// Visuals an agent builds for the owner (2026-10-17 owner: "live artifacts with visuals where the lead is able to build
// visuals … visualize the elements and even show me step by step or flow"): a small JSON spec the UI draws and animates
// (components/stage/visual.jsx, anime.js), carried by a stage scene — written inline by the agent, or a workspace file a
// script keeps rewriting (the stage reads it again as it changes, so a visual can follow a training run). Pure: the
// stage checks a spec here and describes it in the prompt; the UI trusts the normalized shape.
//
//   flow     {nodes: [{id, label?, group?, note?, value?}] ≤ 120, edges: [{from, to, label?, weight?}] ≤ 300,
//             direction?: right | down, order?: [node ids]}          a graph laid out in columns (group = its column;
//                                                                     none: by depth); played step by step along order
//   steps    {steps: [{title, detail?, value?}] ≤ 40}                 a sequence revealed one at a time
//   matrix   {values: [[n]] | frames: [{label?, values}], rows?, cols?, range?: [lo, hi], diverging?, unit?}
//             ≤ 64 × 64 cells, frames × cells ≤ 80 000                a heatmap (weights, attention), replayed by frame
//   line     {series: [{name, points: [[x, y]] ≤ 1000}] ≤ 12, x?, y?, marks?: [{x, label}] ≤ 20}
//   bars     {bars: [{label, value, note?}] ≤ 60 | frames: [{label?, bars}] ≤ 60, unit?}
//   tokens   {prompt?, tokens: [{text, p?, entropy?, top?: [[text, p]] ≤ 10}] ≤ 300}   text written token by token
//   scatter  {points: [{x, y, label?, group?}] ≤ 2000 | frames: [{label?, points}] ≤ 60 × 500, x?, y?, trails?}
//   compare  {sides: [{title, visual, note?}] 2–3, verdict?}          two or three ideas side by side (encoder-decoder
//                                                                     vs decoder-only; run A vs run B), each any kind
//                                                                     above, with what the comparison shows
// Every kind: title?, caption? (one line under it). Numbers that are not finite become null; labels are clipped.

export const VISUAL_KINDS = ["flow", "steps", "matrix", "line", "bars", "tokens", "scatter", "compare"]

const LABEL = 60
const TEXT = 400
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v, n = LABEL) => (v == null ? "" : String(v).slice(0, n))
const arr = (v, what) => {
  if (!Array.isArray(v)) throw new Error(`${what}: a list`)
  return v
}
const cap = (list, n, what) => {
  if (list.length > n) throw new Error(`${what}: ${list.length} — at most ${n}`)
  return list
}
const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""))

function grid(values, what) {
  const rows = arr(values, what)
  if (!rows.length) throw new Error(`${what}: no rows`)
  const width = Array.isArray(rows[0]) ? rows[0].length : 0
  if (!width) throw new Error(`${what}: rows of numbers ([[0.1, 0.2], [0.3, 0.4]])`)
  if (rows.length > 64 || width > 64) throw new Error(`${what}: ${rows.length} × ${width} — at most 64 × 64`)
  return rows.map((r, i) => {
    if (!Array.isArray(r) || r.length !== width) throw new Error(`${what}: row ${i} has ${Array.isArray(r) ? r.length : "no"} values, the first has ${width}`)
    return r.map(num)
  })
}

function labels(v, n, what) {
  if (v == null) return null
  if (arr(v, what).length !== n) throw new Error(`${what}: ${v.length} labels for ${n}`)
  return v.map((x) => str(x, 24))
}

const CHECK = {
  flow(s) {
    const nodes = cap(arr(s.nodes, "nodes"), 120, "nodes").map((n, i) => {
      const id = str(n?.id ?? n, 40).trim()
      if (!id) throw new Error(`nodes[${i}]: an id`)
      return opt({ id, label: str(n?.label ?? id), group: n?.group == null ? null : str(n.group, 40), note: str(n?.note, TEXT), value: num(n?.value) })
    })
    const ids = new Set(nodes.map((n) => n.id))
    if (ids.size !== nodes.length) throw new Error("nodes: ids must be unique")
    const edges = cap(arr(s.edges ?? [], "edges"), 300, "edges").map((e, i) => {
      const from = str(e?.from, 40)
      const to = str(e?.to, 40)
      if (!ids.has(from) || !ids.has(to)) throw new Error(`edges[${i}]: ${from || "?"} → ${to || "?"} names a node that is not listed`)
      return opt({ from, to, label: str(e?.label), weight: num(e?.weight) })
    })
    const order = s.order == null ? null : arr(s.order, "order").map((x) => str(x, 40)).filter((x) => ids.has(x))
    return opt({ nodes, edges, direction: s.direction === "down" ? "down" : "right", order: order?.length ? order : null })
  },
  steps(s) {
    const steps = cap(arr(s.steps, "steps"), 40, "steps").map((x, i) => {
      const title = str(x?.title ?? x, 120).trim()
      if (!title) throw new Error(`steps[${i}]: a title`)
      return opt({ title, detail: str(x?.detail, TEXT), value: x?.value == null ? null : str(x.value, LABEL) })
    })
    if (!steps.length) throw new Error("steps: at least one")
    return { steps }
  },
  matrix(s) {
    const frames = s.frames != null ? cap(arr(s.frames, "frames"), 120, "frames").map((f, i) => opt({ label: str(f?.label), values: grid(f?.values, `frames[${i}].values`) })) : [{ values: grid(s.values, "values") }]
    if (!frames.length) throw new Error("frames: at least one")
    const [r, c] = [frames[0].values.length, frames[0].values[0].length]
    frames.forEach((f, i) => {
      if (f.values.length !== r || f.values[0].length !== c) throw new Error(`frames[${i}]: ${f.values.length} × ${f.values[0].length}, the first is ${r} × ${c}`)
    })
    if (frames.length * r * c > 80000) throw new Error(`${frames.length} frames × ${r} × ${c} cells — at most 80 000 numbers`)
    const range = Array.isArray(s.range) && s.range.length === 2 && num(s.range[0]) != null && num(s.range[1]) != null ? [num(s.range[0]), num(s.range[1])] : null
    return opt({ frames, rows: labels(s.rows, r, "rows"), cols: labels(s.cols, c, "cols"), range, diverging: s.diverging ? true : null, unit: str(s.unit, 20) })
  },
  line(s) {
    const series = cap(arr(s.series, "series"), 12, "series").map((x, i) => {
      const points = cap(arr(x?.points, `series[${i}].points`), 1000, `series[${i}].points`).map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p?.x), num(p?.y)]))
      return { name: str(x?.name ?? `series ${i + 1}`), points }
    })
    if (!series.length) throw new Error("series: at least one")
    const marks = s.marks == null ? null : cap(arr(s.marks, "marks"), 20, "marks").map((m) => opt({ x: num(m?.x), label: str(m?.label) }))
    return opt({ series, x: str(s.x, 30), y: str(s.y, 30), marks })
  },
  bars(s) {
    const bars = (list, what) => cap(arr(list, what), 60, what).map((b) => opt({ label: str(b?.label ?? b?.[0]), value: num(b?.value ?? b?.[1]), note: str(b?.note, TEXT) }))
    const frames = s.frames != null ? cap(arr(s.frames, "frames"), 60, "frames").map((f, i) => opt({ label: str(f?.label), bars: bars(f?.bars, `frames[${i}].bars`) })) : [{ bars: bars(s.bars, "bars") }]
    if (!frames.length) throw new Error("frames: at least one")
    return opt({ frames, unit: str(s.unit, 20) })
  },
  tokens(s) {
    const tokens = cap(arr(s.tokens, "tokens"), 300, "tokens").map((t) =>
      opt({
        text: str(t?.text ?? t, 40),
        p: num(t?.p),
        entropy: num(t?.entropy),
        top: t?.top == null ? null : cap(arr(t.top, "top"), 10, "top").map((x) => [str(x?.[0] ?? x?.text, 40), num(x?.[1] ?? x?.p)]),
      }),
    )
    return opt({ prompt: str(s.prompt, TEXT), tokens })
  },
  scatter(s) {
    const pts = (list, n, what) => cap(arr(list, what), n, what).map((p) => opt({ x: num(p?.x ?? p?.[0]), y: num(p?.y ?? p?.[1]), label: str(p?.label, 30), group: p?.group == null ? null : str(p.group, 30) }))
    const frames = s.frames != null ? cap(arr(s.frames, "frames"), 60, "frames").map((f, i) => opt({ label: str(f?.label), points: pts(f?.points, 500, `frames[${i}].points`) })) : [{ points: pts(s.points, 2000, "points") }]
    if (!frames.length) throw new Error("frames: at least one")
    return opt({ frames, x: str(s.x, 30), y: str(s.y, 30), trails: s.trails ? true : null })
  },
  compare(s) {
    const sides = arr(s.sides, "sides")
    if (sides.length < 2 || sides.length > 3) throw new Error(`sides: ${sides.length} — two or three ideas side by side`)
    return opt({
      sides: sides.map((x, i) => {
        const v = x?.visual
        if (!v || typeof v !== "object" || !CHECK[v.kind] || v.kind === "compare") throw new Error(`sides[${i}].visual: a visual of one kind (${VISUAL_KINDS.filter((k) => k !== "compare").join(", ")})`)
        let side
        try {
          side = { kind: v.kind, ...opt({ title: str(v.title, 80), caption: str(v.caption, TEXT) }), ...CHECK[v.kind](v) }
        } catch (e) {
          throw new Error(`sides[${i}].visual: ${e.message}`)
        }
        return opt({ title: str(x?.title ?? `side ${i + 1}`, 80), note: str(x?.note, TEXT), visual: side })
      }),
      verdict: str(s.verdict, TEXT),
    })
  },
}

// A spec as an agent or a file gives it (an object or its JSON text) → the normalized visual, or an Error saying what to
// fix. maxChars: the JSON's size limit (an inline spec is small; a file may be larger).
export function checkVisual(raw, { maxChars = 24000 } = {}) {
  let s = raw
  if (typeof raw === "string") {
    if (raw.length > maxChars) throw new Error(`visual: ${raw.length} chars — at most ${maxChars} (a larger one goes in a file: {file: "projects/<slug>/out/…json"})`)
    try {
      s = JSON.parse(raw)
    } catch {
      throw new Error(`visual: not JSON — an object such as {"kind": "flow", "nodes": [...], "edges": [...]}`)
    }
  }
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`visual: an object with a kind (${VISUAL_KINDS.join(", ")})`)
  if (typeof raw !== "string" && JSON.stringify(s).length > maxChars) throw new Error(`visual: over ${maxChars} chars of JSON — a larger one goes in a file: {file: "projects/<slug>/out/…json"}`)
  const kind = String(s.kind ?? "")
  if (!CHECK[kind]) throw new Error(`visual.kind: "${kind}" — one of ${VISUAL_KINDS.join(", ")}`)
  return { kind, ...opt({ title: str(s.title, 80), caption: str(s.caption, TEXT) }), ...CHECK[kind](s) }
}

// One line for the prompt: what the owner sees.
export function visualBrief(v) {
  if (!v?.kind) return ""
  const frames = v.frames?.length > 1 ? `, ${v.frames.length} frames` : ""
  switch (v.kind) {
    case "flow":
      return `flow ${v.nodes.length} nodes, ${v.edges?.length ?? 0} edges`
    case "steps":
      return `steps ${v.steps.length}`
    case "matrix":
      return `matrix ${v.frames[0].values.length}×${v.frames[0].values[0].length}${frames}`
    case "line":
      return `line ${v.series.length} series, ${v.series.reduce((n, s) => n + s.points.length, 0)} points`
    case "bars":
      return `bars ${v.frames[0].bars.length}${frames}`
    case "tokens":
      return `tokens ${v.tokens.length}`
    case "scatter":
      return `scatter ${v.frames[0].points.length} points${frames}`
    case "compare":
      return `compare ${v.sides.map((s) => `${s.title} (${visualBrief(s.visual)})`).join(" vs ")}`
    default:
      return v.kind
  }
}
