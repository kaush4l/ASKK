// An agents folder on disk (index.json, <name>/agent.md, team folders with their own index.json — the layout
// backend/agents/definitions.js loadAgentTree reads over HTTP), walked synchronously for host code and desk tools
// that need the agent names: the keeper's `<date>/<agent>.md` rule, dry runs, tests.
//
//   listAgentTree(dir)  [{ name, folder, team, manages }] in manifest order, depth-first
//   listAgentNames(dir) the names only
//   expandAgentNames(list, dir)  a list read from a raw index.json, with every team folder replaced by its agents
//
// Lenient where the loader is strict (a missing agent.md is skipped, a broken frontmatter falls back to the folder
// name): this lists names, it does not validate — the app's loader does.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { splitFrontmatter } from "../../backend/agents/frontmatter.js"

const MAX_DEPTH = 3
const SAFE = /^[a-z][a-z0-9._-]*$/i

function manifest(dir) {
  try {
    const list = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))
    return Array.isArray(list) ? list.filter((n) => typeof n === "string" && SAFE.test(n)) : []
  } catch {
    return []
  }
}

function agentName(file, fallback) {
  try {
    const name = splitFrontmatter(readFileSync(file, "utf8")).data.name
    return typeof name === "string" && name.trim() ? name.trim() : fallback
  } catch {
    return fallback
  }
}

const isTeam = (dir) => !existsSync(join(dir, "agent.md")) && existsSync(join(dir, "index.json"))

export function listAgentTree(agentsDir) {
  const out = []
  const walk = (dir, path, depth, team) => {
    for (const [index, folder] of manifest(dir).entries()) {
      const full = join(dir, folder)
      const folderPath = path ? `${path}/${folder}` : folder
      if (existsSync(join(full, "agent.md"))) {
        out.push({ name: agentName(join(full, "agent.md"), folder), folder: folderPath, team: team ?? null, manages: team && index === 0 ? team : null })
      } else if (isTeam(full) && depth < MAX_DEPTH) {
        walk(full, folderPath, depth + 1, folderPath)
      }
    }
  }
  if (agentsDir) walk(agentsDir, "", 0, null)
  return out
}

export const listAgentNames = (agentsDir) => [...new Set(listAgentTree(agentsDir).map((a) => a.name))]

// A list of top-level entries (e.g. read from a raw index.json by older code) → agent names: each team folder in
// `agentsDir` becomes the names of the agents inside it; any other entry stays as it is.
export function expandAgentNames(list, agentsDir) {
  if (!Array.isArray(list) || !agentsDir) return list
  const out = []
  for (const entry of list) {
    const full = typeof entry === "string" && SAFE.test(entry) ? join(agentsDir, entry) : null
    if (full && isTeam(full)) out.push(...listAgentTree(full).map((a) => a.name))
    else out.push(entry)
  }
  return [...new Set(out)]
}
