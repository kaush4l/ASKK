import { describe, expect, test } from "bun:test"

import { Agent, checkSteps, parseWorkflowMarkdown, reportFields, settledBefore, waitsOf, workflowFromMarkdown } from "../index.js"

const at = new Date("2026-10-22T13:00:00Z")

const FLOW = `---
deadline_minutes: 20
board: false
vars:
  audience: engineers
---
# Tide brief

Research a topic, outline it, write it — each phase reads only what it names.

## research — Find the sources
agent: scout
max_steps: 8

Find what is known about {{request}} for {{audience}}.

### Output
sources: the pages read, one per line
findings: what they say, each with its source

## outline
agent: writer
report: outline

Outline from {{research.findings}} (sources: {{research.sources}}).

## write — Write it
agent: writer
after: outline
report: text

Write {{outline.outline}} for {{audience}} on {{date}}.
`

describe("parseWorkflowMarkdown: one md file → the workflow object", () => {
  test("title, description, run variables, phases with titles, the output format and the variables each uses", () => {
    const wf = parseWorkflowMarkdown(FLOW)
    expect(wf.title).toBe("Tide brief")
    expect(wf.description).toBe("Research a topic, outline it, write it — each phase reads only what it names.")
    expect(wf.vars).toEqual({ audience: "engineers" })
    expect(wf.settings).toMatchObject({ deadline_minutes: 20, board: false })
    expect(wf.steps.map((s) => [s.id, s.title, s.kind, s.agent, s.after, s.report])).toEqual([
      ["research", "Find the sources", "phase", "scout", [], ["sources", "findings"]],
      ["outline", "outline", "phase", "writer", ["research"], ["outline"]],
      ["write", "Write it", "phase", "writer", ["outline"], ["text"]],
    ])
    expect(wf.steps[0].output).toContain("sources: the pages read")
    expect(wf.steps[0].body).toBe("Find what is known about {{request}} for {{audience}}.")
    expect(wf.steps[1].uses).toEqual(["research.findings", "research.sources"])
    expect(wf.steps[2].uses).toEqual(["outline.outline", "audience", "date"])
  })

  test("every variable is checked: an unknown name, a phase that does not run before, a field it does not report", () => {
    const base = "## a\nagent: x\nreport: one\n\ngo\n\n"
    expect(() => parseWorkflowMarkdown(`${base}## b\nagent: x\n\nuse {{nope}}`)).toThrow("{{nope}} — not a run variable (request, date, now) nor an upstream phase's output (a.one)")
    expect(() => parseWorkflowMarkdown(`${base}## b\nagent: x\n\nuse {{a.two}}`)).toThrow("a reports one")
    expect(() => parseWorkflowMarkdown(`${base}## b\nagent: y\nafter: []\n\nuse {{a.one}}`)).toThrow("a does not run before b (put it in b's after:)")
    expect(() => parseWorkflowMarkdown(`## a\nagent: x\n\ngo\n\n## b\nagent: x\n\nuse {{a.one}}`)).toThrow("a names no report fields")
    expect(() => parseWorkflowMarkdown(`## a\nagent: x\n\ngo\n### Output\nno fields here`)).toThrow("### Output names no fields")
    expect(() => parseWorkflowMarkdown(`---\nvars: {request: x}\n---\n## a\nagent: x\n\ngo`)).toThrow("vars request")
    expect(() => parseWorkflowMarkdown(`## A b\nagent: x\n\ngo`)).toThrow("a phase heading is")
    // the whole report of an upstream phase, and a field of it, are fine
    expect(parseWorkflowMarkdown(`${base}## b\nagent: x\n\nuse {{a}} and {{a.one}}`).steps[1].uses).toEqual(["a", "a.one"])
  })

  test("a report's fields read back from an answer, a value over several lines", () => {
    const step = { report: ["sources", "findings"] }
    expect(reportFields(step, "Here is what I found.\n\nsources: wiki\nnoaa\n**findings**: high tide 6am\nlow at noon")).toEqual({ sources: "wiki\nnoaa", findings: "high tide 6am\nlow at noon" })
    expect(reportFields(step, "sources: only")).toEqual({ sources: "only" })
  })
})

// two agents answering from a script; what each was asked is kept
function desk(replies) {
  const seen = {}
  const infer = async (prompt, agent) => {
    ;(seen[agent.name] ??= []).push(prompt)
    return JSON.stringify(replies[agent.name].shift())
  }
  const scout = new Agent({ name: "scout", report: false }, { infer })
  const writer = new Agent({ name: "writer", report: false }, { infer })
  const owner = new Agent({ name: "owner", report: false }, { infer })
  scout.home = writer.home = owner.home = { agents: () => [scout, writer, owner] }
  return { seen, owner }
}

