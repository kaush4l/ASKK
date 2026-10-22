import { checkReport, REPORT_FORMAT } from "./report.js"
import { parseReply, RESPONSE_FORMAT } from "./reply.js"
import { AgentTool, OUTSIDE_DESKS, QUEST_INPUT, readsOutside } from "../tool/tool.js"
import { readVisual } from "../builtin/visual.js"

// Agent: one configurable ReAct loop.
//
//   ask(request) → loop { render prompt → infer → parse → answer? done : run calls (one stage,
//   in parallel) → results join the run's steps } → report
//
// Everything the agent knows renders into the prompt every step, in the owner's reading order (2026-10-17 owner:
// "soul, agent instructions, context, quest, history, tools and response format"): soul → # YOU ARE <name> + role →
// every artifact it holds (latest state, its artifact order) → # REQUEST, then # OWNER GUIDANCE when a note waits
// (it amends the quest) → # EARLIER RUNS → # WORK DONE ON THIS REQUEST → # TOOLS → # RESPONSE (response + report
// formats), or # SYSTEM when config.system replaces it. Each part carries its own instructions (a tool its
// description, an artifact its head line, the run's state its header), so a role says only what the agent is for
// and how it works (2026-10-15 owner: spec + runbook, nothing repeated).
// Callbacks: on(event, fn) for start | think | step | call | result | gate | format | guide | answer | error | chat. A run
// never blocks another agent: a quest to a sub-agent is a tool call, and calls in one step run together.
// guide(text): a note for the run in progress, seen at its next step (once), without a new run.
// context: what the host hands every tool call (ctx.host…), beside ctx.agent and ctx.signal — no globals.
// twin(): the agent as plain data for its UI twin (the agent page, the stream's definition).
// 2026-10-17: before each step's render every artifact with a refresh(agent) is awaited (refreshArtifacts), so a
// host-backed artifact (terminal tails, the file tree) brings fresh state into the synchronous render(); a refresh
// that fails or hangs is one line in that artifact's block, never the run's end.
// 2026-10-17 owner ("I want to be able to talk with the lead to understand what is currently already there and what I
// want to check"): chat(text) is one model call beside the runs — the agent answers from what its prompt shows (the
// run in progress, its artifacts, earlier runs) without starting, waiting for or changing a run, except a GUIDE: line
// (guidance for the run in progress); a QUEUE: line is a proposal the owner may start. current: the run in progress
// ({request, steps}, null when idle). stop(): every run of this agent — in progress or queued, whoever started it (the
// host, a lead's quest) — ends "stopped" at its next step boundary, and every chat in flight with it; a model call in
// flight is not waited for.
// 2026-10-17 (critic): an action is only the reply's own last line (parseChat) — a GUIDE:/QUEUE: line quoted from a
// file, in a code fence, a blockquote or a list never acts; a QUEUE (or a GUIDE with no run left to guide) comes back as
// `proposed`, and no run starts from a chat — the owner starts it with one click.


// Prompt budget (bonsai): what the model needs to act, nothing it can do without.
const CLIP_OLD_STEP = 700 // a tool result older than the last two steps keeps this many chars (a member's report stays whole)
const CLIP_HISTORY = 400 // a past run's request and answer
const REPEAT_MS = 3 * 60_000 // the same data call within this answers from the earlier result
const REFRESH_MS = 15_000 // an artifact's refresh(agent) longer than this (config.refreshMs) is a failed refresh: the step goes on
const IMAGES_MAX = 3 // images in one model call (2026-10-18: the preview's screenshots)
const IMAGE_BYTES = 3_500_000 // one image's bytes at most (a provider's limit is 5 MB)
// Prompt compaction (2026-10-22 owner: "check the size before sending and if it is 90%, we autocompress and send the
// compressed + goal"): before each step's model call the prompt is measured against the agent's budget (config.contextChars,
// else contextBudget(config.model)); at COMPACT_AT of it the run's older steps (all but the last COMPACT_KEEP) and its
// EARLIER RUNS fold into one summary step — written by one model call, or clipped in code when that call fails. # REQUEST
// and # OWNER GUIDANCE are never folded: the goal goes out verbatim.
export const COMPACT_AT = 0.9
const COMPACT_KEEP = 2 // the newest steps a compaction keeps whole
const CLIP_COMPACT = 6000 // a summary's chars at most
const CLIP_FOLD = 300 // each result in the code-side summary
// The budget in prompt chars for a model name (~3.5 chars a token, room left for the reply): Apple's on-device model
// reads ~4k tokens, a small local model ~32k, the rest (Claude, GPT, Gemini: 128k–1M tokens) 400k chars.
export function contextBudget(model) {
  const m = String(model ?? "").toLowerCase()
  if (/apple|on-?device/.test(m)) return 12_000
  if (/ollama|llama|qwen|mistral|phi|gemma|lmstudio|local/.test(m)) return 100_000
  return 400_000
}
// The code-side summary: each folded step's thought and its results' heads (a compaction whose model call failed).
const foldText = (steps, past) =>
  [
    ...past.map((h) => `earlier run (${h.from}): ${clip(h.request, 200)} → ${clip(h.answer, 300)}`),
    ...steps.map((s, i) => `step ${i + 1}: ${clip(s.thought ?? "", 300)}\n${(s.results ?? []).map((r) => `  ${r.tool} → ${r.ok ? "" : "ERROR "}${clipOld(r.output, CLIP_FOLD)}`).join("\n")}`),
  ].join("\n")
const COMPACT_PROMPT =
  "Compress the work below into a summary the agent can keep acting from: every finding with its numbers, paths, ids and names; what was tried and failed; what is left to do. No preamble, plain text, at most 1500 words."

