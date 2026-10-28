import { describe, expect, test } from "bun:test"
import { Agent, Artifact, buildDesk, Checklist, parseReply, QualityMatrix, Schedule, scoreReport, Tool } from "../index.js"

// Scripted model: per agent, a list of replies; records every prompt.
function scripted(script) {
  const prompts = {}
  const infer = async (prompt, agent) => {
    ;(prompts[agent.name] ??= []).push(prompt)
    const next = script[agent.name]?.shift()
    return JSON.stringify(next ?? { thought: "done", calls: [], answer: `${agent.name} ok` })
  }
  return { infer, prompts }
}

describe("parseReply", () => {
  test("json with calls", () => {
    expect(parseReply('x {"thought":"t","calls":[{"tool":"a","input":{}}]} y').calls[0].tool).toBe("a")
  })
  test("plain text is the answer", () => {
    expect(parseReply("hello").answer).toBe("hello")
  })
})

describe("agent loop", () => {
  test("calls tools in parallel, then answers; callbacks fire", async () => {
    const { infer, prompts } = scripted({
      a: [{ thought: "look", calls: [{ tool: "add", input: { x: 1, y: 2 } }, { tool: "add", input: { x: 3, y: 4 } }] }, { thought: "done", calls: [], answer: "3 and 7" }],
    })
    const add = new Tool({ name: "add", input: { x: "n", y: "n" }, run: ({ x, y }) => String(x + y) })
    const agent = new Agent({ name: "a", role: "adder", report: false }, { infer, tools: [add] })
    const events = []
    agent.on("*", (e) => events.push(e.event))
    expect(await agent.ask("add")).toBe("3 and 7")
    expect(prompts.a[1]).toContain("add {x: 1, y: 2} → 3")
    expect(prompts.a[1]).toContain("add {x: 3, y: 4} → 7")
    expect(events).toEqual(["start", "think", "step", "call", "call", "result", "result", "think", "step", "answer"])
  })

  test("unknown tool is an error result, not a crash", async () => {
    const { infer, prompts } = scripted({ a: [{ thought: "x", calls: [{ tool: "nope", input: {} }] }] })
    await new Agent({ name: "a", report: false }, { infer }).ask("go")
    expect(prompts.a[1]).toContain("ERROR no tool nope")
  })

  test("owner guidance mid-run: the next prompt shows it once, then it is gone", async () => {
    const { infer, prompts } = scripted({
      a: [{ thought: "look", calls: [{ tool: "look", input: { n: 1 } }] }, { thought: "focus GAMMA", calls: [{ tool: "look", input: { n: 2 } }] }, { thought: "done", calls: [], answer: "GAMMA" }],
    })
    let agent
    const look = new Tool({ name: "look", input: { n: "n" }, run: ({ n }) => (n === 1 && agent.guide("focus GAMMA, skip BETA"), `look ${n}`) })
    agent = new Agent({ name: "a", report: false }, { infer, tools: [look] })
    const guides = []
    agent.on("guide", (e) => guides.push(e))
    expect(agent.guide("too early")).toBe(false) // idle: nothing to guide
    expect(await agent.ask("go")).toBe("GAMMA")
    expect(guides).toMatchObject([{ from: "owner", text: "focus GAMMA, skip BETA" }])
    expect(prompts.a[0]).not.toContain("# OWNER GUIDANCE")
    expect(prompts.a[1]).toContain("# OWNER GUIDANCE")
    expect(prompts.a[1]).toContain("> owner: focus GAMMA, skip BETA")
    // right under the request it amends, before the run's steps (2026-10-17 owner: quest, then history)
    expect(prompts.a[1].indexOf("# OWNER GUIDANCE")).toBeGreaterThan(prompts.a[1].indexOf("# REQUEST"))
    expect(prompts.a[1].indexOf("# OWNER GUIDANCE")).toBeLessThan(prompts.a[1].indexOf("# WORK DONE ON THIS REQUEST"))
    expect(prompts.a[2]).not.toContain("focus GAMMA, skip BETA")
    expect(agent.guidance).toEqual([])
  })

  test("guidance that arrives while the model answers holds the answer one step", async () => {
    const prompts = []
    let agent
    const replies = [{ thought: "done", calls: [], answer: "BETA" }, { thought: "owner says GAMMA", calls: [], answer: "GAMMA" }]
    const infer = async (prompt) => {
      prompts.push(prompt)
      if (prompts.length === 1) agent.guide("GAMMA, not BETA", "lead")
      return JSON.stringify(replies.shift())
    }
    agent = new Agent({ name: "a", report: false }, { infer })
    const gates = []
    agent.on("gate", (e) => gates.push(e))
    expect(await agent.ask("pick")).toBe("GAMMA")
    expect(gates).toMatchObject([{ held: true }])
    expect(prompts[1]).toContain("> lead: GAMMA, not BETA")
    expect(prompts[1]).toContain("answer held")
  })

  test("maxSteps stops a loop", async () => {
    const infer = async () => JSON.stringify({ thought: "again", calls: [{ tool: "t", input: {} }] })
    const agent = new Agent({ name: "a", maxSteps: 3, report: false }, { infer, tools: [new Tool({ name: "t", run: () => "x" })] })
    expect(await agent.ask("go")).toContain("stopped after 3 steps")
  })
})