describe("a run carries data between phases as variables", () => {
  test("{{phase.field}} filled from the upstream report; board off: no other phase's text; the run's vars over the defaults", async () => {
    const { seen, owner } = desk({
      scout: [{ thought: "r", calls: [], answer: "I read two pages.\nsources: noaa.gov\nfindings: high tide at 6am" }],
      writer: [
        { thought: "o", calls: [], answer: "outline: 1. the 6am tide" },
        { thought: "w", calls: [], answer: "text: The tide is high at 6am." },
      ],
    })
    let text = FLOW
    const wf = workflowFromMarkdown({ read: () => text, write: (t) => (text = t) }, { clock: () => at })
    wf.attach(owner)
    expect(wf.name).toBe("tide-brief")
    wf.ownerCall("run", [{ request: "tides", vars: { audience: "sailors", stray: "x" } }])
    while (wf.active || wf.state.status === "running") await Bun.sleep(5)
    expect(wf.state.stages.map((r) => r.status)).toEqual(["done", "done", "done"])
    expect(wf.state.run.vars).toEqual({ audience: "sailors" })
    expect(seen.scout[0]).toContain("Find what is known about tides for sailors.")
    expect(seen.scout[0]).toContain("The report's format:\nsources: the pages read")
    expect(seen.writer[0]).toContain("Outline from high tide at 6am (sources: noaa.gov).")
    expect(seen.writer[0]).not.toContain("# BOARD")
    expect(seen.writer[0]).not.toContain("I read two pages")
    expect(seen.writer[1]).toContain("Write 1. the 6am tide for sailors on 2026-10-22.")
    // the viewer: a stage's report as fields, its variables by where they came from
    const d = wf.ownerCall("stage", [{ stage: "research" }])
    expect(d.report).toEqual({ sources: "noaa.gov", findings: "high tide at 6am" })
    const vars = wf.ownerCall("stage", [{ stage: "outline" }]).vars
    expect(vars.map((v) => [v.name, v.kind, v.from, v.value])).toEqual([
      ["{{research.findings}}", "output", "research", "high tide at 6am"],
      ["{{research.sources}}", "output", "research", "noaa.gov"],
      ["request", "var", "the run", "tides"],
    ])
  })

  test("the owner experiments: a draft checked, never written; a save kept as a version; an edit marks the phase", async () => {
    let text = FLOW
    const wf = workflowFromMarkdown({ read: () => text, write: (t) => (text = t) }, { clock: () => at })
    const cfg = wf.configTwin()
    expect(cfg).toMatchObject({ title: "Tide brief", vars: { audience: "engineers" }, editable: true, error: null })
    expect(cfg.steps.map((s) => s.uses)).toEqual([["request", "audience"], ["research.findings", "research.sources"], ["outline.outline", "audience", "date"]])
    const src = wf.ownerCall("source", [{}])
    expect(src).toMatchObject({ name: "workflow.md", files: ["workflow.md"], versions: [] })
    // a draft that does not load: the reason, and the file untouched
    const bad = wf.ownerCall("check", [{ name: "workflow.md", text: FLOW.replace("{{research.findings}}", "{{research.nope}}") }])
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("research reports sources, findings")
    expect(text).toBe(FLOW)
    // a draft that loads: the workflow it would be
    const reworded = FLOW.replace("Outline from", "Briefly outline from")
    const good = wf.ownerCall("check", [{ name: "workflow.md", text: reworded }])
    expect(good.ok).toBe(true)
    expect(good.config.steps[1].rev).not.toBe(cfg.steps[1].rev)
    expect(good.config.steps[0].rev).toBe(cfg.steps[0].rev)
    // saved: the old text kept, readable again
    expect(wf.ownerCall("edit", [{ name: "workflow.md", text: reworded, revision: src.revision }])).toMatchObject({ saved: "workflow.md", changed: true })
    expect(text).toBe(reworded)
    expect(wf.state.versions).toHaveLength(1)
    expect(wf.ownerCall("version", [{ file: wf.state.versions[0].file }]).text).toBe(FLOW)
    expect(wf.ownerCall("source", [{}]).versions).toHaveLength(1)
    // an edit that would not load is refused and rolled back
    const now = wf.ownerCall("source", [{}])
    expect(() => wf.ownerCall("edit", [{ name: "workflow.md", text: "## Bad", revision: now.revision }])).toThrow("not saved — the workflow would not load")
    expect(text).toBe(reworded)
  })
})

