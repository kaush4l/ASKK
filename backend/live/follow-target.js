// Where the work is, for a view that follows it (the canvas camera, components/canvas/) — pure.
//
//   followTarget(tree, states) → the name of the agent to follow, or null when nothing runs: the deepest agent
//     at work (calling the model, running tools, handing a quest, waiting for reports) — the most specific work —
//     ties to the one whose step started last, then tree order.
//   questsOut(state) → the names of the agents this one has a quest out to now.
//
//   tree: {name, children | agents} at any depth; states: Map or object name → agent state (agent.js).

const AT_WORK = new Set(["llm", "tool", "tools", "agent", "waiting"])

const kidsOf = (node) => node.children ?? node.agents ?? []
const stateOf = (states, name) => (states instanceof Map ? states.get(name) : states?.[name]) ?? null
const startedAt = (s) => Date.parse(s?.activity?.since ?? s?.working?.at ?? "") || 0

export function atWork(state) {
  const phase = state?.activity?.phase
  if (!AT_WORK.has(phase) || state.status === "error") return false
  return state.status === "running" || phase === "waiting"
}

export function followTarget(tree, states) {
  if (!tree?.name) return null
  let best = null
  const walk = (node, depth, seen) => {
    if (seen.has(node.name)) return
    seen.add(node.name)
    const s = stateOf(states, node.name)
    if (atWork(s)) {
      const at = startedAt(s)
      if (!best || depth > best.depth || (depth === best.depth && at > best.at)) best = { name: node.name, depth, at }
    }
    for (const k of kidsOf(node)) if (k?.name) walk(k, depth + 1, seen)
  }
  walk(tree, 0, new Set())
  return best?.name ?? null
}

export function questsOut(state) {
  const a = state?.activity
  const out = new Set((state?.quests ?? []).map((q) => q?.to).filter(Boolean))
  for (const c of a?.calls ?? []) if (c.kind === "agent") out.add(c.name)
  if (a?.phase === "waiting") for (const n of a.names ?? []) out.add(n)
  if (a?.phase === "agent" && a.name) out.add(a.name)
  return out
}
