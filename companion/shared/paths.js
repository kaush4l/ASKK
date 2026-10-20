// Path containment: `abs` (already realpath-resolved) is `root` or below it.
import { join, resolve, sep } from "node:path"

export const within = (root, abs) => abs === root || abs.startsWith(root + sep)

// ASKK's own folder (the repo root) and its memory folder (2026-10-17 owner: "Move the memory of every desk to the root
// level"): memory/<desk>/ holds each desk's memory and reports, beside custom/ (git-ignored, never pushed). ASKK_MEMORY
// moves it elsewhere.
export const APP_ROOT = resolve(import.meta.dir, "../..")
export const memoryRoot = (env = process.env) => resolve(APP_ROOT, env.ASKK_MEMORY || "memory")
export const memoryFolder = (desk, env = process.env) => join(memoryRoot(env), desk)
