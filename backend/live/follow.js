// Live follow: every tool call of every agent as one feed, plus the answers the kernel refused (gate/format) and the
// owner's guidance to a run in progress, so the owner follows the trail as it happens. Read by the Live page (components/live/live-page.jsx); nothing here
// changes an agent.
//
//   liveFeed(engines, states) -> events, oldest first:
//     { id, engineId, agent, name, kind: tool | agent | gate | guidance, type, view, inputs, state: "running" | "done", ok?, output?, from?, at }
//     a call's id is the same while it runs and once it is done (callId: agent, step row, index in the step)
//   eventTarget(event) -> what the call touched, in a few words (the feed's rows, the canvas, the thread's rows)
//   runSteps(state, {limit}) -> one agent's current (else last) run: its newest steps
//   toolType(engine, name) -> the called tool's type (kernel Tool `type`: function | mcp | agent | artifact …)
//   toolCall(engine, call) -> a tool message or a call in flight as the call callLook (visual.js) draws

import { isRunRequest } from "@/backend/live/agent"
import { LIMITS } from "@/lib/config"

const MAX_EVENTS = LIMITS.live.maxEvents

// The type of the tool an agent called, from its definition's tool specs (agent.js); null when unknown.
export const toolType = (engine, name) => engine?.tools?.find((t) => t.name === name)?.type ?? null

// A tool message (role tool) or a call in flight (activity.calls) as the call callLook (visual.js) draws: its name,
// kind (tool | agent), its tool's type and its view (a quest's when it called an agent, else data when the kernel
// sent none). One shape for the Live feed and the agent page's thread, so a call looks the same in both.
export function toolCall(engine, call) {
  const kind = call?.kind ?? "tool"
  return { name: call?.name, kind, type: toolType(engine, call?.name), view: call?.view ?? (kind === "agent" ? "quest" : "data") }
}

// A call's identity in the feed: its agent, its step (the step's thread row) and its index in that step — the same
// while it runs (activity.calls) and once its result is a thread row, so a selected row stays on its call
// (2026-10-17: running rows were keyed by position among the calls still running, and a selected row switched calls
// when an earlier one finished; a finished call's row took a new id, so the Live page lost the selection).
const callId = (engineId, stepRow, index) => `${engineId}-call-${stepRow}-${index}`

export function liveFeed(engines, states) {
  const events = []
  engines.forEach((engine, index) => {
    const state = states[index]
    if (!state) return
    const base = { engineId: engine.id, agent: engine.name ?? engine.id }
    for (const message of state.messages ?? []) {
      // An answer the kernel refused (open checklist, report missing fields, no tool called) or a reply it could
      // not take: the agent goes on, the trail shows why.
      if (message.role === "assistant" && message.action === "gate") {
        events.push({ ...base, id: message.id, name: message.kind === "format" ? "reply not taken" : "answer refused", kind: "gate", view: "gate", inputs: {}, state: "done", ok: false, output: message.content ?? "", at: message.at })
        continue
      }
      // Guidance for the run in progress (team call `guide`): the agent's next step reads it.
      if (message.role === "user" && message.kind === "guidance") {
        events.push({ ...base, id: message.id, name: "guidance", kind: "guidance", view: "guidance", inputs: {}, state: "done", ok: true, output: message.content ?? "", from: message.from ?? "owner", at: message.at })
        continue
      }
      if (message.role !== "tool" || !message.name) continue
      // The result row names its step row itself (`row`, kernel-team.js), so its id does not depend on that row still
      // being in the thread (2026-10-17: the step row was found by scanning the thread, and once the 400-row window
      // dropped it the call took its message id and the Live page lost the selection). A row without `row` (from a
      // server before it) keeps its message id: stable, though not the id it ran under.
      events.push({
        ...base,
        id: message.row != null && Number.isInteger(message.index) ? callId(engine.id, message.row, message.index) : message.id,
        ...toolCall(engine, message),
        inputs: message.inputs ?? {},
        state: "done",
        ok: message.ok,
        output: message.output ?? message.content ?? "",
        at: message.at,
      })
    }
    // The calls of the step running now, each by its own index in the step (kernel-team.js), never its position
    // among the calls still running; without the step's row or the index (an older stream), by the step's time.
    const activity = state.activity
    for (const [i, call] of (activity?.calls ?? []).entries()) {
      const k = Number.isInteger(call.index) ? call.index : i
      events.push({
        ...base,
        id: activity.row != null && Number.isInteger(call.index) ? callId(engine.id, activity.row, k) : `${engine.id}-live-${activity.since}-${activity.stage ?? 0}-${k}`,
        ...toolCall(engine, call),
        inputs: call.inputs ?? {},
        state: "running",
        at: activity.since,
      })
    }
  })
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return events.slice(-MAX_EVENTS)
}

// A quest's brief (kernel QUEST_INPUT: requirement, ask, outcome) as text, else null.
export function questBrief(inputs = {}) {
  const q = inputs?.quest && typeof inputs.quest === "object" ? inputs.quest : inputs
  const parts = ["requirement", "ask", "outcome"].filter((k) => q?.[k] != null)
  if (parts.length) return parts.map((k) => `${k.toUpperCase()}: ${typeof q[k] === "string" ? q[k] : JSON.stringify(q[k], null, 1)}`).join("\n\n")
  return typeof inputs?.quest === "string" ? inputs.quest : null
}

