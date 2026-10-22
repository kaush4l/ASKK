// One kernel agent as the UI sees it: its definition (the agent.md it came from: description, role, model,
// folder, team, tool specs, artifacts held) and its live state, one immutable snapshot replaced by the stream's
// patches (companion/team/kernel-team.js). Actions are calls to the desk server; nothing runs in the tab.
//
//   state: { status, activity, messages, error, revision, live, working, stats }
//   messages: { role: user | assistant | tool, action?: tool | answer | gate, kind?: guidance | chat, … } — the run's trail
//   2026-10-17: kind chat — the owner's question and the agent's answer (team call `chat`), a pair beside the runs:
//   { role: user, kind: chat, from, content } then { role: assistant, kind: chat, content, guided, proposed }. Neither
//   starts a run nor is one's request (isRunRequest); a thread draws the pair as one Q/A row (threadItems).
//   2026-10-17 (amendment M1): a chat never starts a run. Its QUEUE: line (or a GUIDE: line with no run to guide) comes
//   back as `proposed`, and the owner starts that work with one click ("Queue it": queueProposal → send).

import { IDLE } from "@/backend/live/activity"
import { teamCall } from "@/backend/live/stream"

export const EMPTY_STATE = Object.freeze({
  status: "created",
  activity: IDLE,
  messages: [],
  error: null,
  revision: 0,
  live: {},
  working: null,
  stats: null,
})

// A patch's messages arrive as { from, items }: kept up to `from`, then items.
const patchMessages = (messages, { from, items }) => [...messages.slice(0, from), ...items]

// A message that starts a run (its request): the owner's, a quest, the schedule's — never guidance for a run in
// progress nor an owner chat (2026-10-17: a chat row would have read as the working request and the run's start).
export const isRunRequest = (m) => m?.role === "user" && m.kind !== "guidance" && m.kind !== "chat"

// One line of text: runs of whitespace as one space (a proposal compared, or shown in a note).
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim()

// A thread's rows in order, each owner chat folded into one item with the answer that followed it:
//   → [{ type: "message", message } | { type: "chat", id, question: message | null, answer: message | null, taken }]
// The host appends the pair together; an answer arriving after other rows still pairs with the open question.
// taken (2026-10-17, amendment M1): the answer's proposed work already started — a later run request says the same —
// so the thread offers no second "Queue it" for it after a reload.
export function threadItems(messages = []) {
  const items = []
  let open = null // the newest question still waiting for its answer
  for (const [i, m] of messages.entries()) {
    if (m?.kind !== "chat") {
      items.push({ type: "message", message: m })
      continue
    }
    if (m.role === "user") {
      open = { type: "chat", id: m.id, question: m, answer: null, taken: false }
      items.push(open)
      continue
    }
    const taken = !!m.proposed && messages.slice(i + 1).some((r) => isRunRequest(r) && oneLine(r.content) === oneLine(m.proposed))
    if (open) {
      open.answer = m
      open.taken = taken
      open = null
    } else items.push({ type: "chat", id: m.id, question: null, answer: m, taken })
  }
  return items
}

// What became of a chat besides its answer: its GUIDE: line went into the run in progress (2026-10-17, amendment M1:
// work it proposed is not a note but an action, "Queue it").
export function chatNote({ guided } = {}) {
  return guided ? "→ added to the run as guidance" : null
}

// Ask an agent a question (team call `chat`); never throws: { question, answer, guided, proposed } or { question, error }.
// proposed: the work its answer proposes (a QUEUE: line, or a GUIDE: line with no run to guide), for the owner to queue.
export async function askChat(engine, question) {
  try {
    const value = (await engine.chat(question)) ?? {}
    return { question, answer: String(value.answer ?? ""), guided: !!value.guided, proposed: oneLine(value.proposed) || null, visual: value.visual ?? null, visualError: value.visualError ?? null, error: null }
  } catch (error) {
    return { question, answer: null, guided: false, proposed: null, error: error?.message ?? String(error) }
  }
}

// An askChat outcome as the answer a ChatPair draws ({ content, guided, proposed }, the chat row's shape); null while
// it is pending or when it failed.
export const chatAnswer = (outcome) => (outcome?.answer != null ? { content: outcome.answer, guided: !!outcome.guided, proposed: outcome.proposed ?? null, visual: outcome.visual ?? null, visualError: outcome.visualError ?? null } : null)

