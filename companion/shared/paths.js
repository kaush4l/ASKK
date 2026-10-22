// Path containment: `abs` (already realpath-resolved) is `root` or below it.
import { join, resolve, sep } from "node:path"

export const within = (root, abs) => abs === root || abs.startsWith(root + sep)

// ASKK's own folder (the repo root) and its memory folder (2026-10-17 owner: "Move the memory of every desk to the root
// level"): memory/<desk>/ holds each desk's memory and reports, beside custom/ (git-ignored, never pushed). ASKK_MEMORY
// moves it elsewhere.
export const APP_ROOT = resolve(import.meta.dir, "../..")
export const memoryRoot = (env = process.env) => resolve(APP_ROOT, env.ASKK_MEMORY || "memory")
export const memoryFolder = (desk, env = process.env) => join(memoryRoot(env), desk)
// A team's shared board in its desk's memory (2026-10-21 owner: "For a shared history board for agents, a
// memory/<desk>/<sub desk>"): memory/<desk>/<team>/board.md — the sub desk is the team (a mounted desk's teams under its
// own memory folder). A team name is a folder name here: anything but letters, digits, _ and - becomes _.
// memory/<desk>/ also holds reports/, retros/, practice/, archive/: a team named like one gets a "-team" folder
const MEMORY_DIRS = new Set(["reports", "retros", "practice", "archive", "notes", "runs", "cards", "boards", "projects"])
export const boardFile = (memory, team) => {
  const name = String(team).replace(/[^\w-]/g, "_") || "_"
  return join(memory, MEMORY_DIRS.has(name) ? `${name}-team` : name, "board.md")
}
