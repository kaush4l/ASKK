// The surface the UI and registry use on an engine that runs elsewhere:
// EngineProxy (a Web Worker in this tab) and RemoteEngine (the local
// server's team). State is one immutable snapshot, replaced by patches.

import { IDLE } from "@/backend/core/activity"
import { resolveModel } from "@/backend/models/catalog"

export const EMPTY_STATE = {
  status: "created",
  activity: IDLE,
  messages: [],
  error: null,
  revision: 0,
  memoryError: null,
  stats: null,
  contextWindow: null,
  approvals: [],
  live: {},
  inbox: [],
  quests: [],
  working: null,
}

// A patch's messages arrive as { from, items }: kept up to `from`, then items.
export const patchMessages = (messages, { from, items }) => [...messages.slice(0, from), ...items]

export class EngineSurface {
  #listeners = new Set()
  #state = EMPTY_STATE

  // Definition fields the UI reads.
  describe(agent) {
    this.agent = agent
    this.description = agent.description
    this.responseFormat = agent.response_format ?? "toon"
    this.tools = [
      ...agent.tools.map((name) => ({ name, kind: "tool" })),
      ...(agent.agents ?? []).map((name) => ({ name, kind: "agent" })),
      ...(agent.mcp ?? []).map((name) => ({ name: name === "*" ? "MCP: all servers" : name.includes(".") ? name : `${name}.*`, kind: "tool" })),
    ]
  }

  // The connection this engine calls (resolved on the main thread, where
  // the catalogue lives).
  get model() {
    return resolveModel(this.agent.model)
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

  // Replace the snapshot and tell every listener.
  replaceState(next) {
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  clearListeners() {
    this.#listeners.clear()
  }
}
