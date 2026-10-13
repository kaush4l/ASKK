// Agent definitions are data, loaded at startup from public/agents/:
//
//   agents/
//     index.json          ["assistant", "researcher", ...]  (folders, in order)
//     soul.md             shared character every agent carries
//     <name>/agent.md     frontmatter definition + Markdown instructions
//     <name>/soul.md      optional per-agent soul (opt in with `soul: soul.md`)
//     <team>/index.json   a TEAM folder (no agent.md): its own manifest, loaded
//                         the same way (teams in teams too, up to MAX_TEAM_DEPTH);
//                         its first entry (an agent) is the team's manager
//     <team>/team.md      optional: frontmatter name, goal, purpose + body →
//                         a "## YOUR TEAM" block appended to every member's
//                         instructions (the manager's too)
//     <team>/soul.md      optional: the team's soul (else the parent's)
//
// A team member's definition carries `team: "<team folder path>"` (e.g.
// "world", "world/macro"); the manager also `manages: "<same path>"`; `folder`
// is the agent's folder path. Names stay unique across the whole tree.
//
// agent.md (askk style):
//   ---
//   name: researcher
//   description: ...
//   response_format: toon        (toon | json)
//   tools: [web.read, notes.read]  "*" = every built-in tool (BUILTIN_TOOLS in
//                                features/index.js, hardware tools included)
//   artifacts: [filesystem]      live objects rendered into the prompt
//                                (features/index.js); each brings its commands;
//                                "*" = every artifact type
//                                ("*" is expanded here, so the loaded
//                                definition lists real names; extra names
//                                beside "*" are kept)
//   mcp: [github]                MCP servers from .mcp.json (all their tools) or
//                                server.tool (one), "*" = every server; tools
//                                are named <server>.<tool>
//   model: local-anthropic       optional key in the model catalogue
//                                (models/catalog.js); omitted = the default model
//   toolkits:                    task-based tool subsets for spawned helpers
//     research:                  (agent.spawn {toolkit, focus}); each ⊆ this
//       tools: [fs.read]         agent's tools / mcp; optional role, once,
//       mcp: [github.search]     max_steps, artifacts, description
//       once: true
//   ---
//   Instructions...
//
// The LocalAgents style (a fenced ```json definition first) is also accepted.

import { splitFrontmatter } from "@/backend/agents/frontmatter"
import { expandArtifacts, expandTools } from "@/backend/features"
import { validKey } from "@/backend/models/catalog"
import { withBase } from "@/backend/platform/base-path"
import { detectHost } from "@/backend/platform/host"

const AGENTS_BASE = withBase("/agents/")
const RESPONSE_FORMATS = ["toon", "json"]
// Team folders nest at most this deep (agents/<team>/<team>/<team>/…).
export const MAX_TEAM_DEPTH = 3

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const safeName = (value) =>
  typeof value === "string" &&
  /^[a-z][a-z0-9._-]*$/i.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value)

// An MCP entry (server or server.tool) another list grants: the same entry, its server, or "*".
export const mcpWithin = (entry, allowed = []) =>
  allowed.includes("*") || allowed.includes(entry) || (entry.includes(".") && allowed.includes(entry.split(".")[0]))

const TOOLKIT_KEYS = new Set(["tools", "mcp", "artifacts", "role", "description", "once", "max_steps", "shared"])

