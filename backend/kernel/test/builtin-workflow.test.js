import { describe, expect, test } from "bun:test"

import { builtinKit, checkSteps, downstream, fencedJson, parseWorkflowFiles, renderStep, Workflow } from "../index.js"

// A host whose llm/research answers from a script: each call → the next reply for that step (by the stage id in the prompt).
function scriptHost(replies) {
  const calls = []
  return {
    calls,
    async stream(path, body, { onEvent = () => {} } = {}) {
      const id = body.prompt.match(/<stage n="\d+" id="([a-z-]+)"/)?.[1]
      calls.push({ path, id, body })
      const queue = replies[id] ?? []
      const next = queue.length > 1 ? queue.shift() : queue[0]
      if (next instanceof Error) throw next
      onEvent({ type: "tool", name: "WebSearch", query: id })
      return { type: "result", text: typeof next === "function" ? next(body) : next, turns: 1, cost_usd: 0.01 }
    },
  }
}

const data = (x) => `doc\n\`\`\`data\n${JSON.stringify(x)}\n\`\`\``
const at = new Date("2026-10-22T13:00:00Z")

const steps = () => [
  { id: "state", kind: "code", code: "state" },
  { id: "read", title: "Read the world", body: "Read {{date}}.", schema: "score", derive: "double", inputs: ["state"] },
  { id: "card", body: "Write the card.", check: "card" },
]

const plugins = () => ({
  code: { state: () => ({ data: { cash: 100 }, head: "cash 100" }) },
  schemas: { score: { example: { score: 1 }, validate: (raw) => (typeof raw?.score === "number" ? { value: raw, problems: [] } : { value: null, problems: ["score: a number"] }) } },
  derive: { double: (v) => ({ code: { doubled: v.score * 2 }, problems: v.score > 10 ? ["score above 10"] : [] }) },
  checks: { card: (text, ctx) => ({ problems: text.includes(ctx.expect.decision) ? [] : [`no ${ctx.expect.decision} line`], decision: ctx.expect.decision }) },
  decide: (ctx) => ({ decision: ctx.code.read?.doubled >= 4 ? "TRADE" : "PASS", cash: ctx.inputs.state.cash }),
})

describe("workflow files", () => {
  test("parse, number and check against the desk's registries", () => {
    const files = [
      { name: "00-workflow.md", text: "---\nretries: 2\ncritical: [read]\n---\nfor the owner" },
      { name: "01-state.md", text: "---\nid: state\nkind: code\ncode: state\n---\n" },
      { name: "02-read.md", text: "---\nid: read\nschema: score\ninputs: [state]\n---\nRead." },
      { name: "03-ask.md", text: "---\nid: ask\nkind: agent\nagent: helper\n---\nAsk." },
    ]
    const wf = parseWorkflowFiles(files, { known: plugins() })
    expect(wf.settings).toEqual({ retries: 2, critical: ["read"] })
    expect(wf.steps.map((s) => [s.id, s.kind, s.n, s.after])).toEqual([["state", "code", 0, []], ["read", "research", 1, ["state"]], ["ask", "agent", 2, ["read"]]])
    expect(() => parseWorkflowFiles([{ name: "01-x.md", text: "---\nid: x\nschema: nope\n---\nX" }], { known: plugins() })).toThrow("schema nope — known: score")
    expect(() => parseWorkflowFiles([{ name: "01-x.md", text: "---\nid: y\n---\nX" }])).toThrow("named after its file")
    expect(parseWorkflowFiles([{ name: "01-x.md", text: "---\nid: x\nkind: agent\ntools: [web.search]\nmax_steps: 6\nmin_calls: 2\n---\nX" }]).steps[0]).toMatchObject({ own: true, tools: ["web.search"], max_steps: 6, min_calls: 2 }) // a step agent
    expect(() => parseWorkflowFiles([{ name: "01-x.md", text: "---\nid: x\nkind: agent\nmax_steps: 99\n---\nX" }])).toThrow("max_steps 1..60")
    expect(() => parseWorkflowFiles([{ name: "01-x.md", text: "---\nid: x\nwat: 1\n---\nX" }])).toThrow("unknown keys wat")
    expect(() => checkSteps([{ id: "a", after: ["b"] }])).toThrow("not an earlier step")
  })

  test("downstream and fenced blocks", () => {
    const s = checkSteps(steps())
    expect([...downstream(s, "read")]).toEqual(["read", "card"])
    expect(fencedJson('x\n```data\n{"a":1}\n```\n```data\n{"a":2}\n```').value).toEqual({ a: 2 })
    expect(fencedJson("none").missing).toBe(true)
    expect(fencedJson("```data\n{bad\n```").error).toContain("not JSON")
  })

  test("the default prompt carries the code step's data, the schema example and the body's vars", () => {
    const s = checkSteps(steps())
    const outputs = new Map([["state", { kind: "code", status: "done", data: { cash: 100 } }]])
    const p = renderStep(s[1], { steps: s, outputs, schemas: plugins().schemas, vars: { date: "2026-10-22" }, now: "now" })
    expect(p).toContain("Read 2026-10-22.")
    expect(p).toContain('<input from="state"')
    expect(p).toContain('{"cash":100}')
    expect(p).toContain('"score": 1')
  })
})

