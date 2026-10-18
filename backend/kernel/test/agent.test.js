import { describe, expect, test } from "bun:test"
import { Agent, Artifact, buildDesk, Tool } from "../index.js"

// Prefix resolution (Agent.resolveTool): a member written with the prefix of the team its lead leads runs that
// member; any other prefix is a missing tool (2026-10-17: "nonsense.scout" ran scout).

const BRIEF = { requirement: "GAMMA leads small caps", ask: "is GAMMA moving?", outcome: "yes or no with the price" }

// Scripted model: per agent, a list of replies.
const scripted = (script) => async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "done", calls: [], answer: `${agent.name} ok` })

// A lead of team `desk` with one member, scout, and one data tool; the lead calls `name` once, then answers.
async function callAs(name) {
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: ({ symbol }) => `${symbol} 1` })
  const infer = scripted({ lead: [{ thought: "brief", calls: [{ tool: name, input: BRIEF }] }, { thought: "done", calls: [], answer: "done" }] })
  const desk = buildDesk({ name: "lead", team: "desk", report: false, tools: [quote, { type: "agent", name: "scout", report: false }] }, { infer })
  const events = []
  desk.lead.on("call", (e) => events.push(e))
  desk.lead.on("result", (e) => events.push(e))
  const scoutRuns = []
  desk.agents().get("scout").on("start", (e) => scoutRuns.push(e.request.text))
  await desk.lead.ask("go")
  return { lead: desk.lead, events, scoutRuns }
}

test("another prefix is a missing tool: nonsense.scout fails, listing what the agent has, and scout never runs", async () => {
  const { lead, events, scoutRuns } = await callAs("nonsense.scout")
  const result = events.find((e) => e.event === "result")
  expect(result).toMatchObject({ tool: "nonsense.scout", ok: false, index: 0 })
  expect(result.output).toBe(`no tool nonsense.scout; have ${[...lead.tools.keys()].join(", ")}`)
  expect(result.output).toContain("quote, scout")
  expect(events.find((e) => e.event === "call").tool).toBe("nonsense.scout")
  expect(scoutRuns).toEqual([])
  expect(lead.resolveTool("nonsense.scout")).toBe("nonsense.scout")
  expect(lead.resolveTool("lead.scout")).toBe("lead.scout") // the agent's name is not its team here (team: desk)
  expect(lead.resolveTool("desk.quote")).toBe("desk.quote") // only members resolve, not data tools
})

test("the team's own prefix still runs the member: desk.scout runs scout with its brief", async () => {
  const { lead, events, scoutRuns } = await callAs("desk.scout")
  expect(events.find((e) => e.event === "call")).toMatchObject({ tool: "scout", input: BRIEF, index: 0 })
  expect(events.find((e) => e.event === "result")).toMatchObject({ tool: "scout", ok: true, input: BRIEF, index: 0 })
  expect(scoutRuns.length).toBe(1)
  expect(lead.resolveTool("desk.scout")).toBe("scout")
  expect(lead.resolveTool("scout")).toBe("scout")
})

test("an agent built without a desk: its team is its config's, else its name", () => {
  const infer = scripted({})
  const scout = new Agent({ name: "scout", report: false }, { infer })
  expect(new Agent({ name: "lead", team: "market", report: false }, { infer, tools: [scout] }).resolveTool("market.scout")).toBe("scout")
  expect(new Agent({ name: "lead", team: "market", report: false }, { infer, tools: [scout] }).resolveTool("lead.scout")).toBe("lead.scout")
  expect(new Agent({ name: "lead", report: false }, { infer, tools: [scout] }).resolveTool("lead.scout")).toBe("scout")
})

