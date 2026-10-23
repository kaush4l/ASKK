import { describe, expect, test } from "bun:test"

import { Agent, missingReport, parsePhasesFile, renderPhase, Tool, Workflow } from "../index.js"

const at = new Date("2026-10-22T13:00:00Z")

const FLOW = `---
title: Brief
retries: 1
---

## research
agent: scout
tools: probe
report: sources, findings
Find what is known about {{request}}.

## plan
agent: writer
report: outline

Outline the brief from the board.

## check
agent: scout
after: research
report: verdict
Check the research.
`

describe("phases file", () => {
  test("parses ## phases into phase steps with settings, after and report fields", () => {
    const { settings, steps } = parsePhasesFile(FLOW)
    expect(settings).toMatchObject({ title: "Brief", retries: 1 })
    expect(steps.map((s) => [s.id, s.kind, s.agent, s.after, s.report])).toEqual([
      ["research", "phase", "scout", [], ["sources", "findings"]],
      ["plan", "phase", "writer", ["research"], ["outline"]],
      ["check", "phase", "scout", ["research"], ["verdict"]],
    ])
    expect(steps[0].tools).toEqual(["probe"])
    expect(steps[1].body).toBe("Outline the brief from the board.")
  })

  test("refuses a bad id, a missing agent, an unknown key and no phases", () => {
    expect(() => parsePhasesFile("## Bad\nagent: a\nx")).toThrow("a phase heading is")
    expect(() => parsePhasesFile("## a\nreport: x\n\ngo")).toThrow("needs agent")
    expect(() => parsePhasesFile("## a\nagent: a\ncolour: red\n\ngo")).toThrow("unknown keys colour")
    expect(() => parsePhasesFile("no phases")).toThrow("no phases")
  })

  test("the phase prompt: place in the flow, the board of earlier reports, the report contract", () => {
    const { steps } = parsePhasesFile(FLOW)
    const outputs = new Map([["research", { kind: "phase", by: "scout", text: "sources: a\nfindings: b", status: "done" }]])
    const p = renderPhase(steps[1], { steps, outputs, vars: { request: "tides" } })
    expect(p).toContain("# PHASE 2 of 3: plan")
    expect(p).toContain("Flow: research → [plan] → check")
    expect(p).toContain("The flow's request: tides")
    expect(p).toContain("# BOARD\n## research — scout\nsources: a")
    expect(p).toContain("# PHASE REPORT")
    expect(missingReport(steps[0], "sources: x\n**findings**: y")).toEqual([])
    expect(missingReport(steps[0], "sources: x")).toEqual(["findings"])
  })
})

describe("phase runs", () => {
  test("each phase is its agent's whole run; tools granted for the phase only; a missing field is asked again", async () => {
    const seen = { scout: [], writer: [] }
    const replies = {
      scout: [
        { thought: "probe", calls: [{ tool: "probe", input: {} }] },
        { thought: "done", calls: [], answer: "sources: wiki" }, // findings missing → asked again
        { thought: "again", calls: [], answer: "sources: wiki\nfindings: high tide 6am" },
        { thought: "check", calls: [], answer: "verdict: fine" },
      ],
      writer: [{ thought: "w", calls: [], answer: "outline: 1. tides" }],
    }
    const infer = async (prompt, agent) => {
      seen[agent.name].push({ prompt, tools: [...agent.tools.keys()] })
      return JSON.stringify(replies[agent.name].shift())
    }
    const probe = new Tool({ name: "probe", description: "probe", input: {}, run: async () => "probed" })
    const scout = new Agent({ name: "scout", report: false }, { infer })
    const writer = new Agent({ name: "writer", report: false }, { infer })
    const home = { agents: () => [scout, writer], ctx: { env: { tools: { probe: () => probe } } } }
    scout.home = writer.home = home
    const wf = new Workflow({ id: "brief", load: () => parsePhasesFile(FLOW), clock: () => at })
    wf.attach(writer)
    expect(wf.ownerCall("run", [{ id: "brief", request: "tides" }])).toEqual({ started: true })
    while (wf.active || wf.state.status === "running") await Bun.sleep(5)
    expect(wf.state.stages.map((r) => [r.id, r.status])).toEqual([["research", "done"], ["plan", "done"], ["check", "done"]])
    expect(wf.state.stages[0].gate).toMatchObject({ ok: true, retried: true })
    expect(seen.scout[0].tools).toContain("probe")
    expect(seen.scout[0].prompt).toContain("Find what is known about tides")
    expect(scout.tools.has("probe")).toBe(false)
    expect(seen.writer[0].prompt).toContain("findings: high tide 6am")
    // the viewer: a phase's agent, turns and reads live on its row; its variables recorded, {{request}} once
    expect(wf.state.stages[0]).toMatchObject({ agent: "scout", tools: 1 })
    expect(wf.state.stages[0].turns).toBeGreaterThanOrEqual(3)
    const vars = wf.ownerCall("stage", [{ stage: "plan" }]).vars
    expect(vars.filter((v) => /request/.test(v.name))).toHaveLength(1)
    expect(vars.map((v) => v.kind)).toContain("document")
  })

  test("a phase whose agent runs the flow is refused, not deadlocked", async () => {
    const lead = new Agent({ name: "lead", report: false }, { infer: async () => "{}" })
    lead.home = { agents: () => [lead] }
    const wf = new Workflow({ steps: [{ id: "a", kind: "phase", agent: "lead", body: "go" }], clock: () => at })
    await wf.run({}, { agent: lead })
    expect(wf.state.stages[0]).toMatchObject({ status: "failed" })
    expect(wf.state.stages[0].error).toContain("cannot be the one waiting")
  })
})