// "Queue it" (2026-10-17, amendment M1): the work a chat answer proposed, sent by the owner as new work for the agent
// (team call `send`, as the composer's Send: it runs now, or after the run in progress). Never throws:
//   → { sent: text, error: null } | { sent: null, error }
export async function queueProposal(engine, proposed) {
  const text = oneLine(proposed)
  if (!text) return { sent: null, error: "nothing proposed" }
  if (!engine) return { sent: null, error: "no agent to send it to" }
  try {
    await engine.send(text)
    return { sent: text, error: null }
  } catch (error) {
    return { sent: null, error: error?.message ?? String(error) }
  }
}

// Whether the thread already shows this answer as a chat row (the agent page then draws it there, not inline).
export const chatShown = (messages, answer) => answer != null && (messages ?? []).some((m) => m.kind === "chat" && m.role === "assistant" && m.content === answer)

// A tool as a spec; an older server sends names only.
const toolSpec = (t) => (typeof t === "string" ? { name: t, type: "function", view: null, description: "", input: {} } : t)

export class AgentView {
  #listeners = new Set()
  #state = EMPTY_STATE

  constructor({ id, name, agent }) {
    this.id = id
    this.name = name
    this.describe(agent)
  }

  // The definition, from the registry.
  describe(agent) {
    this.agent = agent
    this.description = agent.description ?? ""
    this.role = agent.role ?? ""
    this.folder = agent.folder ?? null
    this.team = agent.team ?? null
    this.model = agent.model ?? null
    this.artifacts = agent.artifacts ?? []
    const specs = (agent.tools ?? []).map(toolSpec)
    // Sub-agents are tools of type "agent"; an older server lists them only under `agents`.
    for (const name of agent.agents ?? []) if (!specs.some((t) => t.name === name)) specs.push({ name, type: "agent", view: "quest", description: "", input: {} })
    this.tools = specs.map((t) => ({ ...t, kind: t.type === "agent" ? "agent" : "tool" }))
  }

  getSnapshot = () => this.#state

  subscribe = (listener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get status() {
    return this.#state.status
  }

  get activity() {
    return this.#state.activity
  }

  // From the stream: a full state, or changed keys (messages as { from, items }).
  apply(patch, full = false) {
    const { messages, ...rest } = patch
    const next = full ? { ...EMPTY_STATE, ...rest } : { ...this.#state, ...rest }
    if (messages) next.messages = full ? messages : patchMessages(this.#state.messages, messages)
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  dispose() {
    this.#listeners.clear()
  }

  // ── actions (the desk server runs them) ──────────────────────────────

  #call(method, args = []) {
    return teamCall(this.id, method, args)
  }

  // Work for the agent, without waiting for the answer. Returns the call (resolves once the host took it, rejects with
  // its refusal) for a caller that says what became of it (queueProposal); a caller that drops it hears nothing.
  send(text) {
    const call = this.#call("send", [text])
    call.catch(() => {})
    return call
  }

  // Work for the agent; resolves with its answer.
  ask(text) {
    return this.#call("ask", [text])
  }

  stop() {
    this.#call("stop").catch(() => {})
  }

  // The prompt its next step would see.
  preview(text = "") {
    return this.#call("preview", [text])
  }

  // Forget its earlier runs (the history.md beside its .md stays).
  clearMemory() {
    return this.#call("clearMemory")
  }

  // A note for the run in progress, read at its next step; resolves { delivered } (false: no run to guide).
  guide(text) {
    return this.#call("guide", [text])
  }

  // A question answered now (2026-10-17 owner: "talk with the lead to understand what is currently already there and
  // what I want to check"): one model call beside its run, which goes on — never a new run of its own. Resolves
  // { answer, guided, proposed }: guided — the answer's GUIDE line became a note for the run in progress; proposed —
  // the work its QUEUE line (or a GUIDE line with no run to guide) proposes; the host starts nothing, the owner may
  // queue it (2026-10-17, amendment M1).
  chat(text) {
    return this.#call("chat", [text])
  }
}
