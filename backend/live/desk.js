// The desk's shape and shared state, mirrored from the team stream (companion/team/kernel-team.js): the agent
// tree (the lead → the agents it holds as tools → theirs), every board, every artifact. Agent states live on the
// agents (registry.js); this adds what they do not carry. The registry feeds it every event (apply), so it is
// current whether or not a view is mounted. null = no desk yet.
// 2026-10-17: a `kernel` event may carry the tree (an agent spawned or dismissed) and `removed` (artifact ids no
// agent holds any more, gone with a dismissed helper).

import { isRunRequest } from "@/backend/live/agent"
import { teamCall } from "@/backend/live/stream"

let state = null // { title, tree, artifacts } — a team's board is one of its artifacts (2026-10-23: the boards tree beside them was never read)
const listeners = new Set()

function set(next) {
  state = next
  for (const fn of listeners) fn()
}

export const kernelDesk = {
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  getSnapshot: () => state,
  getServerSnapshot: () => null,
  // A team/stream event (registry.js hands every one over).
  apply(e) {
    if (e.type === "snapshot") set(e.kernel ?? null)
    else if (e.type === "kernel" && state) {
      let artifacts = e.artifact ? { ...state.artifacts, [e.artifact.id]: e.artifact } : state.artifacts
      if (e.removed?.length) artifacts = Object.fromEntries(Object.entries(artifacts ?? {}).filter(([id]) => !e.removed.includes(id)))
      set({
        ...state,
        ...(e.tree ? { tree: e.tree } : {}),
        artifacts,
      })
    }
  },
}

// Every artifact an agent holds, in reading order (the agent page).
export function artifactsHeldBy(artifacts, agentName) {
  return Object.values(artifacts ?? {})
    .filter((a) => a.holders?.includes(agentName))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
}

// The live tiles under an agent's row on its card (2026-10-17 owner: "the agent card will show the live artifacts which
// on click will expand to bigger view"): what it holds, in reading order — less one every agent of the desk holds
// (`everyone`: the desk's agent count; those are the desk card's own) and those the card already shows as its own
// (`skip`: ids).
export function heldTiles(artifacts, agentName, { everyone = 0, skip = [] } = {}) {
  const shown = new Set(skip)
  return artifactsHeldBy(artifacts, agentName).filter((a) => !shown.has(a.id) && !(everyone > 1 && (a.holders?.length ?? 0) >= everyone))
}


// A team's live status from its agents' engine states: working | reported | error | idle.
export function teamStatus(agentStates) {
  if (agentStates.some((s) => s?.status === "error")) return "error"
  if (agentStates.some((s) => s?.status === "running" || s?.activity?.phase === "waiting")) return "working"
  if (agentStates.some((s) => (s?.messages ?? []).some((m) => m.action === "answer"))) return "reported"
  return "idle"
}

// One agent's live look (state colour, speech bubble, tools in use): visual.js, shared with the server's Telegram status.
export { VISUAL_STATES, agentVisual } from "@/backend/live/visual"

// The quest a lead is working on (or last worked): its newest incoming message — the owner's
// request for the desk lead, the parent lead's quest for a team lead.
export function currentQuest(state) {
  const messages = state?.messages ?? []
  const byId = state?.working?.request ? messages.find((m) => m.id === state.working.request) : null
  const m = byId ?? [...messages].reverse().find(isRunRequest) // guidance and an owner chat are not a run
  return m ? { text: String(m.content ?? ""), from: m.from ?? "owner", at: m.at ?? null, active: !!byId } : null
}

// A card's artifacts: the team's own (board, memory, any the desk owns) and its lead's (checklist,
// quality). Ordered for reading by view: the preview first (2026-10-17: the one pane the owner and the agents both
// watch), the desk's lists, checklist, the dispatched jobs (2026-10-17: the line's work in flight read right under the
// plan), quality, board, schedule, text.
const ORDER = ["preview", "list", "checklist", "dispatch", "quality", "board", "schedule", "text"]
const rank = (a) => (ORDER.includes(a.view) ? ORDER.indexOf(a.view) : ORDER.length)
// teams: every team name in the tree — an artifact no team owns (a lone agent's memory) sits on its first holder's card.
export function artifactsFor(artifacts, { team, lead, teams = null }) {
  return Object.values(artifacts ?? {})
    .filter((a) => a.owner === team || (a.holders?.[0] === lead && (["checklist", "quality", "text"].includes(a.view) || (teams && !teams.has(a.owner)))))
    .filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
}

// Every agent name under a tree node (itself included).
export const namesIn = (node) => [node.name, ...(node.agents ?? []).flatMap(namesIn)]

// A team card's rows (2026-10-17 owner: the lead creates sub-teams at run time): every agent under the card's lead, a
// sub-team's members indented under their own lead, at any depth — a spawned team is a member of the lead holding
// members of its own, and none of them has a card but the depth-1 one.
//   → [{ name, title, depth (0: the card's direct members), lead: true when it holds agents }]
export function cardRows(node, depth = 0) {
  return (node?.agents ?? []).flatMap((m) => [{ name: m.name, title: m.title ?? null, depth, lead: !!m.agents?.length }, ...cardRows(m, depth + 1)])
}

