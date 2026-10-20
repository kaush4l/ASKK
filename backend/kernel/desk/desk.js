import { Agent, roleLine } from "../agent/agent.js"
import { SharedBoard } from "../artifact/board.js"
import { AgentTool, Tool } from "../tool/tool.js"

// Desk: configuration in, live agents out. One spec shape, nested to any depth:
//
//   agent spec  {name, role, team?, title?, goal?, description?, model?, maxSteps?, desk?, writes?, reads?, board?,
//                artifacts?, tools?: [tool spec]}
//   desk: the name of another desk whose team is mounted under this agent (kept as agent.desk, in tree() and twin())
//   writes / reads: its files lanes (globs: backend/kernel/builtin/files.js); board: false keeps it off its team's board
//
// Everything an agent can call is a tool, in ONE list, built by its type:
//   "market.quote"                               the desk's catalogue (env.tools): a function tool
//   {type: "function", name, description, input, run}   an inline function tool
//   {type: "agent", name, role, tools, …}        another agent, built here, handed over as an AgentTool
//   {type: "mcp", server, tool, …} or any {type} built by env.types[type](spec, agent): the desk says
//                                                how its MCP servers (or anything else) are reached
//   a Tool or an Agent instance                  as is
//   (agent) => Tool                              a factory, called with the agent being built
//
// An agent holding agents leads a team: it gets one SharedBoard "<team>.board" (team = spec.team ??
// its name; parent = the board of the team above), shared with the agents it holds, so the goal
// flows down and findings stay where the team works. A desk is the outermost agent.
//
// env: {infer(prompt, agent), tools?: {name: Tool | (agent) => Tool}, types?: {type: (spec, agent) => Tool},
//       artifacts?: {type: (agent, spec) => Artifact}, context?, clock?, maxDepth?}
// context: a plain object every agent of the desk hands its tool calls (agent.context → ctx: {...context, agent,
// signal}), so a tool reaches the host (ctx.host…) without globals.
// An artifact spec {type, commands?, gate?} also says how the agent holds it (Agent.addArtifact options).
//
// 2026-10-17: the agent set is not fixed. The Desk keeps its build context (desk.ctx: env, context, names, the list),
// so Desk.spawn(spec, caller) builds a helper at run time through the same buildAgent (unique names, maxDepth, the
// catalogue's names) and Desk.dismiss(name, by) removes it; Desk.on taps hear agents added later, and get the desk's
// own events {event: "spawn" | "dismiss", agent, by, goal, keep; spawn: team — the spawned team's name, else null}.
// Every agent knows its desk (agent.home), its depth and the board of the team above it (agent.parentBoard).

export function buildDesk(spec, env) {
  const ctx = { env, context: env.context ?? {}, names: new Set(), all: [] } // one context object for the whole desk
  return new Desk(buildAgent(spec, ctx, { parentBoard: null, depth: 0 }), ctx.all, ctx)
}

// A spawned agent's name: lowercase, a-z 0-9 -, 2–31 chars, starting with a letter. 2026-10-17 (critic): Desk.spawn
// checks it itself, not only the agent.spawn tool — the host makes the name a folder (state/spawned/<name>/), and
// Desk.spawn({name: ".."}) wrote the helper's agent.md and transcript into state/.
export const SPAWN_NAME = /^[a-z][a-z0-9-]{1,30}$/
export function spawnName(raw) {
  const name = String(raw ?? "")
  if (!SPAWN_NAME.test(name)) throw new Error(`name "${name}": lowercase letters, digits and -, 2–31 chars, starting with a letter`)
  return name
}

