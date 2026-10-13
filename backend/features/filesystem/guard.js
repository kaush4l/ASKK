// Write guards an agent.md opts into — enforced in code, because prompt rules
// are advice (agents under pressure delete tests and code to "pass": Kent Beck,
// ImpossibleBench, GitHub Copilot Applied Science, 2025-26).
//
//   writes: ["src/**", "tests/unit/**"]   the agent's file lane: fs.write,
//       fs.edit, fs.append and fs.delete refuse every other path. Parallel
//       agents with disjoint lanes never edit the same file. "!glob" excludes
//       (["projects/**", "!projects/*/tests/acceptance/**"]).
//   preserve: true   existing code is never removed: a write or edit that
//       drops a definition (def/class/function/export, test functions
//       included) or empties most of a code file is refused, and fs.delete
//       of a code or test file is refused. The way out is a report: say
//       "blocked: needs <name> removed because …" and let the owner decide.

import { LIMITS } from "@/lib/config"

const CODE = /\.(py|pyi|js|jsx|mjs|cjs|ts|tsx|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh)$/i

const DEFINITION = [
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, // python def (tests included)
  /^\s*class\s+([A-Za-z_$][\w$]*)/gm, // python / js class
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, // js function
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, // js export
  /^\s*(?:test|it|describe)\(\s*["'`]([^"'`]+)["'`]/gm, // js tests
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, // go
  /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/gm, // rust
]

function definitions(text) {
  const names = new Map() // name -> count
  for (const pattern of DEFINITION) {
    for (const match of text.matchAll(pattern)) names.set(match[1], (names.get(match[1]) ?? 0) + 1)
  }
  return names
}

const clean = (glob) => String(glob).trim().replace(/^\.?\/+/, "")

// Glob → RegExp: ** any depth, * one segment, ? one char. "src/" = "src/**".
function globRegex(glob) {
  let g = clean(glob)
  if (g.endsWith("/")) g += "**"
  let out = ""
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === "*" && g[i + 1] === "*") {
      const slash = g[i + 2] === "/"
      out += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (c === "*") out += "[^/]*"
    else if (c === "?") out += "[^/]"
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${out}$`)
}

const excluded = (writes) => writes.filter((g) => String(g).trim().startsWith("!")).map((g) => String(g).trim().slice(1))
const included = (writes) => writes.filter((g) => !String(g).trim().startsWith("!"))

function inLane(path, writes) {
  if (!Array.isArray(writes) || !writes.length) return true
  const key = clean(path)
  if (excluded(writes).some((glob) => globRegex(glob).test(key))) return false
  return included(writes).some((glob) => globRegex(glob).test(key))
}

// Does a glob list select `path`? Same globs as `writes`; "!glob" excludes, and a
// list of exclusions only selects everything else (agent.md `shared:`, `tree_exclude:`).
export function globsMatch(path, globs) {
  const key = clean(path)
  if (excluded(globs).some((glob) => globRegex(glob).test(key))) return false
  const want = included(globs)
  return !want.length || want.some((glob) => globRegex(glob).test(key))
}

// Is lane `inner` inside lane `outer`? An inner glob the outer lane lists itself is; any other is probed with its
// wildcards filled by a sample segment, which must sit in the outer lane (a spawned helper never gets a wider lane).
// (The fixed prefix alone was the probe before 2026-10-13: "shared/2*/notes.md" probed "shared/2", so a helper
// could not even inherit its caller's own glob lane.)
export function laneWithin(inner, outer) {
  if (!Array.isArray(outer) || !outer.length) return true
  if (!Array.isArray(inner) || !inner.length) return false
  const own = new Set(included(outer).map(clean))
  return included(inner).every((glob) => {
    const key = clean(glob)
    if (own.has(key)) return true
    const probe = key === "" ? "x" : key.replace(/\*\*/g, "x").replace(/[*?]/g, "x").replace(/\/$/, "/x")
    return inLane(probe, outer)
  })
}

export function checkLane(agent, path, verb) {
  if (inLane(path, agent?.writes)) return
  throw new Error(
    `${path} is outside your file lane (${agent.writes.join(", ")}): you may not ${verb} it. ` +
      "Another agent owns it — put what it needs changed in your report (or a quest), never edit it yourself."
  )
}

// A write replacing `before` with `after`: refused under preserve when code goes missing.
export function checkPreserve(agent, path, before, after) {
  if (!agent?.preserve || before == null || !CODE.test(path)) return
  const was = definitions(before)
  const now = definitions(after)
  const lost = [...was].filter(([name, count]) => (now.get(name) ?? 0) < count).map(([name]) => name)
  const lines = (t) => t.split("\n").filter((l) => l.trim()).length
  const shrunk = lines(before) >= LIMITS.fsGuard.minLinesForShrink && lines(after) < lines(before) * LIMITS.fsGuard.shrinkRatio
  if (!lost.length && !shrunk) return
  throw new Error(
    `Refused: this change to ${path} removes existing code` +
      (lost.length ? ` (${lost.slice(0, LIMITS.fsGuard.lostNamesShown).join(", ")}${lost.length > LIMITS.fsGuard.lostNamesShown ? ", …" : ""})` : "") +
      (shrunk ? ` (from ${lines(before)} to ${lines(after)} lines)` : "") +
      ". Existing functionality and tests are never removed. Keep them and add beside them (renaming = keep the old " +
      'name delegating to the new one); if one truly has to go, stop and report "blocked: needs <name> removed because …" for the owner.'
  )
}

export function checkDelete(agent, path) {
  if (!agent?.preserve) return
  if (CODE.test(path) || /(^|\/)(src|lib|app|tests?|spec)(\/|$)/.test(clean(path))) {
    throw new Error(
      `Refused: deleting ${path} removes code or tests. Existing functionality is never deleted; ` +
        'report "blocked: needs <path> deleted because …" for the owner to decide.'
    )
  }
}