// A team card's artifacts: its own (artifactsFor) first, then every nested sub-team's, top-down (their boards have no
// card of their own).
export function cardArtifacts(artifacts, node, { teams = null } = {}) {
  const nested = (n) => (n.agents ?? []).filter((m) => m.agents?.length).flatMap((m) => [m, ...nested(m)])
  return [node, ...nested(node)]
    .flatMap((n) => artifactsFor(artifacts, { team: n.team ?? n.name, lead: n.name, teams }))
    .filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
}

// A team's name on its card and chip: its title, unless that is only the kernel's default "<team> board" (a team
// spawned at run time has no title of its own), else the team, else the lead's name.
export function teamTitle(node) {
  const team = node?.team ?? null
  return node?.title && node.title !== `${team} board` ? node.title : (team ?? node?.name ?? "")
}

// How long a job ran: "45s", "12m04s", "1h02m" (the kit's dispatch prompt says it the same way).
export function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

// The dispatch artifact's jobs (kit dispatch, backend/kernel/builtin/dispatch.js: work a holder started on another
// agent while its own steps go on) as rows: the running ones first, longest running on top, then the ended ones newest
// first; each with how long it has run, else how long it took and when it ended.
//   state: { jobs: [{id, to, by, ask, status: running | done | failed | stopped, startedAt, endedAt, report, error}] }
//   → [{ id, to, by, ask (one line), status, running, elapsed, endedAt, report, error }]
const atMs = (at) => (typeof at === "number" ? at : Date.parse(at ?? ""))
export function dispatchRows(state, { now = Date.now() } = {}) {
  const jobs = Array.isArray(state?.jobs) ? state.jobs.filter((j) => j?.id) : []
  return jobs
    .map((j) => {
      const running = j.status === "running"
      const start = atMs(j.startedAt)
      const end = running ? now : Number.isFinite(atMs(j.endedAt)) ? atMs(j.endedAt) : null
      return {
        id: String(j.id),
        to: j.to ?? "",
        by: j.by ?? "",
        began: j.began ?? true, // an older twin without it: as it was
        delivered: !!j.delivered,
        ask: String(j.ask ?? "").replace(/\s+/g, " ").trim(),
        status: j.status ?? "running",
        running,
        elapsed: Number.isFinite(start) && end != null ? elapsedText(end - start) : "",
        endedAt: running ? null : (j.endedAt ?? null),
        report: String(j.report ?? ""),
        error: j.error ?? null,
        start: Number.isFinite(start) ? start : 0,
        end: end ?? 0,
      }
    })
    .sort((a, b) => (a.running !== b.running ? (a.running ? -1 : 1) : a.running ? a.start - b.start : b.end - a.end))
    .map(({ start, end, ...row }) => row)
}

// The owner stops one dispatched job (2026-10-17, amendment M3: before, only the whole station could be stopped, and
// every other job queued on it died too): the host's artifact route → the dispatch artifact's ownerCall("stop",
// [{id, job}], "owner") → Dispatch.stop(job) by the owner. id: the dispatch artifact's id; job: the row's id ("j2").
//   → {stopped: job}; rejects with the host's refusal (no such artifact or job).
export const stopDispatchJob = (id, job) => teamCall("artifact", "stop", [{ id, job }])

// The owner on a practice edit that waits (kernel builtin/practice.js, 2026-10-20: an instruction or checklist edit from
// a run that read the web is proposed, never in force until accepted): method "accept" applies it, "drop" drops it —
// the host's artifact route → Practice.ownerCall(method, [{id, edit}]). id: the practice's id ("agent.practice"); edit:
// the pending edit's id ("p1"). → {accepted, what} | {dropped}; rejects with the refusal (gone, cannot apply now).
export const practiceCall = (id, method, edit) => teamCall("artifact", method, [{ id, edit }])

// The owner on what waits on a helper (kernel builtin/spawn.js ownerHelperCall, 2026-10-20: a keep: desk, or a kept
// helper's update, from a run that read the web is proposed, never in force until accepted): method "accept" keeps it /
// applies the update, "drop" drops the proposal — the host's team call target "desk". helper: its name.
//   → {accepted, what} | {dropped, what}; rejects with the refusal (gone with its run, running, cannot apply now).
export const helperCall = (method, helper, reason) => teamCall("desk", method, [{ helper, ...(reason ? { reason } : {}) }])

// The next run, set by the owner (time "HH:MM" ET or ISO; goal text) — the desk's schedule.
export const bookNextRun = ({ at, goal }) => teamCall("desk", "schedule", [{ at, goal }])
export const clearNextRun = () => teamCall("desk", "unschedule", [])
export const setDefaultGoal = (goal) => teamCall("desk", "defaultGoal", [goal])

// 2026-10-18 owner ("a small indicator of the number of tools and artifacts every agent has"): what an agent holds,
// counted from its definition (AgentView) — `tools`: its own tools (an artifact's commands and quests to other agents
// not counted), `artifacts`: the artifacts it holds, `agents`: the agents it quests.
export function holdings(engine) {
  const held = (engine?.artifacts ?? []).map((a) => (typeof a === "string" ? a : a?.id)).filter(Boolean)
  const ids = new Set(held)
  const tools = engine?.tools ?? []
  const own = tools.filter((t) => t.kind !== "agent" && !ids.has(String(t.name).split(".")[0]))
  return { tools: own.length, artifacts: held.length, agents: tools.filter((t) => t.kind === "agent").length }
}