// Stop from anywhere and the run in progress (2026-10-17 owner: the owner can stop anything — a member running a
// lead's quest too): agent.stop() aborts every run of the agent, whoever started it; agent.current is the run in progress.
describe("stop and current", () => {
  const never = () => new Promise(() => {})

  test("a lead quests a member whose model call blocks: member.stop() ends the member's run 'stopped', the quest result is ok:false and the lead goes on", async () => {
    let entered
    const inScout = new Promise((r) => (entered = r))
    const lead = [{ thought: "ask scout", calls: [{ tool: "scout", input: BRIEF }] }, { thought: "done", calls: [], answer: "went on" }]
    const infer = async (_, agent) => (agent.name === "scout" ? (entered(), never()) : JSON.stringify(lead.shift()))
    const desk = buildDesk({ name: "lead", team: "desk", report: false, tools: [{ type: "agent", name: "scout", report: false }] }, { infer })
    const scout = desk.agents().get("scout")
    const results = []
    desk.lead.on("result", (e) => results.push(e))
    const errors = []
    scout.on("error", (e) => errors.push(e.error))
    expect(scout.current).toBeNull()
    const run = desk.lead.ask("go")
    await inScout
    // The run in progress: its request and the live steps list.
    expect(scout.current.request).toMatchObject({ from: "lead", text: expect.stringContaining("ASK: is GAMMA moving?") })
    expect(scout.current.steps).toEqual([])
    expect(desk.lead.current.request).toEqual({ text: "go", from: "owner" })
    expect(scout.busy).toBe(true)
    expect(scout.stop()).toBe(1)
    expect(await run).toBe("went on")
    expect(results[0]).toMatchObject({ tool: "scout", ok: false, output: "stopped", index: 0 })
    expect(errors).toEqual(["stopped"])
    expect(scout.status).toBe("error")
    expect([scout.current, desk.lead.current]).toEqual([null, null])
    expect(scout.busy).toBe(false)
    expect(scout.stop()).toBe(0) // nothing left to stop
  })

  test("queued runs end 'stopped' without a model call or an artifact reset; stop returns how many it stopped", async () => {
    let entered
    const inOne = new Promise((r) => (entered = r))
    let calls = 0
    const resets = []
    const list = Object.assign(new Artifact({ name: "a.list" }), { onRunStart: (_, request) => resets.push(request.text) })
    const agent = new Agent({ name: "a", report: false }, { infer: async () => (calls++, entered(), never()), artifacts: [list] })
    const events = []
    agent.on("*", (e) => ["start", "error"].includes(e.event) && events.push(`${e.event} ${e.request?.text ?? e.error}`))
    const runs = ["one", "two", "three"].map((t) => agent.ask(t).catch((e) => e.message))
    await inOne
    expect(agent.stop()).toBe(3)
    expect(await Promise.all(runs)).toEqual(["stopped", "stopped", "stopped"])
    // Each queued run still shows as a run that ended "stopped" (the host's thread row), with no model call.
    expect(events).toEqual(["start one", "error stopped", "start two", "error stopped", "start three", "error stopped"])
    expect(calls).toBe(1)
    expect(resets).toEqual(["one"])
    expect(agent.history).toEqual([])
    expect(agent.busy).toBe(false)
    // The agent takes new work afterwards.
    const fresh = new Agent({ name: "b", report: false }, { infer: async () => JSON.stringify({ thought: "d", calls: [], answer: "ok" }) })
    expect(fresh.stop()).toBe(0)
    expect(await fresh.ask("go")).toBe("ok")
  })

  test("a stop during a step's calls lands at the next step boundary; the tool's ctx.signal carries the reason", async () => {
    let steps = 0
    const wait = new Tool({ name: "wait", run: (_, ctx) => new Promise((done) => ctx.signal.addEventListener("abort", () => done(`aborted: ${ctx.signal.reason}`))) })
    const agent = new Agent({ name: "a", report: false }, { infer: async () => (steps++, JSON.stringify({ thought: "wait", calls: [{ tool: "wait", input: {} }] })), tools: [wait] })
    const results = []
    agent.on("result", (e) => results.push(e.output))
    const run = agent.ask("go").catch((e) => e.message)
    await Bun.sleep(5)
    expect(agent.stop("the owner said so")).toBe(1)
    expect(await run).toBe("stopped")
    expect(results).toEqual(["aborted: the owner said so"])
    expect(steps).toBe(1)
  })

  test("the signal a run was asked with still stops it (the host's), and stopping a lead stops the member running its quest", async () => {
    const host = new AbortController()
    let entered
    const inInfer = new Promise((r) => (entered = r))
    const solo = new Agent({ name: "solo", report: false }, { infer: async () => (entered(), never()) })
    const run = solo.ask("go", { signal: host.signal }).catch((e) => e.message)
    await inInfer
    host.abort()
    expect(await run).toBe("stopped")
    expect(await solo.ask("again", { signal: host.signal }).catch((e) => e.message)).toBe("stopped") // aborted before: never starts

    let inScout
    const scoutIn = new Promise((r) => (inScout = r))
    const infer = async (_, agent) => (agent.name === "scout" ? (inScout(), never()) : JSON.stringify({ thought: "ask", calls: [{ tool: "scout", input: BRIEF }] }))
    const desk = buildDesk({ name: "lead", report: false, tools: [{ type: "agent", name: "scout", report: false }] }, { infer })
    const scout = desk.agents().get("scout")
    const leadRun = desk.lead.ask("go").catch((e) => e.message)
    await scoutIn
    expect(desk.lead.stop()).toBe(1)
    expect(await leadRun).toBe("stopped")
    expect(scout.status).toBe("error")
    expect(scout.busy).toBe(false)
  })
})
