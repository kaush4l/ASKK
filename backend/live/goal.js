// The desk's standing goal as the UI draws it (kernel builtin/goal.js; 2026-10-24 owner: "the desk will set a goal and
// will keep working towards the goal … all actions with feedback is to gain towards the goal"). Pure, but goalCall.
//
//   standingGoal(artifacts) -> the goal artifact's twin when one has a goal (any status), else null
//   goalSeries(state)       -> [{at, value}] the progress entries whose value is a number, oldest first
//   goalLine(state, now)    -> "active · closer 1060 · next 14:47 (in 12 min)": its state in one line
//   goalCall(id, method, extra) -> the owner's call (team call target artifact): set | pause | resume | drop | now |
//                              cadence | feedback | workflow | note | forget | release
//   goalPlan(state)         -> {items (dropped left out), done, total, claimed}: the milestones
//   goalLedger(state)       -> [{kind, label, notes}] decisions, facts, dead ends, guesses — the ones with notes
//   goalWorkflows(artifacts) -> the ids of the desk's workflows (a goal may resume through one)
//   goalPreview(artifacts) -> the desk's preview artifact (the goal's live view, 2026-10-25), else null
//   requestFrame(artifacts, agent) -> the newest request that agent framed as a goal (goal.frame: intent, done, route), else null
//   ROUTE                    -> each route's label and what it means (the kernel's ROUTES)

import { ROUTES } from "@/backend/kernel/index"
import { teamCall } from "@/backend/live/stream"
import { hm } from "./time.js"

export const goalCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

export function standingGoal(artifacts) {
  return Object.values(artifacts ?? {}).find((a) => a?.view === "goal" && a.state?.goal) ?? null
}

export const goalSeries = (state) => (state?.entries ?? []).filter((e) => e.kind === "progress" && typeof e.value === "number").map((e) => ({ at: e.at, value: e.value }))

const minutesUntil = (iso, now) => Math.round((new Date(iso).getTime() - now) / 60000)

export function goalLine(state, now = Date.now()) {
  if (!state?.goal) return "no standing goal"
  const last = (state.entries ?? []).filter((e) => e.kind === "progress").at(-1)
  const parts = [state.status === "active" && (state.stall ?? 0) >= 3 ? "active (stalled: replans next)" : state.status]
  const plan = goalPlan(state)
  if (plan.total) parts.push(`${plan.done}/${plan.total} milestones`)
  if (last) parts.push(`${last.toward}${last.value != null ? ` ${last.value}` : ""}`)
  if (state.status === "active") {
    if (state.next_at) {
      const m = minutesUntil(state.next_at, now)
      parts.push(`next ${hm(state.next_at)} (${m <= 0 ? "due" : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`})`)
    } else parts.push(state.flow_run ? `${state.flow_run.flow} running` : "working on it")
  }
  if (state.reason && state.status !== "active") parts.push(state.reason)
  return parts.join(" · ")
}

export function goalPlan(state) {
  const items = (state?.milestones ?? []).filter((m) => m.status !== "dropped")
  return { items, done: items.filter((m) => m.status === "done").length, total: items.length, claimed: items.filter((m) => m.claim).length }
}

const KINDS = [
  ["decision", "Decisions"],
  ["fact", "Facts"],
  ["dead_end", "Dead ends"],
  ["guess", "Guesses"],
]

export function goalLedger(state) {
  const notes = state?.ledger ?? []
  return KINDS.map(([kind, label]) => ({ kind, label, notes: notes.filter((l) => l.kind === kind) })).filter((g) => g.notes.length)
}

export const goalWorkflows = (artifacts) =>
  Object.values(artifacts ?? {})
    .filter((a) => a?.kind === "workflow")
    .map((a) => a.id)
    .sort()

// The live view beside the goal (2026-10-25 owner: "the goal artifact will show the live goal, progress … live view as
// well"): the desk's one preview ("preview"), else its first preview artifact.
export const goalPreview = (artifacts) => {
  const all = Object.values(artifacts ?? {}).filter((a) => a?.kind === "preview")
  return all.find((a) => a.id === "preview") ?? all.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null
}

export const ROUTE = Object.fromEntries(Object.entries(ROUTES).map(([k, says]) => [k, { label: k === "goal" ? "standing goal" : k, says }]))

export function requestFrame(artifacts, agent) {
  for (const a of Object.values(artifacts ?? {})) {
    const f = a?.view === "goal" ? (a.state?.frames ?? []).findLast((x) => x.agent === agent) : null
    if (f) return f
  }
  return null
}
