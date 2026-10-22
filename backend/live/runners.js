// A desk's live runners (an artifact with view "runners": code's formulas on live bars, each calling the lead back when
// its condition holds — a desk's own artifact class). Pure helpers for its UI twin
// (components/views/runners.jsx): the chart's geometry, each runner's state in a word and a tone, the owner's calls.
//   state.runners[]: { id, symbol, source, interval, every, when, plot, then, repeat, warn, until ("HH:MM" ET), on
//                      ("YYYY-MM-DD": the ET day it is live), from ("HH:MM" ET), gate ({symbol, when}: a second name's
//                      formula that must hold on the same bar), why, set_by, status (running | paused | fired | stopped |
//                      expired), error, last: {at, price, cond (the when), effective (cond and the gate together), gate:
//                      {cond, value} | null, held (the cond holds, the gate does not: why), sleeping (what it sleeps
//                      until: before its day or from), observed, values, prox: {gap, pace, eta}, warming},
//                      fires: [{at, kind}], chart: {t: [label], c: [close], plots: {name: [value]}, marks: [index], source,
//                      interval} }   (on, from, gate and last.effective/held/sleeping optional: older twins lack them)

import { teamCall } from "@/backend/live/stream"

const finite = (x) => typeof x === "number" && Number.isFinite(x)
const extent = (lists) => {
  let lo = Infinity
  let hi = -Infinity
  for (const l of lists) for (const v of l) if (finite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v))
  if (lo === Infinity) return null
  if (lo === hi) return [lo - (Math.abs(lo) * 0.001 || 1), hi + (Math.abs(hi) * 0.001 || 1)]
  return [lo, hi]
}
const path = (values, sx, sy) => {
  let d = ""
  let pen = false
  values.forEach((v, i) => {
    if (!finite(v)) return void (pen = false)
    d += `${pen ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`
    pen = true
  })
  return d
}

// A plot on the price's scale (a moving average, a band, the opening range) is drawn over the price; one on its own scale
// (RSI, MACD, a z-score, a volume ratio) gets the lower panel. → {width, height, price, over, lower, marks, first, last}
export function runnerCharts(chart, { width = 360, height = 150, lowerHeight = 54, pad = 4 } = {}) {
  const c = chart?.c ?? []
  const n = c.length
  const p = extent([c])
  if (!n || !p) return null
  const span = p[1] - p[0]
  const onPrice = ([, s]) => {
    const e = extent([s])
    return !!e && e[0] >= p[0] - span * 1.5 - Math.abs(p[0]) * 0.02 && e[1] <= p[1] + span * 1.5 + Math.abs(p[1]) * 0.02
  }
  const plots = Object.entries(chart.plots ?? {})
  const over = plots.filter(onPrice)
  const below = plots.filter((x) => !onPrice(x) && extent([x[1]]))
  const ys = extent([c, ...over.map(([, s]) => s)])
  const sx = (i) => pad + (n === 1 ? (width - 2 * pad) / 2 : (i / (n - 1)) * (width - 2 * pad))
  const sy = (v) => pad + (1 - (v - ys[0]) / (ys[1] - ys[0])) * (height - 2 * pad)
  const lastOf = (s) => [...s].reverse().find(finite) ?? null
  const out = {
    width,
    height,
    price: { d: path(c, sx, sy), ys, last: { x: sx(n - 1), y: sy(c[n - 1]), v: c[n - 1] } },
    over: over.map(([name, s]) => ({ name, d: path(s, sx, sy), last: lastOf(s) })),
    lower: null,
    marks: (chart.marks ?? []).filter((i) => i >= 0 && i < n).map((i) => ({ x: sx(i), at: chart.t?.[i] ?? "" })),
    first: chart.t?.[0] ?? "",
    last: chart.t?.[n - 1] ?? "",
  }
  if (below.length) {
    const ly = extent(below.map(([, s]) => s))
    const sl = (v) => pad + (1 - (v - ly[0]) / (ly[1] - ly[0])) * (lowerHeight - 2 * pad)
    out.lower = { height: lowerHeight, ys: ly, series: below.map(([name, s]) => ({ name, d: path(s, sx, sl), last: lastOf(s) })) }
  }
  return out
}

export const clockOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) : "")
const lastFire = (r) => (r?.fires ?? []).filter((f) => f.kind === "fire").at(-1) ?? null
const etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(d))
const etHM = (d) => new Date(d).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

// The window, as the desk reads it (custom/trading-team/tools/runners.js sleepsUntil): before its day or its from-time a
// runner sleeps — computed and charted, never fired. → what it sleeps until ("10-21 10:15" | "10-21" | "10:15"), else
// null. A twin without on/from falls back to what the desk's last read said.
export function sleepsUntil(r, now = new Date()) {
  if (!r?.on && !r?.from) return r?.last?.sleeping ?? null
  const day = etDay(now)
  if (r.on && day < r.on) return `${r.on.slice(5)}${r.from ? ` ${r.from}` : ""}`
  if (r.from && (!r.on || day === r.on) && etHM(now) < r.from) return r.from
  return null
}

// Running past its window — after its until on its day, or past its day — it reads, never fires (the desk's "window
// closed"). → why, else null.
function windowClosed(r, now) {
  if (r?.status !== "running") return null
  const day = etDay(now)
  if (r.on && day > r.on) return `${r.on.slice(5)} has passed`
  if (r.until && (!r.on || day === r.on) && etHM(now) > r.until) return `at ${r.until}`
  return null
}

