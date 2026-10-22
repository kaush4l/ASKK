// The pipeline view's model (components/views/pipeline.jsx), pure: a desk's staged workflow artifact (view "pipeline":
// custom/<desk>/lib/workflow.js) → rows the view draws, and the owner's calls on it (team call target artifact).
//   state: {status, run: {id, by, from, note, started, ended}, stages: [{id, n, title, status, started, ms, tools,
//           sources: [{name, query?, url?}], head, error}], result | card: {decision, text, problems, levels},
//           note: {label, mirrored}, learnings: {pending: [{id, text, evidence, source}], accepted}, events?, watch?,
//           runs, prompts}

import { teamCall } from "./stream"

export const pipelineCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

// 4m07s, 38s
export const took = (ms) => {
  if (!(ms >= 0)) return ""
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

export const clockOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) : "")

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return String(url).slice(0, 40)
  }
}

// A stage's web reads as chips: searches by their words, pages by their site — newest first, `max` shown.
export function sourceChips(sources = [], max = 6) {
  const chips = [...(sources ?? [])].reverse().map((s) => (s.url ? { kind: "page", label: host(s.url), title: s.url, href: /^https?:\/\//i.test(s.url) ? s.url : null } : { kind: "search", label: String(s.query ?? s.name ?? "").slice(0, 48), title: s.query ?? s.name }))
  return { chips: chips.slice(0, max), more: Math.max(0, chips.length - max) }
}

export function pipelineView(state, { now = Date.now(), chips = 6 } = {}) {
  const s = state ?? {}
  const running = s.status === "running"
  const stages = (s.stages ?? []).map((x) => {
    const live = x.status === "running" && x.started
    return {
      id: x.id,
      n: x.n,
      title: x.title ?? x.id,
      status: x.status ?? "waiting",
      elapsed: live ? took(now - Date.parse(x.started)) : x.ms ? took(x.ms) : "",
      tools: x.tools ?? 0,
      ...sourceChips(x.sources, chips),
      head: x.head ?? "",
      error: x.error ?? null,
    }
  })
  const settled = stages.filter((x) => ["done", "reused", "failed", "skipped"].includes(x.status)).length
  const result = s.result ?? s.card ?? null
  const events = s.events ?? (s.watch?.hits ?? []).map((h) => `${h.symbol} ${h.kind} ${h.price} crossed (${h.side}) at ${h.px} · ${h.hm}`)
  return {
    status: s.status ?? "idle",
    running,
    progress: stages.length ? `${settled}/${stages.length}` : "",
    run: s.run
      ? {
          id: s.run.id,
          by: s.run.by,
          from: s.run.from,
          note: s.run.note,
          started: clockOf(s.run.started),
          elapsed: running ? took(now - Date.parse(s.run.started)) : s.run.ended ? took(Date.parse(s.run.ended) - Date.parse(s.run.started)) : "",
        }
      : null,
    stages,
    result: result ? { decision: result.decision ?? null, text: result.text ?? "", problems: result.problems ?? [], levels: result.levels ?? [] } : null,
    pending: s.learnings?.pending ?? [],
    accepted: s.learnings?.accepted ?? 0,
    events,
    note: s.note ?? null,
    prompts: s.prompts ?? null,
    runs: (s.runs ?? []).slice().reverse(),
  }
}