// What a helper may hold of an artifact its caller holds: own = the caller's commands subset (agent.holding; null =
// every command), asked = the subset asked for the helper (null = none asked; "<id>.<cmd>" or "<cmd>"). Nothing asked
// → the caller's own; each one asked must be the caller's. → the helper's subset (null = every command). 2026-10-17
// (critic): a caller holding terminal [read, wait] gave its helper start and stop.
export function withinHolding(own, asked, id) {
  const short = (c) => {
    const s = String(c).trim()
    return s.startsWith(`${id}.`) ? s.slice(id.length + 1) : s
  }
  const want = asked == null ? null : [].concat(asked).map(short).filter(Boolean)
  if (!own) return want
  if (want == null) return [...own]
  const extra = want.filter((c) => !own.includes(c))
  if (extra.length) throw notYours(extra, own, id)
  return want
}
const notYours = (extra, own, id) => new Error(`${extra.join(", ")} ${extra.length > 1 ? "are" : "is"} not yours on ${id} (yours: ${own.join(", ") || "none"})`)
// A member in a spawn spec's tools: a nested agent spec (buildAgent builds it under the helper).
const isMember = (t) => !!t && typeof t === "object" && !(t instanceof Tool) && t.type === "agent"
// An agent and every agent below it (its members, the helpers it spawned), the deepest first: the order they go in.
const subtreeOf = (a) => [...(a.children ?? []).flatMap(subtreeOf), a]
// Running, or holding a run accepted and not started yet (Agent.busy): not dismissed under it.
const working = (a) => a.status === "running" || a.busy === true

export class Desk {
  #taps = new Set() // Desk.on listeners: {fn, offs: Map(agent name -> unsubscribe)}
  #leases = new Map() // spawned agent name -> what ties it to its caller (keep: run listeners), released on dismiss

  constructor(lead, all, ctx = null) {
    this.lead = lead
    this.board = lead.board
    this.list = all
    // A Desk built by hand (no buildDesk) still spawns: its context is the lead's, its names the agents it holds.
    this.ctx = ctx ?? { env: {}, context: lead.context ?? {}, names: new Set(all.map((a) => a.name)), all }
    for (const a of all) a.home = this
  }

  ask(text, opts) {
    return this.lead.ask(text, opts)
  }

  // Every agent in the tree, keyed by name (names are unique across a desk).
  agents() {
    return new Map(this.list.map((a) => [a.name, a]))
  }

  // Every team board, outermost first.
  boards() {
    return this.list.map((a) => a.board).filter(Boolean)
  }

  // Every artifact by id with the agents that hold it, in tree order: id -> {artifact, holders: [names]}.
  artifacts() {
    const out = new Map()
    for (const a of this.list)
      for (const art of a.artifacts) {
        if (!out.has(art.id)) out.set(art.id, { artifact: art, holders: [] })
        out.get(art.id).holders.push(a.name)
      }
    return out
  }

  // The desk as plain data for its UI twin: the lead, the tree, every agent's twin, every artifact's twin with its holders.
  twin() {
    return {
      element: "desk",
      lead: this.lead.name,
      tree: this.tree(),
      agents: this.list.map((a) => a.twin()),
      artifacts: Object.fromEntries([...this.artifacts()].map(([id, { artifact, holders }]) => [id, { ...artifact.twin(), holders }])),
    }
  }

  // One listener for every agent in the tree, now and later (a spawned agent is heard from its first event); the
  // payload carries the team path. The desk's own events (spawn, dismiss) reach it too.
  on(fn) {
    const tap = { fn, offs: new Map() }
    this.#taps.add(tap)
    for (const a of this.list) this.#hear(tap, a)
    return () => {
      this.#taps.delete(tap)
      tap.offs.forEach((off) => off())
      tap.offs.clear()
    }
  }

