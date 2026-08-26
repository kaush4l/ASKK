/** Registry — load every agent, each on its own worker (PORT-MAP R3).
 *
 *     const main = await loadAgents({ ports, state, workerUrl })
 *
 * Agents come from two places. `core/agents/` holds the built-in ones — the
 * summarizer above all, since an engine with no summarizer cannot compact its
 * history. `agents/` holds the ones this project is configured with, and a name
 * in both belongs to that copy: it is how a project replaces a built-in without
 * editing the package.
 *
 * Who may call whom is written in the agent files: an agent's `tools` list names
 * the sub-agents it gets, exactly as it names its functions and its MCP tools,
 * and nothing is attached that an agent did not ask for. What each worker is
 * doing is in the state table — the registry is the only place that sees a turn
 * begin and end, so it is what records it. `workerUrl` is a parameter for the
 * reason `worker-host.js` gives: nothing computes it, the caller passes it.
 */

import { parseAgentFile } from "./frontmatter.js"
import { Status } from "./state.js"
import { AgentWorker, SILENT, why } from "./worker-host.js"

/** @typedef {import("./ports.js").Ports} Ports */
/** @typedef {import("./state.js").State} State */
/** @typedef {import("./worker-host.js").Log} Log */
/** @typedef {{ ports: Ports, state: State, workerUrl: string, builtinDir: string, names: string[], log: Log }} Context */

export const MAIN_AGENT = "main"
export const SUMMARIZER_AGENT = "summarizer"
// Fresh-context reviewers for the full flow's verify and critique phases.
// Distributed like the summarizer: nobody's tool, everybody's reviewer.
export const VERIFIER_AGENT = "verifier"
export const CRITIC_AGENT = "critic"
// Where the code's own agents live, and where the project's do.
export const BUILTIN_DIR = "core/agents"
export const AGENTS_DIR = "agents"

/** An agent pinned to its worker. Quacks like an Agent, so it is also a tool. */
export class WorkerAgent {
  /** @param {{ worker: AgentWorker, dir: string, state: State, name: string, description: string }} d */
  constructor(d) {
    /** @type {AgentWorker} */ this.worker = d.worker
    /** @type {string} */ this.dir = d.dir // the folder this agent was loaded from
    /** @type {State} */ this.state = d.state
    /** @type {string} */ this.name = d.name
    /** @type {string} */ this.description = d.description
    /** @type {WorkerAgent[]} */ this.peers = []
    /** @type {{ role: string, content: string }[]} */ this.turns = []
    // Set on the one agent the caller holds. Only that agent can be waiting on
    // a person; everyone else answers to another agent.
    this.entry = false
  }

  /** The conversation as of this agent's last turn. R3 makes `Agent.messages` a
   * live view, and in the worker it still is; across the boundary it cannot be —
   * structured clone copies — so it rides back with every answer, and the
   * worker's `messages` call re-reads it out of turn.
   * @returns {{ role: string, content: string }[]} */
  get messages() {
    return this.turns
  }

  /** Take a turn on this worker, with the state table kept current. @param {string} userInput @returns {Promise<any>} */
  async invoke(userInput) {
    this.state.set(this.name, Status.WORKING)
    let reply
    try {
      reply = await this.worker.run({ type: "invoke", input: userInput })
    } catch (e) {
      this.state.set(this.name, Status.FAILED, why(e))
      throw e
    }
    this.turns = reply?.messages ?? this.turns
    // Only the agent a person is talking to can be waiting on one; a sub-agent's
    // caller already has its answer and has moved on.
    this.state.set(this.name, this.entry ? Status.WAITING : Status.IDLE)
    return reply?.answer
  }

  /** Close this agent and every peer it owns. @param {Log} [log] @returns {Promise<void>} */
  async close(log = SILENT) {
    for (const agent of [...this.peers, this]) {
      try {
        await agent.worker.run({ type: "close" })
      } catch (e) {
        log.warning(`${agent.name}: error during close: ${why(e)}`) // shutdown must not raise
      }
      agent.worker.stop()
      this.state.set(agent.name, Status.CLOSED)
    }
  }
}

/** Build one agent on a fresh worker; a broken one is skipped, not fatal. @param {string} name @param {string} dir @param {Context} ctx @returns {Promise<WorkerAgent | null>} */
async function start(name, dir, ctx) {
  const worker = new AgentWorker(name, ctx.ports.spawnWorker(ctx.workerUrl, { name: `agent-${name}` }))
  ctx.state.register(name, worker.name, dir === ctx.builtinDir)
  worker.onState = (status, detail) => ctx.state.set(name, /** @type {any} */ (status), detail)
  try {
    const info = await worker.run({ type: "boot", name, dir, agentNames: ctx.names })
    ctx.log.info(`agent '${name}' ready`)
    ctx.state.set(name, Status.IDLE)
    return new WorkerAgent({ worker, dir, state: ctx.state, name, description: String(info?.description ?? "") })
  } catch (e) {
    ctx.log.error(`agent '${name}' failed to load: ${why(e)}`)
    ctx.state.set(name, Status.FAILED, why(e))
    worker.stop()
    return null
  }
}