describe("Workflow artifact", () => {
  test("runs code → research (schema, derive) → check with the desk's decision; twin, summary, read", async () => {
    const host = scriptHost({ read: [data({ score: 3 })], card: ["DECISION TRADE"] })
    const wf = new Workflow({ id: "flow", steps: steps(), host, clock: () => at, ...plugins() })
    const out = await wf.run({})
    expect(out).toContain("flow r1-")
    expect(out).toContain("RESULT (card) TRADE")
    expect(wf.state.status).toBe("done")
    expect(wf.state.stages.map((r) => [r.id, r.status])).toEqual([["state", "done"], ["read", "done"], ["card", "done"]])
    expect(wf.state.stages[1].tools).toBe(1)
    expect(wf.state.stages[1].flow.in.map((x) => x.kind)).toEqual(["state"])
    expect(wf.state.result).toMatchObject({ stage: "card", decision: "TRADE", problems: [] })
    expect(wf.state.result.expect.cash).toBe(100)
    expect(wf.read({ stage: "read" })).toContain("doc")
    expect(wf.ownerCall("stage", [{ stage: "read" }]).code).toEqual({ doubled: 6 })
    expect(wf.live().view).toBe("pipeline")
    expect(wf.state.config.steps.map((x) => x.kind)).toEqual(["code", "research", "research"])
    expect(wf.state.log.lines.at(-1).text).toContain("done")
  })

  test("a failing ```data is asked once more with its problems; still failing, the problems flow on", async () => {
    const host = scriptHost({ read: ["no block", data({ score: 12 })], card: ["DECISION TRADE"] })
    const wf = new Workflow({ steps: steps(), host, clock: () => at, ...plugins() })
    await wf.run({})
    const reads = host.calls.filter((c) => c.id === "read")
    expect(reads).toHaveLength(2)
    expect(reads[1].body.prompt).toContain("<check_failed")
    expect(reads[1].body.prompt).toContain("no ```data block")
    expect(wf.state.stages[1].gate).toMatchObject({ ok: false, problems: ["score above 10"], retried: true })
    expect(host.calls.find((c) => c.id === "card").body.prompt).toContain('<gate_failed from="read">score above 10')
  })

  test("a critical step's problems fail the run by default", async () => {
    const host = scriptHost({ read: [data({ score: 12 })], card: ["DECISION TRADE"] })
    const wf = new Workflow({ steps: steps(), host, clock: () => at, settings: { critical: ["read"], retries: 0 }, ...plugins() })
    await wf.run({})
    expect(wf.state.status).toBe("failed")
  })

  test("re-run from a step reuses today's earlier outputs and re-runs code steps", async () => {
    const host = scriptHost({ read: [data({ score: 1 })], card: ["DECISION PASS"] })
    let codeRuns = 0
    const wf = new Workflow({ steps: steps(), host, clock: () => at, ...plugins(), code: { state: () => ({ data: { cash: ++codeRuns } }) } })
    await wf.run({})
    await wf.run({ from: "card", note: "be brief" })
    expect(host.calls.filter((c) => c.id === "read")).toHaveLength(1)
    expect(host.calls.filter((c) => c.id === "card")).toHaveLength(2)
    expect(host.calls.at(-1).body.prompt).toContain("be brief")
    expect(wf.state.stages.find((r) => r.id === "read").status).toBe("reused")
    expect(codeRuns).toBe(2)
    expect(wf.state.runs).toHaveLength(2)
    expect(await wf.run({ from: "nope" })).toContain("no step nope")
  })

  test("the owner's stop ends the run at once; one run at a time", async () => {
    const host = {
      stream: (path, body, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    }
    const wf = new Workflow({ steps: steps(), host, clock: () => at, ...plugins() })
    const run = wf.run({})
    await Bun.sleep(5)
    expect(await wf.run({})).toContain("a workflow run is going")
    expect(wf.ownerCall("stop").stopped).toMatch(/^r1-/)
    expect(await run).toContain("was stopped")
    expect(wf.state.stages.map((r) => r.status)).toEqual(["done", "stopped", "stopped"])
    expect(() => wf.ownerCall("nope")).toThrow("the owner can run, stop")
  })

  test("an agent step quests a desk agent; desk owner calls and extra twin fields", async () => {
    const helper = { name: "helper", ask: async (text, o) => ({ answer: `${o.from} read: ${text.includes("Summarise") ? "ok" : "?"}` }) }
    const lead = { name: "lead", home: { agents: () => [helper] }, current: null }
    const wf = new Workflow({ steps: [{ id: "sum", kind: "agent", agent: "helper", body: "Summarise." }], clock: () => at, ownerCalls: { ping: () => "pong" }, extra: () => ({ seen: 7 }) })
    expect(await wf.run({}, { agent: lead })).toContain("sum: done")
    expect(wf.read({ stage: "sum" })).toContain("workflow:sum read: ok")
    expect(wf.ownerCall("ping")).toBe("pong")
    expect(wf.state.seen).toBe(7)
  })

  test("a bad step file fails the run naming it, and the twin shows the error", async () => {
    const wf = new Workflow({ load: () => parseWorkflowFiles([{ name: "01-a.md", text: "---\nid: b\n---\nX" }]) })
    expect(await wf.run({})).toContain("named after its file")
    expect(wf.configTwin().error).toContain("01-a.md")
  })

  test("the kit hands every holder the desk's one workflow, with the desk's source and plug-ins", () => {
    const kit = builtinKit({ workflowSource: (id) => ({ load: () => ({ settings: { retries: 0 }, steps: checkSteps(steps()) }), folder: `${id}/` }), workflowPlugins: () => plugins() })
    const a = kit.artifacts.workflow({ name: "a" }, {})
    const b = kit.artifacts.workflow({ name: "b" }, {})
    expect(a).toBe(b)
    expect(a.settings().retries).toBe(0)
    expect(a.commands().map((c) => c.name)).toEqual(["workflow.run", "workflow.read"])
    expect(a.configTwin().folder).toBe("workflow/")
  })
})

test("the owner reads a step file: how it runs, its prompt as written, its data contract", () => {
  const wf = new Workflow({ steps: steps(), clock: () => at, ...plugins() })
  expect(wf.ownerCall("step", [{ step: "read" }])).toMatchObject({ step: "read", kind: "research", inputs: ["state"], schema: "score", body: "Read {{date}}.", example: { score: 1 } })
  expect(wf.ownerCall("step", [{ step: "state" }])).toMatchObject({ kind: "code", code: "state", example: null })
  expect(() => wf.ownerCall("step", [{ step: "nope" }])).toThrow("no step nope")
})

test("the viewer: each stage's variables by value, the output before a re-run, the owner's edit checked by a load", async () => {
  const host = scriptHost({ read: [data({ score: 3 })], card: ["DECISION TRADE"] })
  const files = new Map([["02-read.md", "---\nid: read\nschema: score\nderive: double\ninputs: [state]\n---\nRead {{date}} for {{who}}."]])
  const load = () =>
    parseWorkflowFiles(
      [
        { name: "01-state.md", text: "---\nid: state\nkind: code\ncode: state\n---\n" },
        { name: "02-read.md", text: files.get("02-read.md") },
        { name: "03-card.md", text: "---\nid: card\ncheck: card\n---\nWrite the card." },
      ],
      { known: plugins() },
    )
  const fs = { read: (n) => files.get(n) ?? null, write: (n, t) => files.set(n, t) }
  const wf = new Workflow({ id: "flow", load, files: fs, host, clock: () => at, ...plugins() })
  await wf.run({ note: "fast" })
  const d = wf.ownerCall("stage", [{ stage: "read" }])
  expect(d.prompt).toContain("Read 2026-10-22 for {{who}}.")
  expect(d.vars.map((v) => [v.name, v.kind])).toEqual([["{{date}}", "var"], ["{{who}}", "var"], ["owner note", "owner_note"], ["state", "input"]])
  expect(d.vars.find((v) => v.name === "{{who}}").missing).toBe(true)
  expect(d.vars.find((v) => v.name === "state").value).toEqual({ cash: 100 })
  expect(wf.ownerCall("stage", [{ stage: "card" }]).vars.map((v) => v.name)).toEqual(["owner note", "read data", "read code results", "expected"])
  const first = wf.state.stages.find((r) => r.id === "read")
  expect(first.run).toBe(wf.state.run.id)
  expect(first.last).toBeNull()

  // a second run: while it goes the row keeps the first run's output as `last`
  let release
  const slow = { stream: (p, body) => (body.prompt.includes('id="read"') ? new Promise((r) => (release = () => r({ type: "result", text: data({ score: 4 }) }))) : Promise.resolve({ type: "result", text: "DECISION TRADE" })) }
  wf.host = slow
  const run2 = wf.run({})
  await Bun.sleep(5)
  const row = wf.state.stages.find((r) => r.id === "read")
  expect(row.status).toBe("running")
  expect(row.last).toMatchObject({ run: first.run, status: "done" })
  const before = wf.ownerCall("stage", [{ stage: "read", last: true }])
  expect(before).toMatchObject({ last: true, run: first.run, data: { score: 3 } })
  expect(before.prompt).toContain("Read 2026-10-22")
  expect(before.vars.map((v) => v.name)).toContain("owner note")
  expect(wf.ownerCall("stage", [{ stage: "read" }])).toMatchObject({ status: "running", text: null })
  release()
  await run2
  expect(wf.ownerCall("stage", [{ stage: "read" }]).data).toEqual({ score: 4 })

  // the owner edits the step file: a stale revision refused, a file that does not load rolled back, a good one in force
  const f = wf.ownerCall("step", [{ step: "read" }])
  expect(f.source).toMatchObject({ name: "02-read.md", shared: false })
  expect(f.vars).toEqual(["date", "who"])
  expect(() => wf.ownerCall("edit", [{ step: "read", text: "x", revision: "nope" }])).toThrow("changed since it was read")
  expect(() => wf.ownerCall("edit", [{ step: "read", text: "---\nid: read\nschema: nope\n---\nX", revision: f.source.revision }])).toThrow("not saved — the workflow would not load: 02-read.md: schema nope")
  expect(files.get("02-read.md")).toContain("{{who}}")
  const saved = wf.ownerCall("edit", [{ step: "read", text: f.source.text.replace("for {{who}}", "for the owner"), revision: f.source.revision }])
  expect(saved).toMatchObject({ saved: "02-read.md", changed: true })
  expect(wf.ownerCall("step", [{ step: "read" }]).body).toBe("Read {{date}} for the owner.")
  expect(wf.state.log.lines.at(-1).text).toContain("the owner edited 02-read.md")
  expect(() => new Workflow({ steps: steps(), ...plugins() }).ownerCall("edit", [{ step: "read" }])).toThrow("not editable")
})

test("a run cut off by a restart is in its Runs list as interrupted (2026-10-23)", () => {
  const wf = new Workflow({ steps: steps(), clock: () => at, ...plugins() })
  wf.restore({ status: "running", run: { id: "r1-x", by: "owner", started: at.toISOString(), request: "go" }, stages: [{ id: "read", status: "running" }], runs: [] })
  expect(wf.state.status).toBe("interrupted")
  expect(wf.state.runs).toEqual([expect.objectContaining({ id: "r1-x", status: "interrupted", request: "go" })])
})

test("flush() sends what waits on the 1 s debounce at once (a stop writes it — 2026-10-23)", () => {
  const wf = new Workflow({ steps: steps(), clock: () => at, ...plugins() })
  let changes = 0
  wf.onChange(() => changes++)
  wf.touch()
  expect(changes).toBe(0)
  wf.flush()
  expect(changes).toBe(1)
  wf.flush() // nothing waits now
  expect(changes).toBe(1)
})
