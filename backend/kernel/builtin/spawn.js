import { SPAWN_NAME, spawnName, withinHolding } from "../desk/desk.js"
import { Tool } from "../tool/tool.js"
import { globCovers } from "./files.js"

// agent.spawn / agent.dismiss: an agent makes a helper for a stated goal at run time, and lets it go (2026-10-17
// owner: agents can spawn sub-agents for a stated goal). The helper is built by the agent's desk (Desk.spawn, through
// ctx.agent.home) and becomes the caller's quest tool "<name>". Exactly what it may get (2026-10-17 critic):
//   tools      each a name of one of the caller's own tools (the same instance) or of the desk's catalogue
//              (env.tools: the desk's tools and the inbuilt kit, named one by one). Nothing else: never the caller's
//              agents, never an artifact's commands (list the artifact instead), never a tool the caller lacks that
//              the catalogue does not list.
//   artifacts  ids the caller holds (shared: the same instance) or types from the desk's catalogue (env.artifacts),
//              each a name or {type | id, commands?}. Commands never beyond the caller's: on an artifact the caller
//              holds with a commands subset (agent.holding), the helper gets that subset unless it asks a narrower
//              one, and a command outside it is refused ("<cmd> is not yours on <id>"); a catalogue type the caller
//              holds (by that id, or of that kind) is bounded the same way, so a fresh one of it is no wider either.
//              The caller's team board comes with it (it joins the team); another agent's run checklist is never
//              shared (its run start would reset the owner's).
//   keep       run (default): dismissed when the caller's run ends; desk: until agent.dismiss
// Its soul, model, maxSteps and files lanes (writes, reads) are the caller's (Desk.spawn). View "spawn"
// (backend/live/visual.js callLook draws the call; the new agent arrives as a registry event).
//
// 2026-10-17 owner ("let the lead, when required, create a sub team to focus on special critical observation and in
// control on a layer"): the same call builds a TEAM, from the desk's templates or inline, and narrows what it gets.
//   members    [{name, role, tools?, artifacts?, writes?, reads?, model?, max_steps?, board?, members?}]: the helper
//              leads them (its own board "<name>.board" under the caller's); each member is bounded by the CALLER
//              exactly as the helper is (tools, artifacts, lanes). A member that fails builds nothing.
//   template   a team from the desk's catalogue (env.templates, a desk's teams/ folders): its role, goal (when none is
//              given), tools, artifacts, writes, reads, model, max_steps and members; the input's own fields win.
//              Its members are named "<team>-<member>"; inline members keep their names.
//   writes / reads  globs that NARROW the files lanes (default: the caller's): each one covered by one of the caller's
//              (globCovers, files.js), else "outside your lane"; the caller's "!" exclusions are appended, so none
//              drops. A caller without reads: reads everywhere, so any reads lane is narrower.
//   model      one the desk knows (env.models, when the desk lists them); max_steps 1–300. Default: the caller's.

