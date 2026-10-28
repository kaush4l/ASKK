import { expect, test } from "bun:test"

import { kernelClasses } from "../kernel/index.js"
import { CARD, boardKey, compositionBoard, edgePath, sameBoard, strategyOf } from "./composition.js"

const lead = {
  name: "lead", description: "runs the desk", model: null, folder: "lead", agents: ["critic"],
  tools: [
    { name: "web.search", type: "function", view: "web", outside: true },
    { name: "plan.write", type: "artifact", view: "checklist" },
    { name: "dispatch.start", type: "dev", view: "dispatch" },
    { name: "critic", type: "agent", view: "quest" },
  ],
}
const critic = { name: "critic", description: "judges", model: "sonnet", agents: [], tools: [{ name: "plan.tick", type: "artifact", view: "checklist" }] }
const helper = { name: "scout", agents: [], tools: [], spawned: { by: "lead", goal: "look around", keep: "run" } }
const step = { name: "cycle-plan", agents: [], tools: [], spawned: { by: "lead", goal: "the step", keep: "run" } }
const kernel = {
  defaultModel: "default", models: [{ key: "default", label: "Default" }, { key: "sonnet", label: "Sonnet" }],
  tree: { name: "lead", tools: [{ type: "agent", agent: { name: "critic", tools: [] } }] },
  artifacts: {
    plan: { id: "plan", kind: "plan", view: "checklist", keep: "always", holders: ["lead", "critic"], state: {} },
    dispatch: { id: "dispatch", kind: "dispatch", view: "dispatch", keep: "file", holders: ["lead"], state: { jobs: [] } },
    cycle: { id: "cycle", kind: "workflow", view: "pipeline", keep: "day", holders: ["lead"], state: { config: { title: "Cycle", revision: "r1", steps: [{ id: "plan", kind: "agent", after: [] }, { id: "work", kind: "phase", agent: "lead", after: ["plan"] }, { id: "save", kind: "code", after: ["work"] }] } } },
  },
}

test("compositionBoard: build path, an agent band per agent with its slots and tools by type, artifacts, workflow steps", () => {
  const b = compositionBoard([lead, critic], kernel)
  const ids = new Set(b.nodes.map((n) => n.id))
  expect(b.frames.map((f) => f.id)).toEqual(["build", "agents", "artifacts", "workflows"])
  for (const id of ["build:folder", "build:tab", "agent:lead", "agent:lead:model", "agent:lead:response", "agent:lead:artifacts", "agent:lead:members", "agent:lead:tools:function", "agent:lead:tools:dev", "agent:lead:tools:agent", "agent:critic", "artifact:plan", "flow:cycle", "flow:cycle:save"]) expect(ids.has(id)).toBe(true)
  expect(ids.has("agent:critic:members")).toBe(false)
  const node = (id) => b.nodes.find((n) => n.id === id)
  expect(node("agent:lead:model").title).toBe("default")
  expect(node("agent:critic:model").title).toBe("sonnet")
  expect(node("agent:lead:response").sub).toBe("2 gates on the answer") // dispatch and the workflow; plan is a plain checklist kind
  expect(node("artifact:plan").details.find(([k]) => k === "Commands")[1]).toBe("write, tick") // from both holders' tools
  expect(node("artifact:plan").sub).toStartWith("2 commands")
  expect(node("agent:lead:tools:function").sub).toBe("web.search · 1 outside")
  expect(node("flow:cycle:work").tag).toBe("agent lead")
  expect(node("build:desk").sub).toBe("2 agents · 1 team · 3 artifacts")
  // lead first, then its member, each band two rows tall
  expect(node("agent:critic").y - node("agent:lead").y).toBe(2 * (CARD.h + 40))
  const has = (from, to) => b.edges.some((e) => e.from === from && e.to === to)
  expect(has("agent:lead:artifacts", "artifact:dispatch")).toBe(true)
  expect(has("flow:cycle", "flow:cycle:plan")).toBe(true)
  expect(has("flow:cycle:plan", "flow:cycle:work")).toBe(true)
  expect(has("build:tab", "build:host")).toBe(true)
  expect(b.bounds.h).toBe(Math.max(...b.frames.map((f) => f.y + f.h)))
})

test("strategyOf: desk agent, team lead, helper, step agent of a workflow", () => {
  expect(strategyOf(critic)).toBe("desk agent")
  expect(strategyOf({ ...critic, team: "studio" })).toBe("member of team studio")
  expect(strategyOf(lead)).toBe("team lead")
  expect(strategyOf(helper)).toBe("helper of lead · keep run")
  expect(strategyOf(step, ["cycle"])).toBe("step agent of cycle")
})

test("boardKey: an artifact's state alone never moves the board; a workflow edit does", () => {
  const patched = { ...kernel, artifacts: { ...kernel.artifacts, dispatch: { ...kernel.artifacts.dispatch, state: { jobs: [{ id: "j1" }] } } } }
  expect(sameBoard(kernel, patched)).toBe(true)
  const edited = { ...kernel, artifacts: { ...kernel.artifacts, cycle: { ...kernel.artifacts.cycle, state: { config: { ...kernel.artifacts.cycle.state.config, revision: "r2" } } } } }
  expect(sameBoard(kernel, edited)).toBe(false)
  expect(boardKey(null)).toBe("")
})

test("an empty desk still draws its build path; edgePath joins facing sides", () => {
  const b = compositionBoard([], null)
  expect(b.nodes.filter((n) => n.id.startsWith("build:"))).toHaveLength(6)
  expect(b.frames.map((f) => f.id)).toEqual(["build", "agents", "artifacts"])
  const { d } = edgePath({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })
  expect(d.startsWith("M100,25 ")).toBe(true)
  expect(d.endsWith(" 300,25")).toBe(true)
})

test("classes: bases, artifact classes and the standard from kernel.classes; every instance joined to its class", () => {
  const classes = kernelClasses()
  const b = compositionBoard([lead, critic], { ...kernel, classes })
  const has = (from, to) => b.edges.some((e) => e.from === from && e.to === to)
  expect(b.frames.map((f) => f.id).slice(0, 2)).toEqual(["build", "classes"])
  const agentClass = b.nodes.find((n) => n.id === "class:Agent")
  expect(agentClass.details.find(([k]) => k === "Variables")[1]).toContain("maxSteps (config · max_steps)")
  expect(agentClass.details.find(([k]) => k === "How to change")[1]).toMatch(/^1\. /)
  expect(b.nodes.find((n) => n.id === "class:standard").title).toBe(`${classes.kinds.length} of ${classes.kinds.length} aligned`)
  expect(has("class:Plan", "class:Checklist")).toBe(true)
  expect(has("agent:lead", "class:Agent")).toBe(true)
  expect(has("artifact:dispatch", "class:Dispatch")).toBe(true)
  const dispatch = b.nodes.find((n) => n.id === "artifact:dispatch")
  expect(dispatch.details.find(([k]) => k === "Class")[1]).toBe("Dispatch (backend/kernel/builtin/dispatch.js)")
  expect(b.nodes.find((n) => n.id === "class:Dispatch").sub).toStartWith("1 live")
})

test("classes: an older host without kernel.classes draws no Classes region", () => {
  expect(compositionBoard([lead], kernel).frames.some((f) => f.id === "classes")).toBe(false)
})
