// What the desk is working toward and where it is — the dashboard's "Goal and phase" card and its rolling conversation
// (2026-10-23 owner: "I don't need every chat of what I said. I think the more important thing, the goal we are trying to
// do and the phase we are in"). Pure: reads the lead's state and the desk's artifacts, changes nothing.
//
//   deskGoal(state) -> { text, from, at, status: working | answered | failed, answer } | null
//     the lead's run in progress, else its last run: the request, who asked, how it ended
//   deskPhase(artifacts, state) -> { kind: workflow | plan | activity, title, now, done, total, segments } | null
//     a staged workflow running (else its last run), else the plan's open items, else what the lead does now
//   conversation(messages, {limit}) -> [{ id, side: you | lead, kind: request | answer, text, at, original?, rewrite? } | { id, kind: chat,
//     question, answer, taken }] — only what the owner said to the lead and what came back: requests (the desk and
//     Telegram) and their answers, an ask and its reply as one pair (its rows whole: a visual, proposed work, guided) —
//     never quests, wakes, tool rows or guidance; the newest `limit`, oldest first
//   ownerFrom(from) -> true for the owner (no from, "owner", "telegram:<who>")
// The dashboard's live rows (2026-10-25, out of its components): ago / since (times in words), lastTool (the current
// run's last call), busy (any agent at work).

import { isRunRequest, threadItems } from "@/backend/live/agent"

const SETTLED = new Set(["done", "failed", "stopped", "reused", "interrupted", "skipped"])
// 2026-10-23 audit 19: Telegram sends from "telegram:<sender>"
export const ownerFrom = (from) => !from || from === "owner" || from === "telegram" || String(from).startsWith("telegram:")
const ownerRequest = (m) => isRunRequest(m) && (m.kind === "request" || ownerFrom(m.from))

export function deskGoal(state) {
  const messages = state?.messages ?? []
  let at = state?.working?.request ? messages.findIndex((m) => m.id === state.working.request) : -1
  if (at < 0) for (let i = messages.length - 1; i >= 0; i--) if (isRunRequest(messages[i])) { at = i; break }
  if (at < 0) return null
  const request = messages[at]
  const answer = messages.slice(at + 1).find((m) => m.role === "assistant" && m.action === "answer") ?? null
  const working = state?.status === "running" && (!state.working?.request || state.working.request === request.id)
  return {
    text: String(request.content ?? ""),
    from: request.from ?? "you",
    at: request.at ?? null,
    status: working ? "working" : answer?.error ? "failed" : answer ? "answered" : "working",
    answer: answer ? String(answer.content ?? "") : null,
  }
}

export function deskPhase(artifacts, state) {
  const list = Object.values(artifacts ?? {})
  const flow = list.find((a) => a?.view === "pipeline" && Array.isArray(a.state?.stages) && a.state.stages.length)
  if (flow) {
    const stages = flow.state.stages
    const running = stages.filter((s) => s.status === "running")
    const settled = stages.filter((s) => SETTLED.has(s.status)).length
    const segments = stages.map((s) => ({ id: s.id, status: s.status }))
    const status = flow.state.status ?? (running.length ? "running" : "idle")
    let now
    if (running.length) now = running.map((s) => s.title ?? s.id).join(" + ")
    else if (status === "running") now = `starting ${stages.find((s) => s.status === "waiting")?.id ?? ""}`.trim()
    else now = [status, flow.state.card?.decision ?? flow.state.result?.decision].filter(Boolean).join(" · ")
    return { kind: "workflow", id: flow.id, title: flow.title ?? flow.id, status, now, done: settled, total: stages.length, segments }
  }
  const plan = list.find((a) => a?.id === "plan" && Array.isArray(a.state?.items) && a.state.items.length)
  if (plan) {
    const items = plan.state.items
    const open = items.filter((i) => i.status === "open")
    return { kind: "plan", id: plan.id, title: plan.state.goal || "plan", status: open.length ? "running" : "done", now: open[0] ? `${open[0].id}: ${open[0].text}` : "every item settled", done: items.length - open.length, total: items.length, segments: items.map((i) => ({ id: i.id, status: i.status === "open" ? "waiting" : i.status === "skipped" ? "skipped" : "done" })) }
  }
  const a = state?.activity
  if (a && a.phase !== "idle") return { kind: "activity", title: "the lead", status: "running", now: null, done: 0, total: 0, segments: [] }
  return null
}

export function conversation(messages = [], { limit = 6 } = {}) {
  const out = []
  let owned = false // the run in the thread was started by the owner: its answer belongs here
  for (const item of threadItems(messages)) {
    if (item.type === "chat") {
      out.push({ id: item.id ?? item.answer?.id, kind: "chat", question: item.question, answer: item.answer, taken: item.taken, at: item.answer?.at ?? item.question?.at ?? null })
      continue
    }
    const m = item.message
    if (isRunRequest(m)) {
      owned = ownerRequest(m)
      if (owned) out.push({ id: m.id, side: "you", kind: "request", text: String(m.content ?? ""), at: m.at ?? null, from: m.from ?? null, ...(m.original ? { original: m.original, rewrite: m.rewrite ?? null } : {}) })
    } else if (m.role === "assistant" && m.action === "answer" && owned) {
      out.push({ id: m.id, side: "lead", kind: "answer", text: String(m.content ?? ""), at: m.at ?? null, error: !!m.error })
      owned = false
    }
  }
  return out.slice(-limit)
}

// "just now", "5 min ago", "3 h ago", "2 d ago" ("" for no time).
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return ""
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// How long since, while it runs: "42 s", "3 min 5 s", "1 h 4 min".
export function since(iso, now) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return Number.isFinite(s) ? (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`) : null
}

// The current run's last tool row (guidance and an owner chat are not a run).
export function lastTool(state) {
  const messages = state?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool" && m.name) return m
    if (isRunRequest(m)) return null
  }
  return null
}

export const busy = (states) => states.some((s) => s?.status === "running" || s?.activity?.phase === "waiting")
