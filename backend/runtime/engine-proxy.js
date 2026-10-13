// EngineProxy — the main thread's handle on an engine running in its own Web
// Worker (engine-worker.js). Same surface the UI and registry use on an
// engine: getSnapshot/subscribe, deposit/send/stop, memory actions,
// reconfigure, dispose. State arrives from the worker as batched patches;
// the main thread only renders and routes letters between inboxes.

import { IDLE } from "@/backend/core/activity"
import { Memory } from "@/backend/core/memory"
import { EngineSurface, patchMessages } from "@/backend/runtime/engine-surface"
import { SPAWN_CALLS } from "@/backend/runtime/spawner"

let proxyCount = 0

const toError = (data) => Object.assign(new Error(data?.message ?? "Unknown error"), { name: data?.name ?? "Error" })

export class EngineProxy extends EngineSurface {
  #worker
  #host
  #calls = new Map() // callId -> { resolve, reject }
  #callCount = 0
  // host: { descriptions() -> { name: description },
  //         send(caller, to, letter) -> engine id (delivered to that inbox) }
  constructor({ agent, name = agent.name, host }) {
    super()
    proxyCount += 1
    this.id = `engine-${proxyCount}`
    this.name = name
    this.#host = host
    this.memory = { path: new Memory(name).path }
    this.describe(agent)

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

  // ── state ──────────────────────────────────────────────────────────────

  #set(patch) {
    this.replaceState({ ...this.getSnapshot(), ...patch })
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
        if (messages) patch.messages = patchMessages(this.getSnapshot().messages, messages)
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
      case "send":
        this.#reply(data.callId, () => this.#host.send(this, data.to, data.letter))
        break
      case "host":
        // A sub-agent call (the team artifact), answered by the registry.
        this.#reply(data.callId, () => {
          if (!SPAWN_CALLS.includes(data.method) || !this.#host[data.method]) throw new Error("Sub-agents cannot be created here.")
          return this.#host[data.method](this, ...(data.args ?? []))
        })
        break
    }
  }

  // Answer the worker's "send"/"host" request with the value or the error.
  #reply(callId, answer) {
    try {
      this.#post({ type: "sent", callId, ok: true, value: answer() })
    } catch (error) {
      this.#post({ type: "sent", callId, ok: false, error: { name: error.name, message: error.message } })
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

  // A request whose final answer the caller needs (e.g. a reply to a
  // message from an integration). Resolves with the answer.
  ask(text, { from = null } = {}) {
    return this.#call("ask", [text, { from }])
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

  // Owner guidance on the work in progress (seen at its next step).
  guide(text) {
    this.#post({ type: "guide", text })
    return Promise.resolve({ delivered: this.getSnapshot().status === "running" })
  }

  // New definition, model, or sibling descriptions.
  reconfigure(agent = this.agent) {
    if (this.status === "disposed") return
    this.describe(agent)
    this.#post({ type: "configure", agent, model: this.model, descriptions: this.#host.descriptions() })
  }

  // Ends the thread: in-flight work stops at once.
  dispose() {
    if (this.status === "disposed") return
    this.#worker.terminate()
    this.#set({ status: "disposed", activity: IDLE })
    for (const { reject } of this.#calls.values()) reject(new Error(`${this.name} is closed.`))
    this.#calls.clear()
    this.clearListeners()
  }
}