describe("desks: every tool typed, agents are tools", () => {
  const spec = {
    name: "boss",
    team: "desk",
    goal: "find the day's trade",
    role: "sets goals",
    report: false,
    tools: [
      {
        type: "agent",
        name: "world",
        goal: "regime",
        role: "runs world",
        report: false,
        tools: [{ type: "agent", name: "news", role: "news", report: false, tools: ["quote", { type: "mcp", server: "broker", tool: "bars" }] }],
      },
      { type: "agent", name: "solo", role: "one agent", report: false, tools: [{ type: "agent", name: "reader", role: "reads pages", report: false }] },
      { type: "function", name: "clock", description: "time", run: () => "09:50" },
    ],
  }
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: ({ symbol }) => `${symbol} 500` })
  const types = { mcp: (t) => new Tool({ name: `${t.server}.${t.tool}`, type: "mcp", run: () => "bars" }) }

  test("nested build: boards chain, agents hold agents as tools, tools built by type", () => {
    const desk = buildDesk(spec, { infer: scripted({}).infer, tools: { quote }, types })
    const boss = desk.lead
    expect([...boss.tools.keys()]).toEqual(["world", "solo", "clock", "desk.board.write"])
    expect(boss.tools.get("world").type).toBe("agent")
    expect(boss.tools.get("clock").type).toBe("function")
    expect(boss.tools.get("desk.board.write").type).toBe("artifact")
    const world = desk.agents().get("world")
    expect([...world.tools.keys()]).toEqual(["news", "world.board.write"])
    expect(world.board.parent).toBe(desk.board)
    expect([...desk.agents().keys()].sort()).toEqual(["boss", "news", "reader", "solo", "world"])
    const news = desk.agents().get("news")
    expect([...news.tools.keys()]).toEqual(["quote", "broker.bars", "world.board.write"])
    expect(desk.agents().get("reader").teamPath).toBe("desk/solo")
    expect(news.tools.get("broker.bars").type).toBe("mcp")
    expect(desk.tree().agents[0].agents[0].tools).toEqual([{ name: "quote", type: "function" }, { name: "broker.bars", type: "mcp" }])
    expect(desk.agents().get("solo").teamPath).toBe("desk/solo")
  })

  test("goal flows down, report flows up, boards are shared", async () => {
    const { infer, prompts } = scripted({
      boss: [{ thought: "hand out", calls: [{ tool: "world", input: { requirement: "r", ask: "label regime", outcome: "o" } }, { tool: "solo", input: { requirement: "r", ask: "check", outcome: "o" } }] }, { thought: "done", calls: [], answer: "plan ready" }],
      world: [{ thought: "ask news", calls: [{ tool: "news", input: { requirement: "r", ask: "news today", outcome: "o" } }] }, { thought: "report", calls: [], answer: "risk-on" }],
      news: [{ thought: "q", calls: [{ tool: "quote", input: { symbol: "ACME" } }, { tool: "world.board.write", input: { key: "acme", text: "ACME 500" } }] }],
    })
    const desk = buildDesk(spec, { infer, tools: { quote }, types })
    const seen = []
    desk.on((e) => e.event === "answer" && seen.push(`${e.team}:${e.agent}`))
    expect(await desk.ask("today")).toBe("plan ready")
    expect(prompts.boss[1]).toMatch(/world \{requirement: [^\n]*\} → risk-on/)
    expect(prompts.world[1]).toContain("[acme] news: ACME 500")
    expect(prompts.news[0]).toContain("desk GOAL: find the day's trade")
    expect(prompts.boss[1]).not.toContain("[acme]")
    expect(seen).toContain("desk/world:news")
    expect(desk.board.snapshot().children[0].entries.acme.text).toBe("ACME 500")
  })

  test("duplicate names and untyped tools are refused", () => {
    expect(() => buildDesk({ name: "x", tools: [{ type: "agent", name: "x" }] }, { infer: scripted({}).infer })).toThrow("twice")
    expect(() => buildDesk({ name: "x", tools: [{ name: "y" }] }, { infer: scripted({}).infer })).toThrow("needs a type")
  })
})

