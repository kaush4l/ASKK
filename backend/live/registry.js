// The desk this tab follows: its agents (AgentView, one per kernel agent) mirrored from the desk server's team
// stream, and the agent selected in this tab. Started once by the first view (hooks/use-engines.js); module
// singleton, so agents survive route changes. Every stream event also goes to the desk store (tree, boards,
// artifacts: desk.js) and the background log (log.js). Nothing runs in the tab: the server runs the desk.
// 2026-10-17: agents come and go while the desk runs (kernel Desk.spawn / dismiss): a `registry` event carries the
// whole registry and the new agents' states, so a spawned agent's view starts from its state, not an empty one.
//
//   status: idle | connecting | ready | offline (no desk server here: capability `team` missing) | error

import { AgentView } from "@/backend/live/agent"
import { kernelDesk } from "@/backend/live/desk"
import { detectHost, hasCapability, resetHost } from "@/backend/live/host"
import { deskLog } from "@/backend/live/log"
import { connectTeam } from "@/backend/live/stream"

// What the server rendered (no desk yet). Hydration reads it, never the live state: a view inside a Suspense boundary
// hydrates after the status bar has started the registry, and the agents it already had broke hydration (2026-10-17:
// the agent picker's optgroups).
const INITIAL = Object.freeze({
  status: "idle",
  error: null,
  connected: false, // the stream is open (it reconnects on its own)
  agents: [], // definitions, lead first
  engines: [], // AgentView per agent (named engines for the views that predate the kernel)
  requiredId: null, // the lead
  activeId: null, // the agent selected in this tab
})

export class Registry {
  #listeners = new Set()
  #state = INITIAL

  getSnapshot = () => this.#state
  getServerSnapshot = () => INITIAL

  // A view that subscribes starts the registry (start is a no-op once started). 2026-10-17: a hot reload re-creates this
  // module while the views stay mounted — their mount effect never runs again, and the new registry sat idle
  // ("Connecting to the desk…") until a manual reload; React subscribes again to the new instance, so it starts here.
  subscribe = (listener) => {
    this.#listeners.add(listener)
    queueMicrotask(() => this.start())
    return () => this.#listeners.delete(listener)
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  async start() {
    if (this.#state.status !== "idle") return
    this.#set({ status: "connecting" })
    const host = await detectHost().catch(() => null)
    if (!hasCapability(host, "team")) return this.#set({ status: "offline" })
    // 2026-10-20 (the hosted version): no desk server, a model named for this browser — the desk runs in this tab.
    if (host.mode === "browser") {
      const { startBrowserDesk } = await import("@/backend/browser/start")
      const team = await startBrowserDesk().catch((error) => (this.#set({ status: "error", error: error.message }), null))
      if (!team) return this.#state.status === "error" ? undefined : this.#set({ status: "offline" })
    }
    connectTeam(
      (event) => this.apply(event),
      () => this.#set({ connected: false }),
    )
  }

  // One team/stream event (the stream's handler; a test feeds it events directly).
  apply(event) {
    kernelDesk.apply(event)
    deskLog.apply(event)
    if (event.type === "snapshot") this.#mirror(event.registry, event.states)
    else if (event.type === "registry") this.#mirror(event.registry, event.states)
    else if (event.type === "state") this.#state.engines.find((e) => e.id === event.id)?.apply(event.patch)
  }

  #mirror(registry, states = null) {
    const known = new Map(this.#state.engines.map((e) => [e.id, e]))
    const engines = registry.engines.map(({ id, name, agent }) => {
      const engine = known.get(id) ?? new AgentView({ id, name, agent })
      engine.describe(agent)
      if (states?.[id]) engine.apply(states[id], true)
      return engine
    })
    for (const [id, engine] of known) if (!engines.some((e) => e.id === id)) engine.dispose()
    const activeId = engines.some((e) => e.id === this.#state.activeId) ? this.#state.activeId : registry.requiredId
    this.#set({
      status: registry.status === "error" ? "error" : "ready",
      error: registry.error ?? null,
      connected: true,
      agents: registry.agents,
      requiredId: registry.requiredId,
      engines,
      activeId,
    })
  }

  // Start again from scratch (the owner named a model for this browser, or cleared it): the views follow the new desk.
  async restart() {
    resetHost()
    const { stopBrowserDesk } = await import("@/backend/browser/start")
    await stopBrowserDesk() // the old team ends before a new one restores from the same store
    for (const e of this.#state.engines) e.dispose()
    this.#state = INITIAL
    for (const listener of this.#listeners) listener()
    return this.start()
  }

  select(id) {
    if (this.#state.engines.some((e) => e.id === id)) this.#set({ activeId: id })
  }

  byName(name) {
    return this.#state.engines.find((e) => e.name === name) ?? null
  }
}

export const registry = new Registry()
