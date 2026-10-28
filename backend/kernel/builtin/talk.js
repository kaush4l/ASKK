import { Artifact } from "../artifact/artifact.js"
import { readVisual, visualBrief } from "./visual.js"
import { clip, oneLine } from "../util/text.js"

// Talk (2026-10-18 owner: "I want to talk with the desk to understand and guide the build. The desk should be able to
// talk with me too. The work and build can run in the background."): the desk's side of the conversation with the
// owner. The owner already asks the lead (Agent.chat: an answer now) and guides its run; talk is the other way — an
// agent tells the owner what it found or did, and asks the owner what only the owner can decide, and its work goes on.
// Id `talk`, view and kind `talk`, keep `always`.
//
// Commands: say (a result with its numbers, a finding, what runs now), ask {question, options?} (the work never waits for it:
// the reply comes as OWNER GUIDANCE while you run, else as a new run), drop (a question that no longer needs an answer).
// say and ask take a visual (2026-10-18 owner: "Only text based conversation is slow and verbose. So, when asking questions, the lead
//   should have the option to draw the architecture for me to preview and understand. This should help curate the plan
//   more easily."): a drawing the owner sees under the message — a spec (visual.js: flow, steps, matrix, line, bars,
//   tokens, scatter, compare — the options side by side as a compare) or {show: "<preview visual id>"} / the bare id
//   (the drawing already in the preview, e.g. the architecture its script computes; the UI reads it from the preview).
//   The owner clicks an element of it and the reply says what they pointed at.
//
// The owner (the host's team/call {target: "artifact", method, args: [{id, …}]}): ownerCall("reply", [{id, ask, text}])
// records the reply to an open question and returns {reply, deliver, keeper}: the host hands `deliver` to the agent that
// asked (guidance while it runs, else a run); ownerCall("seen", [{id, upto}]) marks the conversation read up to a
// message. Prompt: the last LINES messages and the holder's open questions. State {messages: [{id, kind: say | ask |
// reply, from, text, options, visual, re, status: open | answered | dropped (asks), reason, at}] ≤ MESSAGES, seen,
// revision}. A reply may carry `context` (what the owner pointed at in the drawing), and from another channel `via`
// ("Telegram") with `conversation` (what was said there before it, ≤ 2000 chars) for the asker's text.

const MESSAGES = 80 // in the twin and kept
const LINES = 8 // in the prompt
const OPEN_MAX = 3 // open questions per agent
const TEXT = 1500
const OPTION = 160 // 2026-10-18: at 80 the lead's options (an answer and what it costs) were cut mid-sentence

const VISUAL_INPUT = "a drawing under the message (optional, and the fastest way to be understood): a preview visual's id (\"arch\": the architecture as its script computes it) or a spec {kind: flow | steps | matrix | line | bars | tokens | scatter | compare, …} — the options side by side as a compare"

// What the owner pointed at in a drawing (the UI's element context): ≤ 12 keys, each value a scalar ≤ 120 chars (an
// object as its JSON, clipped); nothing usable → null.
function contextOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out = {}
  for (const [k, v] of Object.entries(raw).slice(0, 12)) {
    if (v == null || v === "") continue
    out[clip(k, 40)] = typeof v === "number" || typeof v === "boolean" ? v : clip(typeof v === "object" ? JSON.stringify(v) : String(v), 120)
  }
  return Object.keys(out).length ? out : null
}

function optionsOf(raw) {
  if (raw == null || raw === "") return []
  const list = Array.isArray(raw) ? raw : String(raw).split(/\s*[|\n]\s*/)
  const out = list.map((o) => clip(oneLine(o), OPTION)).filter(Boolean)
  if (out.length > 4) throw new Error("options: at most 4 answers")
  const long = list.find((o) => oneLine(o).length > OPTION)
  if (long) throw new Error(`options: each at most ${OPTION} chars (one is ${oneLine(long).length}) — put the detail in the question`)
  return out
}