describe("gates, checklist, quality, schedule", () => {
  const REPORT = "VERDICT: risk-off\nEVIDENCE: ACME -0.9% (quote 09:50); VOLX 18.2 (index 09:50)\nCONFIDENCE: 0.6\nFALSIFIER: ACME reclaims 575\nGAPS: none"

  test("a bad report is refused, then a good one passes", async () => {
    const { infer, prompts } = scripted({ a: [{ thought: "t", calls: [], answer: "risk-off" }, { thought: "t", calls: [], answer: REPORT }] })
    const agent = new Agent({ name: "a" }, { infer })
    expect(await agent.ask("go")).toBe(REPORT)
    expect(prompts.a[1]).toContain("report missing VERDICT")
  })

  test("open checklist items block the answer until ticked", async () => {
    const list = new Checklist({ id: "a.checklist", items: ["data: data read"] })
    const { infer, prompts } = scripted({
      a: [{ thought: "t", calls: [], answer: REPORT }, { thought: "t", calls: [{ tool: "a.checklist.tick", input: { id: "data", evidence: "quote 09:50" } }] }, { thought: "t", calls: [], answer: REPORT }],
    })
    const agent = new Agent({ name: "a" }, { infer, artifacts: [list] })
    expect(await agent.ask("go")).toBe(REPORT)
    expect(prompts.a[1]).toContain("checklist open: data")
    expect(list.state.items[0].status).toBe("done")
  })

  test("a required item cannot be skipped", async () => {
    const list = new Checklist({ id: "a.checklist", items: ["!post: posted", "note: noted"] })
    const [tick, skip] = list.commands()
    await expect(skip.run({ id: "post", reason: "no" })).rejects.toThrow("cannot be skipped")
    expect(await skip.run({ id: "note", reason: "n/a" })).toContain("1 open")
    expect(await tick.run({ id: "post", evidence: "sent" })).toContain("all done")
  })

  test("after the retries the answer goes through, flagged", async () => {
    const infer = async () => JSON.stringify({ thought: "t", calls: [], answer: "no format" })
    const agent = new Agent({ name: "a", gateRetries: 1 }, { infer })
    const flags = []
    agent.on("answer", (e) => flags.push(...e.flags))
    expect(await agent.ask("go")).toBe("no format")
    expect(flags[0]).toContain("report missing")
  })

  // 2026-10-17 (critic): the dispatch gate gave way after gateRetries and the lead's jobs outlived its run.
  test("a hard gate reason ({reason, hard: true}) refuses every time without spending a retry; the run ends at maxSteps; soft ones still count", async () => {
    class Hold extends Artifact {
      constructor() {
        super({ name: "hold" })
        this.busy = true
        this.soft = false
      }
      gate() {
        if (this.soft) return "soft reason"
        return this.busy ? { reason: "jobs still running", hard: true } : null
      }
    }
    const hold = new Hold()
    let n = 0
    let frees = 5 // the step whose answer finds the hold released (0: never)
    const infer = async () => (++n === frees && (hold.busy = false), JSON.stringify({ thought: "t", calls: [], answer: `answer ${n}` }))
    const agent = new Agent({ name: "a", report: false, gateRetries: 1, maxSteps: 8 }, { infer, artifacts: [hold] })
    const gates = []
    agent.on("gate", (e) => gates.push(e.reasons))
    expect(agent.gates("x")).toEqual(["jobs still running"]) // gates() gives the reasons as text
    expect(await agent.ask("go")).toBe("answer 5") // refused 4 times with gateRetries 1, through once it holds no more
    expect(gates).toEqual(Array(4).fill(["jobs still running"]))
    // held all along: the run ends at maxSteps, never flagged through
    hold.busy = true
    frees = 0
    const flags = []
    agent.on("answer", (e) => flags.push(e.flags))
    expect(await agent.ask("again")).toBe("(stopped after 8 steps without an answer)")
    expect(flags).toEqual([[]])
    // a soft reason still goes through flagged after gateRetries
    hold.soft = true
    expect(await agent.ask("soft")).toMatch(/^answer \d+$/)
    expect(flags.at(-1)).toEqual(["soft reason"])
  })

  test("quality matrix scores member reports in code", async () => {
    const member = new Agent({ name: "m" }, { infer: async () => JSON.stringify({ thought: "t", calls: [], answer: REPORT }) })
    const q = new QualityMatrix({ id: "lead.quality" })
    const { infer } = scripted({ lead: [{ thought: "t", calls: [{ tool: "m", input: { requirement: "r", ask: "go", outcome: "o" } }] }, { thought: "t", calls: [], answer: REPORT }] })
    const lead = new Agent({ name: "lead" }, { infer, tools: [member], artifacts: [q] })
    await lead.ask("go")
    expect(q.state.rows.m.score).toBe(5)
    expect(scoreReport("VERDICT: x").score).toBe(0)
  })

  test("schedule books, refuses the past, hands out the due run once", () => {
    let now = new Date("2026-10-15T13:00:00Z")
    const s = new Schedule({ clock: () => now, defaultGoal: "read the market" })
    expect(() => s.book({ at: "2026-10-15T12:00:00Z" })).toThrow("past")
    s.book({ in_minutes: 30 }, "chief")
    expect(s.state.next.goal).toBe("read the market")
    expect(s.takeDue()).toBeNull()
    now = new Date("2026-10-15T13:31:00Z")
    expect(s.takeDue().by).toBe("chief")
    expect(s.takeDue()).toBeNull()
  })
})

