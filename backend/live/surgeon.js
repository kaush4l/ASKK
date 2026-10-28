// The surgeon view's model (components/views/surgeon.jsx), pure: the kernel's surgeon artifact (backend/kernel/builtin/
// surgeon.js: a model run under the debugger — where it stopped, the flow of debug points, breakpoints, patches,
// metrics, views) → what the view draws, and the owner's calls on it (team call target artifact).
//   surgeonCall(id, method, extra)  continue | step | next | pause | stop | break {at, step?, every?, nan?} |
//                                   clear {breakpoint} | inspect {target?, view?} | unpatch {patch} | compare {a, b}
//   statusOf(state)                 {tone: idle | running | paused | ended | error | stale, text, reason?}
//   flowRows(state)                 [{point, absmean, share (0..1 of the largest), paused, breaks: [ids]}] in forward order
//   breakAt(state, point)           the breakpoints set at a point (ids)
//   metricsVisual(state)            a line visual of the run's metrics (null when none)
//   viewPair(state, picked)         the views to draw: the owner's pick, else the agent's compare pair, else the newest
//   tokensText(state)               the frame's input (sample 0) as one line, null when none
//   2026-10-26 owner ("visual code the last run and show me the live replay … relating between procedure and
//   observation … change the code run the training"): the recorded runs —
//   allViews(state)                 the live run's views and the replays, one list (each with replay: true or not)
//   runRows(state)                  [{id, status, step, total, loss, val, snaps, parent, why, args, current}] newest first
//   timelineVisuals(state)          {metrics: line | null, flow: matrix | null} of the run on the timeline
//   sourceRows(state)               the code shown: [{n, text, mark}] (mark: the line that calls the point)
//   diffRows(diff)                  a file's diff text → [{text, tone: add | del | head | ctx}]

import { teamCall } from "./stream"

export const surgeonCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

export const SURGEON_VIEWS = ["auto", "attn", "lens", "matrix", "hist", "topk", "pca", "bars"]
export const REPLAY_VIEWS = ["lens", "attn", "pca", "hist", "topk", "matrix"]

export function statusOf(state) {
  const rt = state?.runtime
  if (!state?.session) return { tone: "idle", text: "No run — ask the desk to start one in debug" }
  if (!rt) return { tone: "running", text: `Starting ${state.session.script}…` }
  if (state.stale) return { tone: "stale", text: `No heartbeat — the run may be gone (${rt.status} at step ${rt.step ?? "?"})` }
  const f = rt.frame
  if (rt.status === "paused" && f) return { tone: "paused", text: `Paused at ${f.point ?? "the step boundary"} · ${f.phase} step ${f.step}`, reason: f.reason }
  if (rt.status === "error") return { tone: "error", text: `Error: ${rt.error ?? "the run failed"}` }
  if (rt.status === "ended") return { tone: "ended", text: `Ended at ${rt.phase ?? ""} step ${rt.step ?? "?"}` }
  return { tone: "running", text: `Running · ${rt.phase ?? ""} step ${rt.step ?? "?"}` }
}

export const breakAt = (state, point) => (state?.runtime?.breakpoints ?? []).filter((b) => b.at === point).map((b) => b.id)

export function flowRows(state) {
  const rt = state?.runtime
  if (!rt) return []
  const flow = rt.flow?.length ? rt.flow : (rt.points ?? []).map((point) => ({ point, absmean: null }))
  const max = Math.max(0, ...flow.map((x) => Number(x.absmean) || 0))
  const paused = rt.status === "paused" ? rt.frame?.point : null
  return flow.map((x) => ({ point: x.point, absmean: x.absmean ?? null, share: max && x.absmean != null ? Math.min(1, x.absmean / max) : 0, paused: x.point === paused, breaks: breakAt(state, x.point) }))
}

export function metricsVisual(state) {
  const m = state?.runtime?.metrics ?? {}
  const series = Object.entries(m)
    .map(([name, pts]) => ({ name, points: (pts ?? []).filter((p) => p?.[1] != null) }))
    .filter((s) => s.points.length > 1)
  return series.length ? { kind: "line", series, x: "step" } : null
}

export const allViews = (state) => [...(state?.views ?? []), ...(state?.replays ?? []).map((r) => ({ ...r, replay: true, point: r.at, phase: "replay", step: `${r.steps} frames` }))]

export function viewPair(state, picked = []) {
  const views = allViews(state)
  const byId = new Map(views.map((v) => [v.id, v]))
  const ids = picked.length ? picked : state?.compare ? [state.compare.a, state.compare.b] : views.length ? [views.at(-1).id] : []
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

export function tokensText(state) {
  const t = state?.runtime?.frame?.tokens
  return t?.length ? t.join("") : null
}

export function runRows(state) {
  const live = state?.runtime?.run?.id
  return [...(state?.runs ?? [])].reverse().map((r) => ({ id: r.id, status: r.status, step: r.step, total: r.total, loss: r.final?.loss ?? null, val: r.final?.val_loss ?? null, snaps: r.snaps ?? 0, parent: r.parent ?? null, why: r.why ?? null, args: r.args ?? "", current: r.id === live, shown: r.id === state?.timeline?.run }))
}

export function timelineVisuals(state) {
  const t = state?.timeline
  if (!t) return { metrics: null, flow: null }
  const series = Object.entries(t.series ?? {})
    .filter(([k]) => k !== "lr")
    .map(([name, pts]) => ({ name, points: (pts ?? []).filter((p) => p?.[1] != null) }))
    .filter((x) => x.points.length > 1)
  const metrics = series.length ? { kind: "line", series, x: "step", title: `${t.run} — metrics over the run` } : null
  const f = t.flow
  const flow = f?.points?.length && f.steps?.length ? { kind: "matrix", frames: [{ values: f.values }], rows: f.points, cols: f.steps.map(String), title: `${t.run} — |act| mean per debug point over the steps`, caption: "Row = a debug point in forward order, column = a training step: how big each point's output is as the model learns." } : null
  return { metrics, flow }
}

export function sourceRows(state) {
  const src = state?.source
  return src ? src.lines.map((l) => ({ n: l.n, text: l.text, mark: l.n === src.mark })) : []
}

export const diffRows = (diff) =>
  String(diff ?? "")
    .split("\n")
    .map((text) => ({ text, tone: text.startsWith("@@") ? "head" : text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "ctx" }))