/** Every agent name, mapped to the folder it lives in. Built-ins first, so a project agent of the same
 * name replaces one — overriding the summarizer should not mean two running.
 * @param {Ports} ports @param {string[]} dirs @returns {Promise<Map<string, string>>} */
async function agentDirs(ports, dirs) {
  /** @type {Map<string, string>} */ const found = new Map()
  for (const dir of dirs) {
    for (const entry of await ports.fs.list(dir)) {
      const name = entry.endsWith("/") ? entry.slice(0, -1) : ""
      if (name && (await ports.fs.exists(`${dir}/${name}/agent.md`))) found.set(name, dir)
    }
  }
  return found
}

/** All of a peer that crosses. @param {WorkerAgent} a @returns {object} */ const shape = (a) => ({ name: a.name, description: a.description })

/** The sub-agents this one's frontmatter asks for, minus itself. A non-list `tools:` yields nothing
 * rather than being walked character by character into bogus names — D-2's ruling, applied here too.
 * @param {WorkerAgent} agent @param {Map<string, WorkerAgent>} started @param {Context} ctx @returns {Promise<WorkerAgent[]>} */
async function wantedAgents(agent, started, ctx) {
  const path = `${agent.dir}/${agent.name}/agent.md`
  try {
    const { metadata } = parseAgentFile((await ctx.ports.fs.read(path)) ?? "", path)
    const declared = Array.isArray(metadata.tools) ? metadata.tools.map(String) : []
    const found = declared.map((/** @type {string} */ n) => started.get(n)).filter((p) => p && p !== agent)
    return /** @type {WorkerAgent[]} */ (found)
  } catch (e) {
    ctx.log.warning(`${agent.name}: could not re-read frontmatter for wiring: ${why(e)}`) // loaded once already
    return []
  }
}

/** Attach the sub-agents each agent asked for, then the three it did not. The summarizer is nobody's
 * tool — no agent calls it on purpose; it is what every other engine hands its history to when that
 * gets too long, and the reviewers are the same: fresh context, called by the verify and critique
 * phases rather than by the model. Each answers to a field named as the agent is.
 * @param {Map<string, WorkerAgent>} started @param {Context} ctx @returns {Promise<void>} */
async function wire(started, ctx) {
  for (const agent of started.values()) {
    const wanted = await wantedAgents(agent, started, ctx)
    if (!wanted.length) continue
    await agent.worker.run({ type: "attach", role: "tools", peers: wanted.map(shape) })
    ctx.log.info(`agent '${agent.name}' sub-agents: ${wanted.map((a) => a.name).join(", ")}`)
  }
  for (const role of [SUMMARIZER_AGENT, VERIFIER_AGENT, CRITIC_AGENT]) {
    const reviewer = started.get(role)
    if (!reviewer) continue
    for (const agent of started.values()) {
      if (agent !== reviewer) await agent.worker.run({ type: "attach", role, peers: [shape(reviewer)] })
    }
    ctx.log.info(`agent '${reviewer.name}' will act as ${role} for the others`)
  }
}

/** Load every agent under `agentsDir` and return the main one. Wiring happens
 * after every worker is up, which is what lets two agents name each other. A peer
 * crosses as its name and description only — that plus `invoke` is the whole duck
 * type a toolbox needs, so a sub-agent is a tool on both sides with no adapter,
 * and the call is routed back out here by `onPeer`. The main agent *owns* all of
 * them: closing what the caller holds has to close every worker, called or not.
 * @param {{ ports: Ports, state: State, workerUrl: string, agentsDir?: string, builtinDir?: string, main?: string, log?: Log }} options
 * @returns {Promise<WorkerAgent>} */
export async function loadAgents(options) {
  const { ports, state, workerUrl, main = MAIN_AGENT, log = SILENT } = options
  const builtinDir = options.builtinDir ?? BUILTIN_DIR
  const directory = options.agentsDir ?? AGENTS_DIR
  const homes = await agentDirs(ports, [builtinDir, directory])
  const names = [...homes.keys()]
  if (!homes.has(main)) throw new Error(`No main agent '${main}' in ${directory} (found: ${names.join(", ") || "none"})`)
  /** @type {Context} */
  const ctx = { ports, state, workerUrl, builtinDir, names, log }
  const loaded = await Promise.all([...homes].map(([name, home]) => start(name, home, ctx)))
  /** @type {Map<string, WorkerAgent>} */ const started = new Map()
  for (const agent of loaded) if (agent) started.set(agent.name, agent)
  const mainAgent = started.get(main)
  if (!mainAgent) throw new Error(`Main agent '${main}' failed to load`)
  mainAgent.entry = true
  state.set(main, Status.WAITING)
  for (const agent of started.values()) {
    agent.worker.onPeer = async (name, input) => {
      const peer = started.get(name)
      if (!peer) throw new Error(`no agent named '${name}'`)
      return await peer.invoke(input)
    }
  }
  await wire(started, ctx)
  mainAgent.peers = [...started.values()].filter((agent) => agent !== mainAgent)
  return mainAgent
}
