// Plan (backend/kernel/builtin/plan.js, 2026-10-17): the desk's checklist written at run time — write / tick / skip,
// revisions that keep closed items still listed, a gate only for holders attached with gate: true, no reset per run.

import { describe, expect, test } from "bun:test"
import { Agent, buildDesk, Checklist, Plan } from "../index.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
const ctxOf = (name) => ({ agent: { name } })
// A command run as the agent loop runs it, synchronously (Tool._run: the run function, before Tool.run makes it async).
const run = (plan, cmd, input, by = "planner") => plan.commands().find((t) => t.name === `plan.${cmd}`)._run(input, ctxOf(by))

describe("Plan", () => {
  test("defaults: id plan, kind plan, view checklist, keep always; an empty plan", () => {
    const plan = new Plan({ clock })
    expect(plan).toBeInstanceOf(Checklist)
    expect(plan.twin()).toEqual({ element: "artifact", id: "plan", kind: "plan", view: "checklist", owner: null, title: "plan — the desk's checklist", keep: "always", brief: "no plan yet", state: { goal: "", revision: 0, by: null, at: null, items: [] } })
    expect(plan.commands().map((t) => t.name)).toEqual(["plan.write", "plan.tick", "plan.skip"])
  })

  test("write: lines or objects, required with !, by and revision recorded; the twin state as the spec says", () => {
    const plan = new Plan({ clock })
    expect(run(plan, "write", { goal: "a small LLM in 5 minutes", items: ["data: tokenized corpus on disk", "!eval: val_bpb measured by the fixed eval", { id: "dash", text: "dashboard serves the curve" }] })).toBe("plan revision 1: 3 items; 3 open")
    expect(plan.twin().state).toEqual({
      goal: "a small LLM in 5 minutes",
      revision: 1,
      by: "planner",
      at: "2026-10-17T14:00:00.000Z",
      items: [
        { id: "data", text: "tokenized corpus on disk", required: false, status: "open", note: null, by: null, at: null },
        { id: "eval", text: "val_bpb measured by the fixed eval", required: true, status: "open", note: null, by: null, at: null },
        { id: "dash", text: "dashboard serves the curve", required: false, status: "open", note: null, by: null, at: null },
      ],
    })
    // One text of "- id: text" lines, and a line without an id, read as a model sends them.
    const p2 = new Plan({ clock })
    run(p2, "write", { items: "- train: 5-minute run finished\n- the loss went down" })
    expect(p2.state.items.map((i) => [i.id, i.text])).toEqual([["train", "5-minute run finished"], ["the-loss-went-down", "the loss went down"]])
    expect(() => run(p2, "write", { items: [] })).toThrow("plan.write needs items")
    expect(() => run(p2, "write", { items: ["a: x", "a: y"] })).toThrow("item ids must be unique: a twice")
  })

  test("tick and skip: evidence and reason required, a required item never skipped, who and when recorded", () => {
    const plan = new Plan({ clock })
    run(plan, "write", { goal: "g", items: ["data: corpus", "!eval: measured", "dash: served"] })
    expect(() => run(plan, "tick", { id: "data" }, "coder")).toThrow("evidence is required")
    expect(run(plan, "tick", { id: "data", evidence: "data/tokens.bin 12 MB" }, "coder")).toBe("data ticked; 2 open")
    expect(() => run(plan, "skip", { id: "eval", reason: "no time" }, "coder")).toThrow("eval is required: it cannot be skipped")
    expect(() => run(plan, "skip", { id: "dash" }, "coder")).toThrow("reason is required")
    expect(run(plan, "skip", { id: "dash", reason: "no port free" }, "coder")).toBe("dash skipped; 1 open")
    expect(() => run(plan, "tick", { id: "nope", evidence: "x" })).toThrow("no item nope; items: data, eval, dash")
    expect(plan.state.items[0]).toMatchObject({ status: "ticked", note: "data/tokens.bin 12 MB", by: "coder", at: "2026-10-17T14:00:00.000Z" })
    expect(plan.state.items[2]).toMatchObject({ status: "skipped", note: "no port free", by: "coder" })
    expect(plan.brief()).toBe("2/3 done · rev 1")
    expect(() => run(new Plan(), "tick", { id: "a", evidence: "x" })).toThrow("no plan yet")
  })

  test("a revision replaces the open items, keeps a closed item still listed, drops one not listed", () => {
    const plan = new Plan({ clock })
    run(plan, "write", { goal: "first", items: ["data: corpus", "train: 5-minute run", "old: dropped later"] })
    run(plan, "tick", { id: "data", evidence: "corpus ok" }, "coder")
    run(plan, "tick", { id: "old", evidence: "done once" }, "coder")
    expect(run(plan, "write", { items: ["data: corpus, deduplicated", "train: 5-minute run, lr 3e-3", "eval: val_bpb below 1.9"] }, "planner")).toBe("plan revision 2: 3 items (1 already closed kept); 2 open")
    expect(plan.state.goal).toBe("first") // no goal given: the goal stays
    expect(plan.state.revision).toBe(2)
    expect(plan.state.items.map((i) => [i.id, i.status, i.text])).toEqual([
      ["data", "ticked", "corpus, deduplicated"],
      ["train", "open", "5-minute run, lr 3e-3"],
      ["eval", "open", "val_bpb below 1.9"],
    ])
    expect(plan.state.items[0].note).toBe("corpus ok")
  })

  test("gate: only for a holder attached with gate: true — open items, and an empty plan, refuse its answer", () => {
    const plan = new Plan({ clock })
    const infer = async () => ""
    const lead = new Agent({ name: "lead" }, { infer }).addArtifact(plan, { gate: true })
    const coder = new Agent({ name: "coder" }, { infer }).addArtifact(plan)
    expect(plan.gate(lead)).toBe("no plan yet — ask the planner to write plan (plan.write), then work it")
    expect(plan.gate(coder)).toBeNull()
    run(plan, "write", { items: ["a: one", "b: two"] })
    expect(plan.gate(lead)).toBe("plan open: a, b — plan.tick each with evidence, or plan.skip with a reason")
    expect(lead.gates("done")).toContain("plan open: a, b — plan.tick each with evidence, or plan.skip with a reason")
    expect(coder.gates("done").some((r) => r.startsWith("plan"))).toBe(false)
    run(plan, "tick", { id: "a", evidence: "x" })
    run(plan, "skip", { id: "b", reason: "y" })
    expect(plan.gate(lead)).toBeNull()
    // The holder's prompt says its answer waits; the other's does not.
    expect(plan.render(lead)).toContain("your answer waits while an item is open")
    expect(plan.render(coder)).not.toContain("your answer waits")
  })

  test("a run start does not reset it; a holder with a subset is told only its own commands", async () => {
    const plan = new Plan({ clock })
    run(plan, "write", { goal: "g", items: ["a: one"] })
    run(plan, "tick", { id: "a", evidence: "x" })
    const prompts = []
    const infer = async (p) => (prompts.push(p), JSON.stringify({ thought: "done", calls: [], answer: "ok" }))
    const critic = new Agent({ name: "critic", report: false }, { infer }).addArtifact(plan, { commands: ["tick"] })
    await critic.ask("look")
    expect(plan.state.items[0].status).toBe("ticked")
    expect(prompts[0]).toContain("# plan — plan — the desk's checklist\nthe desk's plan, shared by the agents that hold it: plan.tick {id, evidence} closes an item\nGOAL: g\nrevision 1 by planner")
    expect(prompts[0]).toContain("[x] a: one ↳ x (planner)")
    expect(prompts[0]).not.toContain("plan.write")
    expect(new Plan().render({ name: "x", tools: new Map() })).toContain("(no plan yet — the planner writes it)")
  })

  test("snapshot / restore keep the plan (keep: always); a bad save is ignored", () => {
    const plan = new Plan({ clock })
    run(plan, "write", { goal: "g", items: ["!a: one", "b: two"] })
    run(plan, "tick", { id: "b", evidence: "seen" }, "coder")
    const back = new Plan({ clock })
    back.restore(JSON.parse(JSON.stringify(plan.snapshot())))
    expect(back.state).toEqual(plan.state)
    back.restore({ nope: 1 })
    expect(back.state).toEqual(plan.state)
  })

  test("a desk spec {type: plan, gate: true} gates that holder only; every holder shares one instance", async () => {
    const plan = new Plan({ clock })
    const script = { lead: [{ thought: "done", calls: [], answer: "done" }, { thought: "ask", calls: [{ tool: "planner", input: { requirement: "r", ask: "a plan", outcome: "plan written" } }] }, { thought: "done", calls: [], answer: "done" }], planner: [{ thought: "write", calls: [{ tool: "plan.write", input: { goal: "g", items: ["a: one"] } }] }, { thought: "tick", calls: [{ tool: "plan.tick", input: { id: "a", evidence: "did it" } }] }, { thought: "done", calls: [], answer: "planned" }] }
    const infer = async (_, agent) => JSON.stringify(script[agent.name].shift() ?? { thought: "done", calls: [], answer: "ok" })
    const spec = { name: "lead", report: false, gateRetries: 3, artifacts: [{ type: "plan", gate: true }], tools: [{ type: "agent", name: "planner", report: false, artifacts: [{ type: "plan" }] }] }
    const desk = buildDesk(spec, { infer, artifacts: { plan: () => plan } })
    const gates = []
    desk.on((e) => e.event === "gate" && gates.push([e.agent, e.reasons[0]]))
    expect(await desk.ask("go")).toBe("done")
    expect(gates).toEqual([["lead", "no plan yet — ask the planner to write plan (plan.write), then work it"]])
    expect(plan.state.items[0]).toMatchObject({ status: "ticked", by: "planner" })
    expect(desk.artifacts().get("plan").holders).toEqual(["lead", "planner"])
  })
})
