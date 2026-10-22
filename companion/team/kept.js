// Kept helpers as agent folders (2026-10-20 owner: "The agent might want to keep the sub-agents alive, and in which
// case, these configurations are written as .MD files in the same folder"). A helper spawned with keep: desk (kernel
// agent.spawn / agent.update) is written where its spawner's .md is — <spawner folder>/<helper>/<helper>.md (2026-10-21:
// the standard, docs/standard.md; an agent.md written before stays one), members as its subfolders — in the agent format
// plus who made it and when; its history.md records beside it. At the next start the host spawns it again through its
// spawner (kernel respawn), bounded by what that spawner holds then. Dismissed for good, its folder moves to
// memory/<desk>/archive/agents/<day>-<name>/ (the config leaves the desk, its history stays in memory); dismissed for an
// update, the folder stays and is rewritten.
//
//   keptFolderOf(agent, {agentsRoot, agents})  where a kept helper's .md goes (its spawner's folder/<name>), or null
//   keptText(agent, agents)                    its .md: frontmatter (name, description, goal, keep, by, at, model,
//                                              max_steps, writes, reads, board, tools, artifacts, title, agents) + role
//   readKept(folders)                          [{by, at, input, folder}] under these agent folders, parents first
//   writeKept(agent, folder, agents)           keptText written atomically (<name>.md; an existing agent.md is kept one)
//   archiveKept(folder, memory, name, now)     the folder → memory/<desk>/archive/agents/<YYYY-MM-DD>-<name>[-n]/

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve, sep } from "node:path"

import { SPAWN_NAME } from "../../backend/kernel/index.js"
import { AGENT_FILE_NAMES, agentFile } from "./layout.js"

const FRONT = /^---\n([\s\S]*?)\n---\n?/
// p is root or below it (the standard's agent tree is the lead's folder itself: the lead keeps helpers inside it).
const within = (root, p) => {
  const rel = relative(resolve(root), resolve(p))
  return !rel.startsWith("..") && !rel.startsWith(sep)
}
// A kept helper's folder name: a spawn name that is not one of the files beside an agent's .md.
const keptName = (name) => SPAWN_NAME.test(name) && !AGENT_FILE_NAMES.has(name)

// A member's record inside its team's spawn input (members nest), by name.
function memberIn(input, name) {
  for (const m of input?.members ?? []) {
    if (m.name === name) return m
    const deeper = memberIn(m, name)
    if (deeper) return deeper
  }
  return null
}

// The record an agent was built from: the top of a spawn carries its input; a member's is inside its team top's.
export function recordOf(agent, agents = new Map()) {
  const s = agent.config.spawned
  if (!s) return null
  if (s.input) return { ...s.input, name: agent.name }
  let by = agents.get?.(s.by) ?? null
  for (let k = 0; by && k < 8; k++) {
    const hit = by.config.spawned?.input ? memberIn(by.config.spawned.input, agent.name) : null
    if (hit) return hit
    by = agents.get?.(by.config.spawned?.by) ?? null
  }
  return { name: agent.name, role: agent.config.role ?? "", description: agent.config.description }
}

// Where a kept helper's .md goes: inside its spawner's folder, when that folder is in the desk's agent tree (agentsRoot:
// the lead's folder, or agents/ in the legacy layout; a fixed agent, or a kept helper); null when its spawner has no
// folder there (a run helper's helper is not kept).
export function keptFolderOf(agent, { agentsRoot, agents }) {
  const s = agent.config.spawned
  if (!agentsRoot || s?.keep !== "desk" || !keptName(agent.name)) return null
  const spawner = agents.get(s.by)
  const base = spawner?.config.folder
  if (!base || !within(agentsRoot, base)) return null
  // Never over an agent's .md that is not a kept helper's (the owner's agent, a fixed member): 2026-10-20 review.
  const folder = join(base, agent.name)
  if (agentFile(folder) && readMd(folder)?.meta?.keep !== "desk") return null
  return folder
}

const yaml = (v) => JSON.stringify(v) // YAML reads JSON's strings, lists and objects as they are