export { SPAWN_NAME } // checked by Desk.spawn too (2026-10-17: it lives in desk.js, where the name is used)

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/).map((x) => x.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean) : [v])
const text = (v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : JSON.stringify(v)).trim()
// A list of objects that arrived as JSON text (members written inside a <<< >>> block) → the list; anything else as is.
const asJSON = (v) => {
  if (typeof v !== "string" || !v.trim().startsWith("[")) return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

// The desk the caller belongs to, or an error that says why there is none.
function homeOf(ctx, tool) {
  const caller = ctx?.agent
  const desk = caller?.home
  if (!desk?.spawn) throw new Error(`${tool}: ${caller?.name ?? "this agent"} is not part of a desk`)
  return { caller, desk }
}

// The helper's tools from the names asked: the caller's own (as is), else the desk catalogue's (a name buildAgent
// resolves); anything else is refused with what there is.
function toolsOf(names, caller, desk) {
  const catalogue = desk.ctx?.env?.tools ?? {}
  return list(names).map((raw) => {
    const name = String(raw?.name ?? raw).trim()
    const own = caller.tools.get(name)
    if (own?.type === "agent") throw new Error(`${name} is an agent: a helper does not quest your agents — give it tools, and quest ${name} yourself`)
    if (own?.type === "artifact") throw new Error(`${name} is an artifact's command: list the artifact under artifacts instead`)
    if (own) return own
    if (Object.hasOwn(catalogue, name)) return name
    const mine = [...caller.tools.values()].filter((t) => t.type !== "agent" && t.type !== "artifact").map((t) => t.name)
    throw new Error(`unknown tool ${name}; yours: ${mine.join(", ") || "none"}${Object.keys(catalogue).length ? `; the desk's: ${Object.keys(catalogue).sort().join(", ")}` : ""}`)
  })
}

// The helper's artifacts: an id the caller holds (shared), else a catalogue type ({type, id?, commands?}: buildAgent
// makes it — a desk-shared one is the same instance). Either way its commands stay within the caller's own subset
// (withinHolding): of the artifact it holds by that id, or, for a type, of the ones it holds of that type (its id or
// kind; any held whole → no bound).
function artifactsOf(specs, caller, desk) {
  const types = desk.ctx?.env?.artifacts ?? {}
  const board = caller.board ?? caller.parentBoard
  const known = () => `yours: ${caller.artifacts.map((a) => a.id).join(", ") || "none"}${Object.keys(types).length ? `; the desk's types: ${Object.keys(types).sort().join(", ")}` : ""}`
  const ownOf = (a) => caller.holding?.get(a.id)?.commands ?? null
  const ownOfType = (kind) => {
    const same = caller.artifacts.filter((a) => a.id === kind || a.kind === kind)
    return !same.length || same.some((a) => !ownOf(a)) ? null : [...new Set(same.flatMap(ownOf))]
  }
  // gate: true (a plan the holder must finish before it answers) only restricts the holder: kept as asked.
  const subset = (commands, gate) => ({ ...(commands ? { commands } : {}), ...(gate ? { gate: true } : {}) })
  return list(specs)
    .map((raw) => (typeof raw === "string" ? { ref: raw.trim() } : { ref: String(raw?.id ?? raw?.type ?? "").trim(), type: raw?.type ?? null, id: raw?.id ?? null, commands: raw?.commands ?? null, gate: raw?.gate === true || raw?.gate === "true" }))
    .filter(({ ref }) => ref && ref !== board?.id) // the team's board comes with the helper anyway
    .map(({ ref, type, id, commands, gate }) => {
      const asked = commands ? list(commands) : null
      const held = caller.artifacts.find((a) => a.id === ref)
      if (held) {
        if (held.kind === "checklist") throw new Error(`${ref} is ${held.owner ?? caller.name}'s run checklist: it is not shared (a helper's run would reset it)`)
        return { artifact: held, ...subset(withinHolding(ownOf(held), asked, held.id), gate) }
      }
      const kind = type ?? ref
      if (Object.hasOwn(types, kind)) return { type: kind, ...(id ? { id } : {}), ...subset(withinHolding(ownOfType(kind), asked, id ?? kind), gate) }
      throw new Error(`unknown artifact ${ref}; ${known()}`)
    })
}

// A files lane asked for the helper (writes or reads), narrowed to the caller's: undefined (not asked) → the caller's
// (Desk.spawn copies it); asked → each glob covered by one of the caller's (globCovers), the caller's "!" exclusions
// appended. A caller without a reads lane reads everywhere: any reads lane is narrower.
// Globs from a list or "a, b" text: only a "- " bullet is stripped (list's * bullet would eat a glob's leading **).
const globsOf = (v) => (Array.isArray(v) ? v : v == null ? [] : String(v).split(/[,\n]/)).map((g) => String(g).replace(/^\s*-\s+/, "").trim()).filter(Boolean)
function laneOf(field, asked, caller) {
  if (asked == null || asked === "") return undefined
  const globs = globsOf(asked)
  const own = caller.config?.[field]
  if (field === "reads" && own == null) return globs
  const mine = globsOf(own)
  const lanes = mine.filter((g) => !g.startsWith("!"))
  for (const g of globs) if (!g.startsWith("!") && !lanes.some((o) => globCovers(o, g))) throw new Error(`${field}: ${g} is outside your lane (yours: ${mine.join(", ") || "none"})`)
  if (!globs.some((g) => !g.startsWith("!"))) return globs // nothing allowed: no exclusion needed
  return [...globs, ...mine.filter((g) => g.startsWith("!") && !globs.includes(g))]
}

// A model the desk knows (env.models: names, or the catalogue {name: …}); without a list any name passes.
function modelOf(asked, desk) {
  if (asked == null || asked === "") return undefined
  const model = String(asked).trim()
  const known = desk.ctx?.env?.models
  const names = known == null ? null : Array.isArray(known) ? known.map(String) : known instanceof Set ? [...known].map(String) : Object.keys(known)
  if (names && !names.includes(model)) throw new Error(`unknown model ${model}; models: ${names.join(", ") || "none"}`)
  return model
}

const MAX_STEPS = 300
function stepsOf(asked) {
  if (asked == null || asked === "") return undefined
  const n = Number(asked)
  if (!Number.isInteger(n) || n < 1 || n > MAX_STEPS) throw new Error(`max_steps ${JSON.stringify(asked)}: a whole number from 1 to ${MAX_STEPS}`)
  return n
}

// A team template from the desk's catalogue (env.templates: {<team>: spawn input}), or an error naming them.
function templateOf(asked, desk) {
  if (asked == null || asked === "") return null
  const all = desk.ctx?.env?.templates ?? {}
  const key = String(asked).trim()
  if (!Object.hasOwn(all, key)) throw new Error(`unknown template ${key}; templates: ${Object.keys(all).sort().join(", ") || "none (the desk has no teams/)"}`)
  return { ...all[key], name: all[key]?.name ?? key }
}

// One member as buildAgent takes it ({type: "agent", …}), every capability checked against the CALLER. prefix: the
// team's name for a template's members ("<team>-<member>"), null for inline ones (their own names).
function memberOf(raw, caller, desk, goal, prefix) {
  const own = String(raw?.name ?? "").trim()
  if (!own) throw new Error("members: each member needs a name")
  const name = spawnName(prefix ? `${prefix}-${own}` : own)
  try {
    const role = text(raw.role)
    if (!role) throw new Error("role is required: what it is for and how it works")
    const members = list(raw.members).map((m) => memberOf(m, caller, desk, goal, prefix ? name : null))
    return {
      type: "agent",
      name,
      role,
      goal,
      description: role.split("\n")[0].slice(0, 200), // its quest tool's line on its lead's TOOLS
      tools: [...toolsOf(raw.tools, caller, desk), ...members],
      artifacts: artifactsOf(raw.artifacts, caller, desk),
      ...lanesOf(raw, caller, desk),
    }
  } catch (error) {
    throw new Error(`member ${name}: ${error.message}`)
  }
}

// The fields a spawn input may narrow, as config (undefined ones are left out: Desk.spawn copies the caller's).
function lanesOf(input, caller, desk) {
  const out = {
    writes: laneOf("writes", input.writes, caller),
    reads: laneOf("reads", input.reads, caller),
    model: modelOf(input.model, desk),
    maxSteps: stepsOf(input.max_steps ?? input.maxSteps),
    board: input.board === false || input.board === "false" ? false : undefined, // off its team's board; never onto it
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

export function spawnTool() {
  return new Tool({
    name: "agent.spawn",
    type: "spawn",
    view: "spawn",
    description: "make a helper agent for a stated goal: it joins your team and you quest it like your other agents; it gets your soul, model and file lanes, and only the tools and artifacts listed here — never more than yours. With members (or a template) it leads a sub-team on its own board, e.g. to watch or control one layer closely",
    input: {
      name: "lowercase, a-z 0-9 -, 2–31 chars (its quest tool's name); from a template: the template's name unless given",
      role: "what it is for and how it works (its agent.md body); from a template unless given",
      goal: "the stated goal it works toward; from a template unless given",
      tools: "names of your own tools, or of the desk's catalogue, it may call — not your agents, not an artifact's commands; optional",
      artifacts: "ids you hold, or the desk's catalogue types, it shares (name or {type | id, commands, gate}); on one you hold with only some commands it gets those (or fewer, asked) — never a command you lack; optional",
      template: "a team from the desk's teams/ (its role, goal, tools, artifacts, lanes and members; your fields here win); optional",
      members: "a sub-team it leads: [{name, role, tools?, artifacts?, writes?, reads?, model?, max_steps?, board?}], each bounded by what you hold; optional",
      writes: "globs it may write, each inside your own writes (default: yours); optional",
      reads: "globs it may read, each inside your own reads if you have them (default: yours); optional",
      model: "one of the desk's models (default: yours); optional",
      max_steps: "1–300 (default: yours); optional",
      keep: "run (default: dismissed — with its team — when your run ends) | desk (until agent.dismiss)",
    },
    run: (input = {}, ctx = {}) => {
      const { caller, desk } = homeOf(ctx, "agent.spawn")
      // A template's fields under the input's own (a field given empty is not given).
      const template = templateOf(input.template, desk)
      const given = (k) => input[k] != null && input[k] !== "" && !(Array.isArray(input[k]) && !input[k].length && k === "members")
      const field = (k) => (given(k) ? input[k] : template?.[k])
      const name = spawnName(String(field("name") ?? "").trim())
      const role = text(field("role"))
      if (!role) throw new Error("role is required: what the helper is for and how it works")
      const goal = text(field("goal"))
      if (!goal) throw new Error("goal is required: the stated goal it works toward")
      const rawKeep = field("keep")
      const keep = rawKeep == null || rawKeep === "" ? "run" : String(rawKeep).trim()
      if (!["run", "desk"].includes(keep)) throw new Error(`keep "${keep}": run (dismissed when your run ends) or desk (until agent.dismiss)`)
      const tools = toolsOf(field("tools"), caller, desk)
      const artifacts = artifactsOf(field("artifacts"), caller, desk)
      const narrowed = lanesOf(Object.fromEntries(["writes", "reads", "model", "max_steps", "board"].map((k) => [k, field(k)])), caller, desk)
      // Every member checked before anything is built: one that asks more than the caller holds fails the whole spawn.
      const members = list(asJSON(field("members"))).map((m) => memberOf(m, caller, desk, goal, given("members") ? null : name))
      desk.spawn({ name, role, goal, tools: [...tools, ...members], artifacts, keep, ...narrowed }, caller)
      const stays = keep === "run" ? " (dismissed when this run ends)" : " (stays until agent.dismiss)"
      if (!members.length) return `spawned ${name} — quest it with ${name} {requirement, ask, outcome}${stays}`
      return `spawned team ${name} (lead ${name}; members ${members.map((m) => m.name).join(", ")}; board ${name}.board) — quest or dispatch ${name} {requirement, ask, outcome}${stays}`
    },
  })
}

export function dismissTool() {
  return new Tool({
    name: "agent.dismiss",
    type: "spawn",
    view: "spawn",
    description: "dismiss a helper you spawned (agent.spawn) once it has answered; its helpers go with it (a team goes whole: dismiss its lead)",
    input: { name: "the helper's name" },
    run: (input = {}, ctx = {}) => {
      const { caller, desk } = homeOf(ctx, "agent.dismiss")
      const name = String(input.name ?? "").trim()
      if (!name) throw new Error("name is required: the helper to dismiss")
      const gone = desk.dismiss(name, caller.name)
      return `dismissed ${gone.join(", ")}`
    },
  })
}

// The two tools by name, for a desk's catalogue (env.tools) or an agent's tools list.
export const SPAWN_TOOLS = { "agent.spawn": spawnTool, "agent.dismiss": dismissTool }