  #hear(tap, a) {
    tap.offs.set(a.name, a.on("*", (e) => tap.fn({ ...e, team: a.teamPath })))
  }

  #emit(event, data) {
    const payload = { event, at: Date.now(), ...data }
    for (const tap of this.#taps) tap.fn(payload)
  }

  // A helper for `caller`, built now (agent.spawn): spec {name, role, goal, tools?, artifacts?, keep?: run | desk}
  // in buildAgent's shapes (tool names or instances, artifact {type, commands?, gate?} or {artifact, commands?,
  // gate?}). It runs as its caller does — soul, model, models, fallbacks, maxSteps, report, system, its files lanes
  // (writes, reads) and board: false copied unless the spec sets them (agent.spawn checks a set lane is within the
  // caller's) — sits in the caller's team (the caller's board, else the one above it), uses the caller's context (a
  // mounted desk's own), and becomes the caller's AgentTool "<name>: <goal>". keep "run" (the default): dismissed when
  // the caller's run ends. → the new agent. Nothing changes when it fails (the build is undone). Its name passes
  // SPAWN_NAME. An artifact it shares with its caller is held within the caller's commands subset (withinHolding): an
  // instance the caller holds comes with the caller's subset unless a narrower one is asked; one that came another way
  // (a catalogue type that resolved to the caller's instance) and holds more is refused.
  // 2026-10-17 owner ("let the lead, when required, create a sub team"): a spec whose tools hold members ({type:
  // "agent", name, role, …}, any depth) builds a TEAM — the helper leads it with its own board "<name>.board" under the
  // caller's. Every agent built is wired as the helper is (home, the caller's context, every tap, the caller's
  // config copied unless its own spec sets it, config.spawned {by: its builder, goal, at, keep, team: the helper's
  // name}), every one is bounded by the caller's holdings, keep run dismisses the whole team, and the desk emits one
  // spawn event per agent, the helper first.
  // 2026-10-17 (critic): a team board's id is "<team>.board", and a team's name need not be an agent's (a convention
  // desk's lead leads the team named after the desk): a name — the helper's or a member's — whose board id is already
  // in the desk is refused before anything is built (a second "<desk>.board" had no twin and misreported holders).
  spawn(spec, caller) {
    if (!caller || caller.home !== this || !this.list.includes(caller)) throw new Error("spawn: the caller is not an agent of this desk")
    const name = spawnName(spec?.name)
    if (caller.tools.has(name)) throw new Error(`${caller.name} already has a tool named ${name}`)
    const ids = new Set([...this.boards().map((b) => b.id), ...this.artifacts().keys()])
    const teams = (s) => [s.team ?? s.name, ...(s.tools ?? []).filter(isMember).flatMap(teams)]
    for (const t of teams({ ...spec, name })) if (ids.has(`${t}.board`)) throw new Error(`${t}.board exists: pick another team name`)
    const goal = String(spec?.goal ?? "").trim()
    const keep = spec?.keep === "desk" ? "desk" : "run"
    const c = caller.config
    // board: a caller kept off its team's board (board: false) spawns helpers kept off it too.
    const inherited = Object.fromEntries(["soul", "model", "models", "fallbacks", "maxSteps", "report", "system", "writes", "reads", "board"].filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))
    // 2026-10-20: spec.at — when a kept helper was first made (respawn after a restart); spec.input — the spawn input as
    // plain data (agent.spawn's record), kept on the helper's config.spawned for its agent.md and agent.update.
    const at = typeof spec?.at === "string" && !Number.isNaN(Date.parse(spec.at)) ? spec.at : new Date().toISOString()
    const team = (spec.tools ?? []).some(isMember) ? name : null
    const ownOf = (x) => caller.holding?.get(x.id)?.commands ?? null
    const held = (list) =>
      (list ?? []).map((a) => {
        const x = typeof a?.render === "function" ? a : a?.artifact && typeof a.artifact.render === "function" ? a.artifact : null
        if (!x || !caller.artifacts.includes(x)) return a
        const hold = x === a ? {} : a
        return { ...hold, artifact: x, commands: withinHolding(ownOf(x), hold.commands ?? null, x.id) }
      })
    // One spec as buildAgent takes it: the caller's config under its own (fields it leaves undefined stay the
    // caller's), the caller's holdings bound, its members prepared the same way (their builder: this agent).
    const prepare = (s, by, input = null) => {
      const { keep: _, input: _input, at: _at, ...rest } = s
      const own = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
      const tools = (own.tools ?? []).map((t) => (isMember(t) ? (spawnName(t.name), prepare(t, own.name)) : t))
      return { ...inherited, ...own, tools, artifacts: held(own.artifacts), spawned: { by, goal, at, keep, ...(team ? { team } : {}), ...(input ? { input } : {}) } }
    }
    const names = new Set(this.ctx.names)
    const before = this.list.length
    let sub
    let built
    try {
      sub = buildAgent({ ...prepare(spec, caller.name, spec.input && typeof spec.input === "object" ? structuredClone(spec.input) : null), goal }, this.ctx, { parentBoard: caller.board ?? caller.parentBoard ?? null, depth: (caller.depth ?? 0) + 1 })
      built = this.list.slice(before) // the helper first, then its members (buildAgent's order)
      for (const a of built)
        for (const x of a.artifacts) {
          const own = caller.artifacts.includes(x) ? ownOf(x) : null
          if (!own) continue
          const short = (t) => (t.name.startsWith(`${x.id}.`) ? t.name.slice(x.id.length + 1) : t.name)
          const got = a.holding.get(x.id)?.commands ?? x.commands().map(short)
          const extra = got.filter((cmd) => !own.includes(cmd))
          if (extra.length) throw notYours(extra, own, x.id)
        }
    } catch (error) {
      // Undone: every agent built so far leaves the list, its artifacts, and its team board the board above.
      for (const half of this.list.splice(before)) {
        for (const a of half.artifacts) a.detach?.(half)
        half.board?.detach()
      }
      this.ctx.names = names
      throw error
    }
    for (const a of built) {
      a.home = this
      a.context = caller.context
      for (const tap of this.#taps) this.#hear(tap, a)
    }
    ;(caller.children ??= []).push(sub) // an Agent made by hand (new Desk(lead, [lead])) has no children yet
    caller.addTool(new AgentTool(sub, { description: `${name}: ${goal}` }))
    if (keep === "run") {
      // The caller's run ends (answer or error): the helper goes — with its team — once their runs have ended too
      // (a member may still answer a quest or a dispatch when the caller answers: wait for every queue, then again).
      const done = () => {
        release()
        const go = async () => {
          for (let round = 0; round < 50 && this.list.includes(sub); round++) {
            const busy = subtreeOf(sub).filter(working)
            if (!busy.length) {
              try {
                this.dismiss(sub.name)
              } catch {}
              return
            }
            await Promise.allSettled(busy.map((a) => a.queue ?? Promise.resolve()))
          }
        }
        go()
      }
      const offs = [caller.on("answer", done), caller.on("error", done)]
      const release = () => offs.forEach((off) => off())
      this.#leases.set(sub.name, release)
    }
    for (const a of built) this.#emit("spawn", { agent: a.name, by: a.config.spawned.by, goal, keep, team })
    return sub
  }

  // Removes a spawned agent everywhere (the list, its caller's tools and children, the names, every tap), and the
  // helpers it spawned with it. by: the agent asking (agent.dismiss) — only the one that spawned it may; null = the
  // owner or the host. Refused while it, or a helper of its, runs. 2026-10-17: a team goes whole — dismissing its
  // lead takes every member (they are its children) and unlinks each team board from the board above; a member alone
  // is refused, whoever asks.
  // reason (2026-10-20): "update" — agent.update rebuilds it at once (the host keeps a kept helper's folder); in the event.
  dismiss(name, by = null, { reason = null } = {}) {
    const sub = this.list.find((a) => a.name === name)
    if (!sub) throw new Error(`no agent ${name} in this desk`)
    const spawned = sub.config.spawned
    if (!spawned) throw new Error(`${name} is part of the desk, not a spawned helper: it cannot be dismissed`)
    if (spawned.team && spawned.team !== name) throw new Error(`${name} is a member of team ${spawned.team}: dismiss the team (${spawned.team}), its members go with it`)
    if (by != null && spawned.by !== by) throw new Error(`${name} was spawned by ${spawned.by}: only ${spawned.by} dismisses it`)
    const going = subtreeOf(sub)
    const busy = going.filter(working)
    if (busy.length) throw new Error(`${busy.map((a) => a.name).join(", ")} ${busy.length > 1 ? "are" : "is"} running: dismiss once ${busy.length > 1 ? "they have" : "it has"} answered`)
    for (const a of going) {
      const caller = this.list.find((x) => x.name === a.config.spawned?.by)
      if (caller) {
        caller.children = (caller.children ?? []).filter((x) => x !== a)
        if (caller.tools.get(a.name)?.agent === a) caller.tools.delete(a.name)
      }
      const i = this.list.indexOf(a)
      if (i >= 0) this.list.splice(i, 1)
      this.ctx.names.delete(a.name)
      this.#leases.get(a.name)?.()
      this.#leases.delete(a.name)
      for (const tap of this.#taps) {
        tap.offs.get(a.name)?.()
        tap.offs.delete(a.name)
      }
      for (const x of a.artifacts) x.detach?.(a)
      a.board?.detach() // its team's board leaves the board above (the parent's snapshot no longer lists it)
      a.home = null
      this.#emit("dismiss", { agent: a.name, by: a === sub ? (by ?? spawned.by) : a.config.spawned?.by, goal: a.config.spawned?.goal ?? "", keep: a.config.spawned?.keep ?? "run", team: a.config.spawned?.team ?? null, ...(reason ? { reason } : {}) })
    }
    return going.map((a) => a.name)
  }

  // The shape as plain data: each agent with its tools by type and the agents it holds; spawned: who spawned it, for
  // what, when and how long it stays (Desk.spawn), else null.
  tree(agent = this.lead) {
    return {
      name: agent.name,
      team: agent.board?.team ?? null,
      title: agent.board?.title ?? null,
      goal: agent.board?.state.goal ?? null,
      model: agent.config.model ?? null,
      desk: agent.desk ?? null,
      description: agent.config.description ?? roleLine(agent.config.role),
      tools: [...agent.tools.values()].filter((t) => t.type !== "agent" && t.type !== "artifact").map((t) => ({ name: t.name, type: t.type })),
      spawned: agent.config.spawned ?? null,
      agents: (agent.children ?? []).map((c) => this.tree(c)),
    }
  }
}