export function keptText(agent, agents = new Map()) {
  const s = agent.config.spawned ?? {}
  const r = recordOf(agent, agents) ?? {}
  const members = (agent.children ?? []).filter((c) => c.config.spawned?.team && c.config.spawned.by === agent.name).map((c) => c.name)
  const head = [`name: ${agent.name}`]
  if (r.description) head.push(`description: ${yaml(r.description)}`)
  if (s.input) head.push(`goal: ${yaml(s.goal ?? r.goal ?? "")}`, "keep: desk", `by: ${s.by}`, `at: ${yaml(s.at ?? new Date().toISOString())}`)
  else head.push(`member_of: ${s.team ?? s.by}`)
  if (r.title) head.push(`title: ${yaml(r.title)}`)
  if (r.model) head.push(`model: ${r.model}`)
  if (r.max_steps) head.push(`max_steps: ${r.max_steps}`)
  if (r.writes) head.push(`writes: ${yaml(r.writes)}`)
  if (r.reads) head.push(`reads: ${yaml(r.reads)}`)
  if (r.board === false) head.push("board: false")
  head.push(`tools: ${yaml(r.tools ?? [])}`, `artifacts: ${yaml(r.artifacts ?? [])}`)
  if (members.length) head.push(`agents: ${yaml(members)}`)
  return `---\n${head.join("\n")}\n---\n${String(r.role ?? agent.config.role ?? "").trim()}\n`
}

// One agent's .md (<name>.md, else agent.md) → {meta, role}, or null when it is not one.
function readMd(folder) {
  const file = agentFile(folder)
  if (!file) return null
  const text = readFileSync(file, "utf8")
  const m = text.match(FRONT)
  if (!m) return null
  try {
    return { meta: Bun.YAML.parse(m[1]) ?? {}, role: text.slice(m[0].length).trim() }
  } catch {
    return null
  }
}

const listOf = (v) => (v == null ? [] : [].concat(v).flatMap((x) => (typeof x === "string" ? x.split(",") : [x])).map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== ""))

// A kept folder's agent.md (and its members' subfolders) → the spawn input it was made from. A member is a subfolder
// named by a spawn name (no "..", no separator: 2026-10-20 review), each folder read once, at most 4 levels down.
function inputOf(folder, md, seen = new Set(), depth = 0) {
  seen.add(resolve(folder))
  const { meta, role } = md
  const input = { name: String(meta.name ?? "").trim(), role }
  for (const k of ["description", "goal", "title", "model"]) if (meta[k] != null && meta[k] !== "") input[k] = String(meta[k])
  if (meta.max_steps != null) input.max_steps = Number(meta.max_steps)
  for (const k of ["writes", "reads"]) if (meta[k] != null) input[k] = listOf(meta[k])
  if (meta.board === false) input.board = false
  input.tools = listOf(meta.tools)
  input.artifacts = listOf(meta.artifacts)
  const members = listOf(meta.agents)
    .map((name) => {
      const sub = join(folder, String(name))
      if (!keptName(String(name)) || seen.has(resolve(sub)) || depth >= 4) return null
      const subMd = readMd(sub)
      return subMd ? inputOf(sub, subMd, seen, depth + 1) : null
    })
    .filter(Boolean)
  if (members.length) input.members = members
  return input
}

// The kept helpers under these agent folders ([{name, folder}]: the desk's agents at start), and under theirs, parents
// first: a subfolder whose .md (<name>.md or agent.md) says keep: desk, is named after its folder, and is not one of the
// folder's own members (its agents:).
export function readKept(folders = []) {
  const out = []
  const queue = folders.map((f) => ({ folder: f.folder, by: f.name }))
  const seen = new Set()
  while (queue.length) {
    const { folder, by } = queue.shift()
    if (!folder || seen.has(resolve(folder)) || !existsSync(folder)) continue
    seen.add(resolve(folder))
    const members = new Set(listOf(readMd(folder)?.meta?.agents).map(String))
    let subs = []
    try {
      subs = readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory() && !members.has(d.name))
    } catch {}
    for (const d of subs.sort((a, b) => a.name.localeCompare(b.name))) {
      const sub = join(folder, d.name)
      const md = readMd(sub)
      if (!md || md.meta?.keep !== "desk" || String(md.meta.name ?? "") !== d.name || !keptName(d.name)) continue
      out.push({ by: String(md.meta.by ?? by), at: md.meta.at ? String(md.meta.at) : null, input: inputOf(sub, md), folder: sub })
      queue.push({ folder: sub, by: d.name })
    }
  }
  return out
}

export function writeKept(agent, folder, agents) {
  mkdirSync(folder, { recursive: true })
  const legacy = join(folder, "agent.md")
  const own = join(folder, `${basename(folder)}.md`)
  const file = existsSync(legacy) && !existsSync(own) ? legacy : own
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, keptText(agent, agents))
  renameSync(tmp, file)
}

export function archiveKept(folder, memory, name, now = new Date()) {
  if (!folder || !existsSync(folder) || !memory) return null
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
  const base = join(memory, "archive", "agents")
  mkdirSync(base, { recursive: true })
  let to = join(base, `${day}-${name}`)
  for (let n = 2; existsSync(to); n++) to = join(base, `${day}-${name}-${n}`)
  try {
    renameSync(folder, to)
  } catch {
    cpSync(folder, to, { recursive: true })
    rmSync(folder, { recursive: true, force: true })
  }
  return to
}