export class Talk extends Artifact {
  static about = "the desk's side of the conversation: results said and questions asked of the owner, never waited on"
  static commands = {
    say: { description: "tell the owner something: a result with its numbers and where it is, a finding, what runs now — they read it in the talk panel, with your drawing under it", input: { text: `at most ${TEXT} chars`, visual: VISUAL_INPUT } },
    ask: { description: "ask the owner what only they can decide (a direction, a trade-off, a go-ahead) — draw it (visual) so they see the choice, not read it; keep working: the reply comes as OWNER GUIDANCE or a new run", input: { question: "one question", options: `up to 4 answers to pick from, | separated, each ≤ ${OPTION} chars: the choice and what it costs (optional)`, visual: "a drawing, as talk.say's (optional)" } },
    drop: { description: "withdraw a question of yours that no longer needs an answer", input: { ask: "its id (q3)", reason: "why" } },
  }
  // reply → {reply, deliver, keeper}: the reply recorded, the question answered, the text for the agent that asked.
  // seen → {seen}: the conversation read up to that message. An unknown method, question or one not open → throws.
  static owner = { reply: "reply", seen: "seen" }
  static ownerCan = "reply or mark seen"

  constructor({ id = "talk", title, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "talk" ? "talk — the desk and the owner" : `${id} — talk`) })
    Object.assign(this, { kind: "talk", view: "talk", keep: "always" })
    this.clock = clock
    this.n = 0
    this.state = { messages: [], seen: null, revision: 0 }
  }

  // ---- state ----

  #post(message) {
    this.n += 1
    const m = { id: `${message.kind === "ask" ? "q" : message.kind === "reply" ? "r" : "m"}${this.n}`, at: this.clock().toISOString(), ...message }
    this.bump({ messages: [...this.state.messages, m].slice(-MESSAGES) })
    return m
  }

  #ask(id) {
    const key = String(id ?? "").trim().replace(/^\[|\]$/g, "")
    const q = this.state.messages.find((m) => m.kind === "ask" && m.id === key)
    if (!q) throw new Error(`no question ${id}`)
    return q
  }

  #update(id, patch) {
    this.bump({ messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
  }

  // The open questions (of one agent).
  open(agent = null) {
    return this.state.messages.filter((m) => m.kind === "ask" && m.status === "open" && (!agent || m.from === agent))
  }

  snapshot() {
    return { messages: this.state.messages, seen: this.state.seen, n: this.n }
  }

  restore(data) {
    if (!data || !Array.isArray(data.messages)) return
    const messages = data.messages.slice(-MESSAGES)
    const top = Math.max(0, ...messages.map((m) => Number(String(m.id).slice(1)) || 0))
    this.n = Math.max(Number(data.n) || 0, top)
    this.state = { messages, seen: data.seen ?? null, revision: 0 }
  }

  // ---- the agents ----

  say(input = {}, ctx = {}) {
    const from = ctx.agent?.name ?? "agent"
    const text = String(input.text ?? input.message ?? "").trim()
    if (!text) throw new Error("text: what to tell the owner")
    if (text.length > TEXT) throw new Error(`text: at most ${TEXT} chars — say the result and where it is; the owner opens the rest`)
    const last = [...this.state.messages].reverse().find((m) => m.from === from && m.kind === "say")
    if (last && last.text === text) throw new Error(`you told the owner this already (${last.id})`)
    const visual = readVisual(input.visual)
    const m = this.#post({ kind: "say", from, text, ...(visual ? { visual } : {}) })
    return `told the owner (${m.id}) — they read it in the talk panel; your work goes on`
  }

  ask(input = {}, ctx = {}) {
    const from = ctx.agent?.name ?? "agent"
    const question = String(input.question ?? input.text ?? "").trim()
    if (!question) throw new Error("question: what you ask the owner")
    if (question.length > TEXT) throw new Error(`question: at most ${TEXT} chars`)
    const options = optionsOf(input.options)
    const mine = this.open(from)
    const same = mine.find((q) => q.text === question)
    if (same) throw new Error(`you asked this already (${same.id}): its reply comes as OWNER GUIDANCE or a run`)
    if (mine.length >= OPEN_MAX) throw new Error(`${mine.length} of your questions are open (${mine.map((q) => q.id).join(", ")}): keep working until a reply comes, or ${this.name}.drop one`)
    const visual = readVisual(input.visual)
    const q = this.#post({ kind: "ask", from, text: question, options, ...(visual ? { visual } : {}), status: "open" })
    return `asked the owner (${q.id}) — keep working: the reply comes as OWNER GUIDANCE while you run, else as a new run`
  }

  drop(input = {}, ctx = {}) {
    const from = ctx.agent?.name ?? "agent"
    const q = this.#ask(input.ask ?? input.id)
    if (q.from !== from) throw new Error(`${q.id} is ${q.from}'s question`)
    if (q.status !== "open") throw new Error(`${q.id} is ${q.status}`)
    const reason = clip(oneLine(input.reason), 300)
    if (!reason) throw new Error("reason: why it no longer needs an answer")
    this.#update(q.id, { status: "dropped", reason })
    return `dropped ${q.id}`
  }

  // ---- the owner ----

  seen(a) {
    const upto = String(a.upto ?? "").trim()
    if (!this.state.messages.some((m) => m.id === upto)) throw new Error(`no message ${upto}`)
    if (this.state.seen !== upto) this.bump({ seen: upto })
    return { seen: upto }
  }

  reply(a, from) {
    const q = this.#ask(a.ask)
    if (q.status !== "open") throw new Error(`${q.id} is ${q.status}`)
    const text = String(a.text ?? "").trim()
    if (!text) throw new Error("text: the reply")
    if (text.length > TEXT * 2) throw new Error(`text: at most ${TEXT * 2} chars`)
    const context = contextOf(a.context)
    this.#update(q.id, { status: "answered" })
    const reply = this.#post({ kind: "reply", from, text, re: q.id, ...(context ? { context } : {}) })
    const pointed = context ? ` — pointing at ${Object.entries(context).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")} in your drawing` : ""
    // a reply from another channel (Telegram) brings the conversation before it there (≤ 2000 chars)
    const via = a.via ? ` on ${clip(oneLine(a.via), 40)}` : ""
    const before = a.conversation ? `\n(${via ? `On ${clip(oneLine(a.via), 40)}` : "Before this"}, the conversation before the reply, oldest first:\n${clip(String(a.conversation), 2000)})` : ""
    const deliver = `The owner replies${via} to your question ${q.id} ("${clip(oneLine(q.text), 300)}")${pointed}: "${text}"${before}\nAct on it — a decision goes where decisions go (line.md DECISIONS, the plan) — and tell the owner what you will do with ${this.name}.say.`
    return { reply, deliver, keeper: q.from }
  }

  brief() {
    const open = this.open().length
    const last = this.state.messages.at(-1)
    if (!last) return "nothing said yet"
    return `${open ? `${open} question${open === 1 ? "" : "s"} for the owner · ` : ""}${last.from}: ${clip(oneLine(last.text), 60)}`
  }

  render(agent) {
    const can = this.can(agent)
    const head = `your conversation with the owner${can.length ? `: ${can.join(", ")}` : ""} — tell them results and findings as they come, ask what only they decide; the work never waits for a reply`
    const shown = this.state.messages.slice(-LINES)
    if (!shown.length) return `${head}\n(nothing said yet)`
    const asker = (id) => this.state.messages.find((m) => m.id === id)?.from ?? "?"
    const line = (m) => {
      const who = m.kind === "reply" ? `owner → ${asker(m.re)} (re ${m.re})` : `${m.from} → owner`
      const tag = m.kind === "ask" ? ` [${m.id} ${m.status}${m.options?.length ? `; options: ${m.options.join(" | ")}` : ""}]` : ""
      const drawn = m.visual ? ` (drawn: ${m.visual.show ? `preview ${m.visual.show}` : visualBrief(m.visual)})` : ""
      const at = m.context ? ` (pointing at ${clip(JSON.stringify(m.context), 160)})` : ""
      return `  ${String(m.at).slice(5, 16).replace("T", " ")} ${who}${tag}${drawn}${at}: ${clip(oneLine(m.text), 400)}`
    }
    const out = [head, ...shown.map(line)]
    const mine = this.open(agent?.name ?? null)
    if (mine.length) out.push(`OPEN (waiting for the owner): ${mine.map((q) => q.id).join(", ")}`)
    return out.join("\n")
  }
}
