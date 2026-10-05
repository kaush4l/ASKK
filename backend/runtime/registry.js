import { pickEditable, readAgentEdits, writeAgentEdits } from "@/backend/agents/agent-store"
import { BaseEngine } from "@/backend/core/base-engine"
import { loadAgents, validateAgent } from "@/backend/agents/definitions"
import { detectHost, hasCapability } from "@/backend/platform/host"
import { EngineProxy } from "@/backend/runtime/engine-proxy"
import { startIntegrationBridge } from "@/backend/runtime/integration-bridge"
import { RemoteEngine, connectTeam, teamCall } from "@/backend/runtime/remote-team"
import { createSupervisor } from "@/backend/runtime/supervisor"
import { models } from "@/backend/models/catalog"

// Owns the agent definitions and every live engine in this browser tab.
// On startup every agent in public/agents/index.json gets an engine, each on
// its own Web Worker thread (EngineProxy here, the engine in the worker).
// The first agent in index.json is the default agent: its engine is
// required (`requiredId`) and cannot be closed; extra engines can.
// Module-level singleton: engines survive route changes, not page reloads.
//
// Local mode (host capability `team`): the team runs once on the local server
// (companion/team.js, this same registry with in-process engines) and this
// tab mirrors it (remote-team.js): every tab shows the same engines, and
// actions are calls to the server. Static/demo: engines run here, as above.
// Autopilot mode: every tool call that asks the owner for approval is
// approved at once, so a scheduled run (cron, schedule.wake) works unattended.
// Saved like any setting (localStorage; on the server a runtime file); the
// default is ASKK_AUTOPILOT in .env. The calls still show in each chat.
const AUTOPILOT_KEY = "askk.autopilot"

function savedAutopilot() {
  try {
    const saved = globalThis.localStorage?.getItem(AUTOPILOT_KEY)
    if (saved != null) return saved === "true"
  } catch {
    // no storage: the default below
  }
  return /^(1|true|on|yes)$/i.test(globalThis.process?.env?.ASKK_AUTOPILOT ?? "")
}

class EngineRegistry {
  #listeners = new Set()
  #approved = new Set() // "<engine id> <approval id>" already answered in autopilot mode
  #remote = false // mirroring the server's team
  #server = false // this registry IS the server's team (no remote, no worker threads)
  // How an engine is started: a Web Worker here; in-process on the server.
  #factory = ({ agent, name, host }) => new EngineProxy({ agent, name, host }).init()
  #fileAgents = new Map() // name -> definition exactly as loaded from agent.md

