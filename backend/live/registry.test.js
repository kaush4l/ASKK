// The tab's registry mirrors agents that come and go (2026-10-17, kernel Desk.spawn / dismiss): a `registry` event
// brings the new agent's state with it, so its view starts from that state, not an empty one; a dismissed agent's view
// is dropped; the desk store takes the tree (and artifacts removed) from a `kernel` event.

import { expect, test } from "bun:test"
import { EMPTY_STATE } from "./agent.js"
import { kernelDesk } from "./desk.js"
import { Registry } from "./registry.js"
import { wireRegistry } from "./team-core.js"

const def = (name, agents = []) => ({ name, description: "", role: "", tools: agents.map((a) => ({ name: a, type: "agent", view: "quest" })), agents, artifacts: [], kernel: true })
const registryOf = (...agents) => ({ agents, edited: [], status: "ready", error: null, requiredId: "lead", engines: agents.map((a) => ({ id: a.name, name: a.name, agent: a })) })
const idle = (extra = {}) => ({ status: "idle", activity: { phase: "idle" }, messages: [], error: null, revision: 0, working: null, stats: null, ...extra })
const tree = (...names) => ({ name: "lead", agents: names.map((name) => ({ name, agents: [] })) })

test("a registry event with states: the new agent's view starts from its state; the caller's definition is refreshed", () => {
  const r = new Registry()
  r.apply({ type: "snapshot", registry: registryOf(def("lead", ["coder"]), def("coder")), states: { lead: idle({ status: "running" }), coder: idle() }, kernel: { tree: tree("coder"), artifacts: {} }, log: [] })
  const lead = r.getSnapshot().engines.find((e) => e.id === "lead")
  expect(lead.getSnapshot().status).toBe("running")

  r.apply({ type: "registry", registry: registryOf(def("lead", ["coder", "counter"]), def("coder"), { ...def("counter"), spawned: { by: "lead", goal: "count" } }), states: { counter: idle({ revision: 0 }) } })
  const { engines, agents } = r.getSnapshot()
  expect(engines.map((e) => e.id)).toEqual(["lead", "coder", "counter"])
  expect(agents.map((a) => a.name)).toEqual(["lead", "coder", "counter"])
  const counter = engines.find((e) => e.id === "counter")
  expect(counter.getSnapshot()).not.toBe(EMPTY_STATE)
  expect(counter.getSnapshot().status).toBe("idle") // its state, not the empty "created"
  expect(counter.agent.spawned).toEqual({ by: "lead", goal: "count" })
  // The views it already had are kept, their state untouched; the caller now lists its new quest tool.
  expect(engines.find((e) => e.id === "lead")).toBe(lead)
  expect(lead.getSnapshot().status).toBe("running")
  expect(lead.tools.map((t) => t.name)).toEqual(["coder", "counter"])
  // Its run's patches now reach it.
  r.apply({ type: "state", id: "counter", patch: { status: "running", revision: 1 } })
  expect(counter.getSnapshot().status).toBe("running")

  // Dismissed: the next registry no longer lists it — its view goes, the selection falls back to the lead.
  r.select("counter")
  expect(r.getSnapshot().activeId).toBe("counter")
  r.apply({ type: "registry", registry: registryOf(def("lead", ["coder"]), def("coder")), states: {} })
  expect(r.getSnapshot().engines.map((e) => e.id)).toEqual(["lead", "coder"])
  expect(r.getSnapshot().activeId).toBe("lead")
})

test("the desk store takes the tree from a kernel event, and drops the artifacts it removes", () => {
  kernelDesk.apply({ type: "snapshot", kernel: { title: "lab", tree: tree("coder"), boards: null, artifacts: { "lab.board": { id: "lab.board", holders: ["lead", "coder"] } } } })
  kernelDesk.apply({ type: "kernel", tree: tree("coder", "counter") })
  kernelDesk.apply({ type: "kernel", artifact: { id: "counter.notes", holders: ["counter"] } })
  kernelDesk.apply({ type: "kernel", artifact: { id: "lab.board", holders: ["lead", "coder", "counter"] } })
  let s = kernelDesk.getSnapshot()
  expect(s.tree.agents.map((n) => n.name)).toEqual(["coder", "counter"])
  expect(Object.keys(s.artifacts)).toEqual(["lab.board", "counter.notes"])
  expect(s.title).toBe("lab")

  kernelDesk.apply({ type: "kernel", tree: tree("coder"), removed: ["counter.notes"] })
  s = kernelDesk.getSnapshot()
  expect(s.tree.agents.map((n) => n.name)).toEqual(["coder"])
  expect(Object.keys(s.artifacts)).toEqual(["lab.board"])
  // An artifact event alone leaves the tree as it was.
  kernelDesk.apply({ type: "kernel", artifact: { id: "lab.board", holders: ["lead", "coder"] } })
  expect(kernelDesk.getSnapshot().tree).toBe(s.tree)
})
test("registry-once: the wire registry has no agents copy, and the tab still lists the agents lead first", () => {
  const wire = wireRegistry(registryOf(def("coder"), def("lead", ["coder"])))
  expect("agents" in wire).toBe(false)
  expect(wire.engines.map((e) => e.id)).toEqual(["coder", "lead"])
  const r = new Registry()
  r.apply({ type: "snapshot", registry: wire, states: { lead: idle(), coder: idle() }, kernel: { tree: tree("coder"), artifacts: {} }, log: [] })
  expect(r.getSnapshot().agents.map((a) => a.name)).toEqual(["lead", "coder"])
  expect(r.getSnapshot().agents[0]).toBe(r.getSnapshot().engines[0].agent)
})
