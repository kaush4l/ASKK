// Command-line options every entry point shares (scripts/dev.js, send.js,
// wake.js, companion/server/server.js, companion/team/ask.js).

import { stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

// parseArgs options for choosing the team and its workspace.
export const TEAM_OPTIONS = {
  agents: { type: "string", multiple: true, default: [] },
  root: { type: "string" },
}

// Private agent folders: every --agents flag, else ASKK_AGENTS (.env), a
// list separated by ":" or ",".
export function agentDirsFrom(flags = []) {
  if (flags.length) return flags
  return (process.env.ASKK_AGENTS ?? "").split(/[:,]/).map((d) => d.trim()).filter(Boolean)
}

// The workspace: --root, else the first team's data/ folder, else the folder
// ASKK starts in.
export async function rootFrom(rootFlag, agentDirs = []) {
  if (rootFlag) return rootFlag
  if (agentDirs.length) {
    const team = resolve(agentDirs[0])
    const data = join(basename(team) === "agents" ? dirname(team) : team, "data")
    if (await stat(data).then((s) => s.isDirectory(), () => false)) return data
  }
  return process.cwd()
}
