// Visuals an agent builds for the owner (2026-10-17 owner: "live artifacts with visuals where the lead is able to build
// visuals … visualize the elements and even show me step by step or flow"): a small JSON spec the UI draws and animates
// (components/preview/visual.jsx, anime.js), carried by a preview visual (preview.show; 2026-10-17: the stage folded into
// the preview) — written inline by the agent, or a workspace file a script keeps rewriting (the preview reads it again as
// it changes, so a visual can follow a training run). Pure: the preview checks a spec here and describes it in the
// prompt; the UI trusts the normalized shape.
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
// Every kind: title?, caption? (one line under it), meta? (a small object — config, sha, step — shown as one line).
// Numbers that are not finite become null; labels are clipped.
//
// 2026-10-17 (owner: "it can zoom into granular token level"): drill-down and token detail.
//   open     on a flow node, a step, a bar, a token, a scatter point, a line series, and per row / column of a matrix
//            (open_rows: [link | null] × rows, open_cols: [link | null] × cols): a link to another visual of the preview,
//            "<visual id>" or {id, params?: {name: value} ≤ 8} — values letters, digits, . _ - (≤ 40, never a leading -:
//            a value is filled into a bound script's command, where it must not become an option), or "{x}" (the
//            clicked point's x: a line series or a scatter point). A click in the UI opens it (preview ownerCall "open").
//   tokens   each token also: id?, surprisal? (bits; derived as −log2 p when absent), target? (the teacher-forced next
//            token); the visual: color?: surprisal | p | entropy (the heat), range?: [lo, hi] (the heat's scale)
//   matrix   cells?: [[text ≤ 12]] (rows × cols, every frame) or frames[i].cells (that frame's): drawn in a cell big
//            enough, always in its tooltip and click context (a logit lens: the top-1 token per layer × position)

import { parseYamlish } from "../util/yamlish.js"

export const VISUAL_KINDS = ["flow", "steps", "matrix", "line", "bars", "tokens", "scatter", "compare"]
export const VISUAL_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i // a preview visual's id (preview.js)
export const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/
export const PARAM_VALUE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,39}$/ // never a path (no "/", never only dots), never an option (no leading "-")
export const PARAMS_MAX = 8
export const TOKEN_COLORS = ["surprisal", "p", "entropy"]
const META_MAX = 12
const CELL_TEXT = 12

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

