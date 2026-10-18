import { expect, test } from "bun:test"

import { agentStatus, subtreeTones, teamTree, treeNames } from "./team-tree.js"

const shape = (node) => (node.children.length ? { [node.name]: node.children.map(shape) } : node.name)

test("agents: lists set the levels, shallowest holder first", () => {
  const agents = [
    { name: "lead", agents: ["market", "keeper"] },
    { name: "market", agents: ["tape", "keeper"] },
    { name: "tape" },
    { name: "keeper" },
    { name: "loner" },
  ]
  const tree = teamTree(agents, { root: "lead" })
  expect(shape(tree)).toEqual({ lead: [{ market: ["tape"] }, "keeper", "loner"] })
  expect(tree.children[0].children[0].depth).toBe(2)
})

test("a desk tree wins and carries team titles", () => {
  const agents = [{ name: "lead", agents: ["market"] }, { name: "market", agents: ["tape"] }, { name: "tape" }, { name: "judge" }]
  const kernel = { name: "lead", agents: [{ name: "market", title: "Market", team: "market", desk: "markets", agents: [{ name: "tape", agents: [] }] }, { name: "judge", agents: [] }] }
  const tree = teamTree(agents, { root: "lead", kernel })
  expect(shape(tree)).toEqual({ lead: [{ market: ["tape"] }, "judge"] })
  expect(tree.children[0]).toMatchObject({ title: "Market", team: "market", desk: "markets" })
  expect(tree.children[1].desk).toBeNull()
})

test("nested team folders: members under their manager, sub-teams under the outer manager", () => {
  const agents = [
    { name: "lead" },
    { name: "boss", team: "research", manages: "research" },
    { name: "reader", team: "research" },
    { name: "webboss", team: "research/web", manages: "research/web" },
    { name: "crawler", team: "research/web" },
    { name: "helper", spawned: { by: "reader" } },
  ]
  const tree = teamTree(agents)
  expect(shape(tree)).toEqual({ lead: [{ boss: [{ reader: ["helper"] }, { webboss: ["crawler"] }] }] })
  expect(tree.children[0].team).toBe("research")
  expect(treeNames(tree)).toHaveLength(6)
})

test("cycles and unknown names never break the tree", () => {
  const agents = [{ name: "a", agents: ["b", "ghost"] }, { name: "b", agents: ["a"] }]
  expect(shape(teamTree(agents))).toEqual({ a: ["b"] })
  expect(teamTree(agents, { root: "nobody" })).toBeNull()
})

test("status: tone, bubble text, last tool while thinking, approvals", () => {
  const running = { status: "running", activity: { phase: "llm", stage: "thinking" }, messages: [{ role: "user", content: "go" }, { role: "tool", name: "market.quote", ok: true }] }
  expect(agentStatus(running, {})).toMatchObject({ tone: "llm", message: "Thinking…", detail: "last: market.quote" })
  expect(agentStatus({ status: "running", activity: { phase: "tools", names: ["tape"] }, messages: [] }, { agents: ["tape"] }).tone).toBe("quest")
  expect(agentStatus({ status: "idle", activity: { phase: "waiting", names: ["tape"] }, messages: [] }, {}).tone).toBe("waiting")
  expect(agentStatus({ status: "idle", activity: {}, approvals: [{}], messages: [] }, {})).toMatchObject({ tone: "paused", approvals: 1 })
  expect(agentStatus({ status: "idle", activity: {}, messages: [{ action: "answer", content: "NO TRADE", at: "2026-10-15T14:00:00Z" }] }, {})).toMatchObject({ tone: "done", message: "NO TRADE", at: "2026-10-15T14:00:00Z" })
  expect(agentStatus(null, {})).toMatchObject({ tone: "idle", message: "starting" })
})

test("a collapsed subtree lists its agents busiest first", () => {
  const tree = teamTree([{ name: "lead", agents: ["a", "b", "c"] }, { name: "a" }, { name: "b" }, { name: "c" }])
  const tones = { a: "idle", b: "error", c: "llm" }
  expect(subtreeTones(tree, (n) => ({ tone: tones[n] })).map((t) => t.name)).toEqual(["b", "c", "a"])
})