// 2026-10-23 architecture map: steps side by side read only what has settled for them — never a sibling that happened to
// finish first — and two phases on one agent are never side by side.
describe("parallel phases", () => {
  const FAN = `## z — slow
agent: writer
report: z

slow work

## a — fast, beside z
agent: scout
after: []
report: a

fast work

## b — after z only
agent: critic
after: [z]
report: b

judge

## c — joins both
agent: judge
after: [a, b]
report: c

join
`
  test("a sibling that finished first is not on the board of a step that does not wait on it", async () => {
    const seen = {}
    const replies = { writer: "z: done z", scout: "a: done a", critic: "b: done b", judge: "c: done c" }
    const infer = async (prompt, agent) => {
      ;(seen[agent.name] ??= []).push(prompt)
      if (agent.name === "writer") await Bun.sleep(40) // a ends while z still runs
      return JSON.stringify({ thought: "t", calls: [], answer: replies[agent.name] })
    }
    const agents = ["writer", "scout", "critic", "judge", "owner"].map((name) => new Agent({ name, report: false }, { infer }))
    for (const x of agents) x.home = { agents: () => agents }
    const wf = workflowFromMarkdown({ read: () => FAN }, { clock: () => at })
    wf.attach(agents.at(-1))
    wf.ownerCall("run", [{ request: "go" }])
    while (wf.active || wf.state.status === "running") await Bun.sleep(5)
    expect(wf.state.stages.map((r) => r.status)).toEqual(["done", "done", "done", "done"])
    const board = (p) => p.slice(p.indexOf("# BOARD"))
    expect(board(seen.critic[0])).toContain("## z")
    expect(board(seen.critic[0])).not.toContain("## a")
    expect(board(seen.judge[0])).toContain("## a")
    expect(board(seen.judge[0])).toContain("## b")
    expect(board(seen.judge[0])).toContain("## z") // upstream through b
  })

  test("two phases on one agent that may run side by side are refused, the fix named; in a chain they are fine", () => {
    const two = "## a\nagent: x\n\none\n\n## b\nagent: x\nafter: []\n\ntwo"
    expect(() => parseWorkflowMarkdown(two)).toThrow("agent x also runs a, which may run beside b — one agent runs one at a time: give b after: [a]")
    expect(parseWorkflowMarkdown("## a\nagent: x\n\none\n\n## b\nagent: x\n\ntwo").steps.map((s) => s.after)).toEqual([[], ["a"]])
  })
})

// 2026-10-23: a code step blocks only the steps that read it; `barrier: true` blocks every step after it.
describe("code steps as barriers", () => {
  const steps = (barrier) =>
    checkSteps([
      { id: "state", kind: "code", code: "state", ...(barrier == null ? {} : { barrier }) },
      { id: "quiet", kind: "phase", agent: "a", after: [], body: "reads nothing" },
      { id: "reader", kind: "phase", agent: "b", after: [], inputs: ["state"], body: "reads state" },
      { id: "named", kind: "phase", agent: "c", after: [], body: "uses {{state}}" },
    ])
  test("only its readers wait on it; a barrier holds every later step", () => {
    const free = steps()
    expect(free.map((_, i) => waitsOf(free, i))).toEqual([[], [], ["state"], ["state"]])
    const held = steps(true)
    expect(held.map((_, i) => waitsOf(held, i))).toEqual([[], ["state"], ["state"], ["state"]])
    expect(settledBefore(free, "quiet").map((s) => s.id)).toEqual([])
  })
  test("barrier is for code steps, and a boolean", () => {
    expect(() => checkSteps([{ id: "x", kind: "phase", agent: "a", barrier: true }])).toThrow("barrier is for kind: code steps")
    expect(() => checkSteps([{ id: "x", kind: "code", code: "c", barrier: "yes" }])).toThrow("barrier true | false")
  })
})

test("concurrency: 1 runs side-by-side phases one at a time; unset, they overlap", async () => {
  const flow = (cap) => `${cap ? `---\nconcurrency: ${cap}\n---\n` : ""}## a\nagent: x\nafter: []\n\none\n\n## b\nagent: y\nafter: []\n\ntwo\n`
  const run = async (cap) => {
    let open = 0, most = 0
    const infer = async () => {
      open++
      most = Math.max(most, open)
      await Bun.sleep(15)
      open--
      return JSON.stringify({ thought: "t", calls: [], answer: "ok" })
    }
    const agents = ["x", "y", "owner"].map((name) => new Agent({ name, report: false }, { infer }))
    for (const a of agents) a.home = { agents: () => agents }
    const wf = workflowFromMarkdown({ read: () => flow(cap) }, { clock: () => at })
    wf.attach(agents.at(-1))
    wf.ownerCall("run", [{ request: "go" }])
    while (wf.active || wf.state.status === "running") await Bun.sleep(5)
    expect(wf.state.stages.map((r) => r.status)).toEqual(["done", "done"])
    return most
  }
  expect(await run(1)).toBe(1)
  expect(await run(0)).toBe(2)
})

test("a workflow file that does not load is still editable from the viewer (2026-10-23)", () => {
  let text = "## a\nagent: x\n\nuse {{nope}}"
  const wf = workflowFromMarkdown({ read: () => text, write: (t) => (text = t) }, { clock: () => at })
  const twin = wf.configTwin()
  expect(twin.error).toContain("{{nope}}")
  expect(twin.editable).toBe(true)
})