// "on 10-21 · from 10:15 · until 11:00" ("" without a window).
export const windowText = (r) => [r?.on ? `on ${r.on.slice(5)}` : "", r?.from ? `from ${r.from}` : "", r?.until ? `until ${r.until}` : ""].filter(Boolean).join(" · ")

// The gate as the card draws it: null without one, else {symbol, when, value (the gate bar's close it read), holds: true |
// false | null, word}. Unread: no gate bar of the runner's bar's session yet; not read yet: no read since it was set.
export function runnerGate(r) {
  if (!r?.gate) return null
  const g = r.last?.gate ?? null
  const holds = g?.cond ?? null
  return { symbol: r.gate.symbol, when: r.gate.when, value: g?.value ?? null, holds, word: !g ? "not read yet" : holds === true ? "holds" : holds === false ? "false" : "unread" }
}

// One runner's state: {word, tone, detail}. tone: holds | near | running | warming | paused | done | error. "holds" only
// when the condition and its gate hold together on its bar (last.effective; a twin saved before gates: last.cond); a
// sleeping runner, one held by its gate and one past its window never read "holds". `now`: the clock its window is read at.
export function runnerStatus(r, now = new Date()) {
  const l = r?.last ?? null
  if (r?.status === "error") return { word: "error", tone: "error", detail: r.error ?? "" }
  if (r?.status && r.status !== "running") return { word: r.status, tone: r.status === "paused" ? "paused" : "done", detail: r.status === "fired" && lastFire(r) ? `at ${clockOf(lastFire(r).at)} ET` : r.status === "expired" && r.until ? `at ${r.until} ET` : r.status === "paused" ? (r.paused_why ?? "") : r.status === "stopped" ? (r.stop_why ?? "") : "" }
  if (r?.error) return { word: "error", tone: "error", detail: r.error }
  const sleeping = sleepsUntil(r, now)
  if (sleeping) return { word: "sleeps", tone: "paused", detail: `until ${sleeping}` }
  const closed = windowClosed(r, now)
  if (closed) return { word: "window closed", tone: "paused", detail: `${closed} · reads, never fires` }
  if (!l) return { word: "starting", tone: "warming", detail: "" }
  if (l.warming) return { word: "warming", tone: "warming", detail: l.warming }
  if (l.waiting) return { word: "waiting", tone: "running", detail: l.waiting } // a kernel runner held by its condition
  if (l.note && l.cond == null) return { word: "resting", tone: "paused", detail: l.note } // e.g. outside its window
  const g = l.gate
  const held = l.held ?? (l.cond === true && l.effective === false ? `gate ${g?.cond == null ? "unread" : "false"}: ${r.gate?.symbol ?? "?"} close ${g?.value ?? "—"}` : null)
  if (held) return { word: "held", tone: "running", detail: held }
  if ((l.effective ?? l.cond) === true) return { word: "holds", tone: "holds", detail: "" }
  const p = l.prox
  if (p && p.gap > 0) {
    const near = p.eta != null && p.eta <= Math.max(2, r.warn ?? 0)
    const eta = p.eta != null ? ` · ≈${p.eta} bar${p.eta === 1 ? "" : "s"}` : p.pace > 0 ? " · moving away" : ""
    return { word: near ? "near" : "watching", tone: near ? "near" : "running", detail: `${p.gap} to go${eta}` }
  }
  return { word: "watching", tone: "running", detail: l.cond == null ? "no reading yet" : "" }
}

// A kernel runner's own run state in one line (backend/kernel/builtin/runners.js): "check #14 · 10:41 ET · next 10:42 ·
// now 771.4 vs 772.5" ("" for a twin without it: a desk's own runners).
export function checkLine(r) {
  if (r?.checks == null) return ""
  const l = r.last
  return [`check #${r.checks}`, r.checked_at ? `${clockOf(r.checked_at)} ET` : "not read yet", r.status === "running" && r.next_at ? `next ${clockOf(r.next_at)}` : null, l?.value != null ? `now ${l.value}${l.against != null ? ` vs ${l.against}` : ""}` : null, r.errors ? `${r.errors} errors in a row` : null].filter(Boolean).join(" · ")
}

export const intervalLabel = (min) => (!finite(min) ? String(min ?? "") : min % 10080 === 0 ? `${min / 10080}w` : min % 1440 === 0 ? `${min / 1440}d` : min % 60 === 0 ? `${min / 60}h` : `${min}m`)
export const everyLabel = (e) => (e === "bar" ? "each bar" : e === "tick" ? "each tick" : `every ${intervalLabel(e)}`)

// Holding and near first, then the running ones, the stopped ones last.
export function runnerRows(state, now = new Date()) {
  const rank = { holds: 0, near: 1, running: 2, warming: 3, error: 4, paused: 5, done: 6 }
  return (state?.runners ?? []).map((r) => ({ r, s: runnerStatus(r, now) })).sort((a, b) => (rank[a.s.tone] ?? 9) - (rank[b.s.tone] ?? 9))
}

// "ema9=ema(close, 9); hi=highest(high, 20)" → {ema9: "ema(close, 9)", hi: "highest(high, 20)"}
export function parsePlot(text) {
  const out = {}
  for (const part of String(text ?? "").split(/[;\n]/)) {
    const m = part.match(/^\s*([A-Za-z_][\w-]{0,15})\s*[=:]\s*(.+?)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

// The owner's calls (team call target artifact → the artifact's ownerCall): pause | resume | stop | remove | now.
export const runnerCall = (id, method, runner) => teamCall("artifact", method, [{ id, runner }])
export const startRunner = (id, spec) => teamCall("artifact", "start", [{ id, spec }])
export const testRunner = (id, spec) => teamCall("artifact", "test", [{ id, spec }])