export function buildAgent(spec, ctx, { parentBoard = null, depth = 0 } = {}) {
  const { env } = ctx
  if (!spec?.name) throw new Error("agent spec needs a name")
  if (ctx.names.has(spec.name)) throw new Error(`agent name ${spec.name} used twice`)
  if (depth > (env.maxDepth ?? 4)) throw new Error(`${spec.name}: nested too deep`)
  ctx.names.add(spec.name)

  const tools = (spec.tools ?? []).map((t) => typed(t, spec.name))
  const team = spec.team ?? spec.name
  const board = tools.some((t) => t.type === "agent")
    ? new SharedBoard({ name: team, title: spec.title ?? `${team} board`, parent: parentBoard, goal: spec.goal ?? "", clock: env.clock })
    : null
  const agent = new Agent(spec, { infer: env.infer, context: (ctx.context ??= env.context ?? {}) })
  agent.board = board
  agent.desk = spec.desk ?? null
  agent.teamPath = (board ?? parentBoard)?.path().join("/") ?? ""
  agent.children = []
  agent.depth = depth // 0 for the lead (Desk.spawn: a helper is its caller's depth + 1, within maxDepth)
  agent.parentBoard = parentBoard // the board of the team above (a spawned helper joins its caller's team)
  ctx.all.push(agent)

  for (const t of tools) {
    if (t.type === "agent") {
      const sub = buildAgent(t, ctx, { parentBoard: board, depth: depth + 1 })
      agent.children.push(sub)
      agent.addTool(new AgentTool(sub, { description: t.description ?? (t.goal ? `${t.title ?? t.name}: ${t.goal}` : undefined), after: t.after }))
    } else agent.addTool(makeTool(t, env, agent))
  }
  // Least-changing first (memory, checklist…), the busy board last, so a prompt's head stays stable. A spec's
  // commands (a subset) and gate say how this agent holds the artifact.
  for (const a of spec.artifacts ?? []) agent.addArtifact(resolveArtifact(a, env, agent), holdOf(a))
  // 2026-10-17: board: false keeps an agent off its team's board — the critic judges the output, never the coder's
  // notes. An agent that leads a team still holds its own board (its members write there).
  const held = board ?? (spec.board === false ? null : parentBoard)
  if (held) agent.addArtifact(held)
  return agent
}

