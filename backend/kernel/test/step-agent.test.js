// Workflow step agents (2026-10-22 owner: "make each step in the workflow like an agent … the agent loop within the
// phase loop"): a `kind: agent` step without `agent:` is spawned for the run (Desk.spawn, managed), works with its own
// tools, its ```data contract is its gate, it shows as a spawned agent, the owner's stop ends it, the next run drops it.

import { describe, expect, test } from "bun:test"
import { buildDesk, parseWorkflowFiles, Tool, Workflow } from "../index.js"

const at = new Date("2026-10-22T13:00:00Z")
const probe = new Tool({ name: "probe.read", description: "read a fact", input: { q: "what" }, run: ({ q }) => `fact about ${q}: 42` })
const FILES = [
  { name: "01-look.md", text: "---\nid: look\nkind: agent\ntools: [probe.read]\nschema: fact\nmax_steps: 6\n---\nFind the fact. End with a ```data block {answer}." },
  { name: "02-sum.md", text: "---\nid: sum\nkind: agent\nagent: writer\ninputs: [look]\n---\nSum it up." },
]
const schemas = { fact: { validate: (v) => (typeof v?.answer === "number" ? { value: v, problems: [] } : { value: null, problems: ["answer: a number"] }) } }

function rig(script) {
  const prompts = {}
  const events = []
  const infer = async (prompt, agent) => {
    ;(prompts[agent.name] ??= []).push(prompt)
    let next = script[agent.name]?.shift()
    if (typeof next === "function") next = await next(prompt)
    return JSON.stringify(next ?? { thought: "done", calls: [], answer: `${agent.name} ok` })
  }
  const wf = new Workflow({ id: "flow", load: () => parseWorkflowFiles(FILES, { known: { schemas } }), schemas, clock: () => at })
  const desk = buildDesk({ name: "lead", report: false, model: "opus", artifacts: [wf], tools: [{ type: "agent", name: "writer", report: false }] }, { infer, tools: { "probe.read": probe } })
  desk.on((e) => events.push(e))
  const lead = desk.agents().get("lead")
  return { wf, desk, lead, prompts, events }
}

describe("step agents", () => {
  test("spawned for the step, calls its tools, refused until its data checks, then the next step reads it", async () => {
    const { wf, desk, lead, prompts, events } = rig({
      "flow-look": [
        { thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] },
        { thought: "answer", calls: [], answer: 'It is forty-two.\n```data\n{"answer": "42"}\n```' },
        { thought: "fix", calls: [], answer: 'It is 42.\n```data\n{"answer": 42}\n```' },
      ],
    })
    const said = await wf.run({}, { agent: lead })
    expect(said).toContain("look: done")
    const look = wf.state.stages.find((r) => r.id === "look")
    expect(look).toMatchObject({ status: "done", agent: "flow-look", tools: 1, refused: 1, turns: 3, gate: { ok: true } })
    const sub = desk.agents().get("flow-look")
    expect(sub.config.spawned).toMatchObject({ by: "lead", managed: true })
    expect(sub.config.model).toBe("opus") // the holder's model when the step says default
    expect(lead.tools.has("flow-look")).toBe(false) // managed: no quest tool on the holder
    expect(events.some((e) => e.event === "spawn" && e.agent === "flow-look")).toBe(true)
    expect(prompts["flow-look"][0]).toContain("Find the fact.")
    expect(prompts["flow-look"][0]).toContain("flow-look.contract")
    expect(prompts["flow-look"][2]).toContain("answer: a number") // the gate's reason reached the agent
    expect(wf.today("look").data).toEqual({ answer: 42 })
    expect(prompts.writer[0]).toContain("It is 42.") // a named agent step still quests, with the step agent's document
    expect(wf.configTwin().steps[0]).toMatchObject({ own: true, tools: ["probe.read"], max_steps: 6, step_agent: "flow-look" })
  })

  test("still failing after its gate retries: the answer goes through flagged and its problems flow on", async () => {
    const bad = { thought: "answer", calls: [], answer: 'no number\n```data\n{"answer": "x"}\n```' }
    const { wf, lead } = rig({ "flow-look": [{ thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] }, bad, bad, bad, bad] })
    await wf.run({}, { agent: lead })
    expect(wf.state.stages.find((r) => r.id === "look")).toMatchObject({ status: "done", refused: 2, gate: { ok: false, problems: ["answer: a number"] } })
  })

  test("the owner's stop ends the step agent's run; the next run drops the old agent", async () => {
    let release
    const { wf, desk, lead } = rig({
      "flow-look": [
        () => new Promise((r) => (release = () => r({ thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] }))),
      ],
    })
    const run = wf.run({}, { agent: lead })
    await Bun.sleep(10)
    expect(desk.agents().has("flow-look")).toBe(true)
    wf.ownerCall("stop")
    release()
    expect(await run).toContain("was stopped")
    expect(wf.state.stages.find((r) => r.id === "look").status).toBe("stopped")
    const second = rig({}) // a fresh flow on another desk: unrelated
    expect(second.desk.agents().has("flow-look")).toBe(false)
    await Bun.sleep(5)
    wf.dropStepAgents()
    expect(desk.agents().has("flow-look")).toBe(false)
    expect(wf.stepAgents.size).toBe(0)
  })
})
