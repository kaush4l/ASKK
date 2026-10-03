// EngineProxy — the main thread's handle on an engine running in its own Web
// Worker (engine-worker.js). Same surface the UI and registry use on an
// engine: getSnapshot/subscribe, deposit/send/stop, memory actions,
// reconfigure, dispose. State arrives from the worker as batched patches;
// the main thread only renders and routes letters between inboxes.

import { IDLE } from "@/backend/core/activity"
import { Memory } from "@/backend/core/memory"
import { resolveModel } from "@/backend/models/catalog"

let proxyCount = 0

const toError = (data) => Object.assign(new Error(data?.message ?? "Unknown error"), { name: data?.name ?? "Error" })

export class EngineProxy {
  #worker
  #host
  #listeners = new Set()
  #calls = new Map() // callId -> { resolve, reject }
  #callCount = 0
  #state = {
    status: "created",
    activity: IDLE,
    messages: [],
    error: null,
    revision: 0,
    memoryError: null,
    stats: null,
    contextWindow: null,
    approvals: [],
    inbox: [],
    quests: [],
    working: null,
  }

  // host: { descriptions() -> { name: description },
  //         send(caller, to, letter) -> engine id (delivered to that inbox) }
  constructor({ agent, name = agent.name, host }) {
    proxyCount += 1
    this.id = `engine-${proxyCount}`
    this.name = name
    this.#host = host
    this.memory = { path: new Memory(name).path }
    this.#describe(agent)

    this.#worker = new Worker(new URL("./engine-worker.js", import.meta.url), {
      type: "module",
      name: `engine ${name}`,
    })
    this.#worker.onmessage = ({ data }) => this.#receive(data)
    this.#worker.onerror = (event) => {
      event.preventDefault?.()
      this.#fail(`Engine thread failed: ${event.message || "could not start"}`)
    }
    this.#post({ type: "init", id: this.id, name, agent, model: this.model, descriptions: host.descriptions() })
  }

  // Definition fields the UI reads.
  #describe(agent) {
    this.agent = agent
    this.description = agent.description
    this.responseFormat = agent.response_format ?? "toon"
    this.tools = [
      ...agent.tools.map((name) => ({ name, kind: "tool" })),
      ...(agent.agents ?? []).map((name) => ({ name, kind: "agent" })),
    ]
  }

  // The connection this engine calls (resolved here: the catalogue lives on
  // the main thread, and the worker is sent the result).
  get model() {
    return resolveModel(this.agent.model)
  }

  // ── state ──────────────────────────────────────────────────────────────

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

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  #fail(message) {
    this.#set({ status: "error", activity: IDLE, error: message })
    for (const { reject } of this.#calls.values()) reject(new Error(message))
    this.#calls.clear()
  }

  // ── worker messages ────────────────────────────────────────────────────

  #post(message) {
    if (this.status !== "disposed") this.#worker.postMessage(message)
  }

  #receive(data) {
    if (this.status === "disposed") return
    switch (data.type) {
      case "state": {
        const { messages, ...patch } = data.patch
        if (messages) patch.messages = [...this.#state.messages.slice(0, messages.from), ...messages.items]
        this.#set(patch)
        break
      }
      case "result": {
        const call = this.#calls.get(data.callId)
        this.#calls.delete(data.callId)
        if (data.ok) call?.resolve(data.value)
        else call?.reject(toError(data.error))
        break
      }
      case "send": {
        try {
          const value = this.#host.send(this, data.to, data.letter)
          this.#post({ type: "sent", callId: data.callId, ok: true, value })
        } catch (error) {
          this.#post({ type: "sent", callId: data.callId, ok: false, error: { name: error.name, message: error.message } })
        }
        break
      }
    }
  }

  #call(method, args = []) {
    if (this.status === "disposed") return Promise.reject(new Error(`${this.name} is closed.`))
    const callId = ++this.#callCount
    return new Promise((resolve, reject) => {
      this.#calls.set(callId, { resolve, reject })
      this.#post({ type: "call", callId, method, args })
    })
  }

  // ── engine surface ─────────────────────────────────────────────────────

  init() {
    return this // the worker initializes the engine as it starts
  }

  // Put a letter in this engine's inbox (another thread). Returns at once.
  deposit(letter) {
    if (this.status === "disposed") throw new Error(`${this.name} is closed.`)
    this.#post({ type: "deposit", letter })
  }

  // UI entry point: the owner's message, as a letter. Outcomes are in state.
  send(text) {
    this.deposit({ kind: "request", text, from: null })
  }

  restore() {
    return this.#call("restore")
  }

  clearMemory() {
    return this.#call("clearMemory")
  }

  summarizeMemory() {
    return this.#call("summarizeMemory")
  }

  preview(text = "") {
    return this.#call("preview", [text])
  }

  stop() {
    this.#post({ type: "stop" })
  }

  // Approve (true) or decline a pending tool call from state `approvals`.
  resolveApproval(id, ok) {
    this.#post({ type: "approval", id, ok: !!ok })
  }

  // New definition, model, or sibling descriptions.
  reconfigure(agent = this.agent) {
    if (this.status === "disposed") return
    this.#describe(agent)
    this.#post({ type: "configure", agent, model: this.model, descriptions: this.#host.descriptions() })
  }

  // Ends the thread: in-flight work stops at once.
  dispose() {
    if (this.status === "disposed") return
    this.#worker.terminate()
    this.#set({ status: "disposed", activity: IDLE })
    for (const { reject } of this.#calls.values()) reject(new Error(`${this.name} is closed.`))
    this.#calls.clear()
    this.#listeners.clear()
  }
}