test("a quest is a brief: requirement, ask and outcome, in that order; refused without them", async () => {
  const { questText } = await import("../tool/tool.js")
  expect(questText({ requirement: "ACME above VWAP", ask: "does it hold 770?", outcome: "a race call" })).toBe("REQUIREMENT: ACME above VWAP\nASK: does it hold 770?\nOUTCOME: a race call")
  expect(questText({ quest: { requirement: "r", ask: "a", outcome: "o" } })).toBe("REQUIREMENT: r\nASK: a\nOUTCOME: o")
  expect(() => questText({ quest: "label the regime" })).toThrow("a quest needs requirement, ask, outcome")
  expect(() => questText({ requirement: "r", ask: "a" })).toThrow("a quest needs outcome")
})

test("the same data call twice in a run is answered from the first; old results keep their tail", async () => {
  let runs = 0
  const data = new Tool({ name: "bars", run: () => (++runs, `${"old ".repeat(300)}NEWEST`) })
  const replies = [
    { thought: "a", calls: [{ tool: "bars", input: { s: "ACME" } }] },
    { thought: "b", calls: [{ tool: "bars", input: { s: "ACME" } }] },
    { thought: "c", calls: [{ tool: "bars", input: { s: "BETA" } }] },
    { thought: "d", calls: [{ tool: "bars", input: { s: "GAMMA" } }] },
    { thought: "e", calls: [], answer: "done" },
  ]
  const prompts = []
  const agent = new Agent({ name: "w", report: false }, { infer: async (p) => (prompts.push(p), JSON.stringify(replies[prompts.length - 1])), tools: [data] })
  await agent.ask("go")
  expect(runs).toBe(3)
  expect(prompts[2]).toContain("same call as step 1")
  expect(prompts.at(-1)).toContain("NEWEST") // step 1's result, clipped, still ends with its newest part
})

test("an artifact called by name answers with its current view", async () => {
  const { Artifact } = await import("../artifact/artifact.js")
  const art = Object.assign(new Artifact({ name: "desk.notes" }), { render: () => "NOTE: hold" })
  const replies = [{ thought: "read", calls: [{ tool: "desk.notes", input: {} }] }, { thought: "done", calls: [], answer: "ok" }]
  const prompts = []
  const agent = new Agent({ name: "r", report: false }, { infer: async (p) => (prompts.push(p), JSON.stringify(replies[prompts.length - 1])), artifacts: [art] })
  await agent.ask("go")
  expect(prompts[1]).toContain("desk.notes → desk.notes (an artifact")
  expect(prompts[1]).toContain("NOTE: hold")
})

