import { roleLine } from "../agent/agent.js"
import { SPAWN_NAME, spawnName, withinHolding } from "../desk/desk.js"
import { Tool } from "../tool/tool.js"
import { globCovers } from "./files.js"
import { clip, oneLine } from "../util/text.js"

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
//   keep       run (default): dismissed when the caller's run ends; desk: until agent.dismiss — written as its
//              agent.md and spawned again at every start (companion/team/kept.js). From a run that read outside
//              (below) keep desk is only proposed: the helper works for this run and waits for the owner's accept.
// Its soul, model, maxSteps and files lanes (writes, reads) are the caller's (Desk.spawn). View "spawn"
// (backend/live/visual.js callLook draws the call; the new agent arrives as a registry event).
//
// 2026-10-17 owner ("let the lead, when required, create a sub team to focus on special critical observation and in
// control on a layer"): the same call builds a TEAM, from the desk's templates or inline, and narrows what it gets.
//   members    [{name, role, tools?, artifacts?, writes?, reads?, model?, max_steps?, board?, members?}]: the helper leads
//              them (its own board "<name>.board" under the caller's); each member is bounded by the CALLER exactly as the
//              helper is (tools, artifacts, lanes). A member that fails builds nothing.
//   template   a team from the desk's catalogue (env.templates, a desk's teams/ folders); the input's own fields win.
//              Its members are named "<team>-<member>"; inline members keep their names.
//   writes / reads  globs that NARROW the files lanes (default: the caller's): each covered by one of the caller's
//              (globCovers, files.js), else "outside your lane"; the caller's "!" exclusions are appended, so none drops.
//              A caller without reads: reads everywhere, so any reads lane is narrower.
//   model      one the desk knows (env.models, when the desk lists them); max_steps 1–300. Default: the caller's.
//   description  no description → the role's first line that is not a section header (roleLine: a template role opens on
//              "SPEC" — 2026-10-17 critic: every station showed "SPEC").

export { SPAWN_NAME } // checked by Desk.spawn too (2026-10-17: it lives in desk.js, where the name is used)

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/).map((x) => x.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean) : [v])
const text = (v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : JSON.stringify(v)).trim()
// A list of objects that arrived as JSON text (members written inside a <<< >>> block) → the list; anything else as is.
const asJSON = (v) => {
  try {
    return typeof v === "string" && v.trim().startsWith("[") ? JSON.parse(v) : v
  } catch {
    return v
  }
}

