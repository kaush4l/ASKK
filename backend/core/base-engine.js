// BaseEngine — the abstract agent. A live object composed of elements that
// render into the prompt sent to the LLM, built from an agent.md definition.
// Subclasses supply the strategy by implementing run(); everything else —
// elements, rendering, model, inference with metrics, tools, memory,
// summarizing, lifecycle — is shared here.
//
// Elements (in prompt order — see template.js):
//   soul          who the agent is in every role (agents/soul.md or its own)
//   instructions  its role: the hat for this work (agent.md body + skills)
//   context       current time
//   history       the engine's message state
//   tools         declared tools + other agents exposed as tools
//   response      structured response format (`responseModel`)
//   request       the current user message
//
// Lifecycle (`status`):  created --init()--> idle <--> running --dispose()--> disposed
//                                              \-> error (next ask() recovers)
//
// State is an immutable snapshot replaced on every change, so React (or the
// worker bridge, runtime/engine-worker.js) can subscribe to it.
//
// Ported from LocalAgents core/engine.py (`BaseAgent`); template order from askk.

import { IDLE } from "@/backend/core/activity"
import { Memory, serializeMemory } from "@/backend/core/memory"
import { ReActResponse } from "@/backend/core/responses"
import { createSummarizer } from "@/backend/core/single-call"
import { formatContext, formatRequest, formatRole, formatSoul, renderPrompt, renderTemplate } from "@/backend/core/template"
import { formatLog } from "@/backend/core/log"
import { AgentTool, Tool } from "@/backend/core/tool"
import { parseToolPlan } from "@/backend/core/tool-plan"
import { createArtifacts, createTools, loadMcpTools } from "@/backend/features"
import { missingModelMessage, resolveModel } from "@/backend/models/catalog"
import { complete, contextWindow } from "@/backend/models/llm"
import { TokenMeter } from "@/backend/models/metrics"
import { readFile, writeFile } from "@/backend/platform/storage"

// Summarize automatically once a prompt reaches this share of the context window.
const AUTO_SUMMARIZE_AT = 0.92
// A failed model call is tried again this many times (after 15 s, then 30 s).
const MODEL_RETRIES = 2
const RETRY_WAIT_MS = 15 * 1000
// Every agent's context is capped (tokens): the model's window when smaller,
// else this. Also the window when the model's is unknown (the local CLIs), so
// auto-summarize always has a limit. agent.md `context_window` or
// ASKK_CONTEXT_CAP (.env, server and headless) overrides it.
const CONTEXT_CAP = 262144

function contextCap(agent) {
  const own = Number(agent?.context_window)
  if (own > 0) return own
  const env = Number(globalThis.process?.env?.ASKK_CONTEXT_CAP)
  return env > 0 ? env : CONTEXT_CAP
}
// Steps per letter (agent.md `max_steps`) and rounds of quests per origin
// (`max_rounds`): unlimited unless set. Long-running work is kept on track by
// status checks instead (runtime/supervisor.js → status letters to the lead).
const limit = (value) => (Number(value) > 0 ? Number(value) : Infinity)
// Most tool calls one response may make (all stages together).
const MAX_CALLS_PER_STEP = 16

let engineCount = 0

// "string", "string[]", … for one input schema.
const typeLabel = (schema) =>
  schema.type === "array" && schema.items?.type ? `${schema.items.type}[]` : (schema.type ?? "value")

// `name({"a": "<string>", "b?": …})` from a tool's input schema.
function toolUsage(tool) {
  const properties = tool.inputs?.properties ?? {}
  const required = new Set(tool.inputs?.required ?? [])
  const args = Object.entries(properties).map(
    ([key, schema]) => `"${key}": <${typeLabel(schema)}${required.has(key) ? "" : ", optional"}>`
  )
  return `${tool.name}({${args.join(", ")}})`
}

// Plain text of a parsed response, for display and history.
function responseText(parsed) {
  const value = parsed.response
  if (Array.isArray(value)) return value.join("\n")
  const text = (field) => (Array.isArray(field) ? field.join("\n") : String(field ?? ""))
  return text(value) || text(parsed.decision) || text(parsed.thinking) || text(parsed.observation)
}

const clip = (text, size) =>
  text.length <= size ? text : `${text.slice(0, size / 2)}\n[… clipped …]\n${text.slice(-size / 2)}`

// Shorten long entries proportionally so the summarizer's own prompt fits in
// the context window (leaving room for its instructions and reply).
function fitLog(log, window) {
  const textOf = (m) => (m.role === "tool" ? (m.output ?? "") : (m.content ?? ""))
  const total = log.reduce((sum, m) => sum + textOf(m).length, 0)
  const budget = window ? window * 4 * 0.6 : Infinity // ~4 characters per token
  if (total <= budget) return log
  const share = budget / total
  return log.map((m) => {
    const size = Math.max(400, Math.floor(textOf(m).length * share))
    return m.role === "tool" ? { ...m, output: clip(textOf(m), size) } : { ...m, content: clip(textOf(m), size) }
  })
}

// Tool inputs as shown while a call runs (activity.calls): long strings cut,
// the full inputs land on the tool message when the call ends.
const LIVE_INPUT_CHARS = 20000
const LIVE_PROGRESS_CHARS = 4000 // a streaming call's live output kept in state (its tail; every patch re-sends it to every tab)
const LIVE_PROGRESS_MS = 100 // progress reaches the state at most ten times a second
function clipInputs(inputs) {
  if (!inputs || typeof inputs !== "object") return inputs ?? null
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, typeof value === "string" && value.length > LIVE_INPUT_CHARS ? `${value.slice(0, LIVE_INPUT_CHARS)}…` : value])
  )
}


