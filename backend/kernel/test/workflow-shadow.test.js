// A step's shadow (2026-10-25 owner: "an A/B run" — docs/portable-workflows.md): the same step run beside it as the
// other kind (a step agent ↔ one research call), its own prompt and tools, checked by the step's contract, saved as
// NN-<id>.shadow.*, compared field by field on the row — never waited on, never read downstream.

import { describe, expect, test } from "bun:test"
import { buildDesk, parseStep, parseWorkflowFiles, Tool, Workflow } from "../index.js"

const at = new Date("2026-10-25T13:00:00Z")
const probe = new Tool({ name: "probe.read", description: "read a fact", input: { q: "what" }, run: ({ q }) => `fact about ${q}: 42` })
const schemas = { fact: { validate: (v) => (typeof v?.answer === "number" ? { value: v, problems: [] } : { value: null, problems: ["answer: a number"] }) } }
const FILES = [
  { name: "01-look.md", text: "---\nid: look\nkind: agent\ntools: [probe.read]\nschema: fact\nshadow: {kind: research, tools: [market], max_turns: 4, seconds: 60}\n---\nFind the fact. End with a ```data block {answer, side}." },
  { name: "02-sum.md", text: "---\nid: sum\nkind: agent\nagent: writer\ninputs: [look]\n---\nSum it up." },
]

function rig({ research, agent }) {
  const calls = []
  const prompts = {}
  const host = {
    stream: async (path, body) => {
      calls.push({ path, body })
      return typeof research === "function" ? research(body) : research
    },
  }
  const infer = async (prompt, a) => {
    ;(prompts[a.name] ??= []).push(prompt)
    return JSON.stringify(agent[a.name]?.shift() ?? { thought: "done", calls: [], answer: `${a.name} ok` })
  }
  const wf = new Workflow({ id: "flow", load: () => parseWorkflowFiles(FILES, { known: { schemas, tools: ["market"] } }), schemas, host, clock: () => at })
  const desk = buildDesk({ name: "lead", report: false, artifacts: [wf], tools: [{ type: "agent", name: "writer", report: false }] }, { infer, tools: { "probe.read": probe } })
  return { wf, desk, lead: desk.agents().get("lead"), calls, prompts }
}

describe("workflow shadow (A/B)", () => {
  test("parsed and checked: a map with kind research | agent", () => {
    const s = parseStep("---\nid: a\nkind: agent\nshadow: {kind: research, tools: [market]}\n---\nx")
    expect(s.shadow).toMatchObject({ kind: "research", own: false, tools: ["market"], max_turns: 8, seconds: 300 })
    expect(() => parseStep("---\nid: a\nshadow: {kind: code}\n---\nx")).toThrow("shadow kind research | agent")
    expect(() => parseStep("---\nid: a\nshadow: {kind: agent, orders: true}\n---\nx")).toThrow("shadow keys orders")
    expect(() => parseWorkflowFiles([{ name: "01-a.md", text: "---\nid: a\nshadow: {kind: research, tools: [orders]}\n---\nx" }], { known: { tools: ["market"] } })).toThrow("shadow tools orders")
  })

  test("both run; the step's data goes on, the shadow's is saved and compared, never read downstream", async () => {
    const { wf, lead, calls, prompts } = rig({
      research: { type: "result", text: 'Shadow says 42 too.\n```data\n{"answer": 42, "side": "short"}\n```', turns: 3, cost_usd: 0.02 },
      agent: { "flow-look": [{ thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] }, { thought: "answer", calls: [], answer: 'It is 42.\n```data\n{"answer": 42, "side": "long"}\n```' }] },
    })
    await wf.run({}, { agent: lead })
    await Bun.sleep(5)
    const row = wf.state.stages.find((r) => r.id === "look")
    expect(row).toMatchObject({ status: "done", agent: "flow-look", gate: { ok: true } })
    expect(row.shadow).toMatchObject({ kind: "research", status: "done", turns: 3, cost_usd: 0.02, gate: { ok: true, problems: [] }, same: 1, differs: ["side"] })
    expect(row.shadow.file).toEndWith("01-look.shadow.md")
    // the shadow's own call: research with its tools, the step's prompt
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: "llm/research", body: { max_turns: 4, seconds: 60, tools: ["market"] } })
    expect(calls[0].body.prompt).toContain("Find the fact.")
    // downstream reads the step's document only
    expect(prompts.writer[0]).toContain("It is 42.")
    expect(prompts.writer[0]).not.toContain("Shadow says")
    expect(wf.today("look").data).toEqual({ answer: 42, side: "long" })
    expect(wf.configTwin().steps[0].shadow).toEqual({ kind: "research", tools: ["market"], model: "default" })
  })

  test("a shadow that fails its contract or errs is recorded; the step is untouched", async () => {
    const good = { "flow-look": [{ thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] }, { thought: "answer", calls: [], answer: 'It is 42.\n```data\n{"answer": 42}\n```' }] }
    const bad = rig({ research: { type: "result", text: 'no\n```data\n{"answer": "x"}\n```' }, agent: structuredClone(good) })
    await bad.wf.run({}, { agent: bad.lead })
    await Bun.sleep(5)
    const r1 = bad.wf.state.stages.find((r) => r.id === "look")
    expect(r1.gate.ok).toBe(true)
    expect(r1.shadow).toMatchObject({ status: "done", gate: { ok: false, problems: ["answer: a number"] }, differs: null })
    const err = rig({ research: { type: "error", message: "no CLI" }, agent: structuredClone(good) })
    await err.wf.run({}, { agent: err.lead })
    await Bun.sleep(5)
    const r2 = err.wf.state.stages.find((r) => r.id === "look")
    expect(r2.status).toBe("done")
    expect(r2.shadow).toMatchObject({ status: "failed", error: "no CLI" })
  })

  test("the other way: a research step with a step-agent shadow (<step agent>-b, its own tools)", async () => {
    const files = [{ name: "01-look.md", text: "---\nid: look\nschema: fact\ntools: [market]\nshadow: {kind: agent, tools: [probe.read], max_steps: 4}\n---\nFind the fact." }]
    const calls = []
    const host = { stream: async (path, body) => (calls.push(body), { type: "result", text: 'R.\n```data\n{"answer": 42}\n```' }) }
    const script = [{ thought: "read", calls: [{ tool: "probe.read", input: { q: "x" } }] }, { thought: "answer", calls: [], answer: 'A.\n```data\n{"answer": 42}\n```' }]
    const infer = async (_p, a) => JSON.stringify((a.name === "flow-look-b" && script.shift()) || { thought: "done", calls: [], answer: "ok" })
    const wf = new Workflow({ id: "flow", load: () => parseWorkflowFiles(files, { known: { schemas, tools: ["market"] } }), schemas, host, clock: () => at })
    const desk = buildDesk({ name: "lead", report: false, artifacts: [wf] }, { infer, tools: { "probe.read": probe } })
    await wf.run({}, { agent: desk.agents().get("lead") })
    for (let i = 0; i < 20 && wf.state.stages[0].shadow?.status === "running"; i++) await Bun.sleep(5)
    const row = wf.state.stages[0]
    expect(row).toMatchObject({ status: "done", agent: null })
    expect(calls).toHaveLength(1) // only the step's own research call
    expect(row.shadow).toMatchObject({ kind: "agent", status: "done", agent: "flow-look-b", tools: 1, gate: { ok: true }, same: 1, differs: [] })
    expect(desk.agents().get("flow-look-b").config.maxSteps).toBe(4)
  })
})