test("a required checklist item can be skipped when requiredWhen says it does not apply now", async () => {
  let open = true
  const c = new Checklist({ id: "l.checklist", items: ["!top5: set the top 5", "!next: book the next run"], requiredWhen: (id) => id !== "top5" || open })
  const [, skip] = c.commands()
  await expect(skip.run({ id: "top5", reason: "closed" })).rejects.toThrow("cannot be skipped")
  open = false
  expect(await skip.run({ id: "top5", reason: "after the close" })).toContain("top5 skipped")
  await expect(skip.run({ id: "next", reason: "x" })).rejects.toThrow("cannot be skipped")
})

test("a reply in fields: calls with their inputs, lists and long text between <<< >>>, the answer last", () => {
  const r = parseReply(`thought: brief the team
call: tape
requirement: ACME above VWAP
ask: does it hold 770?
outcome: one race call
call: desk.predict
predictions: <<<
- symbol: ACME
  p: 0.62
  up: 773.5
  down: 768
  tf: close
  drivers: momentum, levels
>>>`)
  expect(r.thought).toBe("brief the team")
  expect(r.calls.map((c) => c.tool)).toEqual(["tape", "desk.predict"])
  expect(r.calls[0].input).toEqual({ requirement: "ACME above VWAP", ask: "does it hold 770?", outcome: "one race call" })
  expect(r.calls[1].input.predictions[0]).toEqual({ symbol: "ACME", p: 0.62, up: 773.5, down: 768, tf: "close", drivers: "momentum, levels" })
  expect(r.answer).toBeNull()
  const done = parseReply("thought: done\nanswer: <<<\nVERDICT: hold\nGAPS: none\n>>>")
  expect(done).toEqual({ thought: "done", calls: [], answer: "VERDICT: hold\nGAPS: none" })
  expect(parseReply('thought: x\ncall: desk.top5.set {"trades": [], "note": "none"}').calls[0].input).toEqual({ trades: [], note: "none" })
})

test("minCalls: an answer before any tool ran is refused once, then the agent works", async () => {
  const replies = ["thought: no tools here\nanswer: <<<\ndone\n>>>", "thought: look\ncall: q\ns: ACME", "thought: done\nanswer: <<<\nACME 1\n>>>"]
  let i = 0
  const q = new Tool({ name: "q", input: { s: "symbol" }, run: () => "ACME 1" })
  const agent = new Agent({ name: "m", report: false, minCalls: 1 }, { infer: async () => replies[i++], tools: [q] })
  expect(await agent.ask("go")).toBe("ACME 1")
  expect(i).toBe(3)
})

test("an answer beside artifact commands is final; beside a data call it is not taken until the results are read", async () => {
  const list = new Checklist({ id: "a.checklist", items: ["data: data read"] })
  const tick = { tool: "a.checklist.tick", input: { id: "data", evidence: "quote" } }
  let i = 0
  const one = [{ thought: "t", calls: [tick], answer: "done" }]
  const a = new Agent({ name: "a", report: false }, { infer: async () => JSON.stringify(one[i++]), artifacts: [list] })
  expect(await a.ask("go")).toBe("done")
  expect(i).toBe(1)

  const q = new Tool({ name: "q", input: { s: "symbol" }, run: () => "ACME 1" })
  const two = [{ thought: "t", calls: [{ tool: "q", input: { s: "ACME" } }], answer: "guess" }, { thought: "t", calls: [], answer: "ACME 1" }]
  const prompts = []
  let j = 0
  const b = new Agent({ name: "b", report: false }, { infer: async (p) => (prompts.push(p), JSON.stringify(two[j++])), tools: [q] })
  expect(await b.ask("go")).toBe("ACME 1")
  expect(prompts[1]).toContain("answer not taken")
})

const BRIEF = { requirement: "16:05 ET, 12 wrong calls", ask: "which variable did each miss?", outcome: "the misses + the scorecard" }

