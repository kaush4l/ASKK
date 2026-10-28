// Where a desk's agents live (2026-10-21 owner: "create agent will follow the standard of <desk>/<agent>/<agent>.md for
// configurations and tools.js … In the folder where the agent.md lives will have a history.md"). Two layouts:
//
//   standard   <desk>/<lead>/<lead>.md (+ tools.js, practice.md, history.md); members <desk>/<lead>/<member>/<member>.md
//   legacy     <desk>/agents/<lead>/agent.md (members as subfolders, each agent.md): every desk made before 2026-10-21
//
// A desk whose agents/ holds an agent folder (one with an agent.md) is legacy, unchanged; otherwise its lead is the one
// folder directly in the desk with <name>/<name>.md (an agent.md there is accepted too, for migration), reserved
// folders (RESERVED) and dot folders aside. Host side (fs).
//
//   agentFile(folder)       <folder>/<name>.md, else <folder>/agent.md, else null
//   deskLead(folder)        {folder, root, layout}: the lead's folder, the root of the desk's agent tree (kept helpers
//                           go only inside it), "standard" | "legacy"; an Error naming what it found otherwise
//   agentTreeRoot(folder)   deskLead(folder).root, else <folder>/agents (nothing is ever kept outside it)
//   AGENT_FILE_NAMES        the names an agent's folder may not take: its own history.md and practice.md sit beside
//                           its <name>.md

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

// An agent .md's frontmatter block.
export const FRONT = /^---\n([\s\S]*?)\n---\n?/

// A file written whole or not at all (a crash never leaves half of it); its folder made.
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

// Folders of a desk that are never its lead (the desk's own parts, the host's, the tooling's).
export const RESERVED = new Set(["agents", "data", "state", "tools", "teams", "proposed", "vendor", "node_modules", "tests", "lib", "docs", "memory", "history", "artifacts", "stages", "skills", "archive", "fixtures", "src", "scripts"])
// An agent named history or practice would share its <name>.md with its history.md or practice.md.
export const AGENT_FILE_NAMES = new Set(["history", "practice"])

export function agentFile(folder) {
  const own = join(folder, `${basename(folder)}.md`)
  if (!AGENT_FILE_NAMES.has(basename(folder)) && existsSync(own)) return own
  const legacy = join(folder, "agent.md")
  return existsSync(legacy) ? legacy : null
}

const subfolders = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
}

export function deskLead(folder) {
  const legacyDir = join(folder, "agents")
  const legacy = subfolders(legacyDir).filter((d) => existsSync(join(legacyDir, d, "agent.md")))
  if (legacy.length === 1) return { folder: join(legacyDir, legacy[0]), root: legacyDir, layout: "legacy" }
  if (legacy.length > 1) throw new Error(`${legacyDir}: a desk has one lead folder with an agent.md (found ${legacy.join(", ")})`)
  const leads = subfolders(folder).filter((d) => !d.startsWith(".") && !RESERVED.has(d) && agentFile(join(folder, d)))
  if (leads.length === 1) return { folder: join(folder, leads[0]), root: join(folder, leads[0]), layout: "standard" }
  throw new Error(
    leads.length
      ? `${folder}: a desk has one lead folder (<lead>/<lead>.md); found ${leads.length}: ${leads.join(", ")} — make one the lead and the others its members (<lead>/<member>/<member>.md, named in its agents:)`
      : `${folder}: no lead agent — a desk holds its lead as <lead>/<lead>.md (members <lead>/<member>/<member>.md), or agents/<lead>/agent.md (the legacy layout)`
  )
}

export function agentTreeRoot(folder) {
  try {
    return deskLead(folder).root
  } catch {
    return join(folder, "agents")
  }
}
