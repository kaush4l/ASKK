// One kernel agent as the UI sees it: its definition (the agent.md it came from: description, role, model,
// folder, team, tool specs, artifacts held) and its live state, one immutable snapshot replaced by the stream's
// patches (companion/team/kernel-team.js). Actions are calls to the desk server; nothing runs in the tab.
//
//   state: { status, activity, messages, error, revision, working, stats }
//   messages: { role: user | assistant | tool, action?: tool | answer | gate, kind?: guidance | chat, … } — the run's trail
//   2026-10-17: kind chat — the owner's question and the agent's answer (team call `chat`), a pair beside the runs:
//   { role: user, kind: chat, from, content } then { role: assistant, kind: chat, content, guided, proposed }. Neither
//   starts a run nor is one's request (isRunRequest); a thread draws the pair as one Q/A row (threadItems).
//   2026-10-17 (amendment M1): a chat never starts a run. Its QUEUE: line (or a GUIDE: line with no run to guide) comes
//   back as `proposed`, and the owner starts that work with one click ("Queue it": queueProposal → send).

import { IDLE } from "@/backend/live/activity"
import { signal } from "@/backend/live/signal"
import { teamCall } from "@/backend/live/stream"

export const EMPTY_STATE = Object.freeze({
  status: "created",
  activity: IDLE,
  messages: [],
  error: null,
  revision: 0,
  working: null,
  stats: null,
  messagesSkipped: 0,
})

// A patch's messages arrive as { from, items }, `from` indexing the whole thread: the tab holds its tail only
// (2026-10-26, snapshot-thread-tail: the snapshot left messagesSkipped rows out), so rows are kept up to
// from − messagesSkipped, then items. A from before the tail (0: the thread restarted) gives items as the rows.
export function patchMessages({ messages = [], messagesSkipped: skipped = 0 }, { from, items }) {
  if (from < skipped) return { messages: items, messagesSkipped: from }
  return { messages: [...messages.slice(0, from - skipped), ...items], messagesSkipped: skipped }
}

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

// The newest error an agent met (2026-10-26, agent-error-reason: the agent page shows why, not a bare "error"):
// the newest message row holding an `error` → { text, at }; else state.error with no time; else null.
export function lastError(state) {
  const row = (state?.messages ?? []).findLast((m) => m?.error)
  if (row) return { text: String(row.error), at: row.at ?? null }
  return state?.error ? { text: String(state.error), at: null } : null
}

// What became of a chat besides its answer: its GUIDE: line went into the run in progress (2026-10-17, amendment M1:
// work it proposed is not a note but an action, "Queue it").
export function chatNote({ guided } = {}) {
  return guided ? "→ added to the run as guidance" : null
}

// The thread's button for the rows the snapshot left out (snapshot-thread-tail): null when none were.
export const olderLabel = (skipped) => (skipped > 0 ? `Show ${skipped} older row${skipped === 1 ? "" : "s"}` : null)

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

// A tool as a spec; an older server sends names only.
const toolSpec = (t) => (typeof t === "string" ? { name: t, type: "function", view: null, description: "", input: {} } : t)

export class AgentView {
  state = signal(EMPTY_STATE)

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
    this.soul = agent.soul ?? ""
    this.soulFile = agent.soul_file ?? null
    this.folder = agent.folder ?? null
    this.team = agent.team ?? null
    this.model = agent.model ?? null
    this.artifacts = agent.artifacts ?? []
    const specs = (agent.tools ?? []).map(toolSpec)
    // Sub-agents are tools of type "agent"; an older server lists them only under `agents`.
    for (const name of agent.agents ?? []) if (!specs.some((t) => t.name === name)) specs.push({ name, type: "agent", view: "quest", description: "", input: {} })
    this.tools = specs.map((t) => ({ ...t, kind: t.type === "agent" ? "agent" : "tool" }))
  }

  getSnapshot = this.state.get
  subscribe = this.state.subscribe

  get #state() {
    return this.state.get()
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
    if (messages) Object.assign(next, full ? { messages } : patchMessages(this.#state, messages))
    this.state.set(next)
  }

  dispose() {
    this.state.clear()
  }

  // ── actions (the desk server runs them) ──────────────────────────────

  #call(method, args = []) {
    return teamCall(this.id, method, args)
  }

  // Work for the agent, without waiting for the answer. Returns the call (resolves once the host took it, rejects with
  // its refusal) for a caller that says what became of it (queueProposal); a caller that drops it hears nothing.
  // meta (2026-10-24): {via: typed | voice, suffix?} — the owner's words, rewritten on-device by the host before the run
  // (companion/capabilities/sanitize.js); suffix: a note appended after the rewrite (the voice page's "read aloud" line).
  send(text, meta = null) {
    const call = this.#call("send", meta ? [text, meta] : [text])
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

  // The rows the snapshot left out (team call `older` [skipped]), put before the thread; resolves the count loaded
  // (0 when none were left out, or a patch moved the thread meanwhile).
  async loadOlder() {
    const skipped = this.#state.messagesSkipped
    if (!skipped) return 0
    const { items = [] } = (await this.#call("older", [skipped])) ?? {}
    const s = this.#state
    if (s.messagesSkipped !== skipped) return 0
    this.state.set({ ...s, messages: [...items, ...s.messages], messagesSkipped: Math.max(0, skipped - items.length) })
    return items.length
  }

  // The whole row of a step the snapshot sent cut (snapshot-steps-lean: contentCut), through the call `older` [end,
  // start]; resolves true once it is back in place (false when the thread moved meanwhile).
  async loadStep(id) {
    const at = this.#state.messages.findIndex((m) => m.id === id)
    if (at < 0) return false
    const index = (this.#state.messagesSkipped ?? 0) + at
    const { items = [] } = (await this.#call("older", [index + 1, index])) ?? {}
    const s = this.#state
    const i = s.messages.findIndex((m) => m.id === id)
    if (i < 0 || items[0]?.id !== id) return false
    this.state.set({ ...s, messages: s.messages.map((m, j) => (j === i ? items[0] : m)) })
    return true
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
  guide(text, meta = null) {
    return this.#call("guide", meta ? [text, meta] : [text])
  }

  // A question answered now (2026-10-17 owner: "talk with the lead to understand what is currently already there and
  // what I want to check"): one model call beside its run, which goes on — never a new run of its own. Resolves
  // { answer, guided, proposed }: guided — the answer's GUIDE line became a note for the run in progress; proposed —
  // the work its QUEUE line (or a GUIDE line with no run to guide) proposes; the host starts nothing, the owner may
  // queue it (2026-10-17, amendment M1).
  chat(text, meta = null) {
    return this.#call("chat", meta ? [text, meta] : [text])
  }
}