test("after: a member that works from a sibling's report is refused until that sibling reported this run", async () => {
  const { infer } = scripted({
    lead: [
      { thought: "both", calls: [{ tool: "grader", input: BRIEF }, { tool: "critic", input: BRIEF }] },
      { thought: "now", calls: [{ tool: "critic", input: { ...BRIEF, requirement: { grades: ["MU 1d wrong", "ACME close right"], at: "16:05" } } }] },
    ],
  })
  const desk = buildDesk({ team: "desk", name: "lead", report: false, tools: [{ type: "agent", name: "grader", report: false }, { type: "agent", name: "critic", report: false, after: ["grader"] }] }, { infer })
  const results = []
  desk.lead.on("result", (r) => results.push(r))
  await desk.lead.ask("go")
  const critic = results.filter((r) => r.tool === "critic")
  expect(critic[0].ok).toBe(false)
  expect(critic[0].output).toContain("call grader first")
  expect(critic[1].ok).toBe(true)
})

test("a member called with its team's prefix runs that member", async () => {
  const { infer } = scripted({ lead: [{ thought: "brief macro", calls: [{ tool: "desk.macro", input: BRIEF }] }] })
  const desk = buildDesk({ team: "desk", name: "lead", report: false, tools: [{ type: "agent", name: "macro", report: false }] }, { infer })
  const results = []
  const calls = []
  desk.lead.on("result", (r) => results.push(r))
  desk.lead.on("call", (c) => calls.push(c))
  await desk.lead.ask("go")
  expect(results[0].tool).toBe("macro")
  expect(results[0].ok).toBe(true)
  // The call and its result name the member that ran, carry the brief and the call's place in the step (2026-10-17:
  // the host paired "desk.macro" with nothing and the thread row lost its brief).
  expect(calls[0]).toMatchObject({ tool: "macro", input: BRIEF, index: 0 })
  expect(results[0]).toMatchObject({ tool: "macro", input: BRIEF, index: 0 })
})

test("call and result carry the call's index in its step and its input: results that arrive out of order still say which call they answer", async () => {
  // Two quote calls in one step; ACME resolves after GAMMA (2026-10-17: two quote calls in one step showed each other's inputs).
  const { infer, prompts } = scripted({ a: [{ thought: "both", calls: [{ tool: "quote", input: { symbol: "ACME" } }, { tool: "quote", input: { symbol: "GAMMA" } }] }, { thought: "done", calls: [], answer: "ok" }] })
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: async ({ symbol }) => (symbol === "ACME" && (await Bun.sleep(20)), `${symbol} ${symbol === "ACME" ? 500 : 217}`) })
  const agent = new Agent({ name: "a", report: false }, { infer, tools: [quote] })
  const events = []
  agent.on("call", (e) => events.push(e))
  agent.on("result", (e) => events.push(e))
  await agent.ask("go")
  expect(events.map(({ event, tool, input, index, output }) => ({ event, tool, input, index, output }))).toEqual([
    { event: "call", tool: "quote", input: { symbol: "ACME" }, index: 0, output: undefined },
    { event: "call", tool: "quote", input: { symbol: "GAMMA" }, index: 1, output: undefined },
    { event: "result", tool: "quote", input: { symbol: "GAMMA" }, index: 1, output: "GAMMA 217" }, // arrived first
    { event: "result", tool: "quote", input: { symbol: "ACME" }, index: 0, output: "ACME 500" },
  ])
  // The step keeps its results in call order: the prompt reads ACME's first.
  expect(prompts.a[1]).toContain("quote {symbol: ACME} → ACME 500\n  quote {symbol: GAMMA} → GAMMA 217")
})

test("a brief field read as a list or object reaches the sub-agent as lines, not JSON", async () => {
  const { questText } = await import("../tool/tool.js")
  const text = questText({ requirement: { time: "15:21 ET", tickers: ["GAMMA", "AMD"] }, ask: ["which legs end?", "days in each"], outcome: "legs table" })
  expect(text).toContain("time: 15:21 ET\ntickers: GAMMA, AMD")
  expect(text).toContain("- which legs end?\n- days in each")
  expect(text).not.toContain("{")
})

test("board.write keeps report lines written outside <<< >>> as part of the text", async () => {
  const desk = buildDesk({ team: "desk", name: "lead", report: false, tools: [{ type: "agent", name: "m", report: false }] }, { infer: scripted({}).infer })
  const write = desk.lead.tools.get("desk.board.write")
  await write.run({ key: "verdict", text: "VERDICT: GAMMA short 5d", EVIDENCE: "leg down 6 days", GAPS: "none" }, { agent: desk.lead })
  expect(desk.lead.board.state.entries.verdict.text).toBe("VERDICT: GAMMA short 5d\nEVIDENCE: leg down 6 days\nGAPS: none")
})