// A long text as its start and a marker (letters that repeat what history already holds).
const clipText = (text, max) => (text && text.length > max ? `${text.slice(0, max)}… (${text.length - max} more chars, in your history)` : text)
export class BaseEngine {
  #listeners = new Set()
  #controller = null
  #messageCount = 0
  // Characters per token for this model, calibrated from server usage counts.
  #charsPerToken = 4
  // `revision` bumps on reconfigure() so subscribers re-read definition fields.
  // `memoryError` is set while the memory file cannot be saved or read.
  // `stats` are the token metrics of the latest LLM call (models/metrics.js);
  // `contextWindow` is the model's window in tokens (null = unknown).
  #state = {
    status: "created",
    activity: IDLE,
    messages: [],
    error: null,
    revision: 0,
    memoryError: null,
    stats: null,
    contextWindow: null,
    approvals: [], // tool calls waiting for the owner: [{ id, tool, inputs }]
    artifacts: {}, // artifact state by type, e.g. { filesystem: { open: [...] } }
    live: {}, // artifact UI snapshots by type (publishLive): { title, view, data, version, at }
    inbox: [], // letters waiting their turn: [{ id, kind, from, preview }]
    quests: [], // quests this engine handed out, report not back: [{ id, to, text, at }]
    // The letter being worked on, for the supervisor: { id, kind, quest,
    // replyTo, from, request (message id), at } | null
    working: null,
  }
  #approvalWaits = new Map() // approval id -> resolve(ok)
  #approvalCount = 0
  #declined = new Set() // calls the owner declined during the current request
  #request = null // the user message being worked on (splits history from progress)
  #toolContext = null // CONTEXT lines from the tools (Tool.context), once per definition
  // Inbox: every piece of work arrives as a letter, worked one at a time.
  #inbox = [] // [{ letter }] waiting
  #draining = false
  #letterCount = 0
  // Letter ids stay unique across restarts (the count starts again at 0): a
  // run is one origin id, and per-run state (the checklist) resets on a new one.
  #letterPrefix = `${Date.now().toString(36)}`
  #work = null // { letter, origin, controller } being worked on
  #origins = new Map() // origin letter id -> { resolve, reject } (ask())
  // Quests handed to other agents, by id: { id, to, toId, text, origin, batch, report }
  #quests = new Map()
  #questCount = 0
  #dispatched = 0 // quests handed out by the current letter
  #guidance = [] // guidance messages for the work in progress, added at its next step
  #activityBeforeApproval = null // restored when the last open approval is answered

  // directory: { describe(name) -> description,
  //              send({ name } | { id }, letter) -> Promise<engine id> }
  //   the other agents: their descriptions, and delivery to their inboxes.
  // getModel(key) -> model connection; defaults to the model catalogue.
  constructor({ agent, id = null, name = agent.name, directory = null, getModel = resolveModel, responseModel = ReActResponse }) {
    if (new.target === BaseEngine) throw new Error("BaseEngine is abstract; use a strategy such as ReActEngine.")
    engineCount += 1
    this.id = id ?? `engine-${engineCount}`
    this.name = name
    this.responseModel = responseModel
    this.directory = directory
    this.getModel = getModel
    this.memory = new Memory(name) // agents/<name>/memory.md in browser storage
    this.configure(agent)
  }

  // ── strategy (implemented by subclasses) ────────────────────────────────

  // Work on one request until there is an answer. `request` is the user
  // message already in state; return the final answer text, or throw.
  // eslint-disable-next-line no-unused-vars
  async run(text, request, signal) {
    throw new Error(`${this.constructor.name} does not implement run().`)
  }

  // ── definition ─────────────────────────────────────────────────────────

  // Build every element from an agent definition.
  configure(agent) {
    this.agent = agent
    this.description = agent.description
    this.maxSteps = limit(agent.max_steps)
    this.maxRounds = limit(agent.max_rounds)

    // Elements
    this.soul = agent.soul ?? ""
    this.instructions = this.#composeInstructions()
    // Artifacts keep their state across a reconfigure.
    const saved = Object.fromEntries((this.artifacts ?? []).map((a) => [a.type, a.state]))
    this.artifacts = createArtifacts(agent.artifacts ?? [], { engine: this, saved, onChange: () => this.#artifactsChanged() })
    // The FILESYSTEM artifact lists every file and shows opened ones (fs.open):
    // fs.read / fs.list would only put the same text in the prompt twice.
    const viaArtifact = agent.artifacts?.includes("filesystem") ? ["fs.read", "fs.list"] : []
    this.tools = [
      ...createTools((agent.tools ?? []).filter((name) => !viaArtifact.includes(name))),
      ...this.artifacts.flatMap((artifact) => artifact.commands()),
      ...(agent.agents ?? []).map(
        (name) =>
          new AgentTool({
            name,
            description: this.directory?.describe(name) ?? `Hand the ${name} agent a quest.`,
          })
      ),
      // quest.steer / quest.recall: for agents that hand out quests (to named
      // agents, or to sub-agents they create with the team artifact).
      ...(agent.agents?.length || agent.artifacts?.includes("team") ? this.#questTools() : []),
    ]
    this.toolsMap = new Map(this.tools.map((tool) => [tool.name, tool]))
    this.#toolContext = null // MCP tools are added with it (#describeTools)
    this.responseFormat = agent.response_format ?? "toon"

    // Static sections, rendered once per definition
    this.toolsInstructions = this.formatToolsInstructions()
    this.responseInstructions = this.responseModel.getInstructions(this.responseFormat)
  }

  // Apply an edited definition (or model) to this live engine. Message
  // history is kept; the next request renders with the new elements.
  reconfigure(agent = this.agent) {
    if (this.status === "disposed") return
    this.configure(agent)
    this.update({ revision: this.#state.revision + 1 })
    this.#loadContextWindow()
  }

  // The connection this engine calls: the catalogue entry named by the
  // agent's `model` key, else the default. null when the key is unknown.
  get model() {
    return this.getModel(this.agent.model)
  }

  async #loadContextWindow() {
    const model = this.model
    // `this.model` is resolved anew on every read: compare the connection.
    const current = () => {
      const now = this.model
      return this.status !== "disposed" && now?.key === model?.key && now?.id === model?.id
    }
    const cap = contextCap(this.agent)
    // The cap holds at once; a smaller window from the model's list lowers
    // it. A lookup that never answers (some local servers) leaves the cap.
    if (current()) this.update({ contextWindow: cap })
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 10000))
    const known = model ? await Promise.race([contextWindow(model).catch(() => null), timeout]) : null
    const window = Math.min(known ?? cap, cap)
    // Ignore a lookup that a newer model change has overtaken.
    if (current()) this.update({ contextWindow: window })
  }

  // agent.md body, then each declared skill.
  #composeInstructions() {
    const skills = Object.entries(this.agent.skills ?? {})
    if (!skills.length) return this.agent.instructions
    const skillsText = skills.map(([name, text]) => `### ${name}\n${text}`).join("\n\n")
    return `${this.agent.instructions}\n\n## SKILLS\n\n${skillsText}`
  }

  // ── state (arrow fields keep `this` bound for subscribers) ──────────────

  getSnapshot = () => this.#state

  subscribe = (listener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get state() {
    return this.#state
  }

  update(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  message(role, fields) {
    this.#messageCount += 1
    return { id: `${this.id}-m${this.#messageCount}`, role, content: "", at: new Date().toISOString(), ...fields }
  }

  push(message) {
    this.update({ messages: [...this.#state.messages, message] })
  }

  replaceLast(message) {
    this.update({ messages: [...this.#state.messages.slice(0, -1), message] })
  }

  // ── memory ─────────────────────────────────────────────────────────────

  // Save the message list to the memory file. Never throws; a failure is
  // recorded in state so the UI can show it.
  async persist() {
    try {
      await this.memory.save(this.#state.messages)
      if (this.#state.memoryError) this.update({ memoryError: null })
    } catch (error) {
      this.update({ memoryError: `Memory not saved: ${error.message}` })
    }
  }

  // Reload messages saved by a previous session (memory.md only).
  async restore() {
    try {
      await this.#restoreArtifacts()
      const saved = await this.memory.load()
      if (!saved.length || this.#state.messages.length) return
      const messages = saved.map((m) => this.message(m.role, { ...m, restored: true }))
      this.update({ messages })
    } catch (error) {
      this.update({ memoryError: `Memory not loaded: ${error.message}` })
    }
  }

  // Empty the message list and its memory file.
  async clearMemory() {
    if (this.status === "running") throw new Error(`${this.name} is busy.`)
    if (this.status === "disposed") return
    this.update({ messages: [], error: null, status: this.status === "error" ? "idle" : this.status })
    for (const artifact of this.artifacts) artifact.reset()
    await this.persist()
  }

  // ── artifacts ──────────────────────────────────────────────────────────

  // What artifacts say must still be done before a final answer (the
  // checklist): [{ id, text }]. Empty = the answer may stand.
  pendingChecks() {
    return (this.artifacts ?? []).flatMap((artifact) => artifact.pending?.() ?? [])
  }

  get #artifactsPath() {
    return `${this.memory.dir}/artifacts.json`
  }

  // Publish and save artifact state (agents/<engine>/artifacts.json).
  #artifactsChanged() {
    const artifacts = Object.fromEntries(this.artifacts.map((a) => [a.type, a.toJSON()]))
    this.update({ artifacts })
    this.publishLive()
    writeFile(this.#artifactsPath, JSON.stringify(artifacts, null, 2)).catch((error) =>
      this.update({ memoryError: `Artifacts not saved: ${error.message}` })
    )
  }

  async #restoreArtifacts() {
    if (!this.artifacts.length) return
    const text = await readFile(this.#artifactsPath)
    const saved = text ? JSON.parse(text) : {}
    for (const artifact of this.artifacts) {
      if (saved[artifact.type]) artifact.state = { ...artifact.initialState(), ...saved[artifact.type] }
    }
    this.update({ artifacts: Object.fromEntries(this.artifacts.map((a) => [a.type, a.toJSON()])) })
    this.refreshArtifacts().catch(() => {}) // their live views, before the first step
  }

  // Bring every artifact up to date with its source (before each render).
  async refreshArtifacts() {
    await Promise.all(this.artifacts.map((artifact) => artifact.refresh()))
    this.publishLive()
  }

  // Each artifact's UI snapshot (Artifact.live()) into state.live[type] =
  // { title, view, data, version, at }, only when it changed: an update
  // event for every view that follows the engine (Live follow).
  #liveSeen = new Map() // type -> JSON of its last published snapshot
  publishLive() {
    let changed = null
    for (const artifact of this.artifacts ?? []) {
      let snapshot = null
      try {
        snapshot = artifact.live()
      } catch {
        snapshot = null
      }
      if (!snapshot) continue
      const json = JSON.stringify(snapshot)
      if (this.#liveSeen.get(artifact.type) === json) continue
      this.#liveSeen.set(artifact.type, json)
      const before = this.#state.live?.[artifact.type]
      changed ??= { ...(this.#state.live ?? {}) }
      changed[artifact.type] = { title: artifact.constructor.title, ...snapshot, version: (before?.version ?? 0) + 1, at: new Date().toISOString() }
    }
    if (changed) this.update({ live: changed })
  }

  formatArtifacts() {
    const parts = this.artifacts.map((artifact) => artifact.render()).filter(Boolean)
    if (!parts.length) return ""
    return `## ARTIFACTS\n\nLive objects in their latest state (not a log of changes).\n\n${parts.join("\n\n")}`
  }

  // Summarize `log` with a single-call summarizer agent, then move the log
  // into a new history file. Returns the summary message to put in its
  // place. Throws on failure; nothing is changed until it succeeds.
  async summarize(log, { summarizer = createSummarizer(), signal } = {}) {
    const model = this.model
    if (!model) throw new Error(missingModelMessage(this.agent.model))
    const input = serializeMemory(this.name, fitLog(log, this.#state.contextWindow))
    const { parsed } = await summarizer.call(input, { model, signal })
    const summary = String(parsed.response ?? "").trim()
    if (!summary) throw new Error("The summarizer returned an empty summary.")
    const archive = await this.memory.archive(log)
    return this.message("summary", { content: summary, count: log.length, archive })
  }

  // Replace the whole log with one summary; the log moves to a history file.
  // The log is untouched if summarizing fails or is stopped.
  async summarizeMemory({ summarizer } = {}) {
    if (this.status === "running") throw new Error(`${this.name} is busy.`)
    if (this.status === "disposed") return
    const log = this.#state.messages.filter((m) => m.content || m.output)
    if (!log.length) return

    const controller = new AbortController()
    this.#controller = controller
    this.update({ status: "running", error: null, activity: { phase: "summarizing" } })
    try {
      const summary = await this.summarize(log, { summarizer, signal: controller.signal })
      this.update({ messages: [summary], status: "idle", activity: IDLE, stats: null })
      await this.persist()
      return summary.content
    } catch (error) {
      if (this.status === "disposed") throw error
      const aborted = error.name === "AbortError"
      this.update({
        status: aborted ? "idle" : "error",
        activity: IDLE,
        error: aborted ? null : `Summarize failed: ${error.message}`,
      })
      throw error
    } finally {
      if (this.#controller === controller) this.#controller = null
      this.#drain() // letters that arrived meanwhile
    }
  }

  // Before an LLM step: when the prompt would fill AUTO_SUMMARIZE_AT of the
  // context window, summarize everything except the current request, which
  // stays after the summary.
  async autoSummarize(text, request, signal) {
    const window = this.#state.contextWindow
    if (!window) return
    const history = this.#state.messages.filter((m) => m !== request)
    const log = history.filter((m) => m.content || m.output)
    if (log.length < 2) return
    const tokens = (chars) => Math.ceil(chars / this.#charsPerToken)
    const used = tokens(this.render(text, history).length)
    if (used / window < AUTO_SUMMARIZE_AT) return
    // Summarizing cannot help when the fixed elements fill the window.
    if (tokens(this.formatHistory(history).length) < window * 0.1) return

    this.update({ activity: { phase: "summarizing" } })
    let summary
    try {
      summary = await this.summarize(log, { signal })
    } catch (error) {
      if (error.name === "AbortError") throw error
      throw new Error(`Summarize failed (automatic, at ${Math.round((used / window) * 100)}% of context): ${error.message}`)
    }
    this.update({ messages: [summary, request], stats: null, activity: { phase: "llm", stage: "waiting" } })
    await this.persist()
  }

  // ── element formatting ─────────────────────────────────────────────────

  // Numbered log lines of messages (no heading).
  formatLog(messages) {
    return formatLog(messages)
  }

  // Earlier requests and their answers (finished turns).
  formatHistory(messages = this.#state.messages) {
    const log = this.formatLog(messages)
    return log ? `## CONVERSATION HISTORY (earlier requests, already answered)\n\n${log}` : ""
  }

  // `history` without the current request, split at it: finished turns
  // before, this request's steps and tool results after.
  splitHistory(history) {
    const at = this.#request ? this.#state.messages.indexOf(this.#request) : -1
    return at < 0 ? { earlier: history, progress: [] } : { earlier: history.slice(0, at), progress: history.slice(at) }
  }

  formatToolsInstructions(tools = this.tools) {
    if (!tools.length) return ""
    // One line per tool: its call signature, then what it does.
    const lines = tools.map((tool) =>
      tool.kind === "agent"
        ? `- ${tool.name}({"quest": <string>}) - Agent: ${tool.description}`
        : `- ${toolUsage(tool)} - ${tool.description}`
    )
    const agents = tools.some((tool) => tool.kind === "agent")
      ? "\n\nCalling an agent hands it a quest and ends your turn after this response; its report wakes " +
        "you (all reports together, when you hand out several at once). The agent sees only the quest, so " +
        "write it complete: the goal, the context it needs, constraints, what done looks like, and what to " +
        "report back."
      : ""
    return (
      "## AVAILABLE TOOLS\n\n" +
      lines.join("\n") +
      "\n\nCalls: one per line runs in order; parallel[call_a(...), call_b(...)] runs independent calls " +
      "together. After a failed call the rest are skipped. Results arrive in the next step." +
      agents +
      "\n"
    )
  }


  // ── prompt rendering ───────────────────────────────────────────────────

  // Every element, keyed by its template slot.
  elements(userInput, history) {
    const { earlier, progress } = this.splitHistory(history)
    return {
      soul: formatSoul(this.soul),
      instructions: formatRole(this.instructions),
      context: formatContext([...(this.#toolContext ?? []), ...this.#openQuestLines()]),
      history: this.formatHistory(earlier),
      artifacts: this.formatArtifacts(),
      tools: this.toolsInstructions,
      response: this.responseInstructions,
      request: formatRequest(userInput, this.formatLog(progress)),
    }
  }

  // Quests still out (e.g. while the owner writes in between), one line each.
  #openQuestLines() {
    const open = [...this.#quests.values()].filter((q) => !q.report)
    if (!open.length) return []
    const clip = (text) => (text.length > 160 ? `${text.slice(0, 160)}…` : text)
    return [
      "Quests you handed out, report not back yet (it wakes you when it is):",
      ...open.map((q) => `- ${q.to} (quest ${q.id}): ${clip(q.text)}`),
    ]
  }

  // CONTEXT lines the tools contribute (e.g. which workspace fs.* work on);
  // tools of one feature share one context() function, asked once. The
  // agent's MCP servers (`mcp:`) are listed here too, asynchronously, and
  // their tools join the engine's (once per definition).
  async #describeTools() {
    if (this.#toolContext) return
    const agent = this.agent
    const mcp = await loadMcpTools(agent.mcp ?? [])
    if (this.agent !== agent) return // reconfigured meanwhile; the next letter loads again
    const added = mcp.tools.filter((tool) => !this.toolsMap.has(tool.name))
    if (added.length) {
      this.tools = [...this.tools, ...added]
      this.toolsMap = new Map(this.tools.map((tool) => [tool.name, tool]))
      this.toolsInstructions = this.formatToolsInstructions()
    }
    const sources = [...new Set(this.tools.map((tool) => tool.context).filter(Boolean))]
    const lines = await Promise.all(sources.map((context) => Promise.resolve().then(context).catch(() => null)))
    this.#toolContext = [...lines.filter(Boolean), ...mcp.lines]
  }

  // Fill the template. The complete prompt is sent on every request.
  render(userInput, history) {
    return renderTemplate(this.elements(userInput, history))
  }

  // The prompt the next request would send now (debug view on the chat page).
  async preview(userInput = "") {
    await this.refreshArtifacts()
    return this.render(userInput, this.#state.messages)
  }

  // ── tool execution ─────────────────────────────────────────────────────

  // Every tool call in a response, as ordered stages (tool-plan.js).
  static parseToolPlan(response) {
    return parseToolPlan(response)
  }

  // Run a tool plan exactly as written: stages one after another, the calls
  // of a parallel stage started together and joined. Once a stage has a
  // failed call, later stages are skipped (they may depend on it). Pushes one
  // tool message per call, in written order. Returns whether all succeeded.
  async runTools(plan, signal) {
    const total = plan.flat().length
    if (total > MAX_CALLS_PER_STEP) {
      this.push(
        this.message("tool", {
          name: null,
          ok: false,
          output: `Too many tool calls in one response (${total}); the limit is ${MAX_CALLS_PER_STEP}.`,
          content: `Result: Error: too many tool calls (${total} > ${MAX_CALLS_PER_STEP})`,
        })
      )
      return false
    }

    let failed = null
    for (const [index, calls] of plan.entries()) {
      const stage = index + 1
      const parallel = calls.length > 1
      const kindOf = (name) => (this.toolsMap.get(name)?.kind === "agent" ? "agent" : "tool")
      const viewOf = (name) => this.toolsMap.get(name)?.view ?? null
      const result = (call, fields) =>
        this.message("tool", {
          name: call.name,
          kind: kindOf(call.name),
          view: viewOf(call.name),
          inputs: call.inputs,
          stage,
          parallel,
          ...fields,
          content: `Result: ${call.name}: ${fields.output}`,
        })

      if (failed) {
        for (const call of calls) {
          this.push(result(call, { ok: false, skipped: true, output: `Skipped: ${failed} failed earlier in this response.` }))
        }
        continue
      }

      const names = calls.map((c) => c.name)
      // calls: what is running now, for views that follow it live (Live follow);
      // a tool that streams adds its progress to its call while it runs.
      const running = calls.map((c) => ({ name: c.name, kind: kindOf(c.name), view: viewOf(c.name), streams: !!this.toolsMap.get(c.name)?.streams, inputs: clipInputs(c.inputs), progress: null }))
      const since = new Date().toISOString()
      this.update({ activity: { phase: parallel ? "tools" : kindOf(names[0]), name: names[0], names, calls: running, stage, since } })
      let publishing = null
      const publish = () => {
        publishing = null
        if (this.#state.activity?.since === since) this.update({ activity: { ...this.#state.activity, calls: running.map((c) => ({ ...c })) } })
      }
      const progressOf = (i) => (update) => {
        if (!update || typeof update !== "object") return
        const progress = { ...(running[i].progress ?? {}) }
        if (typeof update.append === "string") progress.text = `${progress.text ?? ""}${update.append}`.slice(-LIVE_PROGRESS_CHARS)
        if (typeof update.text === "string") progress.text = update.text.slice(-LIVE_PROGRESS_CHARS)
        if (update.data && typeof update.data === "object") progress.data = { ...(progress.data ?? {}), ...update.data }
        progress.at = new Date().toISOString()
        running[i].progress = progress
        publishing ??= setTimeout(publish, LIVE_PROGRESS_MS)
      }
      const outcomes = await Promise.all(calls.map((c, i) => this.executeTool(c.name, c.inputs, { signal, progress: progressOf(i) })))
      clearTimeout(publishing)
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      outcomes.forEach((outcome, i) => this.push(result(calls[i], outcome)))
      // What the calls changed (files, runs) shows in the artifacts' live views
      // now, not at the next step — only after a stage that could change them.
      const changing = calls.some((c) => {
        const tool = this.toolsMap.get(c.name)
        return tool?.effect === "write" || tool?.view === "file" || tool?.view === "terminal"
      })
      if (changing && this.artifacts?.some((a) => a.live() !== null)) await this.refreshArtifacts().catch(() => {})
      const bad = outcomes.findIndex((o) => !o.ok)
      if (bad !== -1) failed = calls[bad].name
    }
    return !failed
  }

  // Autopilot: one switch for every engine in this thread (the server's
  // team is one thread). On, a tool marked `approval` runs without asking
  // the owner. Set by the registry (setAutopilot); headless and the server
  // start from ASKK_AUTOPILOT in .env.
  static autopilot = /^(1|true|on|yes)$/i.test(globalThis.process?.env?.ASKK_AUTOPILOT ?? "")

  // Execute a tool by name. Never throws — returns { ok, output }.
  async executeTool(toolName, inputs, { signal, progress } = {}) {
    try {
      const tool = this.toolsMap.get(toolName)
      if (!tool) {
        const available = [...this.toolsMap.keys()].join(", ") || "none"
        throw new Error(`Tool not found. Available: ${available}`)
      }
      if (tool.approval && !BaseEngine.autopilot) {
        // A declined call is not asked again within the same request.
        const key = `${toolName} ${JSON.stringify(inputs)}`
        if (this.#declined.has(key) || !(await this.#requestApproval(tool, inputs, signal))) {
          if (!signal?.aborted) this.#declined.add(key)
          throw new Error(
            "The owner declined this call. Do not try it again or work around it; answer now and say it was not done."
          )
        }
      }
      const result = await tool.invoke(inputs, { engine: this, signal, progress: progress ?? (() => {}) })
      return { ok: true, output: typeof result === "string" ? result : JSON.stringify(result) }
    } catch (error) {
      return { ok: false, output: `Error executing ${toolName}: ${error.message}` }
    }
  }

  // ── approval ───────────────────────────────────────────────────────────

  // Wait for the owner to approve or decline one exact call (state
  // `approvals`, answered with resolveApproval). Aborting declines it.
  #requestApproval(tool, inputs, signal) {
    if (signal?.aborted) return Promise.resolve(false)
    const id = `approval-${++this.#approvalCount}`
    // The activity to go back to is the one before the FIRST open approval
    // (with overlapping approvals, a later one would restore "approval").
    if (!this.#state.approvals.length) this.#activityBeforeApproval = this.#state.activity
    this.update({
      approvals: [
        ...this.#state.approvals,
        { id, tool: tool.name, inputs, summary: tool.describe?.(inputs) ?? null, at: new Date().toISOString() },
      ],
      activity: { phase: "approval", name: tool.name },
    })
    return new Promise((resolve) => {
      const done = (ok) => {
        if (!this.#approvalWaits.has(id)) return
        this.#approvalWaits.delete(id)
        signal?.removeEventListener("abort", onAbort)
        const approvals = this.#state.approvals.filter((a) => a.id !== id)
        this.update({ approvals, ...(approvals.length ? {} : { activity: this.#activityBeforeApproval }) })
        resolve(ok)
      }
      const onAbort = () => done(false)
      this.#approvalWaits.set(id, done)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  resolveApproval(id, ok) {
    this.#approvalWaits.get(id)?.(!!ok)
  }

  // Guidance from the owner on the work in progress (Live follow's guide
  // box): added to that work at its next step, without stopping it. Returns
  // whether it reached running work; when idle, send a letter instead.
  guide(text, from = "owner") {
    const content = String(text ?? "").trim()
    if (!content) throw new Error("Empty guidance.")
    if (!this.#work || this.status !== "running") return { delivered: false }
    this.#guidance.push(this.message("user", { content, from, guidance: true }))
    return { delivered: true }
  }

  // ── inference ──────────────────────────────────────────────────────────

  // One LLM step: render with `history`, stream the reply into a new
  // assistant message (live activity: waiting → thinking → responding,
  // live token metrics), then parse it into the structured response.
  async step(text, history, step, signal) {
    // Guidance that arrived during the last step joins the work now.
    if (this.#guidance.length) {
      const guidance = this.#guidance.splice(0)
      this.update({ messages: [...this.#state.messages, ...guidance] })
      history = [...history, ...guidance]
    }
    // Memory is brought up to date before every render.
    await this.persist()
    const model = this.model
    if (!model) throw new Error(missingModelMessage(this.agent.model))
    await this.refreshArtifacts()
    const { text: prompt, breaks: cacheAt } = renderPrompt(this.elements(text, history))
    let reply = this.message("assistant", { prompt, raw: "", reasoning: "", structured: null, step })
    const meter = new TokenMeter({ prompt, contextWindow: this.#state.contextWindow })
    this.update({
      messages: [...this.#state.messages, reply],
      activity: { phase: "llm", stage: "waiting" },
      stats: meter.snapshot(),
    })

    let usage = null
    let fellBack = null
    try {
      // A model server can fail mid-answer for reasons that pass (a local GPU
      // hang, a dropped connection, a 5xx): try again, at most MODEL_RETRIES
      // times, from an empty reply. Stops and aborts are never retried.
      for (let attempt = 0; ; attempt++) {
        try {
          ;({ usage, fellBack } = await this.#complete(model, prompt, cacheAt, signal, meter, () => reply, (next) => (reply = next)))
          break
        } catch (error) {
          if (error.name === "AbortError" || signal?.aborted || attempt >= MODEL_RETRIES) throw error
          reply = { ...reply, raw: "", reasoning: "", retries: attempt + 1, lastError: error.message }
          this.update({ messages: [...this.#state.messages.slice(0, -1), reply], activity: { phase: "llm", stage: "waiting", retry: attempt + 1 } })
          await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS * (attempt + 1)))
          if (signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" })
        }
      }
      // The model failed before answering and its fallback answered: say so on the reply.
      if (fellBack) reply = { ...reply, model: model.backup.key ?? model.backup.id, fellBack }
    } finally {
      this.update({ stats: meter.finish(usage) })
      if (usage?.inputTokens > 0) this.#charsPerToken = prompt.length / usage.inputTokens
      // Keep whatever streamed, even when aborted or failed.
      if (reply.raw) {
        this.update({ activity: { phase: "parsing" } })
        const parsed = this.responseModel.fromRaw(reply.raw)
        reply = { ...reply, structured: parsed.toJSON(), action: parsed.action, content: responseText(parsed) }
        this.replaceLast(reply)
      }
    }
    return reply
  }

  // One model call for step(): streams into the reply (getReply/setReply keep
  // step's variable current) with live activity and token metrics.
  #complete(model, prompt, cacheAt, signal, meter, getReply, setReply) {
    return complete({
      model,
      prompt,
      cacheAt,
      signal,
      onDelta: ({ content, reasoning }) => {
        const reply = getReply()
        const next = { ...reply, raw: reply.raw + content, reasoning: reply.reasoning + reasoning }
        setReply(next)
        meter.add(content + reasoning)
        const stage = content ? "responding" : "thinking"
        this.update({
          messages: [...this.#state.messages.slice(0, -1), next],
          stats: meter.snapshot(),
          ...(this.#state.activity.stage !== stage ? { activity: { phase: "llm", stage } } : {}),
        })
      },
    })
  }

  // ── inbox: letters ─────────────────────────────────────────────────────
  //
  // Every piece of work arrives as a letter in this engine's inbox, deposited
  // from any thread: the owner's message, another agent's quest, the reports
  // on quests this engine handed out. Letters are worked one at a time, in
  // order; a deposit while idle starts the work.
  //
  //   { kind: "request", text, from: null }          the owner
  //   { kind: "quest", id, text, from, replyTo }     another agent; the answer goes back
  //                                                  to engine `replyTo` as a report
  //   { kind: "report", quest, from, ok, text }      the answer to a quest this engine sent
  //   { kind: "cancel", quest }                      the sender called its quest back
  //
  // Work on a letter ends with an answer, or by handing out quests: then the
  // engine stops, and the reports (every quest of that letter, joined) come
  // back as a new letter continuing the same origin — the owner's request or
  // the quest that started it. Only a final answer settles the origin.

  // Deposit a letter. Resolves with the final answer of the work it starts
  // (requests and quests); reports and cancels resolve at once.
  deposit(letter) {
    if (this.status === "disposed") return Promise.reject(new Error(`${this.name} is closed.`))
    if (letter.kind === "report") return Promise.resolve(this.#receiveReport(letter))
    if (letter.kind === "cancel") return Promise.resolve(this.#cancel(letter.quest))
    if (letter.kind === "guidance") return Promise.resolve(this.#receiveGuidance(letter))
    if (letter.kind === "status") return Promise.resolve(this.#receiveStatus(letter))
    const entry = { ...letter, id: letter.id ?? this.#nextLetterId(), at: new Date().toISOString() }
    const done = new Promise((resolve, reject) => this.#origins.set(entry.id, { resolve, reject }))
    // Handled here: a caller that awaits still sees the failure, but a letter
    // nobody waits on (a routed quest) can never become an unhandled rejection,
    // which would end the whole team's thread.
    done.catch(() => {})
    this.#enqueue(entry)
    return done
  }

  // A request from the owner (or a test). Resolves with the final answer.
  ask(text, { from = null } = {}) {
    return this.deposit({ kind: "request", text, from })
  }

  // UI entry point: errors are already recorded in state.
  send(text) {
    return this.ask(text).catch(() => {})
  }



  // agent.md `memory: run` — every run (a request or a quest; not the reports
  // or status checks that continue one) starts from an empty log; the old one
  // moves to a history file. For agents whose work lives in shared files, so
  // past runs are not re-sent on every step.
  async #freshForRun() {
    if (this.agent?.memory !== "run") return
    const log = this.#state.messages.filter((m) => m.content || m.output)
    if (!log.length) return
    await this.memory.archive(log)
    this.update({ messages: [], stats: null })
    await this.persist()
  }
  #nextLetterId() {
    return `${this.id}-${this.#letterPrefix}-l${++this.#letterCount}`
  }
  #enqueue(letter) {
    this.#inbox.push({ letter })
    this.#publishInbox()
    this.#drain()
  }

  #publishInbox() {
    const preview = (text = "") => (text.length > 120 ? `${text.slice(0, 120)}…` : text)
    this.update({
      inbox: this.#inbox.map(({ letter }) => ({
        id: letter.id,
        kind: letter.kind,
        from: letter.from ?? null,
        preview: preview(letter.text ?? letter.reports?.map((r) => r.quest.to).join(", ")),
      })),
    })
  }

  // Open quests to state; while not running, the activity says who it waits for.
  #publishQuests() {
    const quests = [...this.#quests.values()]
      .filter((q) => !q.report)
      .map(({ id, to, text, at }) => ({ id, to, text, at }))
    const idle = this.status !== "running" && this.status !== "disposed"
    const waiting = quests.length ? { phase: "waiting", names: [...new Set(quests.map((q) => q.to))] } : IDLE
    this.update({ quests, ...(idle ? { activity: waiting } : {}) })
  }

  // Work the inbox, one letter at a time.
  async #drain() {
    if (this.#draining) return
    this.#draining = true
    try {
      while (this.#inbox.length && this.status !== "disposed" && this.status !== "running") {
        const { letter } = this.#inbox.shift()
        this.#publishInbox()
        // A status on a quest that has reported or was called back meanwhile.
        if (letter.kind === "status" && !this.#openQuest(letter.quest)) continue
        await this.#workOn(letter)
      }
    } finally {
      this.#draining = false
    }
  }

  // Settle an origin: report to the quest's sender, resolve ask().
  #settle(origin, answer, error = null) {
    if (origin.kind === "quest" && origin.replyTo) {
      const report = {
        kind: "report",
        quest: origin.id,
        from: this.name,
        ok: !error,
        text: error ? `Failed: ${error.name === "AbortError" ? "stopped before it finished" : error.message}` : answer,
      }
      this.directory?.send({ id: origin.replyTo }, report).catch(() => {}) // a sender that is gone needs no report
    }
    const waiter = this.#origins.get(origin.id)
    this.#origins.delete(origin.id)
    if (error) waiter?.reject(error)
    else waiter?.resolve(answer)
  }

  // What the model sees as the current request for a letter.
  #requestText(letter) {
    if (letter.kind === "status") return this.#statusText(letter)
    if (letter.kind === "quest" && letter.guidance?.length) {
      return `${letter.text}\n\nGuidance from ${letter.from} since:\n${letter.guidance.map((g) => `- ${g}`).join("\n")}`
    }
    if (letter.kind !== "reports") return letter.text
    const { origin } = letter
    const parts = letter.reports.map(({ quest, report }) =>
      // The quest's full text is already in this engine's history (its own call): a reminder is enough.
      [`### ${quest.to} · quest ${quest.id} · ${report.ok ? "done" : "failed"}`, `Quest: ${clipText(quest.text, 240)}`, "", "Report:", report.text].join(
        "\n"
      )
    )
    const rounds = origin.rounds ?? 0
    const left = Math.max(0, this.maxRounds - rounds)
    const guidance = origin.guidance?.length
      ? `Guidance from ${origin.from} meanwhile:\n${origin.guidance.map((g) => `- ${g}`).join("\n")}\n\n`
      : ""
    return (
      `Reports are back on the quests you handed out for this ${origin.kind === "quest" ? `quest from ${origin.from}` : "request"}:\n\n` +
      `"${clipText(origin.text, 400)}"\n\n${parts.join("\n\n")}\n\n${guidance}` +
      (Number.isFinite(this.maxRounds) ? `Round ${rounds} of ${this.maxRounds}. ` : "") +
      (left
        ? "Continue that work with these reports: hand out more quests only if something the goal needs is still missing, otherwise answer it."
        : "No rounds left: answer it now with what you have, and say what is still open.")
    )
  }

  // Work one letter through the strategy (run()).
  async #workOn(letter) {
    if (this.status === "created") this.init()
    // A status check is a side turn: it may steer, recall or hand out quests
    // for the quest's origin, but never answers (settles) that origin.
    const side = letter.kind === "status"
    const origin =
      letter.kind === "reports" ? letter.origin : side ? this.#quests.get(letter.quest).origin : letter
    this.#declined.clear()
    this.#dispatched = 0
    await this.#describeTools()
    if (letter.kind === "quest" || letter.kind === "request") await this.#freshForRun(letter)
    const text = this.#requestText(letter)
    // The request is rendered in its own slot; history is every other message.
    const request = this.message("user", {
      content: text,
      from: letter.kind === "reports" ? letter.reports.map((r) => r.quest.to).join(", ") : (letter.from ?? null),
      ...(letter.kind === "quest" ? { quest: letter.id } : {}),
      ...(letter.kind === "reports" ? { reports: letter.reports.map((r) => r.quest.id) } : {}),
      ...(side ? { status: letter.quest } : {}),
    })
    const controller = new AbortController()
    this.#request = request
    this.#controller = controller
    this.#work = { letter, origin, controller }
    this.update({
      status: "running",
      activity: { phase: "llm", stage: "waiting" },
      error: null,
      messages: [...this.#state.messages, request],
      working: {
        id: letter.id,
        kind: letter.kind,
        origin: origin.id, // the run this letter belongs to (request or quest, and its reports)
        quest: origin.kind === "quest" ? origin.id : null,
        replyTo: origin.replyTo ?? null,
        from: origin.from ?? null,
        request: request.id,
        at: new Date().toISOString(),
      },
    })

    try {
      const answer = await this.run(text, request, controller.signal)
      this.update({ status: "idle" }) // activity: #publishQuests (idle, or waiting)
      // Quests handed out: their reports continue this origin later.
      if (this.#dispatched) origin.rounds = (origin.rounds ?? 0) + 1
      else if (!side) this.#settle(origin, answer)
    } catch (error) {
      if (this.status === "disposed") return
      const last = this.#state.messages.at(-1)
      if (error.name === "AbortError") {
        if (last?.role === "assistant") this.replaceLast({ ...last, stopped: true })
        this.update({ status: "idle", activity: IDLE })
      } else {
        if (last?.role === "assistant") this.replaceLast({ ...last, error: error.message })
        this.update({ status: "error", activity: IDLE, error: error.message })
      }
      if (!side) {
        this.#recallQuests((quest) => quest.origin === origin)
        this.#settle(origin, null, error)
      }
    } finally {
      if (this.#controller === controller) this.#controller = null
      this.#work = null
      this.#guidance = []
      if (this.status !== "disposed") this.update({ working: null })
      this.#request = null
      this.#publishQuests()
      // Save the turn's final answer (or error) too.
      if (this.status !== "disposed") await this.persist()
    }
  }

  // ── quests: work handed to other agents ──────────────────────────────────

  // Hand `text` to agent `to` as a quest (AgentTool). Resolves once it is in
  // that agent's inbox; the report arrives later, as a letter.
  async dispatchQuest(to, text) {
    if (!this.#work) throw new Error("Quests are handed out only while working on a letter.")
    if (!this.directory) throw new Error("No other agents are reachable.")
    const { letter, origin } = this.#work
    const rounds = origin.rounds ?? 0
    if (rounds >= this.maxRounds) {
      throw new Error(
        `This request has had ${rounds} rounds of quests, the limit. Answer now with what you have, and say what is still open.`
      )
    }
    const id = `${this.id}-q${++this.#questCount}`
    const quest = { id, to, toId: null, text, origin, batch: letter.id, at: new Date().toISOString(), report: null }
    this.#quests.set(id, quest)
    try {
      quest.toId = await this.directory.send({ name: to }, { kind: "quest", id, text, from: this.name, replyTo: this.id })
    } catch (error) {
      this.#quests.delete(id)
      throw error
    }
    this.#dispatched += 1
    this.#publishQuests()
    return `Quest ${id} is in ${to}'s inbox. You stop after this response; its report wakes you.`
  }

  // How the turn ends once the current letter has handed out quests (the
  // strategy checks after running tools); null when it has not.
  waitingForReports() {
    if (!this.#dispatched) return null
    const open = [...this.#quests.values()].filter((q) => q.batch === this.#work?.letter.id && !q.report)
    return `Waiting for reports: ${open.map((q) => `${q.to} (quest ${q.id})`).join(", ")}.`
  }

  // A report on one of this engine's quests. When every quest handed out by
  // the same letter has reported, they come back together as one letter.
  #receiveReport(report) {
    const quest = this.#quests.get(report.quest)
    if (!quest || quest.report) return // called back, or already in
    quest.report = report
    const batch = [...this.#quests.values()].filter((q) => q.batch === quest.batch)
    if (batch.some((q) => !q.report)) return this.#publishQuests()
    for (const q of batch) this.#quests.delete(q.id)
    this.#publishQuests()
    this.#enqueue({
      kind: "reports",
      id: this.#nextLetterId(),
      origin: quest.origin,
      reports: batch.map((q) => ({ quest: q, report: q.report })),
      at: new Date().toISOString(),
    })
  }

  #openQuest(id) {
    const quest = this.#quests.get(id)
    return quest && !quest.report ? quest : null
  }

  // ── supervision: status checks on long-running quests ────────────────────
  //
  // The supervisor (runtime/supervisor.js) watches every engine working on
  // a quest and, every few minutes or steps, deposits a status letter with
  // the digest of its latest work in the quest owner's inbox. The owner
  // checks it against the quest in a side turn: on track (one line, no
  // tools), steer (quest.steer: guidance the agent sees on its next step),
  // or recall (quest.recall: the quest reports back as called back).

  // A status letter: one per quest waits in the inbox (the newest).
  #receiveStatus(letter) {
    if (!this.#openQuest(letter.quest)) return
    this.#inbox = this.#inbox.filter(({ letter: l }) => !(l.kind === "status" && l.quest === letter.quest))
    this.#enqueue({ ...letter, id: this.#nextLetterId(), at: new Date().toISOString() })
  }

  #statusText(letter) {
    const quest = this.#quests.get(letter.quest)
    const minutes = Math.round((Date.now() - Date.parse(quest.at)) / 60000)
    if (letter.stalled) {
      return (
        `Stalled quest ${quest.id}, handed to ${quest.to} ${minutes} min ago for: "${quest.origin.text}"\n\n` +
        `The quest:\n${quest.text}\n\n${letter.text}\n\n` +
        `Act now: quest.recall({"quest": "${quest.id}", "reason": "stalled"}) and send the same full quest again, ` +
        "or do the work another way. Waiting does not bring this report back."
      )
    }
    return (
      `Status check on quest ${quest.id}, handed to ${quest.to} ${minutes} min ago for: "${quest.origin.text}"\n\n` +
      `The quest:\n${quest.text}\n\n` +
      `${quest.to} is still working: ${letter.steps} steps so far. Its latest work:\n\n${letter.text}\n\n` +
      "Check it against the quest. On track: answer in one line, no tools. Drifting, looping or stuck: " +
      `steer it with quest.steer({"quest": "${quest.id}", "guidance": …}), or stop it with ` +
      `quest.recall({"quest": "${quest.id}", "reason": …}) and hand out a better quest.`
    )
  }

  // Guidance from the quest's sender: seen on the next step of the work on
  // that quest; noted for later when the quest waits (queued, or for its own
  // quests' reports).
  #receiveGuidance({ quest: id, from, text }) {
    if (this.#work?.origin.id === id && this.status === "running") {
      this.#guidance.push(this.message("user", { content: text, from, guidance: true }))
      return
    }
    const queued = this.#inbox.find(({ letter }) => letter.id === id)?.letter
    const origin = queued ?? [...this.#quests.values()].find((q) => q.origin.id === id)?.origin
    if (origin) origin.guidance = [...(origin.guidance ?? []), text]
  }

  // Tools for agents that hand out quests.
  #questTools() {
    const quest = { type: "string", minLength: 1, maxLength: 120 }
    return [
      new Tool({
        name: "quest.steer",
        view: "quest",
        description:
          "Send guidance to an agent working on one of your quests; it sees it on its next step. Use it when a " +
          "status check shows it drifting.",
        inputs: {
          type: "object",
          properties: { quest, guidance: { type: "string", minLength: 1, maxLength: 4000 } },
          required: ["quest", "guidance"],
          additionalProperties: false,
        },
        run: ({ quest: id, guidance }) => this.#steer(id, guidance),
      }),
      new Tool({
        name: "quest.recall",
        view: "quest",
        description:
          "Stop one of your quests: the agent drops it, and it comes back to you as a failed report with your reason.",
        inputs: {
          type: "object",
          properties: { quest, reason: { type: "string", maxLength: 1000 } },
          required: ["quest"],
          additionalProperties: false,
        },
        run: ({ quest: id, reason = "" }) => this.#recallOne(id, reason),
      }),
    ]
  }

  async #steer(id, guidance) {
    const quest = this.#openQuest(id)
    if (!quest) throw new Error(`No open quest ${id}.`)
    await this.directory.send({ id: quest.toId }, { kind: "guidance", quest: id, from: this.name, text: guidance })
    return `Guidance sent to ${quest.to}; it sees it on its next step.`
  }

  #recallOne(id, reason) {
    const quest = this.#openQuest(id)
    if (!quest) throw new Error(`No open quest ${id}.`)
    this.directory?.send({ id: quest.toId }, { kind: "cancel", quest: id }).catch(() => {})
    // Its batch still joins: the quest reports back as called back.
    this.#receiveReport({ quest: id, from: quest.to, ok: false, text: `Called back by you${reason ? `: ${reason}` : "."}` })
    return `Quest ${id} called back; ${quest.to} stops working on it.`
  }

  // Call back every open quest to agent `name` (before it is ended: agent.kill);
  // each reports back as called back, so its batch still joins. Returns how many.
  recallQuestsTo(name, reason = "") {
    const open = [...this.#quests.values()].filter((q) => q.to === name && !q.report)
    for (const quest of open) this.#recallOne(quest.id, reason)
    return open.length
  }

  // Call quests back: each agent drops the quest from its inbox or stops
  // working on it. Returns the quests called back.
  #recallQuests(match) {
    const recalled = [...this.#quests.values()].filter(match)
    for (const quest of recalled) {
      this.#quests.delete(quest.id)
      if (!quest.report && quest.toId) this.directory?.send({ id: quest.toId }, { kind: "cancel", quest: quest.id }).catch(() => {})
    }
    if (recalled.length) this.#publishQuests()
    return recalled
  }

  // The sender called quest `id` back: drop it if waiting, stop it if being
  // worked on, and call back the quests it handed out in turn.
  #cancel(id) {
    this.#inbox = this.#inbox.filter(({ letter }) => letter.id !== id && letter.origin?.id !== id)
    this.#publishInbox()
    if (this.#work?.origin.id === id) this.#work.controller.abort()
    this.#recallQuests((quest) => quest.origin.id === id)
    this.#origins.delete(id)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  get status() {
    return this.#state.status
  }

  get activity() {
    return this.#state.activity
  }

  init() {
    if (this.status === "created") {
      this.update({ status: "idle" })
      this.#loadContextWindow()
    }
    return this
  }

  // Abort the letter being worked on, and call back every quest handed out.
  // Work that was only waiting for reports ends as stopped.
  stop() {
    this.#controller?.abort()
    const origins = new Set(this.#recallQuests(() => true).map((quest) => quest.origin))
    const stopped = new DOMException("Stopped", "AbortError")
    for (const origin of origins) if (this.#work?.origin !== origin) this.#settle(origin, null, stopped)
  }

  dispose() {
    if (this.status === "disposed") return
    this.#recallQuests(() => true)
    this.update({ status: "disposed", activity: IDLE })
    this.#controller?.abort()
    const closed = new Error(`${this.name} is closed.`)
    for (const { letter } of this.#inbox) if (letter.kind !== "reports") this.#settle(letter, null, closed)
    this.#inbox = []
    this.#listeners.clear()
  }
}