// agent.md `toolkits: {<name>: {tools?, mcp?, artifacts?, role?, description?, once?, max_steps?, shared?}}` — the
// tool subsets the agent's spawned helpers get by task (agent.spawn {toolkit}). Every kit ⊆ the agent's own.
function checkToolkits(config) {
  if (config.toolkits === undefined) return
  const name = config.name
  if (!plain(config.toolkits)) throw new Error(`Agent ${name}: toolkits must be a map of name → {tools, mcp, …}.`)
  const tools = config.tools ?? []
  const mcp = config.mcp ?? []
  const artifacts = (config.artifacts ?? []).filter((a) => a !== "team")
  const list = (value, what, kit) => {
    if (value === undefined) return
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.trim())) {
      throw new Error(`Agent ${name}: toolkit ${kit}: ${what} must be a list of names.`)
    }
  }
  const kits = {}
  for (const [kit, given] of Object.entries(config.toolkits)) {
    if (!safeName(kit)) throw new Error(`Agent ${name}: toolkit name "${kit}" is not a safe name.`)
    if (!plain(given)) throw new Error(`Agent ${name}: toolkit ${kit} must be a map (tools, mcp, role, …).`)
    const spec = { ...given }
    const unknown = Object.keys(spec).filter((k) => !TOOLKIT_KEYS.has(k))
    if (unknown.length) throw new Error(`Agent ${name}: toolkit ${kit}: unknown keys ${unknown.join(", ")}.`)
    for (const key of ["tools", "mcp", "artifacts", "shared"]) list(spec[key], key, kit)
    if (spec.tools) spec.tools = expandTools(spec.tools)
    const extraTools = (spec.tools ?? []).filter((t) => !tools.includes(t))
    const extraMcp = (spec.mcp ?? []).filter((m) => !safeName(m) || !mcpWithin(m, mcp))
    const extraArtifacts = (spec.artifacts ?? []).filter((a) => !artifacts.includes(a))
    const extra = [...extraTools, ...extraMcp, ...extraArtifacts]
    if (extra.length) throw new Error(`Agent ${name}: toolkit ${kit} gives what the agent does not have: ${extra.join(", ")}.`)
    if (spec.role !== undefined && typeof spec.role !== "string") throw new Error(`Agent ${name}: toolkit ${kit}: role must be text.`)
    if (spec.description !== undefined && typeof spec.description !== "string") throw new Error(`Agent ${name}: toolkit ${kit}: description must be text.`)
    if (spec.once !== undefined && typeof spec.once !== "boolean") throw new Error(`Agent ${name}: toolkit ${kit}: once must be true or false.`)
    if (spec.max_steps !== undefined && !(Number.isInteger(spec.max_steps) && spec.max_steps > 0)) {
      throw new Error(`Agent ${name}: toolkit ${kit}: max_steps must be a positive whole number.`)
    }
    kits[kit] = spec
  }
  config.toolkits = kits
}

function splitDefinition(markdown) {
  const fenced = markdown.match(/^\s*```json\s*\n([\s\S]*?)\n```\s*\n?/)
  if (fenced) return { data: JSON.parse(fenced[1]), body: markdown.slice(fenced[0].length).trim() }
  return splitFrontmatter(markdown)
}

function parseAgent(markdown) {
  const { data, body } = splitDefinition(markdown)
  return validateAgent({
    tools: [],
    artifacts: [],
    agents: [], // other agents this one may call as tools
    mcp: [], // MCP servers (or server.tool) from .mcp.json whose tools it may call
    skills: {},
    strategy: "react",
    response_format: "toon",
    ...data,
    instructions: body,
  })
}

// Check a full definition (from a file or an edit). Returns it, or throws.
export function validateAgent(input) {
  const config = { ...input }
  if (Array.isArray(config.tools)) config.tools = expandTools(config.tools)
  if (Array.isArray(config.artifacts)) config.artifacts = expandArtifacts(config.artifacts)
  if (
    !safeName(config.name) ||
    typeof config.description !== "string" ||
    !safeName(config.strategy) ||
    !Array.isArray(config.tools) ||
    !config.tools.every(safeName) ||
    !Array.isArray(config.artifacts ?? []) ||
    !(config.artifacts ?? []).every(safeName) ||
    !plain(config.skills) ||
    !(config.skillset === undefined || (Array.isArray(config.skillset) && config.skillset.every(safeName))) ||
    !Array.isArray(config.agents ?? []) ||
    !(config.agents ?? []).every((a) => safeName(a) && a !== config.name) ||
    !Array.isArray(config.mcp ?? []) ||
    !(config.mcp ?? []).every((m) => m === "*" || safeName(m)) ||
    !RESPONSE_FORMATS.includes(config.response_format) ||
    (config.soul !== undefined && typeof config.soul !== "string") ||
    !(config.checklist === undefined || (Array.isArray(config.checklist) && config.checklist.every((c) => typeof c === "string"))) ||
    !(config.memory === undefined || config.memory === "keep" || config.memory === "run") ||
    !(config.inbox === undefined || config.inbox === "keep" || config.inbox === "drop") ||
    !(config.daily === undefined || (Array.isArray(config.daily) && config.daily.every((c) => typeof c === "string"))) ||
    !(config.checklist_file === undefined || (typeof config.checklist_file === "string" && config.checklist_file.trim())) ||
    !(config.checklist_template === undefined || (typeof config.checklist_template === "string" && config.checklist_template.trim())) ||
    !(config.checklist_vars === undefined || plain(config.checklist_vars)) ||
    !(config.quest_minutes === undefined || (typeof config.quest_minutes === "number" && config.quest_minutes > 0)) ||
    !(config.writes === undefined || (Array.isArray(config.writes) && config.writes.every((c) => typeof c === "string" && c.trim()))) ||
    !(config.shared === undefined || (Array.isArray(config.shared) && config.shared.every((c) => typeof c === "string" && c.trim()))) ||
    !(config.tree_exclude === undefined || (Array.isArray(config.tree_exclude) && config.tree_exclude.every((c) => typeof c === "string" && c.trim()))) ||
    !(config.preserve === undefined || typeof config.preserve === "boolean") ||
    !(config.strict === undefined || typeof config.strict === "boolean") ||
    !(config.compact === undefined || (Array.isArray(config.compact) && config.compact.every((c) => typeof c === "string")))
  ) {
    throw new Error(`Invalid agent definition${config.name ? `: ${config.name}` : ""}.`)
  }
  checkToolkits(config)
  if (config.model != null && !validKey(config.model)) {
    throw new Error(`Agent ${config.name}: model must be a key from the model catalogue.`)
  }
  if (new Set(config.tools).size !== config.tools.length) {
    throw new Error(`Duplicate tool name in agent definition: ${config.name}.`)
  }
  if (typeof config.instructions !== "string" || !config.instructions.trim()) {
    throw new Error(`Agent ${config.name} needs instructions.`)
  }
  return { ...config, model: config.model ?? null, instructions: config.instructions.trim() }
}