// Guidance that arrived while the model wrote its answer: the answer waits one step so the note is read.
const HELD = "answer held: the owner's guidance arrived while you wrote it — read # OWNER GUIDANCE, then answer"
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s))
// An old result keeps its head and its tail: series arrive oldest first, so a head-only cut dropped the
// newest bars and the agent fetched them again (2026-10-15, waves).
const clipEnds = (s, n) => {
  const t = String(s)
  if (t.length <= n) return t
  const head = Math.floor(n * 0.4)
  return `${t.slice(0, head)} … ${t.slice(t.length - (n - head))}`
}
// An old result that leads with its own summary — a JSON object whose `line` (text) or `lines` (texts) a tool put first —
// keeps that summary whole (≤ CLIP_SUMMARY) above the clipped ends (2026-10-21: a 10-name market read's per-name lines
// were cut to their head and tail, and the trading lead lost SPY's line in the middle).
const CLIP_SUMMARY = 1600
export const clipOld = (s, n) => {
  const t = String(s)
  if (t.length <= n) return t
  let lead = null
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t)
      lead = typeof o.line === "string" ? o.line : Array.isArray(o.lines) ? o.lines.map(String).join("\n") : null
    } catch {}
  }
  return lead ? `${clip(lead, CLIP_SUMMARY)}\n${clipEnds(t, n)}` : clipEnds(t, n)
}

// The owner's chat (Agent.chat): how to answer, last in its prompt where # RESPONSE is in a step's.
export const CHAT_FORMAT =
  "The owner is talking with you; your run (if any) goes on without this reply. Answer in plain prose from what you see above — what is built, what runs now, what the numbers are, what is next, what to check, with paths and numbers. No calls: tools do not run here. Draw rather than describe (2026-10-18 owner: \"Only text based conversation is slow and verbose\"): to show an architecture, a flow, two options side by side or numbers, add ONE block fenced ```visual … ``` holding a visual spec as JSON ({\"kind\": \"flow\" | \"steps\" | \"matrix\" | \"line\" | \"bars\" | \"tokens\" | \"scatter\" | \"compare\", …}) or {\"show\": \"<the id of a visual in the preview>\"} (e.g. \"arch\": the architecture as its script computes it) — the owner sees it drawn under your answer; keep the prose short beside it. If the owner asks you to do, change or check something, make your reply's last line, on its own (not quoted, not in a list or a code block), GUIDE: <the note for your run in progress> when you are running, or QUEUE: <the request for a new run, for the owner to start> when idle; otherwise no such line."
const CHAT_KEEP = 12 // exchanges kept in agent.chats