const helperTool = (spec) => new Tool({ type: "spawn", view: "spawn", ...spec })

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
        if (held.kind === "practice") throw new Error(`${ref} is ${held.owner ?? caller.name}'s practice: it is not shared (give the helper its own: artifacts [practice])`)
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
    const title = text(raw.title)
    return {
      type: "agent",
      name,
      role,
      goal,
      description: text(raw.description).slice(0, 200) || roleLine(role), // its quest tool's line on its lead's TOOLS
      ...(title ? { title } : {}), // its board's, when it leads members of its own
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

// ---- where the words came from (2026-10-20) -----------------------------------------------------
// practice.js's provenance guard, extended to kept helpers: a role or goal written by a run that read outside — ctx.outside,
// the run's outside reads (agent.js readsOutside: web.*, browse, desk.read / desk.ask, a quest's or dispatched job's
// member that read them) — may carry a page's words. Kept (keep: desk), it would be a lasting prompt that outlives the
// run (its agent.md, respawned at every start). So from such a run nothing lasting is written without the owner:
//   agent.spawn keep: desk    the helper is built keep "run" (it works for this run, dismissed when the run ends) with
//                             config.spawned.proposed {keep: "desk", from, by, at}; the owner's accept keeps it (Desk.keep)
//   agent.update of a kept    the kept helper stays as it is; the change waits on it as config.spawned.proposed {update:
//   helper (staying kept)     the fields given, keep: "desk", from, by, at} (Desk.propose); the owner's accept applies it
//                             as its spawner would (agent.update, outside: none)
// (A run helper updated to keep: desk is spawned again, so the first rule holds it.) Neither the proposed text nor its
// fields reach a prompt: agent.catalog names only that one waits. The owner (team/call target "desk", method accept |
// drop, args [{helper, reason?}]): ownerHelperCall below; drop clears the proposal (a run helper still goes when its run
// ends; a kept one stays as it was). Nothing proposed is saved: a restart (or the run's end) drops it.
// → "web.read, scout: browse.open" (as practice.js tags it), or null when the run read nothing outside.
export function outsideFrom(ctx = {}) {
  const reads = [...(ctx.outside ?? ctx.agent?.current?.outside ?? [])]
  return reads.length ? `${reads.slice(0, 6).join(", ")}${reads.length > 6 ? ", …" : ""}` : null
}

// ---- the spawn input as plain data (2026-10-20) ------------------------------------------------
// What a helper was made from, names not instances: written as a kept helper's agent.md (companion/team/kept.js),
// the base agent.update changes, respawn's input after a restart. Members carry their final names ("<team>-<member>"
// for a template's), so a respawn builds them as inline members under the same names.
const artifactRecord = (a) => {
  if (typeof a === "string") return a.trim()
  const out = {}
  for (const k of ["type", "id"]) if (a?.[k] != null && a[k] !== "") out[k] = String(a[k]).trim()
  if (a?.commands != null) out.commands = list(a.commands).map(String)
  if (a?.gate === true || a?.gate === "true") out.gate = true
  return out
}
function recordOf(src) {
  const out = { name: src.name, description: text(src.description) || undefined, title: text(src.title) || undefined, role: text(src.role), goal: text(src.goal) || undefined }
  const tools = list(src.tools).map((t) => String(t?.name ?? t).trim()).filter(Boolean)
  const artifacts = list(src.artifacts).map(artifactRecord).filter((a) => (typeof a === "string" ? a : a.type || a.id))
  if (tools.length) out.tools = tools
  if (artifacts.length) out.artifacts = artifacts
  for (const k of ["writes", "reads"]) if (src[k] != null && src[k] !== "") out[k] = globsOf(src[k])
  if (src.model != null && src.model !== "") out.model = String(src.model).trim()
  const steps = src.max_steps ?? src.maxSteps
  if (steps != null && steps !== "") out.max_steps = Number(steps)
  if (src.board === false || src.board === "false") out.board = false
  if (src.members?.length) out.members = src.members
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}
function memberRecord(raw, prefix) {
  const own = String(raw?.name ?? "").trim()
  const name = prefix ? `${prefix}-${own}` : own
  return recordOf({ ...raw, name, members: list(raw?.members).map((m) => memberRecord(m, prefix ? name : null)) })
}

export function spawnTool() {
  return helperTool({
    name: "agent.spawn",
    description: "make a helper agent for a stated goal: it joins your team and you quest it like your other agents; it gets your soul, model and file lanes (writes, reads, model, max_steps default to yours, each only narrower), and only the tools and artifacts listed here — never more than yours. A template fills every field not given. With members (or a template) it leads a sub-team on its own board, e.g. to watch or control one layer closely",
    input: {
      name: "lowercase, a-z 0-9 -, 2–31 chars (its quest tool's name)",
      role: "what it is for and how it works (its agent.md body)",
      goal: "the stated goal it works toward",
      description: "its one line (its card; a member's line in its lead's TOOLS); default: its role's first line; optional",
      title: "its board's title when it leads members; optional",
      tools: "names of your own tools, or of the desk's catalogue — not your agents, not an artifact's commands; optional",
      artifacts: "ids you hold, or the desk's catalogue types (name or {type | id, commands, gate}); on one you hold it gets your commands on it, or fewer asked; optional",
      template: "a team from the desk's teams/ (role, goal, tools, artifacts, lanes, members); optional",
      members: "a sub-team it leads: [{name, role, tools?, artifacts?, writes?, reads?, model?, max_steps?, board?}], each bounded by what you hold; optional",
      writes: "globs it may write, inside your own writes; optional",
      reads: "globs it may read, inside your own reads if you have them; optional",
      model: "one of the desk's models; optional",
      max_steps: "1–300; optional",
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
      const description = text(field("description")).slice(0, 200) || roleLine(role)
      const title = text(field("title"))
      // 2026-10-20: what was asked, as plain data (names, not instances): a kept helper's agent.md (the host writes it,
      // companion/team/kept.js), agent.update's base, respawn's input after a restart.
      const record = recordOf({ ...Object.fromEntries(["tools", "artifacts", "writes", "reads", "model", "max_steps", "board"].map((k) => [k, field(k)])), name, role, goal, description, title, members: list(asJSON(field("members"))).map((m) => memberRecord(m, given("members") ? null : name)) })
      const at = typeof input.at === "string" && !Number.isNaN(Date.parse(input.at)) ? input.at : undefined // respawn: when it was first made
      // keep: desk from a run that read outside: built for this run only, the keep proposed to the owner (above)
      const from = keep === "desk" ? outsideFrom(ctx) : null
      const proposed = from ? { keep: "desk", from, by: caller.name, at: new Date().toISOString() } : null
      desk.spawn({ name, role, goal, description, ...(title ? { title } : {}), tools: [...tools, ...members], artifacts, keep: proposed ? "run" : keep, ...(proposed ? { proposed } : {}), ...narrowed, input: record, ...(at ? { at } : {}) }, caller)
      const stays = proposed
        ? ` for this run only — this run read the web (${from}), so keeping it (keep: desk) waits for the owner's accept; until then it is dismissed when this run ends`
        : keep === "run"
          ? " (dismissed when this run ends)"
          : " (stays until agent.dismiss)"
      if (!members.length) return `spawned ${name} — quest it with ${name} {requirement, ask, outcome}${stays}`
      return `spawned team ${name} (lead ${name}; members ${members.map((m) => m.name).join(", ")}; board ${name}.board) — quest or dispatch ${name} {requirement, ask, outcome}${stays}`
    },
  })
}

export function dismissTool() {
  return helperTool({
    name: "agent.dismiss",
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

// agent.catalog (2026-10-20 owner: sub-agents "might also need a special request in order to decide what tools and any
// other metadata"): what the caller can give a helper, before it spawns one — its own tools and the desk catalogue's
// with what each does, the artifacts it holds (with its commands) and the desk's artifact types, the team templates,
// the models — and the helpers it has now (status, keep, goal, the step their run is at). find narrows tools and types.
const short = (s, n = 160) => clip(oneLine(s), n)
export function catalogTool() {
  return helperTool({
    name: "agent.catalog",
    description: "before agent.spawn: what you can give a helper — your tools and the desk's (what each does), the artifacts you hold (your commands on each) and the desk's artifact types, team templates, models — and your helpers now (status, keep, goal)",
    input: { find: "words that narrow the tools and types listed (any word matches); optional" },
    run: (input = {}, ctx = {}) => {
      const { caller, desk } = homeOf(ctx, "agent.catalog")
      const env = desk.ctx?.env ?? {}
      const words = String(input.find ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean)
      const hit = (...parts) => !words.length || words.some((w) => parts.join(" ").toLowerCase().includes(w))
      const mine = [...caller.tools.values()].filter((t) => t.type !== "agent" && t.type !== "artifact")
      const own = new Set(mine.map((t) => t.name))
      const describe = (entry) => (entry && typeof entry === "object" && "description" in entry ? entry.description : "")
      const out = []
      const yours = mine.filter((t) => hit(t.name, t.description))
      out.push(`YOUR TOOLS (give by name)${words.length ? ` matching ${words.join(" ")}` : ""}: ${yours.length}`, ...yours.map((t) => `- ${t.name} — ${short(t.description)}`))
      const desks = Object.entries(env.tools ?? {}).filter(([name, e]) => !own.has(name) && hit(name, describe(e)))
      out.push(`THE DESK'S TOOLS you do not hold (give by name): ${desks.length}`, ...desks.slice(0, 60).map(([name, e]) => `- ${name}${describe(e) ? ` — ${short(describe(e))}` : ""}`))
      const held = caller.artifacts.filter((a) => a.kind !== "checklist" && a.kind !== "practice" && a !== (caller.board ?? caller.parentBoard))
      out.push("ARTIFACTS YOU HOLD (give by id; commands: yours on it, a helper gets these or fewer)", ...held.map((a) => {
        const cmds = caller.holding?.get(a.id)?.commands ?? a.commands().map((t) => (t.name.startsWith(`${a.id}.`) ? t.name.slice(a.id.length + 1) : t.name))
        return `- ${a.id} (${a.kind}) — ${short(a.brief?.() ?? "", 80) || a.title}${cmds.length ? ` · commands: ${cmds.join(", ")}` : " · read only"}`
      }))
      const types = Object.keys(env.artifacts ?? {}).filter((k) => hit(k)).sort()
      if (types.length) out.push(`ARTIFACT TYPES (a fresh one, or the desk's shared one by type): ${types.join(", ")}`)
      const templates = Object.entries(env.templates ?? {})
      if (templates.length) out.push("TEAM TEMPLATES (agent.spawn {template})", ...templates.map(([k, t]) => `- ${k} — ${short(t?.description ?? roleLine(t?.role ?? ""), 120)}${t?.members?.length ? ` · members: ${t.members.map((m) => m.name).join(", ")}` : ""}`))
      const models = env.models == null ? null : Array.isArray(env.models) ? env.models : Object.keys(env.models)
      out.push(`MODELS: ${models ? models.join(", ") : "any"} (yours: ${caller.config.model ?? "the desk's default"})`)
      out.push(`LANES: writes ${globsOf(caller.config.writes).join(", ") || "none"} · reads ${caller.config.reads == null ? "everywhere" : globsOf(caller.config.reads).join(", ") || "none"}`)
      const helpers = (caller.children ?? []).filter((c) => c.config.spawned)
      out.push(`YOUR HELPERS NOW: ${helpers.length}`, ...helpers.map((h) => {
        const run = h.current
        const now = h.status === "running" && run ? `running step ${run.steps?.length ?? 0} on "${short(run.request, 80)}"` : h.status
        const p = h.config.spawned.proposed // that one waits, never what it says (2026-10-20)
        const waits = p ? `; ${p.update ? "an update" : "keep desk"} waits for the owner` : ""
        return `- ${h.name} (keep ${h.config.spawned.keep}${waits}${h.children?.length ? `, team: ${h.children.map((c) => c.name).join(", ")}` : ""}) — ${now} · goal: ${short(h.config.spawned.goal, 120)}`
      }))
      return out.join("\n")
    },
  })
}

// agent.update (2026-10-20 owner: the retro "should be able to update instructions or the tools … it may have
// missed"): a helper the caller spawned, rebuilt with the fields given changed (role, goal, tools, artifacts, lanes,
// model, max_steps, keep: desk keeps it — its agent.md is written; keep: run lets a kept one go with this run). Its
// spawn record is the base; refused while it runs. The old one is dismissed ("update": a kept helper's folder stays and
// is rewritten) and the new one spawned; when the new spec fails, the old one is spawned again and the error returned.
export function updateTool() {
  const fields = ["role", "goal", "description", "title", "tools", "artifacts", "writes", "reads", "model", "max_steps", "members", "board"]
  return helperTool({
    name: "agent.update",
    description: "change a helper you spawned — its role (instructions), goal, tools, artifacts, lanes, model or max_steps — or keep it (keep: desk: it stays across runs and restarts, written as its agent.md); only the fields given change",
    input: { name: "the helper's name", role: "optional", goal: "optional", description: "optional", tools: "the whole new list; optional", artifacts: "the whole new list; optional", writes: "optional", reads: "optional", model: "optional", max_steps: "optional", keep: "run | desk; optional" },
    run: async (input = {}, ctx = {}) => {
      const { caller, desk } = homeOf(ctx, "agent.update")
      const name = String(input.name ?? "").trim()
      const helper = desk.list.find((a) => a.name === name)
      if (!helper) throw new Error(`no helper ${name}; yours: ${(caller.children ?? []).filter((c) => c.config.spawned).map((c) => c.name).join(", ") || "none"}`)
      const spawned = helper.config.spawned
      if (!spawned) throw new Error(`${name} is part of the desk, not a spawned helper: its agent.md is the owner's`)
      if (spawned.by !== caller.name) throw new Error(`${name} was spawned by ${spawned.by}: only ${spawned.by} updates it`)
      const base = spawned.input
      if (!base) throw new Error(`${name} has no spawn record to update from: dismiss it and spawn it again`)
      const changed = fields.filter((k) => input[k] != null && input[k] !== "")
      // a helper whose keep waits for the owner (built for this run, keep desk proposed) stays proposed unless told otherwise
      const was = spawned.proposed && !spawned.proposed.update ? spawned.proposed.keep : spawned.keep
      const keep = input.keep == null || input.keep === "" ? was : String(input.keep).trim()
      if (!["run", "desk"].includes(keep)) throw new Error(`keep "${keep}": run or desk`)
      if (!changed.length && keep === was) throw new Error(`nothing to change: give one of ${fields.join(", ")} or keep`)
      // A kept helper staying kept, changed by a run that read outside: it stays as the owner kept it; the change waits.
      const from = spawned.keep === "desk" && keep === "desk" ? outsideFrom(ctx) : null
      if (from) {
        const update = Object.fromEntries(changed.map((k) => [k, input[k]]))
        const replaces = spawned.proposed ? ` (it replaces the one that waited, ${spawned.proposed.from})` : ""
        desk.propose(name, { update, keep: "desk", from, by: caller.name, at: new Date().toISOString() }, caller.name)
        return `${name}: update of ${changed.join(", ")} PROPOSED, not in force — this run read the web (${from}), so a change to a kept helper waits for the owner to accept it${replaces}; ${name} works as it was. Need the change in this run: agent.spawn a run helper (keep: run) with it`
      }
      const next = { ...base, ...Object.fromEntries(changed.map((k) => [k, input[k]])), name, keep, at: spawned.at }
      // A new role without a new description: the line comes from the new role (2026-10-20: a kept helper's card kept the
      // old role's first line, run facts and all).
      if (changed.includes("role") && !changed.includes("description")) delete next.description
      desk.dismiss(name, caller.name, { reason: "update" })
      const spawn = spawnTool()
      let made
      try {
        made = await spawn.run(next, ctx)
      } catch (error) {
        // the old one as it was: its keep (outside: none — it was kept or not before this run) and what waited on it
        const back = await spawn.run({ ...base, name, keep: spawned.keep, at: spawned.at }, { ...ctx, outside: [] }).then(
          () => {
            if (spawned.proposed) desk.propose(name, spawned.proposed, spawned.proposed.by)
            return "the old one is back"
          },
          (again) => `and the old one could not be rebuilt (${again.message}): agent.spawn it again`,
        )
        throw new Error(`${name} not updated (${error.message}); ${back}`)
      }
      const held = made.includes(" for this run only — ") ? made.slice(made.indexOf(" for this run only — ")) : ""
      const gone = spawned.proposed?.update ? ` (the update that waited for the owner, ${spawned.proposed.from}, is gone: it was made against the old one)` : ""
      return `updated ${name}: ${[...changed, ...(keep !== was ? [`keep ${keep}`] : [])].join(", ")}${held}${gone}`
    },
  })
}

// After a restart: the kept helpers (records [{by, input, at}], parents before their own helpers) spawned again by
// the agents that made them, each bounded by its spawner's holdings as at its first spawn. One that cannot be (its
// spawner gone, a tool no longer there) is skipped with a log line; the rest go on. → the names spawned.
export async function respawn(desk, records = [], { log = () => {} } = {}) {
  const spawn = spawnTool()
  const done = []
  for (const r of records) {
    const name = r?.input?.name
    const caller = desk.list.find((a) => a.name === r?.by)
    if (!name) continue
    const skip = !caller ? `its spawner ${r?.by ?? "?"} is not in the desk` : desk.list.some((a) => a.name === name) ? "an agent of that name is in the desk already" : null
    if (skip) {
      log(`kept ${name}: ${skip} — not restored`)
      continue
    }
    try {
      // outside: none — what the owner kept (written by a run that read nothing outside, or accepted) comes back kept
      await spawn.run({ ...r.input, keep: "desk", ...(r.at ? { at: r.at } : {}) }, { agent: caller, outside: [] })
      done.push(name)
    } catch (error) {
      log(`kept ${name}: not restored (${error.message})`)
    }
  }
  return done
}

// The owner on what waits on a helper (2026-10-20; the host's team/call target "desk", method accept | drop, args
// [{helper, reason?}]): accept keeps a helper spawned for one run (Desk.keep: its agent.md is written) or applies a kept
// helper's update as its spawner would (agent.update with outside: none — the owner read it; refused while it runs, or
// when its spawner no longer holds what it names: then it stays proposed, drop it); drop clears the proposal. → {accepted,
// what} | {dropped}
export async function ownerHelperCall(desk, method, { helper, reason } = {}) {
  const name = String(helper ?? "").trim()
  const sub = desk.list.find((a) => a.name === name)
  const p = sub?.config.spawned?.proposed
  const waiting = () => desk.list.filter((a) => a.config.spawned?.proposed).map((a) => a.name).join(", ") || "none"
  if (!p) throw new Error(sub ? `${name} has nothing waiting for the owner; waiting: ${waiting()}` : `no helper ${name || "(none named)"} in this desk (a helper spawned for one run is dismissed when that run ends); waiting: ${waiting()}`)
  if (method === "drop") {
    desk.propose(name, null, "owner", { reason: String(reason ?? "").trim() || "not accepted" })
    return { dropped: name, what: p.update ? `${name} stays as it was kept` : `${name} goes when its spawner's run ends` }
  }
  if (method !== "accept") throw new Error(`the owner can accept or drop what waits on a helper (not ${method})`)
  if (!p.update) {
    desk.keep(name, "owner")
    return { accepted: name, what: `${name} kept: it stays until dismissed, written as its agent.md and back at every start` }
  }
  const caller = desk.list.find((a) => a.name === sub.config.spawned.by)
  if (!caller) throw new Error(`${name}'s spawner ${sub.config.spawned.by} is not in the desk`)
  const { proposed: _, ...rest } = sub.config.spawned
  sub.config.spawned = rest // applied now, not one agent.update reports gone
  try {
    const what = await updateTool().run({ ...p.update, name, keep: p.keep ?? "desk" }, { ...caller.context, agent: caller, outside: [] })
    return { accepted: name, what }
  } catch (error) {
    if (desk.list.some((a) => a.name === name)) desk.propose(name, p, p.by) // not applied: it still waits
    throw new Error(`${error.message} — it still waits: accept it later, or drop it`)
  }
}

// The tools by name, for a desk's catalogue (env.tools) or an agent's tools list.
export const SPAWN_TOOLS = { "agent.spawn": spawnTool, "agent.dismiss": dismissTool, "agent.catalog": catalogTool, "agent.update": updateTool }