// How an artifact spec is held: {commands?, gate?} from a typed spec or {artifact, …}; a name, factory or instance as is.
const holdOf = (a) => (a && typeof a === "object" && typeof a.render !== "function" ? { commands: a.commands ?? null, gate: !!a.gate } : {})

// A tool spec in its typed form: a name is a catalogue function tool; instances pass through; a function is a
// factory, called with the agent once it exists. The two internal forms are symbols, so a desk's own tool type
// can never be mistaken for them (a spec {type: "instance"} goes to env.types like any other type).
const INSTANCE = Symbol("instance")
const FACTORY = Symbol("factory")
function typed(t, owner) {
  if (t instanceof Tool) return { type: INSTANCE, tool: t }
  if (t instanceof Agent) return { type: INSTANCE, tool: new AgentTool(t) }
  if (typeof t === "function") return { type: FACTORY, make: t }
  if (typeof t === "string") return { type: "function", name: t }
  if (t?.type) return t
  throw new Error(`${owner}: a tool spec needs a type (${JSON.stringify(t)})`)
}

function makeTool(t, env, agent) {
  if (t.type === INSTANCE) return t.tool
  if (t.type === FACTORY) {
    const tool = t.make(agent)
    if (!tool?.name) throw new Error(`${agent.name}: a tool factory returned no tool`)
    return tool
  }
  if (t.type === "function") {
    if (typeof t.run === "function") return new Tool(t)
    const entry = env.tools?.[t.name]
    if (!entry) throw new Error(`${agent.name}: unknown tool ${t.name}`)
    return typeof entry === "function" ? entry(agent) : entry
  }
  const make = env.types?.[t.type]
  if (!make) throw new Error(`${agent.name}: no builder for tool type ${t.type}`)
  const tool = make(t, agent)
  if (!tool?.name) throw new Error(`${agent.name}: the ${t.type} builder returned no tool`)
  return tool
}

// An artifact by catalogue name ("ticket" → env.artifacts.ticket(agent)), a typed spec
// ({type: "checklist", items} → env.artifacts.checklist(agent, spec)), a factory, an instance, or {artifact: instance
// | factory, commands?, gate?} (held with a commands subset or gated: Desk.spawn shares the caller's instance; a
// composer that binds its own catalogue hands a factory this way and keeps the spec's commands and gate).
function resolveArtifact(a, env, agent) {
  if (a?.artifact && typeof a.artifact.render === "function") return a.artifact
  if (a && typeof a === "object" && typeof a.artifact === "function") {
    const made = a.artifact(agent)
    if (!made || typeof made.render !== "function") throw new Error(`${agent.name}: an artifact factory returned no artifact`)
    return made
  }
  const named = typeof a === "string" ? { type: a } : a?.type && !(a.render instanceof Function) ? a : null
  if (named) {
    const make = env.artifacts?.[named.type]
    if (!make) throw new Error(`${agent.name}: unknown artifact ${named.type}`)
    return make(agent, named)
  }
  return typeof a === "function" ? a(agent) : a
}
