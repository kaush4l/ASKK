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
// The class is split by function into parts (core/engine/), each a set of
// methods mixed into BaseEngine.prototype: definition, memory-ops,
// artifacts, prompt, tools-run, approvals, inference, inbox, quests. Their
// internals are the engine's `_`-prefixed fields (createInternals below).
//
// Ported from LocalAgents core/engine.py (`BaseAgent`); template order from askk.

import { IDLE } from "@/backend/core/activity"
import { autopilot } from "@/backend/core/tool"
import { Memory } from "@/backend/core/memory"
import { ReActResponse } from "@/backend/core/responses"
import { parseToolPlan } from "@/backend/core/tool-plan"
import { resolveModel } from "@/backend/models/catalog"
import { ApprovalsPart } from "@/backend/core/engine/approvals"
import { ArtifactsPart } from "@/backend/core/engine/artifacts"
import { DefinitionPart } from "@/backend/core/engine/definition"
import { InboxPart } from "@/backend/core/engine/inbox"
import { InferencePart } from "@/backend/core/engine/inference"
import { MemoryPart } from "@/backend/core/engine/memory-ops"
import { PromptPart } from "@/backend/core/engine/prompt"
import { QuestsPart } from "@/backend/core/engine/quests"
import { ToolsPart } from "@/backend/core/engine/tools-run"
import { LIMITS } from "@/lib/config"

let engineCount = 0

// The engine's internal fields (were #private before the split; parts share them).
function createInternals() {
  return {
    _listeners: new Set(),
    _controller: null,
    _messageCount: 0,
    // Characters per token for this model, calibrated from server usage counts.
    _charsPerToken: LIMITS.metrics.charsPerToken,
    // `revision` bumps on reconfigure() so subscribers re-read definition fields.
    // `memoryError` is set while the memory file cannot be saved or read.
    // `stats` are the token metrics of the latest LLM call (models/metrics.js);
    // `contextWindow` is the model's window in tokens (null = unknown).
    _state: {
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
    },
    _approvalWaits: new Map(), // approval id -> resolve(ok)
    _approvalCount: 0,
    _declined: new Set(), // calls the owner declined during the current request
    _request: null, // the user message being worked on (splits history from progress)
    _toolContext: null, // CONTEXT lines from the tools (Tool.context), once per definition
    // Inbox: every piece of work arrives as a letter, worked one at a time.
    _inbox: [], // [{ letter }] waiting
    _dormant: false, // asleep (ASKK_HIBERNATE_MINUTES): newest messages only in memory, full log in memory.md
    _sleepTimer: null,
    _kept: new Map(), // agent.md inbox: keep — unsettled requests/quests by id, saved to inbox.json
    _draining: false,
    _deferTimer: null,
    _letterCount: 0,
    // Letter ids stay unique across restarts (the count starts again at 0): a
    // run is one origin id, and per-run state (the checklist) resets on a new one.
    _letterPrefix: `${Date.now().toString(36)}`,
    _work: null, // { letter, origin, controller } being worked on
    _origins: new Map(), // origin letter id -> { resolve, reject } (ask())
    // Quests handed to other agents, by id: { id, to, toId, text, origin, batch, report }
    _quests: new Map(),
    _questCount: 0,
    _dispatched: 0, // quests handed out by the current letter
    _guidance: [], // guidance messages for the work in progress, added at its next step
    _activityBeforeApproval: null, // restored when the last open approval is answered
    _liveSeen: new Map(), // type -> JSON of its last published snapshot (publishLive)
  }
}

export class BaseEngine {
  // directory: { describe(name) -> description,
  //              send({ name } | { id }, letter) -> Promise<engine id> }
  //   the other agents: their descriptions, and delivery to their inboxes.
  // getModel(key) -> model connection; defaults to the model catalogue.
  constructor({ agent, id = null, name = agent.name, directory = null, getModel = resolveModel, responseModel = ReActResponse }) {
    if (new.target === BaseEngine) throw new Error("BaseEngine is abstract; use a strategy such as ReActEngine.")
    Object.assign(this, createInternals())
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

  // ── state (arrow fields keep `this` bound for subscribers) ──────────────

  getSnapshot = () => this._state

  subscribe = (listener) => {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  get state() {
    return this._state
  }

  update(patch) {
    this._state = { ...this._state, ...patch }
    for (const listener of this._listeners) listener()
  }

  message(role, fields) {
    this._messageCount += 1
    return { id: `${this.id}-m${this._messageCount}`, role, content: "", at: new Date().toISOString(), ...fields }
  }

  push(message) {
    this.update({ messages: [...this._state.messages, message] })
  }

  replaceLast(message) {
    this.update({ messages: [...this._state.messages.slice(0, -1), message] })
  }

  // Every tool call in a response, as ordered stages (tool-plan.js).
  static parseToolPlan(response) {
    return parseToolPlan(response)
  }

  // Autopilot (tool.js `autopilot`): one switch for every engine in this thread.
  static get autopilot() {
    return autopilot.on
  }
  static set autopilot(on) {
    autopilot.on = on
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  get status() {
    return this._state.status
  }

  get activity() {
    return this._state.activity
  }

  init() {
    if (this.status === "created") {
      this.update({ status: "idle" })
      this._loadContextWindow()
    }
    return this
  }

  // Abort the letter being worked on, and call back every quest handed out.
  // Work that was only waiting for reports ends as stopped.
  stop() {
    this._controller?.abort()
    const origins = new Set(this._recallQuests(() => true).map((quest) => quest.origin))
    const stopped = new DOMException("Stopped", "AbortError")
    for (const origin of origins) if (this._work?.origin !== origin) this._settle(origin, null, stopped)
  }

  dispose() {
    if (this.status === "disposed") return
    this._recallQuests(() => true)
    this.update({ status: "disposed", activity: IDLE })
    this._controller?.abort()
    const closed = new Error(`${this.name} is closed.`)
    for (const { letter } of this._inbox) if (letter.kind !== "reports") this._settle(letter, null, closed)
    this._inbox = []
    this._listeners.clear()
  }
}

// Copy each part's methods (and getters) onto the prototype, non-enumerable
// like class methods. A method BaseEngine defines itself is never replaced.
for (const Part of [DefinitionPart, MemoryPart, ArtifactsPart, PromptPart, ToolsPart, ApprovalsPart, InferencePart, InboxPart, QuestsPart]) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(Part.prototype))) {
    if (name === "constructor") continue
    if (Object.hasOwn(BaseEngine.prototype, name)) throw new Error(`BaseEngine part ${Part.name}: ${name} defined twice.`)
    Object.defineProperty(BaseEngine.prototype, name, descriptor)
  }
}