export { RESPONSE_FORMATS }

async function read(url, { optional = false } = {}) {
  const response = await fetch(url)
  if (optional && response.status === 404) return null
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: HTTP ${response.status}`)
  return response.text()
}

// Where agents come from: the private folders the local host serves
// (--agents / ASKK_AGENTS, in order) — a team of its own, with its own lead —
// else the shipped public/agents/ (also with private folders when the host
// was started with --with-public). Each source has the same layout:
// index.json, soul.md, <name>/agent.md.
async function agentSources() {
  const host = await detectHost()
  const origin = globalThis.location.origin
  return [
    ...(host.sources ?? []).map(({ id, name }) => ({
      id: `private:${name}`,
      name,
      base: new URL(withBase(`/__askk/sources/${id}/`), origin),
      private: true,
    })),
    ...(host.publicAgents === false ? [] : [{ id: "public", name: "public", base: new URL(AGENTS_BASE, origin), private: false }]),
  ]
}

// Every agent of every source. The first agent of the first source is the
// default (registry). A private agent shadows a public one of the same name;
// a name twice in private sources is an error.
export async function loadAgents() {
  const agents = []
  for (const source of await agentSources()) {
    for (const agent of await loadSource(source)) {
      const existing = agents.find((a) => a.name === agent.name)
      if (!existing) agents.push(agent)
      else if (source.private) throw new Error(`Agent "${agent.name}" is defined in two private folders.`)
      // else: the public agent is shadowed by the private one
    }
  }
  return agents
}

// One source: its shared soul and every agent in its manifest, team folders
// included (loadAgentTree).
async function loadSource({ id, name, base }) {
  return loadAgentTree({ id, name, base, read })
}

const teamLine = (team, members) => {
  const [manager, ...rest] = members
  return `${team.name} (\`${team.path}\`) — manager: ${manager}${rest.length ? `; members: ${rest.join(", ")}` : ""}.`
}

// The "## YOUR TEAM" block for one agent of a team (and the line naming the team it sits in, when nested).
function teamBlock(team, members, agentName, outer) {
  const lines = ["## YOUR TEAM", "", teamLine(team, members)]
  if (team.goal) lines.push(`Goal: ${team.goal}`)
  if (team.purpose) lines.push(`Purpose: ${team.purpose}`)
  lines.push(
    agentName === members[0]
      ? `You are its manager: the team's work comes to you: you quest your members, fold their reports and answer for the team.${outer ? ` You report to ${outer.manager} (${outer.name}).` : ""}`
      : `You report to ${members[0]}, its manager.`
  )
  if (team.body) lines.push("", team.body)
  return lines.join("\n")
}

// The agent tree of one source, read through `read(url, {optional})` (text, or null when optional and absent):
// index.json → agent folders (agent.md) and team folders (index.json, team.md, soul.md), depth-first in manifest
// order. Exported for tests and tools (any reader: fetch, a map, the disk).
export async function loadAgentTree({ id = "test", name = "agents", base, read: readText }) {
  const agents = []
  const names = new Set()

  // Every reference stays inside the agents folder.
  const inside = (reference, from) => {
    const url = new URL(reference, from)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error(`${reference} must be inside the agents folder.`)
    }
    return url
  }

  async function loadFolder(dir, { path, depth, soul, team, outer }) {
    const label = path || name
    const folders = JSON.parse(await readText(inside("index.json", dir)))
    if (!Array.isArray(folders) || (team && !folders.length) || !folders.every(safeName) || new Set(folders).size !== folders.length) {
      throw new Error(`Invalid index.json manifest in ${label} agents.`)
    }
    const members = [] // this folder's direct agents and sub-team managers, in order

    for (const [index, folder] of folders.entries()) {
      const folderUrl = inside(`${folder}/`, dir)
      const folderPath = path ? `${path}/${folder}` : folder
      const agentPath = inside("agent.md", folderUrl)
      const markdown = await readText(agentPath, { optional: true })

      if (markdown == null) {
        // A team folder: its own index.json (+ team.md, soul.md).
        const manifest = await readText(inside("index.json", folderUrl), { optional: true })
        if (manifest == null) throw new Error(`${folderPath} has neither agent.md nor index.json.`)
        if (depth + 1 > MAX_TEAM_DEPTH) throw new Error(`${folderPath}: team folders nest at most ${MAX_TEAM_DEPTH} deep.`)
        if (team && index === 0) throw new Error(`${folderPath}: a team's first entry is its manager, an agent — not a team folder.`)
        const teamMd = await readText(inside("team.md", folderUrl), { optional: true })
        const { data = {}, body = "" } = teamMd == null ? {} : splitFrontmatter(teamMd)
        for (const key of ["name", "goal", "purpose"]) {
          if (data[key] !== undefined && typeof data[key] !== "string") throw new Error(`${folderPath}/team.md: ${key} must be text.`)
        }
        const teamSoul = await readText(inside("soul.md", folderUrl), { optional: true })
        const sub = {
          path: folderPath,
          name: data.name ?? folder,
          goal: data.goal ?? "",
          purpose: data.purpose ?? "",
          body: body.trim(),
        }
        const manager = await loadFolder(folderUrl, {
          path: folderPath,
          depth: depth + 1,
          soul: teamSoul == null ? soul : splitFrontmatter(teamSoul).body,
          team: sub,
          // the enclosing team's manager (or the lead) is loaded already (a sub-team is never a team's first entry)
          outer: members[0] ? { name: team ? team.name : "the lead", manager: members[0] } : null,
        })
        members.push(manager)
        continue
      }

      const agent = parseAgent(markdown)
      if (names.has(agent.name)) throw new Error(`Duplicate agent: ${agent.name}`)
      names.add(agent.name)

      // `soul: soul.md` in frontmatter opts into a per-agent soul; otherwise the team's (or the shared one).
      const ownSoul = agent.soul ? splitFrontmatter(await readText(inside(agent.soul, agentPath))).body : soul

      const skills = {}
      for (const [skill, reference] of Object.entries(agent.skills)) {
        skills[skill] = (await readText(inside(reference, agentPath))).trim()
      }

      // `checklist_template: <file>` — the day's checklist template, read once like skills (features/checklist/template.js).
      const checklistTemplate = agent.checklist_template ? await readText(inside(agent.checklist_template, agentPath)) : undefined

      agents.push({
        ...agent,
        folder: folderPath,
        soul: ownSoul,
        skills,
        source: id,
        ...(team ? { team: team.path } : {}),
        ...(team && index === 0 ? { manages: team.path } : {}),
        ...(checklistTemplate !== undefined ? { checklist_template_text: checklistTemplate } : {}),
      })
      members.push(agent.name)
    }

    // Every member of this team (its manager included) learns the team's goal and purpose.
    if (team) {
      for (const agent of agents) {
        if (agent.team !== team.path) continue
        agent.instructions = `${agent.instructions}\n\n${teamBlock(team, members, agent.name, outer)}`
      }
    }
    return members[0]
  }

  const sharedSoul = splitFrontmatter((await readText(inside("soul.md", base), { optional: true })) ?? "").body
  await loadFolder(base, { path: "", depth: 0, soul: sharedSoul, team: null, outer: null })
  return agents
}
