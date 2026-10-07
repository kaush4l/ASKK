// Spawner — sub-agents an agent creates while it works (the `team` artifact's
// agent.spawn / agent.task / agent.keep / agent.kill). Modelled on Claude
// Code's Task subagents and VS Code's custom agents: the caller writes the
// sub-agent's role and hands it one goal; the sub-agent runs in its own
// engine (own thread, inbox, memory, context window) with at most the
// caller's own tools, and its final answer comes back as a report. Then the
// caller decides: kill it (done), give it another quest (agent.task), or keep
// it (a team member that survives restarts).
//
// Rules:
//   - only an agent whose agent.md lists the `team` artifact spawns; a spawned
//     agent never spawns (one level, as in Claude Code);
//   - tools, MCP servers and artifacts ⊆ the caller's (never more power);
//   - file lane `writes` ⊆ the caller's lane (default: the caller's), so parallel
//     helpers get disjoint folders; `preserve` and `strict` are inherited;
//   - at most `spawn_max` (agent.md, default 6) alive per caller;
//   - a task agent (not kept) idle for `idle_minutes` (default 30) is ended by
//     the reaper; a kept one only by agent.kill (or closing it in the app);
//   - kept definitions are saved (setting `askk.spawned`) and restarted with
//     their memory when the team starts.
//
// One spawner per team: the registry's (app and server) and headless ask's.
// It holds no engines itself; the team adds and removes them:
//   createSpawner({ agents(), engines(), add(agent, { restore }) -> engine,
//                   remove(engine), replace(agent) })
//   .spawn(caller, spec) · .kill(caller, name, reason) · .keep(caller, name, keep)
//   .roster(caller) · .saved() · .adopt(engine) · .forget(engine)
// Engines reach it through their directory (SPAWN_CALLS, async across threads).

import { validateAgent } from "@/backend/agents/definitions"
import { laneWithin } from "@/backend/features/filesystem/guard"

export const SPAWN_CALLS = ["spawn", "kill", "keep", "roster"]

const SAVED_KEY = "askk.spawned"
const NAME = /^[a-z][a-z0-9-]{1,39}$/
const DEFAULT_MAX = 6
const DEFAULT_IDLE_MINUTES = 30
const DEFAULT_STEPS = 40
const REAP_MS = 60_000
const ENDED_KEEP = 8

