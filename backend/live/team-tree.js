// The team as a tree, and how each agent in it reads at a glance — pure, so
// any view (the home page's tree, tests) draws the same levels.
//
// Levels come from the definitions, first match wins:
//   1. a code desk's tree (backend/kernel buildDesk → desk.tree(): {name, title?, team?, desk?, agents: [...]}; `desk`:
//      a desk mounted inside this one, at that node)
//   2. `agents:` lists — an agent holds the agents it hands quests to (the shallowest holder wins)
//   3. nested team folders — a member (`team: "<path>"`) sits under its manager (`manages: "<path>"`),
//      a sub-team's manager under the enclosing team's manager
//   4. spawned helpers under the agent that spawned them (`spawned.by`)
//   5. everyone else under the root (the lead)

import { agentVisual } from "@/backend/live/visual"

const parentPath = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")
const nameOf = (ref) => (typeof ref === "string" ? ref : ref?.name)

// → { name, title, team, desk, depth, spawned, children: [node] } for the root, or null without it.
// agents: definitions in registry order; root: the lead's name (default: the first agent).
export function teamTree(agents, { root = agents[0]?.name, kernel = null } = {}) {
  const byName = new Map(agents.map((a) => [a.name, a]))
  if (!byName.has(root)) return null
  const order = new Map(agents.map((a, i) => [a.name, i]))
  const parent = new Map()
  const meta = new Map() // name → { title, team, desk } from the desk tree
  const climbsTo = (from, name) => {
    for (let at = from; at != null; at = parent.get(at)) if (at === name) return true
    return false
  }
  const attach = (child, to) => {
    if (child === root || parent.has(child) || !byName.has(child) || !byName.has(to) || climbsTo(to, child)) return
    parent.set(child, to)
  }

  // 1. the desk's own tree
  if (kernel?.name === root) {
    const walk = (node) => {
      meta.set(node.name, { title: node.title ?? null, team: node.team ?? null, desk: node.desk ?? null })
      for (const child of node.agents ?? []) {
        attach(child.name, node.name)
        walk(child)
      }
    }
    walk(kernel)
  }

  // 2. `agents:` lists, breadth-first from the root, then from anyone it does not reach
  const seen = new Set()
  const spread = (start) => {
    const queue = [start]
    while (queue.length) {
      const name = queue.shift()
      if (seen.has(name)) continue
      seen.add(name)
      for (const sub of (byName.get(name)?.agents ?? []).map(nameOf)) {
        attach(sub, name)
        queue.push(sub)
      }
    }
  }
  spread(root)
  for (const a of agents) spread(a.name)

  // 3. nested team folders
  const managerOf = new Map(agents.filter((a) => a.manages).map((a) => [a.manages, a.name]))
  for (const a of agents) {
    if (a.manages) attach(a.name, managerOf.get(parentPath(a.manages)) ?? root)
    else if (a.team && managerOf.has(a.team)) attach(a.name, managerOf.get(a.team))
  }

  // 4. spawned helpers, 5. the rest
  for (const a of agents) if (a.spawned?.by) attach(a.name, a.spawned.by)
  for (const a of agents) attach(a.name, root)

  const children = new Map()
  for (const [child, to] of parent) children.set(to, [...(children.get(to) ?? []), child])
  const build = (name, depth) => {
    const a = byName.get(name)
    return {
      name,
      title: meta.get(name)?.title ?? null,
      team: meta.get(name)?.team ?? (a.manages ? a.manages.split("/").pop() : null),
      desk: meta.get(name)?.desk ?? null,
      depth,
      spawned: !!a.spawned,
      children: (children.get(name) ?? []).sort((x, y) => order.get(x) - order.get(y)).map((c) => build(c, depth + 1)),
    }
  }
  return build(root, 0)
}

// Every name in a subtree, the node first.
export const treeNames = (node) => [node.name, ...node.children.flatMap(treeNames)]

// One agent's status for its speech bubble: the visual state (its colour), the bubble's text, a
// second line (the last tool while the model runs), when it last reported, and pending approvals.
//   tone: llm · tool · quest · waiting · paused · error · done · idle (VISUAL_STATES)
function lastTool(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool" && m.name) return m
    if (m.role === "user" && !m.from && m.kind !== "chat") return null // only the current letter's work (an owner chat is not one)
  }
  return null
}

export function agentStatus(state, agent) {
  const v = agentVisual(state, (agent?.agents ?? []).map(nameOf))
  const messages = state?.messages ?? []
  const approvals = state?.approvals?.length ?? 0
  const base = { tone: v.state, message: v.message, active: v.active, approvals, detail: null, at: null }
  if (!state) return { ...base, message: "starting" }
  if (approvals && v.state !== "paused" && v.state !== "error") return { ...base, tone: "paused", message: `Needs your approval (${approvals})` }
  if (v.state === "llm") {
    const tool = lastTool(messages)
    return tool ? { ...base, detail: `last: ${tool.kind === "agent" ? "quest to " : ""}${tool.name}${tool.ok === false ? " (failed)" : ""}` } : base
  }
  if (v.state === "done") return { ...base, at: [...messages].reverse().find((m) => m.action === "answer")?.at ?? null }
  return base
}

// A collapsed subtree at a glance: every agent under the node with its tone, busiest first.
const RANK = ["error", "paused", "tool", "quest", "llm", "waiting", "done", "idle"]
export function subtreeTones(node, statusOf) {
  return treeNames(node)
    .slice(1)
    .map((name) => ({ name, tone: statusOf(name)?.tone ?? "idle" }))
    .sort((a, b) => RANK.indexOf(a.tone) - RANK.indexOf(b.tone))
}
