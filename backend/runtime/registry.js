import { pickEditable, readAgentEdits, writeAgentEdits } from "@/backend/agents/agent-store"
import { loadAgents, validateAgent } from "@/backend/agents/definitions"
import { EngineProxy } from "@/backend/runtime/engine-proxy"
import { createSupervisor } from "@/backend/runtime/supervisor"
import { models } from "@/backend/models/catalog"

// Owns the agent definitions and every live engine in this browser tab.
// On startup every agent in public/agents/index.json gets an engine, each on
// its own Web Worker thread (EngineProxy here, the engine in the worker).
// The first agent in index.json is the default agent: its engine is
// required (`requiredId`) and cannot be closed; extra engines can.
// Module-level singleton: engines survive route changes, not page reloads.
class EngineRegistry {
  #listeners = new Set()
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
  }

  getSnapshot = () => this.#state

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
    this.#set({ status: "loading", error: null })
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
      const engines = agents.map((agent) => new EngineProxy({ agent, host: this.#host }).init())
      // Each engine reloads its own memory file before the registry is ready.
      await Promise.all(engines.map((engine) => engine.restore()))
      const requiredId = engines[0]?.id ?? null
      this.#set({ engines, activeId: requiredId, requiredId, status: "ready" })
      // Status checks on long-running quests, sent to each quest's owner.
      createSupervisor({
        engines: () => this.#state.engines,
        deliver: (id, letter) => this.#state.engines.find((e) => e.id === id && e.status !== "disposed")?.deposit(letter),
      })
      // Catalogue changes (new default, edited connection) reach every engine.
      models.subscribe(() => {
        for (const engine of this.#state.engines) engine.reconfigure()
      })
    } catch (error) {
      this.#set({ status: "error", error: error.message })
    }
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
    const original = this.#fileAgents.get(name)
    if (!original) throw new Error(`Unknown agent: ${name}`)
    const edits = readAgentEdits()
    delete edits[name]
    writeAgentEdits(edits)
    this.#applyAgent(original, this.#state.edited.filter((n) => n !== name))
  }

  // Start another engine from a loaded agent definition (e.g. after closing one).
  create(agentName) {
    const agent = this.#state.agents.find((a) => a.name === agentName)
    if (!agent) throw new Error(`Unknown agent: ${agentName}`)
    const siblings = this.#state.engines.filter((e) => e.agent.name === agentName).length
    const name = siblings ? `${agent.name} ${siblings + 1}` : agent.name
    const engine = new EngineProxy({ agent, name, host: this.#host }).init()
    engine.restore() // reopened agents pick up their saved memory
    this.#set({ engines: [...this.#state.engines, engine], activeId: engine.id })
    return engine
  }

  select(id) {
    if (this.#state.engines.some((e) => e.id === id)) this.#set({ activeId: id })
  }

  dispose(id) {
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