// What an event touched, in a few words: the quest's ask, the path, the search terms (web.search's `q`), the url, the
// symbol, the first text input, else the first input fields as `key: value`. One summariser for the Live feed, the
// canvas and the agent page's thread rows (2026-10-17: a thread row never said which call it answered, and
// web.search's `q` was found only when it came first). Clipped: a line, not the input.
const TARGET_CHARS = 200
// A value as text: text as it is, an object as `key: value` pairs (each value text or compact JSON), anything else
// (a list, a number) as compact JSON. 2026-10-17: an object-valued query, path, url or symbol was String()ed and read
// "[object Object]".
// Only the fields worth naming, at every depth (a blank `ask:` inside a brief, or `{b: " "}` two levels down, is left out).
const prune = (v) =>
  typeof v === "string" ? v.trim()
  : Array.isArray(v) ? v.filter(filled).map(prune)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => filled(x)).map(([k, x]) => [k, prune(x)]))
  : v
const pairs = (o) => Object.entries(o).filter(([, v]) => filled(v)).map(([k, v]) => `${k}: ${typeof v === "string" ? v.trim() : JSON.stringify(prune(v))}`).join(", ")
const text = (v) => (typeof v === "string" ? v : v && typeof v === "object" && !Array.isArray(v) ? pairs(v) : (JSON.stringify(prune(v)) ?? ""))
// Clipped at TARGET_CHARS, never through the middle of a surrogate pair (an emoji cut in half renders as �).
const short = (v) => {
  const s = text(v).trim() // leading blanks would fill the line before the words
  if (s.length <= TARGET_CHARS) return s
  const end = /[\uD800-\uDBFF]/.test(s[TARGET_CHARS - 1]) ? TARGET_CHARS - 1 : TARGET_CHARS
  return `${s.slice(0, end)}…`
}
// A value worth naming: text with more than whitespace, a number or boolean, a list or object holding one (2026-10-17:
// an empty `path: {}` ahead of a real `url`, or a blank `url: "   "`, summarised as an empty or blank line).
const filled = (v) => (typeof v === "string" ? v.trim() !== "" : typeof v === "number" || typeof v === "boolean" ? true : Array.isArray(v) ? v.some(filled) : v && typeof v === "object" ? Object.values(v).some(filled) : false)

// A quest's ask (flat, or nested under `quest`) when it says something, else null.
export function questAsk(inputs) {
  const q = inputs?.quest && typeof inputs.quest === "object" && !Array.isArray(inputs.quest) ? inputs.quest : (inputs ?? {})
  return filled(q.ask) ? q.ask : null
}

export function eventTarget(event) {
  // Inputs that came as plain text or a number (an inline value the reply parser could not read as fields) are the target.
  if (event.kind !== "gate" && event.kind !== "guidance" && filled(event.inputs) && typeof event.inputs !== "object") return short(event.inputs)
  const inputs = event.inputs && typeof event.inputs === "object" ? event.inputs : {}
  // Clipped like every other target (2026-10-17: a refused answer's 5000-char reason came back whole).
  if (event.kind === "gate" || event.kind === "guidance") return short(event.output ?? "")
  if (event.kind === "agent") {
    const ask = questAsk(inputs)
    if (ask != null) return short(ask)
    if (filled(inputs.quest)) return short(inputs.quest)
  }
  for (const key of ["path", "query", "q", "url", "symbol"]) if (filled(inputs[key])) return short(inputs[key])
  const first = Object.values(inputs).find((v) => typeof v === "string" && filled(v))
  if (first) return short(first)
  return short(pairs(Object.fromEntries(Object.entries(inputs).filter(([, v]) => filled(v)).slice(0, 3))))
}

// One agent's current run (else its last) as steps, oldest first, the newest `limit` of them: each call's result
// (tool), the step's thought when it had one (think), a refused answer (gate), the owner's guidance, the answer.
//   → { steps: [{ id, step: tool | think | gate | guidance | answer, name?, kind?, view?, inputs?, ok?, text, from?, at }], hidden }
export function runSteps(state, { limit = 6 } = {}) {
  const messages = state?.messages ?? []
  const byId = state?.working?.request ? messages.findIndex((m) => m.id === state.working.request) : -1
  let start = byId
  // the run's request: never guidance nor an owner chat (2026-10-17: kind chat rows sit beside the run, not in it)
  if (start < 0) for (let i = messages.length - 1; i >= 0; i--) if (isRunRequest(messages[i])) { start = i; break }
  const steps = []
  for (const m of messages.slice(start + 1)) {
    const base = { id: m.id, at: m.at ?? null }
    if (m.role === "tool" && m.name) steps.push({ ...base, step: "tool", name: m.name, kind: m.kind ?? "tool", view: m.view ?? null, inputs: m.inputs ?? {}, ok: m.ok !== false, text: String(m.output ?? m.content ?? "") })
    else if (m.role === "user" && m.kind === "guidance") steps.push({ ...base, step: "guidance", kind: "guidance", text: String(m.content ?? ""), from: m.from ?? "owner" })
    else if (m.role === "assistant" && m.action === "gate") steps.push({ ...base, step: "gate", kind: "gate", ok: false, text: String(m.content ?? "") })
    else if (m.role === "assistant" && m.action === "answer") steps.push({ ...base, step: "answer", ok: !m.error, text: String(m.content ?? "") })
    else if (m.role === "assistant" && m.action === "tool") {
      // A step's content is its thought, then one line per call (`name({...})`): only the thought is new here.
      const thought = String(m.content ?? "").split("\n")[0]
      if (thought && !/^[\w.-]+\(/.test(thought)) steps.push({ ...base, step: "think", text: thought })
    }
  }
  return { steps: steps.slice(-limit), hidden: Math.max(0, steps.length - limit) }
}
