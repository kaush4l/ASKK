// A helper made at run time (kernel Desk.spawn, tool agent.spawn) in one line — the view of its twin's `spawned
// {by, goal, at, keep}` (2026-10-17 critic: the field had no view but the helper's place in the tree). Pure, tested
// (spawned.test.js); the agent page's header and the canvas card at near zoom only draw what it returns.
//
//   spawnedLine(agent, {now}) → "helper · spawned by lead · count the corpus · keep run · 14:05", or null for an
//   agent of the desk. agent: a definition (the registry's), an AgentView (its `.agent`) or a desk-tree node.
//   The time is local: HH:MM on the day it was spawned, else YYYY-MM-DD HH:MM.
//   2026-10-17: a spawned team (`spawned.team`, kernel Desk.spawn {members}): its lead reads "team · spawned by …", a
//   member "member of <team> · spawned by <its lead> · …".
//   2026-10-20: a proposal that waits for the owner (`spawned.proposed`, kernel builtin/spawn.js: a keep: desk or a
//   kept helper's update from a run that read the web) ends the line with "keep desk waits for you" / "update waits for
//   you"; proposedOf(node) is its view's data, heldHelpers(tree) every one in a desk tree.

const GOAL_CHARS = 120

const pad = (n) => String(n).padStart(2, "0")
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function when(at, now) {
  const ms = typeof at === "number" ? at : Date.parse(at ?? "")
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return day(d) === day(new Date(now)) ? clock : `${day(d)} ${clock}`
}

export function spawnedLine(agent, { now = Date.now() } = {}) {
  const s = [agent?.spawned, agent?.agent?.spawned].find((x) => x && typeof x === "object")
  if (!s?.by) return null
  const first = String(s.goal ?? "").split("\n")[0].trim()
  const goal = first.length > GOAL_CHARS ? `${first.slice(0, GOAL_CHARS - 1)}…` : first
  const name = agent?.name ?? agent?.agent?.name
  const what = !s.team ? "helper" : s.team === name ? "team" : `member of ${s.team}`
  const waits = s.proposed ? (s.proposed.update ? "update waits for you" : "keep desk waits for you") : null
  return [what, `spawned by ${s.by}`, goal, `keep ${s.keep === "desk" ? "desk" : "run"}`, when(s.at, now), waits].filter(Boolean).join(" · ")
}

// What waits on a helper for the owner's accept, as its view draws it, or null:
//   {name, by, goal, kind: "keep" | "update", from, at, keep, changes: [{field, value}] (an update's fields, each value
//   as text: a list joined with ", ", an object as JSON), role (a keep's: the role it would keep)}.
// node: a desk-tree node, a definition or an AgentView (as spawnedLine).
const asText = (v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") : JSON.stringify(v))
export function proposedOf(node) {
  const s = [node?.spawned, node?.agent?.spawned].find((x) => x && typeof x === "object")
  const p = s?.proposed
  if (!p || typeof p !== "object") return null
  const update = p.update && typeof p.update === "object" ? p.update : null
  return {
    name: node?.name ?? node?.agent?.name ?? "",
    by: p.by ?? s.by ?? null,
    goal: String(s.goal ?? ""),
    kind: update ? "update" : "keep",
    from: p.from ?? null,
    at: p.at ?? null,
    keep: p.keep ?? "desk",
    changes: update ? Object.entries(update).map(([field, value]) => ({ field, value: asText(value) })) : [],
    role: update ? null : String(s.input?.role ?? node?.role ?? node?.agent?.role ?? ""),
  }
}

// A desk tree's node by its agent's name, or null (the agent page draws what waits from the tree: it follows every
// kernel {tree} the host sends).
export function treeNode(tree, name) {
  if (!tree) return null
  if (tree.name === name) return tree
  for (const c of tree.agents ?? []) {
    const hit = treeNode(c, name)
    if (hit) return hit
  }
  return null
}

// Every helper in a desk tree with a proposal waiting, top-down.
export function heldHelpers(tree) {
  const out = []
  const walk = (n) => {
    if (!n) return
    const p = proposedOf(n)
    if (p) out.push(p)
    for (const c of n.agents ?? []) walk(c)
  }
  walk(tree)
  return out
}