// What a run read from outside (tool/tool.js readsOutside: web.*, browse, desk.read / desk.ask, an MCP tool, a tool built
// with outside: true): each run keeps the names it called in `current.outside` (a Set, handed to every tool call as
// ctx.outside); a quest or a dispatched job starts its member's run with the caller's set (the brief may carry what the
// caller read), and the member's own reads join the caller's as "<member>: <tool>" when that run ends (its report may
// carry them). The practice holds an instruction or a checklist item written by such a run for the owner
// (builtin/practice.js); a helper it keeps (agent.spawn keep: desk) works for that run only, and a kept helper's update
// waits on it, until the owner accepts (builtin/spawn.js); a desk it creates or updates (desk.create) waits for the
// owner's accept before it is written, and tool code it proposes (desk.propose) says where its words came from
// (builtin/desks.js).
export { OUTSIDE_DESKS, readsOutside }
const CHAT_SHOWN = 6 // earlier exchanges a chat's prompt shows
const CLIP_CHAT = 800 // each side of an earlier exchange in a chat's prompt
// A chat reply's action line: GUIDE: or QUEUE: after optional spaces (≤ 3: four make an indented code block) and **,
// the note after it (a closing ** dropped). Never after >, -, *, a number or a backtick (a quote, a list, code).
const CHAT_ACTION = /^ {0,3}(?:\*\*\s*)?(GUIDE|QUEUE)\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*?)\s*(?:\*\*)?\s*$/
const FENCE = /^ {0,3}(```|~~~)/ // a code fence's open or close line

// A chat reply → {answer, action, note}: an action only from the reply's final non-empty line, when that line is
// outside any code fence, not a blockquote's lazy continuation (the line above it starts with >) and is a GUIDE:/QUEUE:
// line itself (CHAT_ACTION) — it leaves the answer. Every other line stays in the answer untouched and acts on nothing
// (2026-10-17 critic: a QUEUE: line quoted from notes.md inside a fence started a run as the owner's). A reply in the
// run's JSON shape (a model used to it) gives its answer field.
function parseChat(raw) {
  let text = String(raw ?? "").trim()
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text)
      if (typeof o?.answer === "string") text = o.answer.trim()
    } catch {}
  }
  const none = { answer: text, action: null, note: "" }
  const lines = text.split("\n")
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last--
  if (last < 0) return none
  const hit = lines[last].match(CHAT_ACTION)
  if (!hit?.[2].trim()) return none // no action line, or one with nothing to do (it stays in the answer)
  const fenced = lines.slice(0, last).filter((l) => FENCE.test(l)).length % 2 === 1 // an open fence above it
  const quoted = last > 0 && /^\s*>/.test(lines[last - 1]) // `> …` then this line: the quote goes on
  if (fenced || quoted) return none
  return { answer: lines.slice(0, last).join("\n").trim(), action: hit[1].toUpperCase(), note: hit[2].trim() }
}

// A chat answer's drawing: the first block fenced ```visual (or ~~~visual) outside any other fence → {answer without it,
// visual} (readVisual: a checked spec or {show: id}); one that does not read stays out of the answer and its error comes
// back as visualError (the owner sees why nothing is drawn). No block → {answer, visual: null}.
export function chatVisual(answer) {
  const lines = String(answer ?? "").split("\n")
  let open = null // the fence that opened a block we are inside of
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^ {0,3}(```|~~~)\s*(\S*)/)
    if (!f) continue
    if (open) {
      if (lines[i].trim().startsWith(open)) open = null
      continue
    }
    if (f[2].toLowerCase() !== "visual") {
      open = f[1]
      continue
    }
    const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(f[1]))
    if (end < 0) break
    const body = lines.slice(i + 1, end).join("\n")
    const rest = [...lines.slice(0, i), ...lines.slice(end + 1)].join("\n").replace(/\n{3,}/g, "\n\n").trim()
    try {
      return { answer: rest, visual: readVisual(body) }
    } catch (error) {
      return { answer: rest, visual: null, visualError: error.message }
    }
  }
  return { answer: String(answer ?? ""), visual: null }
}

// An agent's one line when no description is given: its role's first line that is not a section header (a line of
// capitals and spaces — SPEC, RUNBOOK, OWNER CHAT — maybe after # or before :), ≤ 200 chars; "" when there is none.
// 2026-10-17 (critic): every station template's role opens on "SPEC", and each spawned station and member showed it as
// its description (twin, tree, its line in its lead's TOOLS).
export function roleLine(role) {
  const lines = String(role ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
  return (lines.find((l) => !/^#*\s*[A-Z][A-Z ]*:?$/.test(l)) ?? "").slice(0, 200)
}

// A tool's twin; a tool object that is not a kernel Tool (a desk's own builder) as the same fields.
const toolTwin = (t) =>
  typeof t.twin === "function"
    ? t.twin()
    : { element: "tool", id: t.name, ...(typeof t.spec === "function" ? t.spec() : { name: t.name, type: t.type, view: t.view ?? null, description: t.description ?? "", input: t.input ?? {} }) }

export class Agent {
  #runs = new Set() // the AbortController of every run accepted and not ended (in progress or queued): stop() aborts them
  #chats = new Map() // the AbortController of every chat in flight -> {from, text, at}: stop() aborts them too

  constructor(config, { infer, tools = [], artifacts = [], context = {} } = {}) {
    if (!config?.name) throw new Error("agent needs a name")
    if (typeof infer !== "function") throw new Error(`${config.name}: needs infer(prompt, agent)`)
    this.name = config.name
    // report: answers must follow REPORT_FORMAT (checked in code); gateRetries: how often a final
    // answer is refused (open checklist, bad report) before it goes through flagged.
    this.config = { maxSteps: 12, historyKeep: 3, report: true, gateRetries: 2, ...config }
    this.infer = infer
    this.tools = new Map()
    this.artifacts = []
    this.history = [] // finished runs: {from, request, answer}
    this.guidance = [] // notes for the run in progress, not yet seen by a step: {from, text, at}
    this.chats = [] // the owner's chats, newest last (≤ CHAT_KEEP): {from, text, answer, at} — never in a run's prompt
    this.current = null // the run in progress: {request, steps, outside} (steps: the live list; outside: readsOutside), null when idle
    this.listeners = new Map()
    this.status = "idle"
    this.context = context // spread into every tool call's ctx, under agent and signal
    this.holding = new Map() // artifact id -> how this agent holds it: {commands, gate} (addArtifact)
    this.refreshFailed = new Map() // artifact id -> why its last refresh failed (one line in its prompt block)
    for (const t of tools) this.addTool(t)
    for (const a of artifacts) this.addArtifact(a)
  }

  // ---- configuration --------------------------------------------------------------------------

  addTool(tool) {
    const t = tool instanceof Agent ? new AgentTool(tool) : tool
    if (this.tools.has(t.name)) throw new Error(`${this.name}: tool ${t.name} twice`)
    this.tools.set(t.name, t)
    return this
  }

  // options: how this agent holds it. commands: only these of its commands (the part after "<id>."), e.g. a critic
  // that reads the terminal but never starts a command (2026-10-17); gate: handed to attach(agent, options) — the
  // desk's Plan gates only the holders attached with gate: true.
  addArtifact(artifact, { commands = null, gate = false } = {}) {
    const all = artifact.commands()
    const short = (t) => (t.name.startsWith(`${artifact.id}.`) ? t.name.slice(artifact.id.length + 1) : t.name)
    const keep = commands == null ? null : new Set([].concat(commands).map((c) => String(c).trim()))
    const unknown = keep ? [...keep].filter((c) => !all.some((t) => short(t) === c)) : []
    if (unknown.length) throw new Error(`${this.name}: ${artifact.id} has no command ${unknown.join(", ")} (has ${all.map(short).join(", ") || "none"})`)
    this.artifacts.push(artifact)
    this.holding.set(artifact.id, { commands: keep ? [...keep] : null, gate: !!gate })
    for (const t of all) {
      if (keep && !keep.has(short(t))) continue
      if (t.type === "function") t.type = "artifact" // a command that changes an artifact
      t.view ??= artifact.view // its call draws as the artifact it changes
      this.addTool(t)
    }
    artifact.attach?.(this, { commands: keep ? [...keep] : null, gate: !!gate })
    return this
  }

  // The reverse of addArtifact (a workflow phase hands an artifact for one phase, 2026-10-22): its commands go, detach().
  removeArtifact(id) {
    const artifact = this.artifacts.find((a) => a.id === id)
    if (!artifact) return false
    for (const t of artifact.commands()) this.tools.delete(t.name)
    this.artifacts = this.artifacts.filter((a) => a !== artifact)
    this.holding.delete(id)
    artifact.detach?.(this)
    return true
  }

  // Every artifact's refresh(agent), together, before a step renders: host-backed state (a terminal's tail, a file
  // tree) is read here so render() stays synchronous. A refresh that throws or passes REFRESH_MS is noted in that
  // artifact's prompt block (refreshFailed) and the step goes on with its last state.
  async refreshArtifacts() {
    await Promise.all(
      this.artifacts.map(async (a) => {
        if (typeof a.refresh !== "function") return
        let timer = null
        try {
          const ms = this.config.refreshMs ?? REFRESH_MS
          await Promise.race([a.refresh(this), new Promise((_, no) => (timer = setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms)))])
          this.refreshFailed.delete(a.id)
        } catch (error) {
          this.refreshFailed.set(a.id, String(error?.message ?? error).split("\n")[0].slice(0, 200))
        } finally {
          clearTimeout(timer)
        }
      }),
    )
  }

  // The images this step's model call carries (2026-10-18 owner: "the screenshot will be included along with the next
  // request and the agent can iterate over in order to complete a live artifact and I can also observe it"): each
  // artifact's images(agent) — the preview's newest screenshot of the page this agent last acted on, once per shot —
  // at most IMAGES_MAX, each ≤ IMAGE_BYTES; a failure or a hang past refreshMs drops that artifact's images, never
  // the step. Each {media_type, data (base64), caption, ref}: the model gets the data, the step event only the ref.
  async collectImages() {
    const found = await Promise.all(
      this.artifacts.map(async (a) => {
        if (typeof a.images !== "function") return []
        let timer = null
        try {
          const ms = this.config.refreshMs ?? REFRESH_MS
          const got = await Promise.race([a.images(this), new Promise((_, no) => (timer = setTimeout(() => no(new Error("timeout")), ms)))])
          return Array.isArray(got) ? got : []
        } catch {
          return []
        } finally {
          clearTimeout(timer)
        }
      }),
    )
    return found
      .flat()
      .filter((i) => i && typeof i.data === "string" && /^image\/(png|jpeg|webp|gif)$/.test(i.media_type ?? "") && i.data.length * 0.75 <= IMAGE_BYTES)
      .slice(0, IMAGES_MAX)
  }

  // ---- twin -----------------------------------------------------------------------------------

  // The agent as plain data (companion/team/kernel-team.js streams it as the agent's definition): what it is
  // (description, role, model, team, folder; desk: the desk mounted under it, else null), what it can call (every
  // tool's twin, the agents among them) and the artifacts it holds, by id.
  twin() {
    const tools = [...this.tools.values()]
    return {
      element: "agent",
      id: this.name,
      name: this.name,
      description: this.config.description ?? roleLine(this.config.role),
      role: String(this.config.role ?? ""),
      model: this.config.model ?? null,
      team: this.teamPath ?? "",
      folder: this.config.folder ?? null,
      desk: this.desk ?? null,
      tools: tools.map(toolTwin),
      agents: tools.filter((t) => t.type === "agent").map((t) => t.name),
      artifacts: this.artifacts.map((a) => a.id),
      // 2026-10-17: an agent spawned at run time (Desk.spawn): who spawned it, for what goal, when, how long it stays.
      spawned: this.config.spawned ? (({ input, ...rest }) => rest)(this.config.spawned) : null, // its spawn record stays on config (agent.update, a kept helper's agent.md)
      status: this.status,
    }
  }

  // ---- callbacks ------------------------------------------------------------------------------

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(fn)
    return () => this.listeners.get(event).delete(fn)
  }

  emit(event, data) {
    const payload = { agent: this.name, event, at: Date.now(), ...data }
    for (const fn of this.listeners.get(event) ?? []) fn(payload)
    for (const fn of this.listeners.get("*") ?? []) fn(payload)
  }

  // ---- prompt ---------------------------------------------------------------------------------

  // Sections 1–7 in the owner's reading order (the header comment): who it is, what it is for, what it holds,
  // what is asked, what was done, what it can call, how to reply.
  // options.chat ({from, text}: Agent.chat): the same sections for the owner's chat — request null when idle — but 7 is
  // # OWNER CHAT (the last exchanges, then the owner's words) and # RESPONSE the chat's format. Without options the
  // prompt is a step's, unchanged.
  render(request, steps, options = {}) {
    const chat = options?.chat ?? null
    const parts = []
    // 1 soul: desk-wide, no header — the prompt opens on the identity itself.
    if (this.config.soul) parts.push(this.config.soul)
    // 2 agent instructions
    parts.push(`# YOU ARE ${this.name}\n${this.config.role ?? ""}`)
    // 3 context: every artifact it holds, in its artifact order (buildAgent: least-changing first, the board last)
    // A refresh that failed (refreshArtifacts) is one line under its block: the state shown is the last one read.
    for (const a of this.artifacts) parts.push(`# ${a.id} — ${a.title}\n${a.render(this)}${this.refreshFailed.has(a.id) ? `\n(refresh failed: ${this.refreshFailed.get(a.id)} — this is its last state)` : ""}`)
    // 4 quest: the request, and the owner's note right under it while one waits (guidance amends the quest)
    parts.push(request ? `# REQUEST (from ${request.from})\n${request.text}` : "# REQUEST\n(idle: no run in progress)")
    if (this.guidance.length) parts.push(`# OWNER GUIDANCE\nArrived during this run. Act on it now; it shows once, so say in your thought what you change.\n${this.guidance.map((g) => `> ${g.from}: ${g.text}`).join("\n")}`)
    // 5 history: earlier runs, then this run's steps (newest last)
    const past = this.current?.historyFolded && !chat ? [] : this.history.slice(-this.config.historyKeep) // folded into the run's summary step
    if (past.length) parts.push(`# EARLIER RUNS\nYour last answers: their numbers are from then — confirm them with this run's tools before you use them.\n${past.map((h) => `> ${h.from}: ${clip(h.request, CLIP_HISTORY)}\n< ${clip(h.answer, CLIP_HISTORY)}`).join("\n")}`)
    if (steps.length) {
      const last = steps.length - 2
      const done = steps.map((s, i) => `step ${i + 1}: ${s.thought}\n${s.results.map((r) => `  ${r.tool} → ${r.ok ? "" : "ERROR "}${i < last && this.tools.get(r.tool)?.type !== "agent" ? clipOld(r.output, CLIP_OLD_STEP) : r.output}`).join("\n")}`)
      parts.push(`# WORK DONE ON THIS REQUEST\nYour steps so far and their results (newest last): read them before you call again.\n${done.join("\n")}`)
    }
    // 6 tools
    if (this.tools.size) {
      const brief = [...this.tools.values()].some((t) => t.type === "agent") ? `Agents take a brief: ${Object.entries(QUEST_INPUT).map(([k, v]) => `${k} = ${v}`).join("; ")}.\n` : ""
      parts.push(`# TOOLS\n${brief}${[...this.tools.values()].map((t) => t.describe()).join("\n")}`)
    }
    // 7 the owner's chat (Agent.chat): the earlier exchanges, the owner's words, the chat's format — never a run's
    if (chat) {
      const past = this.chats.slice(-CHAT_SHOWN).map((c) => `> ${c.from}: ${clip(c.text, CLIP_CHAT)}\n< ${clip(c.answer, CLIP_CHAT)}`)
      const now = typeof chat === "object" && chat.text ? [`> ${chat.from ?? "owner"}: ${chat.text}`] : []
      parts.push(`# OWNER CHAT\nThe owner talks with you outside your runs (newest last): answer the last message.\n${[...past, ...now].join("\n")}`)
      parts.push(`# RESPONSE\n${CHAT_FORMAT}`)
      return parts.join("\n\n")
    }
    // 7 response format, last: config.system replaces it whole
    parts.push(this.config.system ? `# SYSTEM\n${this.config.system}` : `# RESPONSE\n${RESPONSE_FORMAT}${this.config.report ? `\n${REPORT_FORMAT}` : ""}`)
    return parts.join("\n\n")
  }

  // Reasons to refuse a final answer: open checklist items, a report missing fields, no tool called yet
  // (config.minCalls: an agent that works from data answers only after its tools ran — 2026-10-15: a
  // model replied "no tool access" and answered from the brief's numbers).
  gates(answer, steps = []) {
    return this.#gates(answer, steps).reasons
  }

  // The reasons as text, and hard: an artifact's gate() returns a reason (text) or {reason, hard: true} — a hard one
  // refuses the answer however often it comes and never counts toward gateRetries; the run still ends at maxSteps
  // (2026-10-17 critic: the dispatch gate gave way after two refusals and the lead's jobs outlived its run).
  #gates(answer, steps = []) {
    const reasons = []
    let hard = false
    for (const a of this.artifacts) {
      const got = a.gate?.(this, answer)
      const reason = got && typeof got === "object" ? String(got.reason ?? "").trim() : got ? String(got) : ""
      if (!reason) continue
      reasons.push(reason)
      if (typeof got === "object" && got.hard) hard = true
    }
    const ran = steps.reduce((n, s) => n + (s.calls?.length ?? 0), 0)
    if (this.config.minCalls && ran < this.config.minCalls) reasons.push(`no tool called yet: your tools are listed under # TOOLS — call them ("call:" lines) and answer from their results`)
    if (this.config.report) {
      const missing = checkReport(answer)
      if (missing.length) reasons.push(`report missing ${missing.join(", ")} — answer in the REPORT format`)
    }
    return { reasons, hard }
  }

  // ---- owner guidance -------------------------------------------------------------------------

  // A note for the run in progress (the owner from the Live page, the agent page, home or Telegram): the next step's prompt shows
  // it under # OWNER GUIDANCE, then it is gone — the step that read it carries it in its thought. Only while a run
  // is in progress (false otherwise: there is nothing to guide, a message is new work).
  guide(text, from = "owner") {
    const note = String(text ?? "").trim()
    if (!note) throw new Error("guidance needs text")
    if (this.status !== "running") return false
    this.guidance.push({ from, text: note, at: Date.now() })
    this.emit("guide", { from, text: note })
    return true
  }

  // Guidance not yet read, with a step left to read it in.
  #guided(n) {
    return this.guidance.length > 0 && n < this.config.maxSteps
  }

  // ---- the owner's chat -----------------------------------------------------------------------

  // One model call outside the run queue: never waits for, blocks or changes the run in progress, except the reply's
  // last line `GUIDE: <note>` while it runs (this.guide: guided true); `QUEUE: <request>` — or GUIDE with no run in
  // progress — comes back as proposed (2026-10-17 critic: nothing starts a run from a chat — the owner does, with one
  // click). Only the reply's own last line acts (parseChat); it leaves the answer. Kept in this.chats (≤ CHAT_KEEP),
  // never in a run's prompt. Emits chat {from, text, answer, guided, proposed, ms, prompt_chars, reply_chars}; a model
  // call that throws rejects, without the event. Two chats may run at once; stop() ends every chat in flight: it
  // rejects "stopped", without the event, and a GUIDE it carried is never delivered.
  async chat(text, { from = "owner" } = {}) {
    const said = String(text ?? "").trim()
    if (!said) throw new Error("a chat needs text")
    const controller = new AbortController()
    this.#chats.set(controller, { from, text: said, at: Date.now() })
    try {
      await this.refreshArtifacts()
      if (controller.signal.aborted) throw new Error("stopped")
      const run = this.current
      const prompt = this.render(run?.request ?? null, run?.steps ?? [], { chat: { from, text: said } })
      const t0 = Date.now()
      const raw = await this.#infer(prompt, controller.signal)
      if (controller.signal.aborted) throw new Error("stopped") // stopped as the reply came: it acts on nothing
      const ms = Date.now() - t0
      const reply = String(raw ?? "")
      const parsed = parseChat(reply)
      const { action, note } = parsed
      const { answer, visual, visualError } = chatVisual(parsed.answer)
      const guided = action === "GUIDE" ? this.guide(note, from) : false // false: no run in progress any more
      const proposed = action === "QUEUE" || (action === "GUIDE" && !guided) ? note : null
      this.chats.push({ from, text: said, answer, at: Date.now() })
      if (this.chats.length > CHAT_KEEP) this.chats.splice(0, this.chats.length - CHAT_KEEP)
      const out = { answer, ...(visual ? { visual } : {}), ...(visualError ? { visualError } : {}), guided, proposed, ms, prompt_chars: prompt.length, reply_chars: reply.length }
      this.emit("chat", { from, text: said, ...out })
      return out
    } finally {
      this.#chats.delete(controller)
    }
  }

  // The chats in flight, oldest first: [{from, text, at}] (the host lists them as work the owner can stop).
  get chatting() {
    return [...this.#chats.values()].map((c) => ({ ...c }))
  }

  // ---- stop -----------------------------------------------------------------------------------

  // Every run of this agent — the one in progress and each queued behind it, whoever started it (the host, a lead's
  // quest, a dispatch) — ends with "stopped": the running one at its next step boundary (its model call in flight is
  // not waited for), a queued one when its turn comes, without a model call. Every chat in flight ends "stopped" at
  // once (its reply, when it comes, is dropped). → how many runs and chats it stopped. reason: the abort's
  // (ctx.signal.reason for a tool that honours the signal).
  stop(reason = "stopped by the owner") {
    let n = 0
    for (const c of [...this.#runs, ...this.#chats.keys()])
      if (!c.signal.aborted) {
        c.abort(reason)
        n++
      }
    return n
  }

  // A run accepted and not ended — in progress, or queued and not started yet (its status not "running" yet):
  // Desk.dismiss waits for it.
  get busy() {
    return this.#runs.size > 0
  }

  // ---- the loop -------------------------------------------------------------------------------

  // outside: the caller's run's outside reads (a quest's, a dispatched job's): this run starts tainted with them and
  // hands its own back when it ends (readsOutside above).
  async ask(text, { from = "owner", signal, outside = null } = {}) {
    // Each run its own controller, linked to the signal it was asked with (the host's, the caller's run): either
    // aborts it, and stop() reaches every run however it was started.
    const controller = new AbortController()
    const link = () => controller.abort(signal.reason)
    if (signal?.aborted) controller.abort(signal.reason)
    else signal?.addEventListener?.("abort", link, { once: true })
    this.#runs.add(controller)
    // One run at a time per agent: later quests queue behind the current one.
    const prev = this.queue ?? Promise.resolve()
    const run = prev
      .catch(() => {})
      .then(() => this.#run({ text, from }, controller.signal, outside))
      .finally(() => {
        this.#runs.delete(controller)
        signal?.removeEventListener?.("abort", link)
      })
    this.queue = run
    return run
  }

  // The model call of a step, raced with the run's signal: a stop does not wait for a reply that may take minutes
  // (the reply, when it comes, is dropped). The signal also rides the call's options (2026-10-21: a stopped trading run
  // left its Claude CLI running up to 15 min): an infer that takes it (`infer(prompt, agent, {signal})`) ends the
  // request itself; images ride beside it (`{images, signal}`).
  #infer(prompt, signal, images = []) {
    if (signal?.aborted) return Promise.reject(new Error("stopped"))
    let reply
    try {
      const options = { ...(images.length ? { images } : {}), ...(signal ? { signal } : {}) }
      reply = Promise.resolve(Object.keys(options).length ? this.infer(prompt, this, options) : this.infer(prompt, this))
    } catch (error) {
      reply = Promise.reject(error)
    }
    if (!signal) return reply
    return new Promise((resolve, reject) => {
      const stopped = () => reject(new Error("stopped"))
      signal.addEventListener("abort", stopped, { once: true })
      if (signal.aborted) stopped() // stopped from inside the call itself
      reply.then(resolve, reject).finally(() => signal.removeEventListener("abort", stopped))
    })
  }

  // The prompt budget in chars: config.contextChars, else by the model's name (contextBudget).
  get budget() {
    return Number(this.config.contextChars) > 0 ? Number(this.config.contextChars) : contextBudget(this.config.model)
  }

  // The prompt reached COMPACT_AT of the budget: the run's steps but the newest COMPACT_KEEP, and its EARLIER RUNS, fold
  // into one summary step (tool `compact`) — one model call writes it; one that fails (not a stop) gives the code-side
  // fold. The request and the owner's guidance stay as they are. Nothing to fold (two steps, no history): the prompt
  // goes as it is, without the event. → the prompt to send. Emits compact {n, before_chars, after_chars, budget,
  // steps_folded, runs_folded, mode: model | clip, ms, prompt_chars, reply_chars, error?}.
  async #compact(request, steps, prompt, signal, n) {
    const folded = Math.max(0, steps.length - COMPACT_KEEP)
    const past = this.current?.historyFolded ? [] : this.history.slice(-this.config.historyKeep)
    if (!folded && !past.length) return prompt
    const old = steps.slice(0, folded)
    const t0 = Date.now()
    let summary = null
    let error = null
    let ask = ""
    let raw = ""
    try {
      // the summary call itself stays under the budget: the folded work clipped to 60% of it
      const whole = old.map((s, i) => `step ${i + 1}: ${s.thought ?? ""}\n${(s.results ?? []).map((r) => `  ${r.tool} → ${r.ok ? "" : "ERROR "}${r.output}`).join("\n")}`).join("\n")
      const work = clipEnds(whole.length < this.budget * 0.6 ? whole : foldText(old, []), Math.floor(this.budget * 0.6))
      const runs = past.map((h) => `> ${h.from}: ${clip(h.request, CLIP_HISTORY)}\n< ${clip(h.answer, CLIP_HISTORY)}`).join("\n")
      ask = `# COMPACT\n${COMPACT_PROMPT}\n\n# REQUEST (from ${request.from})\n${request.text}${runs ? `\n\n# EARLIER RUNS\n${runs}` : ""}\n\n# WORK TO COMPRESS\n${work}`
      raw = String((await this.#infer(ask, signal)) ?? "")
      summary = raw.trim() || null
      if (!summary) error = "empty summary"
    } catch (e) {
      if (signal?.aborted || e.message === "stopped") throw e
      error = e.message
    }
    const mode = summary ? "model" : "clip"
    const text = clip(summary ?? foldText(old, past), CLIP_COMPACT)
    const label = [folded ? `steps 1–${folded}` : "", past.length ? `${past.length} earlier run${past.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")
    steps.splice(0, folded, { thought: `(compacted: ${label} summarized to keep the prompt under its budget)`, results: [{ tool: "compact", ok: true, output: text }], compacted: { steps: folded, runs: past.length } })
    if (this.current && past.length) this.current.historyFolded = true
    const after = this.render(request, steps)
    this.emit("compact", { n, before_chars: prompt.length, after_chars: after.length, budget: this.budget, steps_folded: folded, runs_folded: past.length, mode, ms: Date.now() - t0, ...(mode === "model" ? { prompt_chars: ask.length, reply_chars: raw.length } : {}), ...(error ? { error } : {}) })
    return after
  }

  async #run(request, signal, caller = null) {
    this.status = "running"
    // A run stopped while it waited (queued behind another) still shows as a run that ended "stopped" — start, then
    // error, no model call — but never resets its artifacts (a checklist's run start).
    if (!signal?.aborted) for (const a of this.artifacts) a.onRunStart?.(this, request)
    this.emit("start", { request })
    const steps = []
    const inherited = new Set(caller ?? [])
    const outside = new Set(inherited) // what this run read from outside, and what its caller had read before it asked
    this.current = { request, steps, outside }
    this.reported = new Set() // the agents that answered a quest of this run (AgentTool `after`)
    const seen = new Map() // "tool input" of this run's data calls → the step that made it
    let refused = 0
    try {
      for (let n = 1; n <= this.config.maxSteps; n++) {
        if (signal?.aborted) throw new Error("stopped")
        await this.refreshArtifacts() // host-backed artifacts read fresh state before the prompt renders
        if (signal?.aborted) throw new Error("stopped")
        const shown = this.guidance.length // the notes this prompt shows: read once the model replies
        let prompt = this.render(request, steps)
        if (prompt.length >= this.budget * COMPACT_AT) prompt = await this.#compact(request, steps, prompt, signal, n)
        const images = await this.collectImages()
        if (signal?.aborted) throw new Error("stopped")
        this.emit("think", { n })
        const t0 = Date.now()
        const raw = await this.#infer(prompt, signal, images)
        this.guidance.splice(0, shown)
        const reply = parseReply(raw)
        // ms, prompt_chars, reply_chars: the model call behind this step (the UI's stats per agent); images: what the
        // model saw with it (refs only — the UI shows each screenshot; never the data).
        const looked = images.length ? { images: images.map((i) => ({ caption: i.caption ?? "", ...(i.ref ?? {}) })) } : {}
        this.emit("step", { n, thought: reply.thought, calls: reply.calls, answer: reply.answer, ms: Date.now() - t0, prompt_chars: prompt.length, reply_chars: String(raw ?? "").length, ...looked })
        if (reply.answer != null && !reply.calls.length) {
          const answer = String(reply.answer)
          if (this.#guided(n)) {
            steps.push({ thought: reply.thought || "answer", results: [{ tool: "guide", ok: false, output: HELD }] })
            this.emit("gate", { reasons: ["owner guidance arrived while it answered"], held: true })
            continue
          }
          const { reasons, hard } = this.#gates(answer, steps)
          if (!reasons.length) return this.#finish(request, answer, [], steps)
          // A hard reason refuses without spending a retry (the run still ends at maxSteps); the rest count.
          if (hard || refused++ < this.config.gateRetries) {
            this.emit("gate", { reasons })
            steps.push({ thought: reply.thought || "answer", results: [{ tool: "gate", ok: false, output: `answer refused: ${reasons.join("; ")}` }] })
            continue
          }
          return this.#finish(request, answer, reasons, steps)
        }
        if (!reply.calls.length) {
          steps.push({ thought: reply.thought || "(no calls, no answer)", results: [{ tool: "format", ok: false, output: "give calls or an answer" }] })
          this.emit("format", { note: "no calls and no answer" })
          continue
        }
        const results = await Promise.all(reply.calls.map((c, index) => this.#call(c, signal, seen, n, index, outside)))
        steps.push({ thought: reply.thought, calls: reply.calls, results })
        // An answer beside calls (2026-10-15 market and focus sims: board write + answer in one reply, the
        // answer dropped). Beside artifact commands only, all ok, it is final once the gates pass; beside a
        // data or agent call it was written before their results, so it is not taken and the model is told why.
        if (reply.answer != null) {
          const commandsOnly = reply.calls.every((c) => this.tools.get(c.tool)?.type === "artifact") && results.every((r) => r.ok)
          const answer = String(reply.answer)
          const reasons = commandsOnly ? this.gates(answer, steps) : []
          const held = commandsOnly && !reasons.length && this.#guided(n)
          if (commandsOnly && !reasons.length && !held) return this.#finish(request, answer, [], steps)
          results.push({ tool: "format", ok: false, output: held ? HELD : commandsOnly ? `answer refused: ${reasons.join("; ")}` : "answer not taken: it came with calls whose results you had not read — read them above, then answer alone (no calls)" })
          if (held) this.emit("gate", { reasons: ["owner guidance arrived while it answered"], held: true })
          else this.emit(commandsOnly ? "gate" : "format", commandsOnly ? { reasons } : { note: "answer beside data or agent calls" })
        }
      }
      return this.#finish(request, `(stopped after ${this.config.maxSteps} steps without an answer)`, [], steps)
    } catch (error) {
      this.status = "error"
      this.current = null
      this.guidance = [] // a note for a run that failed or was stopped goes with it
      this.emit("error", { error: error.message })
      throw error
    } finally {
      // the reads this run made itself go back to the caller (its report, or what it wrote, may carry them)
      if (caller) for (const x of outside) if (!inherited.has(x)) caller.add(`${this.name}: ${x}`)
    }
  }

  // index: the call's place in its step (reply.calls). The step's calls run together and their results arrive in any
  // order, so `call` and `result` both carry it, and `result` its input: the host pairs a result with its own call by
  // index, never by tool name (2026-10-17: two quote calls in one step showed each other's inputs).
  async #call({ tool, input }, signal, seen = null, n = 0, index = 0, outside = null) {
    // A member called with its own team's prefix is that member (resolveTool). `call` and `result` name the member
    // that ran; the step's `calls` keep the name as written.
    tool = this.resolveTool(tool)
    const t = this.tools.get(tool)
    this.emit("call", { tool, input, index })
    let result
    // The same data call twice in one run answers nothing new (2026-10-15: tape and breadth re-sent one
    // batch 3–6 times); its result is in WORK DONE. Agents, artifact commands and gates are not data calls.
    const key = seen && t && (t.type === "function" || t.type === "mcp") ? `${tool} ${JSON.stringify(input ?? {})}` : null
    const prior = key ? seen.get(key) : null
    if (prior && Date.now() - prior.at < REPEAT_MS) result = { tool, ok: true, output: `same call as step ${prior.n}: its result is above — use it, do not call it again` }
    else if (!t && this.artifacts.some((a) => a.id === tool)) {
      // An artifact called by name is read: its current state, as the prompt shows it (2026-10-15: the
      // grader and outlook reached for desk.predictions / desk.calibration as tools).
      const a = this.artifacts.find((x) => x.id === tool)
      result = { tool, ok: true, output: `${tool} (an artifact: the same view is in your prompt, no need to call it)\n${a.render(this)}` }
    } else if (!t) result = { tool, ok: false, output: this.#missing(tool) }
    else {
      try {
        const out = await t.run(input ?? {}, { ...this.context, agent: this, signal, outside })
        result = { tool, ok: true, output: typeof out === "string" ? out : JSON.stringify(out) }
      } catch (error) {
        result = { tool, ok: false, output: error.message }
      }
    }
    if (key && result.ok && !(prior && Date.now() - prior.at < REPEAT_MS)) seen.set(key, { n, at: Date.now() })
    // marked once its result is in: a call beside it in the same step was written before that text was seen
    if (t && outside && readsOutside(tool, t)) outside.add(tool)
    if (t?.type === "agent" && result.ok) this.reported?.add(tool)
    this.emit("result", { ...result, input: input ?? {}, index })
    return result
  }

  // The tool a call runs, from the name the model wrote: the name itself, or a member written with the prefix of the
  // team this agent leads ("market.macro" for macro in team market) — the slip cost a step (2026-10-16: the market
  // lead prefixed all four of its members). The team is the board's (desk.js: spec.team ?? the lead's name), else the
  // config's. One helper for the kernel and the host (kernel-team.js draws a step's calls by it). Anything else stays
  // as written and fails as a missing tool (2026-10-17: any prefix resolved, so "nonsense.scout" ran scout).
  resolveTool(name) {
    if (this.tools.has(name)) return name
    const written = String(name ?? "")
    const dot = written.lastIndexOf(".")
    const team = this.board?.team ?? this.config.team ?? this.name
    const member = written.slice(dot + 1)
    return dot > 0 && written.slice(0, dot) === team && this.tools.get(member)?.type === "agent" ? member : name
  }

  // A call to a name that is neither a tool nor an artifact.
  #missing(name) {
    return `no tool ${name}; have ${[...this.tools.keys()].join(", ")}`
  }

  // flags: gate reasons still open when the answer went through anyway; steps: the run's work, for
  // transcripts (each {thought, calls, results}).
  #finish(request, answer, flags = [], steps = []) {
    this.history.push({ from: request.from, request: request.text, answer })
    this.status = "idle"
    this.current = null
    this.guidance = [] // left only when the run ran out of steps
    this.emit("answer", { request, answer, flags, steps })
    return answer
  }
}