// {name: value} ≤ PARAMS_MAX, each value a short word (a number becomes its text) — or null when empty. point: a value
// may be "{x}" (a link's: the clicked point's x, put in by the UI).
export function checkParams(raw, what = "params", { point = false } = {}) {
  if (raw == null) return null
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${what}: {name: value}, e.g. {"t": 7}`)
  const entries = Object.entries(raw)
  if (entries.length > PARAMS_MAX) throw new Error(`${what}: ${entries.length} — at most ${PARAMS_MAX}`)
  const out = {}
  for (const [k, v] of entries) {
    if (!PARAM_KEY.test(k)) throw new Error(`${what}: "${String(k).slice(0, 30)}" — a name of letters, digits or _`)
    const text = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : ""
    const ok = (PARAM_VALUE.test(text) && !/^\.+$/.test(text)) || (point && text === "{x}")
    if (!ok) throw new Error(`${what}.${k}: "${String(v ?? "").slice(0, 40)}" — letters, digits, . _ - (at most 40, not starting with -)${point ? ', or "{x}" (the clicked point\'s x)' : ""}`)
    out[k] = text
  }
  return entries.length ? out : null
}

// A drill-down link: "<visual id>" or {id, params?} → {id, params?}; nothing → null.
function link(raw, what) {
  if (raw == null || raw === "") return null
  const o = typeof raw === "string" ? { id: raw } : raw
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(`${what}: a visual id, or {id, params}`)
  const id = String(o.id ?? "").trim()
  if (!VISUAL_ID.test(id)) throw new Error(`${what}.id: "${id.slice(0, 40)}" — the id of a visual in the preview (letters, digits, - or _)`)
  const params = checkParams(o.params, `${what}.params`, { point: true })
  return params ? { id, params } : { id }
}

// One link per row (or column): [link | null] of exactly n; null when none links.
function links(raw, n, what) {
  if (raw == null) return null
  const list = arr(raw, what)
  if (list.length !== n) throw new Error(`${what}: ${list.length} links for ${n}`)
  const out = list.map((x, i) => link(x, `${what}[${i}]`))
  return out.some(Boolean) ? out : null
}

// A small object shown as one line (the config a visual was made from, its sha, the step): ≤ META_MAX scalar values.
function meta(raw) {
  if (raw == null) return null
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error('meta: a small object, e.g. {"config": "r04-base", "params": 19300000}')
  const entries = Object.entries(raw)
  if (entries.length > META_MAX) throw new Error(`meta: ${entries.length} keys — at most ${META_MAX}`)
  const out = {}
  for (const [k, v] of entries) {
    const key = String(k).slice(0, 24)
    if (typeof v === "boolean") out[key] = v
    else if (typeof v === "number") out[key] = Number.isFinite(v) ? v : null
    else if (v != null) out[key] = (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 80)
  }
  return Object.keys(out).length ? out : null
}

// Text per cell, the grid's shape: [[text ≤ CELL_TEXT]] of r × c; null when none.
function cellGrid(raw, r, c, what) {
  if (raw == null) return null
  const rows = arr(raw, what)
  if (rows.length !== r) throw new Error(`${what}: ${rows.length} rows of text, the values have ${r}`)
  return rows.map((row, i) => {
    if (!Array.isArray(row) || row.length !== c) throw new Error(`${what}: row ${i} has ${Array.isArray(row) ? row.length : "no"} texts, the values have ${c}`)
    return row.map((x) => (x == null ? "" : String(x).slice(0, CELL_TEXT)))
  })
}

const rangeOf = (v) => (Array.isArray(v) && v.length === 2 && num(v[0]) != null && num(v[1]) != null ? [num(v[0]), num(v[1])] : null)

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
      return opt({ id, label: str(n?.label ?? id), group: n?.group == null ? null : str(n.group, 40), note: str(n?.note, TEXT), value: num(n?.value), open: link(n?.open, `nodes[${i}].open`) })
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
      return opt({ title, detail: str(x?.detail, TEXT), value: x?.value == null ? null : str(x.value, LABEL), open: link(x?.open, `steps[${i}].open`) })
    })
    if (!steps.length) throw new Error("steps: at least one")
    return { steps }
  },
  matrix(s) {
    const raw = s.frames != null ? cap(arr(s.frames, "frames"), 120, "frames") : [{ values: s.values }]
    const frames = raw.map((f, i) => opt({ label: str(f?.label), values: grid(f?.values, s.frames != null ? `frames[${i}].values` : "values") }))
    if (!frames.length) throw new Error("frames: at least one")
    const [r, c] = [frames[0].values.length, frames[0].values[0].length]
    frames.forEach((f, i) => {
      if (f.values.length !== r || f.values[0].length !== c) throw new Error(`frames[${i}]: ${f.values.length} × ${f.values[0].length}, the first is ${r} × ${c}`)
      if (s.frames != null && raw[i]?.cells != null) f.cells = cellGrid(raw[i].cells, r, c, `frames[${i}].cells`)
    })
    if (frames.length * r * c > 80000) throw new Error(`${frames.length} frames × ${r} × ${c} cells — at most 80 000 numbers`)
    return opt({ frames, rows: labels(s.rows, r, "rows"), cols: labels(s.cols, c, "cols"), cells: cellGrid(s.cells, r, c, "cells"), range: rangeOf(s.range), diverging: s.diverging ? true : null, unit: str(s.unit, 20), open_rows: links(s.open_rows, r, "open_rows"), open_cols: links(s.open_cols, c, "open_cols") })
  },
  line(s) {
    const series = cap(arr(s.series, "series"), 12, "series").map((x, i) => {
      const points = cap(arr(x?.points, `series[${i}].points`), 1000, `series[${i}].points`).map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p?.x), num(p?.y)]))
      const open = link(x?.open, `series[${i}].open`)
      return { name: str(x?.name ?? `series ${i + 1}`), points, ...(open ? { open } : {}) }
    })
    if (!series.length) throw new Error("series: at least one")
    const marks = s.marks == null ? null : cap(arr(s.marks, "marks"), 20, "marks").map((m) => opt({ x: num(m?.x), label: str(m?.label) }))
    return opt({ series, x: str(s.x, 30), y: str(s.y, 30), marks })
  },
  bars(s) {
    const bars = (list, what) => cap(arr(list, what), 60, what).map((b, i) => opt({ label: str(b?.label ?? b?.[0]), value: num(b?.value ?? b?.[1]), note: str(b?.note, TEXT), open: Array.isArray(b) ? null : link(b?.open, `${what}[${i}].open`) }))
    const frames = s.frames != null ? cap(arr(s.frames, "frames"), 60, "frames").map((f, i) => opt({ label: str(f?.label), bars: bars(f?.bars, `frames[${i}].bars`) })) : [{ bars: bars(s.bars, "bars") }]
    if (!frames.length) throw new Error("frames: at least one")
    return opt({ frames, unit: str(s.unit, 20) })
  },
  tokens(s) {
    const tokens = cap(arr(s.tokens, "tokens"), 300, "tokens").map((t, i) => {
      const p = num(t?.p)
      let surprisal = num(t?.surprisal)
      if (surprisal == null && p != null && p > 0 && p <= 1) surprisal = Number((-Math.log2(p)).toFixed(4)) // bits
      return opt({
        text: str(t?.text ?? t, 40),
        id: num(t?.id),
        p,
        surprisal,
        entropy: num(t?.entropy),
        target: t?.target == null ? null : str(t.target, 40),
        top: t?.top == null ? null : cap(arr(t.top, `tokens[${i}].top`), 10, `tokens[${i}].top`).map((x) => [str(x?.[0] ?? x?.text, 40), num(x?.[1] ?? x?.p)]),
        open: typeof t === "object" ? link(t?.open, `tokens[${i}].open`) : null,
      })
    })
    if (s.color != null && !TOKEN_COLORS.includes(s.color)) throw new Error(`color: "${str(s.color, 20)}" — ${TOKEN_COLORS.join(" | ")} (the heat behind each token)`)
    return opt({ prompt: str(s.prompt, TEXT), tokens, color: s.color ?? null, range: rangeOf(s.range) })
  },
  scatter(s) {
    const pts = (list, n, what) => cap(arr(list, what), n, what).map((p, i) => opt({ x: num(p?.x ?? p?.[0]), y: num(p?.y ?? p?.[1]), label: str(p?.label, 30), group: p?.group == null ? null : str(p.group, 30), open: Array.isArray(p) ? null : link(p?.open, `${what}[${i}].open`) }))
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
          side = { kind: v.kind, ...opt({ title: str(v.title, 80), caption: str(v.caption, TEXT), meta: meta(v.meta) }), ...CHECK[v.kind](v) }
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
  return { kind, ...opt({ title: str(s.title, 80), caption: str(s.caption, TEXT), meta: meta(s.meta) }), ...CHECK[kind](s) }
}

// Every drill-down link a visual carries (a compare: its sides').
export function linksOf(v) {
  if (!v?.kind) return []
  const each = (list) => (list ?? []).map((x) => x?.open).filter(Boolean)
  switch (v.kind) {
    case "flow":
      return each(v.nodes)
    case "steps":
      return each(v.steps)
    case "matrix":
      return [...(v.open_rows ?? []), ...(v.open_cols ?? [])].filter(Boolean)
    case "line":
      return each(v.series)
    case "bars":
      return v.frames.flatMap((f) => each(f.bars))
    case "tokens":
      return each(v.tokens)
    case "scatter":
      return v.frames.flatMap((f) => each(f.points))
    case "compare":
      return v.sides.flatMap((s) => linksOf(s.visual))
    default:
      return []
  }
}

// "meta config r04-base, n_layer 6": a visual's meta in one line ("" when none).
export const metaLine = (m) =>
  m && typeof m === "object"
    ? Object.entries(m)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")
    : ""

// One line for the prompt: what the owner sees.
export function visualBrief(v) {
  if (!v?.kind) return ""
  const n = v.kind === "compare" ? 0 : linksOf(v).length
  const more = n ? `, ${n} link${n === 1 ? "" : "s"}` : ""
  return `${kindBrief(v)}${more}`
}

function kindBrief(v) {
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

// 2026-10-18 (the dev desk's lead: two refused preview.show calls for one answer): a spec written as indented
// "key: value" text (kind: bars / bars: / - label: …) is read with util/yamlish.js; a list whose first item holds the
// spec with an empty key and whose other items are that key's entries (the reply format's reading of the same text) is
// folded back into the spec.
export function folded(list) {
  const [head, ...rest] = list
  if (!head || typeof head !== "object" || Array.isArray(head) || head.kind == null) return list
  const empty = Object.keys(head).filter((k) => head[k] === "")
  return empty.length === 1 && rest.length ? { ...head, [empty[0]]: rest } : list
}

// A drawing in a conversation (2026-10-18 owner: "Only text based conversation is slow and verbose. So, when asking
// questions, the lead should have the option to draw the architecture for me to preview and understand."): talk.say /
// talk.ask's `visual` and a chat answer's ```visual block. raw → {show: "<preview visual id>"} (a bare id, or {show}:
// the drawing already in the preview — the architecture its script computes — drawn where the owner reads; the UI reads
// it from the preview, so it stays current) | a checked spec (an object, its JSON, or indented key: value text) | null
// (nothing given); an Error saying what to write otherwise.
export const TALK_VISUAL_MAX = 12000
export function readVisual(raw, { maxChars = TALK_VISUAL_MAX } = {}) {
  if (raw == null || raw === "") return null
  let v = raw
  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t) return null
    if (VISUAL_ID.test(t)) return { show: t }
    if (t.startsWith("{")) {
      try {
        v = JSON.parse(t)
      } catch {
        throw new Error(`visual: not JSON — a spec such as {"kind": "flow", "nodes": [...], "edges": [...]}, or {"show": "<a preview visual's id>"}`)
      }
    } else {
      v = parseYamlish(t)
      if (!v) throw new Error(`visual: not a spec — JSON on one line, indented key: value lines, or a preview visual's id`)
    }
  }
  if (Array.isArray(v)) v = folded(v)
  if (v && typeof v === "object" && !Array.isArray(v) && v.kind == null && v.show != null) {
    const id = String(v.show).trim()
    if (!VISUAL_ID.test(id)) throw new Error(`visual.show: "${String(v.show).slice(0, 40)}" — the id of a visual in the preview`)
    return { show: id }
  }
  return checkVisual(v, { maxChars })
}
