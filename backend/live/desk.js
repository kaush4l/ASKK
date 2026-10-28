// The desk's shape and shared state, mirrored from the team stream (companion/team/kernel-team.js): the agent
// tree (the lead → the agents it holds as tools → theirs), every board, every artifact. Agent states live on the
// agents (registry.js); this adds what they do not carry. The registry feeds it every event (apply), so it is
// current whether or not a view is mounted. null = no desk yet.
// 2026-10-17: a `kernel` event may carry the tree (an agent spawned or dismissed) and `removed` (artifact ids no
// agent holds any more, gone with a dismissed helper).

import { isRunRequest } from "@/backend/live/agent"
import { signal } from "@/backend/live/signal"
import { teamCall } from "@/backend/live/stream"
import { skippedOf } from "@/backend/live/artifact-tail"

// { title, tree, artifacts } — a team's board is one of its artifacts (2026-10-23: the boards tree beside them was never
// read). An artifact's patch replaces that artifact only: the others keep their identity, so a view of one (useArtifact)
// redraws for its own changes alone.
const desk = signal(null, null)

export const kernelDesk = {
  ...desk,
  getSnapshot: desk.get,
  // A team/stream event (registry.js hands every one over).
  apply(e) {
    const state = desk.get()
    if (e.type === "snapshot") desk.set(e.kernel ?? null)
    else if (e.type === "kernel" && state) {
      let artifacts = e.artifact ? { ...state.artifacts, [e.artifact.id]: e.artifact } : state.artifacts
      if (e.removed?.length) artifacts = Object.fromEntries(Object.entries(artifacts ?? {}).filter(([id]) => !e.removed.includes(id)))
      desk.set({
        ...state,
        ...(e.tree ? { tree: e.tree } : {}),
        ...(e.defaultModel !== undefined ? { defaultModel: e.defaultModel } : {}),
        ...(e.models ? { models: e.models } : {}),
        artifacts,
      })
    }
  },
  // A card opened on an artifact the snapshot sent compact (artifact-tail.js): its full view, fetched once from an agent
  // that holds it (agent call `artifact` [id]); a live patch meanwhile is whole already, so it is kept.
  async loadFull(id) {
    const a = desk.get()?.artifacts?.[id]
    if (!skippedOf(a) || loading.has(id)) return
    loading.add(id)
    try {
      const full = await teamCall(a.holders?.[0], "artifact", [id])
      const state = desk.get()
      if (full && skippedOf(state?.artifacts?.[id])) desk.set({ ...state, artifacts: { ...state.artifacts, [id]: full } })
    } catch {
      // the compact view stays: it still draws the tree and the newest change
    } finally {
      loading.delete(id)
    }
  },
}
const loading = new Set()

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
// eq for the desk's artifacts as cards lay them out (useDesk): the same ids, owners, views and holders — a patch to an
// artifact's state alone keeps the layout, and its tile redraws by itself (useArtifact).
const layoutKey = (artifacts) => Object.values(artifacts ?? {}).map((a) => `${a.id}|${a.owner}|${a.view}|${(a.holders ?? []).join(",")}`).join("\n")
export const sameLayout = (a, b) => a === b || layoutKey(a) === layoutKey(b)
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
// The owner asks "what is this?" (kernel builtin/ask.js, 2026-10-27 ask-context): answered now with no run — the
// host's artifact route → Ask.ownerCall("what", [{id, question, element}]). id: the ask artifact's id ("ask");
// element: {artifact, view?} or null. → the answer with its file:line cites; rejects with the refusal (unknown element).
export const askWhat = (id, question, element = null) => teamCall("artifact", "what", [{ id, question, element }])

// The owner on what waits on a helper (kernel builtin/spawn.js ownerHelperCall, 2026-10-20: a keep: desk, or a kept
// helper's update, from a run that read the web is proposed, never in force until accepted): method "accept" keeps it /
// applies the update, "drop" drops the proposal — the host's team call target "desk". helper: its name.
//   → {accepted, what} | {dropped, what}; rejects with the refusal (gone with its run, running, cannot apply now).
export const helperCall = (method, helper, reason) => teamCall("desk", method, [{ helper, ...(reason ? { reason } : {}) }])

// The desk's selectable models (footer model selector): default Claude CLI, local oMLX, and Argon (Gemini).
export const DESK_MODELS = [
  { key: "default", label: "Default (Claude CLI)", provider: "claude-cli", id: "default" },
  { key: "omlx", label: "Qwen3.8 27B (oMLX, local)", provider: "openai", id: "Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp" },
  { key: "argon", label: "Argon (Gemini)", provider: "gemini-cli", id: "argon" },
]
export const setDeskModel = (model) => teamCall("desk", "model", [{ model }])
export const setAgentModel = (agent, model) => teamCall("desk", "agentModel", [{ agent, model: model || null }])

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
// /live?desk=<name> (2026-10-26, desk-param: a link to one desk landed on the desk the askk_desk cookie held): the
// desk the URL names, when the server hosts it and it is not the one shown — else null, so the page reloads at most once.
//   search: location.search; desks: GET desks → desks ([{name}]); current: the desk shown now.
export function deskFromQuery(search, desks, current) {
  const name = new URLSearchParams(search ?? "").get("desk")
  return name && name !== current && (desks ?? []).some((d) => d?.name === name) ? name : null
}