const number = (value, fallback, min, max) => {
  const n = Number(value)
  return value != null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

// What a sub-agent may have: the subset asked for, of what the caller has.
function subset(asked, allowed, what) {
  if (asked == null) return [...allowed]
  if (!Array.isArray(asked)) throw new Error(`${what} must be a list.`)
  const extra = asked.filter((name) => !allowed.includes(name))
  if (extra.length) throw new Error(`${what} you do not have cannot be given: ${extra.join(", ")}. Yours: ${allowed.join(", ") || "none"}.`)
  return [...new Set(asked)]
}

// The sub-agent's definition: the caller's soul, model and response format,
// the role it was given, and the closing rules every spawned agent works by.
export function spawnedDefinition(parent, spec = {}) {
  const name = String(spec.name ?? "").trim()
  if (!NAME.test(name)) throw new Error('name: 2-40 chars, lowercase letters, digits and "-", starting with a letter (e.g. "csv-researcher").')
  const role = String(spec.role ?? "").trim()
  if (role.length < 20) throw new Error("role: say who it is, how it works and what it hands back (at least a sentence).")
  const tools = subset(spec.tools, parent.tools ?? [], "Tools")
  const mcp = subset(spec.mcp, parent.mcp ?? [], "MCP servers")
  const artifacts = subset(spec.artifacts, (parent.artifacts ?? []).filter((a) => a !== "team"), "Artifacts")
  const keep = !!spec.keep
  // The caller's exclusions ("!glob") always carry over to the helper's lane.
  const writes =
    spec.writes == null
      ? parent.writes
      : [...new Set([...spec.writes, ...(parent.writes ?? []).filter((w) => String(w).trim().startsWith("!"))])]
  if (writes != null && (!Array.isArray(writes) || !writes.length || !writes.every((w) => typeof w === "string" && w.trim()))) {
    throw new Error('writes: a list of path globs, e.g. ["src/parser/**", "tests/unit/test_parser.py"].')
  }
  if (writes && parent.writes && !laneWithin(writes, parent.writes)) {
    throw new Error(`writes ${writes.join(", ")} goes outside your own lane (${parent.writes.join(", ")}).`)
  }
  const checklist = spec.checklist == null ? undefined : spec.checklist
  if (checklist != null && (!Array.isArray(checklist) || !checklist.every((c) => typeof c === "string"))) {
    throw new Error('checklist: a list of "id: what done means" lines.')
  }
  const description = String(spec.description ?? "").trim() || role.split(/(?<=[.!?])\s/)[0].slice(0, 200)
  const instructions = [
    role,
    "",
    "## HOW YOU WORK (spawned sub-agent)",
    "",
    `${parent.name} created you for its goals and hands you each one as a quest. Work the quest to its end with your tools, ` +
      "then answer: your final answer is your report to it — what you did, the result, the evidence (paths, command exit " +
      "codes, sources) and anything still open. Do not ask it questions mid-way; state your assumptions in the report. " +
      (writes ? `You write only in your lane: ${writes.join(", ")}; anything outside it goes in your report. ` : "") +
      `${keep ? "You are kept on the team: later quests may build on this one." : "You are a task agent: when your report is in, you may be ended."}`,
  ].join("\n")
  return validateAgent({
    name,
    description,
    strategy: "react",
    response_format: parent.response_format ?? "toon",
    soul: parent.soul ?? "",
    model: parent.model ?? null,
    tools,
    mcp,
    artifacts,
    agents: [],
    skills: {},
    ...(parent.skillset ? { skillset: parent.skillset } : {}),
    memory: "keep",
    ...(writes ? { writes: [...writes] } : {}),
    ...(parent.preserve ? { preserve: true } : {}),
    ...(parent.strict ? { strict: true } : {}),
    ...(checklist ? { checklist } : {}),
    max_steps: number(spec.max_steps, DEFAULT_STEPS, 1, 200),
    instructions,
    spawned: {
      by: parent.name,
      keep,
      idle_minutes: number(spec.idle_minutes, number(parent.spawn_idle_minutes, DEFAULT_IDLE_MINUTES, 1, 1440), 1, 1440),
      role,
      at: new Date().toISOString(),
    },
  })
}

function readSaved() {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(SAVED_KEY) ?? "[]")
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeSaved(list) {
  try {
    globalThis.localStorage?.setItem(SAVED_KEY, JSON.stringify(list))
  } catch {
    // not saved: kept for this session only
  }
}

export function createSpawner({ agents, engines, add, remove, replace }) {
  const idleSince = new Map() // engine id -> ms since it has had nothing to do
  const ended = [] // { name, by, at, reason }

  const own = (caller) => engines().filter((e) => e.status !== "disposed" && e.agent?.spawned?.by === caller.agent.name)
  const find = (caller, name) => {
    const engine = own(caller).find((e) => e.agent.name === name)
    if (!engine) throw new Error(`${name} is not one of your sub-agents. Yours: ${own(caller).map((e) => e.agent.name).join(", ") || "none"}.`)
    return engine
  }

  const busy = (state) => state.status === "running" || !!state.working || !!state.inbox?.length || !!state.quests?.length || !!state.approvals?.length

  // Idle tracking for the reaper and the roster.
  function adopt(engine) {
    const tick = () => {
      if (busy(engine.getSnapshot())) idleSince.delete(engine.id)
      else if (!idleSince.has(engine.id)) idleSince.set(engine.id, Date.now())
    }
    engine.subscribe(tick)
    tick()
  }

  function end(engine, reason) {
    idleSince.delete(engine.id)
    const { name, spawned } = engine.agent
    ended.push({ name, by: spawned?.by ?? null, at: new Date().toISOString(), reason })
    if (ended.length > ENDED_KEEP * 4) ended.splice(0, ended.length - ENDED_KEEP * 4)
    if (spawned?.keep) writeSaved(readSaved().filter((d) => d.name !== name))
  }

  // Task agents idle past their limit are ended (kept ones never).
  const reaper = setInterval(() => {
    const now = Date.now()
    for (const engine of engines()) {
      const s = engine.agent?.spawned
      if (!s || s.keep || engine.status === "disposed" || !idleSince.has(engine.id)) continue
      if (now - idleSince.get(engine.id) < s.idle_minutes * 60_000) continue
      end(engine, `idle ${s.idle_minutes} min (task agent)`)
      remove(engine)
    }
  }, REAP_MS)
  reaper.unref?.()

  return {
    // Kept definitions to start with the team (valid, names not taken).
    saved() {
      const taken = new Set(agents().map((a) => a.name))
      const out = []
      for (const def of readSaved()) {
        try {
          const agent = validateAgent(def)
          if (!agent.spawned?.keep || taken.has(agent.name)) continue
          taken.add(agent.name)
          out.push(agent)
        } catch {
          // a broken saved definition is skipped
        }
      }
      return out
    },

    adopt,

    // Closed from outside (the app's close button): no longer a sub-agent.
    forget(engine) {
      if (engine.agent?.spawned) end(engine, "closed in the app")
    },

    spawn(caller, spec) {
      const parent = caller.agent
      if (parent.spawned) throw new Error("A spawned sub-agent cannot spawn agents.")
      if (!(parent.artifacts ?? []).includes("team")) throw new Error("Only an agent with the team artifact can spawn agents.")
      const max = number(parent.spawn_max, DEFAULT_MAX, 1, 20)
      const alive = own(caller)
      if (alive.length >= max) {
        throw new Error(`You have ${alive.length} sub-agents, the limit (${max}). agent.kill one that is done, or give it the work with agent.task.`)
      }
      const agent = spawnedDefinition(parent, spec)
      if (agents().some((a) => a.name === agent.name) || engines().some((e) => e.status !== "disposed" && e.agent?.name === agent.name)) {
        throw new Error(`The name ${agent.name} is taken. Pick another.`)
      }
      const engine = add(agent, { restore: false })
      adopt(engine)
      if (agent.spawned.keep) writeSaved([...readSaved().filter((d) => d.name !== agent.name), agent])
      return { id: engine.id, name: agent.name, keep: agent.spawned.keep, tools: [...agent.tools, ...agent.mcp.map((m) => `${m}.*`)], idle_minutes: agent.spawned.idle_minutes }
    },

    kill(caller, name, reason = "") {
      const engine = find(caller, name)
      end(engine, reason || `ended by ${caller.agent.name}`)
      remove(engine)
      return { name }
    },

    keep(caller, name, keep = true) {
      const engine = find(caller, name)
      const agent = { ...engine.agent, spawned: { ...engine.agent.spawned, keep: !!keep } }
      replace(agent)
      writeSaved(keep ? [...readSaved().filter((d) => d.name !== name), agent] : readSaved().filter((d) => d.name !== name))
      return { name, keep: !!keep }
    },

    // The caller's sub-agents now, and the last ones ended.
    roster(caller) {
      const now = Date.now()
      const alive = own(caller).map((engine) => {
        const state = engine.getSnapshot()
        const s = engine.agent.spawned
        const idle = idleSince.has(engine.id) ? Math.floor((now - idleSince.get(engine.id)) / 60_000) : null
        return {
          name: engine.agent.name,
          id: engine.id,
          description: engine.agent.description,
          keep: !!s.keep,
          status: state.status,
          busy: busy(state),
          phase: state.activity?.phase ?? "idle",
          waitingApproval: !!state.approvals?.length,
          idleMinutes: idle,
          idleLimit: s.keep ? null : s.idle_minutes,
          spawnedAt: s.at,
          tools: [...engine.agent.tools, ...(engine.agent.mcp ?? []).map((m) => `${m}.*`)],
          error: state.error ?? null,
        }
      })
      return {
        max: number(caller.agent.spawn_max, DEFAULT_MAX, 1, 20),
        alive,
        ended: ended.filter((e) => e.by === caller.agent.name).slice(-ENDED_KEEP),
      }
    },
  }
}

// The directory methods an engine uses to reach the spawner (host: the
// registry's or headless ask's; self() is the calling engine).
export function spawnDirectory(host, self) {
  return Object.fromEntries(SPAWN_CALLS.map((method) => [method, async (...args) => host[method](self(), ...args)]))
}