  // What engine threads need from the main thread: the other agents'
  // descriptions (for tool docs), and letter delivery between inboxes —
  // quests to the first live engine running that agent ({ name }), replies
  // and cancels to the exact engine ({ id }). Returns the target's id.
  #host = {
    descriptions: () => Object.fromEntries(this.#state.agents.map((a) => [a.name, a.description])),
    send: (caller, to, letter) => {
      const live = this.#state.engines.filter((e) => e.status !== "disposed")
      const target = to.id ? live.find((e) => e.id === to.id) : live.find((e) => e.agent.name === to.name && e !== caller)
      if (!target) throw new Error(`Agent ${to.name ?? to.id} is not running.`)
      if (target === caller) throw new Error("An agent cannot send a letter to itself.")
      target.deposit(letter)
      return target.id
    },
  }
  #state = {
    agents: [], // effective definitions (file + saved edit)
    edited: [], // names of agents with a saved edit
    status: "idle", // idle | loading | ready | error
    error: null,
    engines: [],
    activeId: null,
    requiredId: null, // the default agent's engine; never disposed
    autopilot: false, // approve every tool call without asking (see AUTOPILOT_KEY)
  }

  getSnapshot = () => this.#state

  // The server's team: engines in-process (companion/team-worker.js).
  runOnServer(factory) {
    this.#server = true
    this.#factory = factory
  }

  // The public part of the registry, for tabs mirroring the server's team.
  publicState() {
    const { agents, edited, status, error, requiredId, engines, autopilot } = this.#state
    return { agents, edited, status, error, requiredId, autopilot, engines: engines.map((e) => ({ id: e.id, name: e.name, agent: e.agent })) }
  }

  // Turn autopilot mode on or off (on the server's team from any tab).
  setAutopilot(on) {
    if (this.#remote) return teamCall("registry", "setAutopilot", [!!on])
    try {
      globalThis.localStorage?.setItem(AUTOPILOT_KEY, String(!!on))
    } catch {
      // not saved: on for this session only
    }
    BaseEngine.autopilot = !!on // engines in this thread (the server's team) skip asking
    this.#set({ autopilot: !!on })
    for (const engine of this.#state.engines) this.#autoApprove(engine)
  }

  #watchApprovals(engine) {
    engine.subscribe(() => this.#autoApprove(engine))
    this.#autoApprove(engine)
  }

  // Approve what an engine is waiting for, when autopilot. After the
  // current update: the answer changes the engine's state again.
  #autoApprove(engine) {
    if (!this.#state.autopilot) return
    for (const { id } of engine.getSnapshot().approvals ?? []) {
      const key = `${engine.id} ${id}`
      if (this.#approved.has(key)) continue
      this.#approved.add(key)
      queueMicrotask(() => engine.resolveApproval(id, true))
    }
  }

  // Replace the browser layer of the model catalogue (the model switcher in
  // any tab, on the server's team). Engines follow via models.subscribe.
  setModels(text) {
    if (models.savedJson() !== text) models.replaceSaved(text)
  }

  subscribe = (listener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  // Load agent definitions, layer saved edits on top, and start one engine
  // per agent. Runs once.
  async start() {
    if (this.#state.status !== "idle" && this.#state.status !== "error") return
    const autopilot = savedAutopilot()
    BaseEngine.autopilot = autopilot
    this.#set({ status: "loading", error: null, autopilot })
    if (!this.#server) {
      const host = await detectHost().catch(() => null)
      if (hasCapability(host, "team")) return this.#startRemote()
    }
    try {
      // The model catalogue first: engines resolve their model from it.
      const [fileAgents] = await Promise.all([loadAgents(), models.load()])
      this.#fileAgents = new Map(fileAgents.map((agent) => [agent.name, agent]))

      const edits = readAgentEdits()
      const edited = []
      const agents = fileAgents.map((agent) => {
        if (!edits[agent.name]) return agent
        try {
          const merged = validateAgent({ ...agent, ...edits[agent.name] })
          edited.push(agent.name)
          return merged
        } catch {
          return agent // an invalid saved edit falls back to the file
        }
      })

      // Agents first: engines describe their sub-agents through the directory.
      this.#set({ agents, edited })
      const engines = agents.map((agent) => this.#factory({ agent, name: agent.name, host: this.#host }))
      // Each engine reloads its own memory file before the registry is ready.
      await Promise.all(engines.map((engine) => engine.restore()))
      for (const engine of engines) this.#watchApprovals(engine)
      const requiredId = engines[0]?.id ?? null
      this.#set({ engines, activeId: requiredId, requiredId, status: "ready" })
      // Status checks on long-running quests, sent to each quest's owner.
      createSupervisor({
        engines: () => this.#state.engines,
        deliver: (id, letter) => this.#state.engines.find((e) => e.id === id && e.status !== "disposed")?.deposit(letter),
      })
      // Messages from integrations (Telegram, …) go to the default agent.
      startIntegrationBridge(() => this.#state.engines.find((e) => e.id === this.#state.requiredId && e.status !== "disposed"))
      // Catalogue changes (new default, edited connection) reach every engine.
      models.subscribe(() => {
        for (const engine of this.#state.engines) engine.reconfigure()
      })
    } catch (error) {
      this.#set({ status: "error", error: error.message })
    }
  }

  // ── mirroring the server's team ───────────────────────────────────────

  async #startRemote() {
    this.#remote = true
    await models.load()
    let shared = null // the model layer last agreed with the server
    const applyModels = (text) => {
      if (typeof text !== "string") return
      shared = text
      try {
        // Always rebuild: tabs of one browser share localStorage, so the text
        // can already be there while this tab's catalogue is stale.
        models.replaceSaved(text)
      } catch {
        // the server's layer is checked there; a mismatch here is ignored
      }
    }
    // The model switcher (or Settings) in this tab changes the server's team.
    models.subscribe(() => {
      const text = models.savedJson()
      if (shared !== null && text !== shared) {
        shared = text
        teamCall("registry", "setModels", [text]).catch(() => {})
      }
    })
    connectTeam((event) => {
      if (event.type === "snapshot") {
        applyModels(event.models)
        this.#mirror(event.registry, event.states)
      } else if (event.type === "registry") this.#mirror(event.registry)
      else if (event.type === "state") this.#state.engines.find((e) => e.id === event.id)?.apply(event.patch)
      else if (event.type === "models") applyModels(event.models)
    })
  }

  #mirror(registry, states = null) {
    const known = new Map(this.#state.engines.map((e) => [e.id, e]))
    const engines = registry.engines.map(({ id, name, agent }) => {
      const engine = known.get(id) ?? new RemoteEngine({ id, name, agent })
      engine.describe(agent)
      if (states?.[id]) engine.apply(states[id], true)
      return engine
    })
    for (const [id, engine] of known) if (!engines.some((e) => e.id === id)) engine.dispose()
    const activeId = engines.some((e) => e.id === this.#state.activeId) ? this.#state.activeId : registry.requiredId
    this.#set({
      agents: registry.agents,
      edited: registry.edited,
      status: registry.status,
      error: registry.error,
      requiredId: registry.requiredId,
      autopilot: !!registry.autopilot,
      engines,
      activeId,
    })
  }

  #applyAgent(agent, edited) {
    this.#set({
      agents: this.#state.agents.map((a) => (a.name === agent.name ? agent : a)),
      edited,
    })
    for (const engine of this.#state.engines) {
      if (engine.agent.name === agent.name) engine.reconfigure(agent)
      // Agents that call this one as a tool re-read its description.
      else if (engine.agent.agents?.includes(agent.name)) engine.reconfigure()
    }
  }

  // Save an edit to an agent's editable fields; live engines pick it up.
  updateAgent(name, patch) {
    if (this.#remote) return teamCall("registry", "updateAgent", [name, patch])
    const current = this.#state.agents.find((a) => a.name === name)
    if (!current) throw new Error(`Unknown agent: ${name}`)
    const next = validateAgent({ ...current, ...pickEditable({ ...current, ...patch }) })

    const edits = readAgentEdits()
    edits[name] = pickEditable(next)
    writeAgentEdits(edits)

    const edited = this.#state.edited.includes(name) ? this.#state.edited : [...this.#state.edited, name]
    this.#applyAgent(next, edited)
    return next
  }

  // Drop the saved edit and return to the agent.md file version.
  resetAgent(name) {
    if (this.#remote) return teamCall("registry", "resetAgent", [name])
    const original = this.#fileAgents.get(name)
    if (!original) throw new Error(`Unknown agent: ${name}`)
    const edits = readAgentEdits()
    delete edits[name]
    writeAgentEdits(edits)
    this.#applyAgent(original, this.#state.edited.filter((n) => n !== name))
  }

  // Start another engine from a loaded agent definition (e.g. after closing one).
  create(agentName) {
    if (this.#remote) {
      return teamCall("registry", "create", [agentName]).then((id) => {
        this.select(id)
        return this.#state.engines.find((e) => e.id === id) ?? null
      })
    }
    const agent = this.#state.agents.find((a) => a.name === agentName)
    if (!agent) throw new Error(`Unknown agent: ${agentName}`)
    const siblings = this.#state.engines.filter((e) => e.agent.name === agentName).length
    const name = siblings ? `${agent.name} ${siblings + 1}` : agent.name
    const engine = this.#factory({ agent, name, host: this.#host })
    engine.restore() // reopened agents pick up their saved memory
    this.#watchApprovals(engine)
    this.#set({ engines: [...this.#state.engines, engine], activeId: engine.id })
    return engine
  }

  select(id) {
    if (this.#state.engines.some((e) => e.id === id)) this.#set({ activeId: id })
  }

  dispose(id) {
    if (this.#remote) return void teamCall("registry", "dispose", [id]).catch(() => {})
    const engines = this.#state.engines
    const index = engines.findIndex((e) => e.id === id)
    if (index === -1 || id === this.#state.requiredId) return
    engines[index].dispose()
    const rest = engines.filter((e) => e.id !== id)
    const activeId =
      this.#state.activeId === id ? (rest[index] ?? rest[index - 1] ?? null)?.id ?? null : this.#state.activeId
    this.#set({ engines: rest, activeId })
  }
}

export const engineRegistry = new EngineRegistry()
