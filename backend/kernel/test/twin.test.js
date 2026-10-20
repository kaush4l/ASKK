// The twin contract (every kernel element as plain data for its UI twin), the run context, tool factories in a
// spec, defineTool and the nested-desk marker.

import { describe, expect, test } from "bun:test"
import { Agent, AgentTool, Artifact, buildDesk, Checklist, defineTool, SharedBoard, Tool } from "../index.js"

const quiet = async (_, agent) => JSON.stringify({ thought: "done", calls: [], answer: `${agent.name} ok` })

// lead (team desk) → scout (team hunt, a mounted desk "options") → reader; the lead holds a checklist.
const spec = {
  name: "lead",
  team: "desk",
  goal: "find the trade",
  role: "Leads the desk.\nSecond line.",
  model: "opus",
  folder: "/desks/d/agents/lead",
  report: false,
  artifacts: [(agent) => new Checklist({ id: `${agent.name}.checklist`, items: ["names: scout reported"], owner: "desk" })],
  tools: [
    { type: "agent", name: "scout", team: "hunt", desk: "options", description: "finds names", report: false, tools: [{ type: "agent", name: "reader", role: "reads pages", report: false }] },
    { type: "function", name: "clock", description: "the time", run: () => "09:50" },
  ],
}

describe("twin: tools", () => {
  test("Tool.twin is its spec as an element", () => {
    const t = new Tool({ name: "web.read", view: "web", description: "a page as text", input: { url: "the page" }, run: () => "" })
    expect(t.twin()).toEqual({ element: "tool", id: "web.read", name: "web.read", type: "function", view: "web", description: "a page as text", input: { url: "the page" }, outside: true })
    expect(t.spec()).toEqual({ name: "web.read", type: "function", view: "web", description: "a page as text", input: { url: "the page" }, outside: true })
  })

  // 2026-10-20: whether a tool's results count as outside reads (tool.js readsOutside) — the web, another desk, every MCP
  // tool unless built outside: false, a desk's own tool built outside: true — is in its twin (the agent page marks it).
  test("outside: the web, desk.read / desk.ask, MCP tools (unless outside: false), a tool built outside: true", () => {
    const spec = (o) => new Tool({ run: () => "", ...o }).spec().outside ?? false
    expect(spec({ name: "rh.get_quotes", type: "mcp" })).toBe(true)
    expect(spec({ name: "calc.add", type: "mcp", outside: false })).toBe(false)
    expect(spec({ name: "desk.read", type: "desk", view: "desk" })).toBe(true)
    expect(spec({ name: "notes.save" })).toBe(false)
    expect(spec({ name: "news.fetch", outside: true })).toBe(true)
    expect(spec({ name: "web.fetch", outside: false })).toBe(false) // the tool's own word wins over its name
    expect(defineTool({ name: "news.read", description: "x", run: () => "", outside: true }).outside).toBe(true)
    expect(() => defineTool({ name: "news.read", description: "x", run: () => "", outside: "yes" })).toThrow("outside must be true or false")
  })

  test("AgentTool.twin carries the agent it wraps", () => {
    const sub = new Agent({ name: "macro", description: "reads the macro calendar" }, { infer: quiet })
    const twin = new AgentTool(sub, { name: "market.macro" }).twin()
    expect(twin).toMatchObject({ element: "tool", id: "market.macro", name: "market.macro", type: "agent", view: "quest", description: "reads the macro calendar", agent: "macro" })
    expect(Object.keys(twin.input)).toEqual(["requirement", "ask", "outcome"])
  })
})

describe("twin: artifacts", () => {
  test("a SharedBoard's twin state is {goal, entries}", () => {
    const parent = new SharedBoard({ name: "desk", goal: "find the trade" })
    const board = new SharedBoard({ name: "hunt", parent, goal: "names" })
    board.write("acme", "ACME 500", "scout")
    const twin = board.twin()
    expect(twin).toMatchObject({ element: "artifact", id: "hunt.board", kind: "board", view: "board", owner: "hunt", title: "hunt.board", keep: "day", brief: "1 entries" })
    expect(twin.state).toEqual({ goal: "names", entries: { acme: { author: "scout", text: "ACME 500", at: expect.any(String) } } })
    expect(twin.items).toBeUndefined()
  })

  test("a Checklist's twin carries its items, brief and keep", () => {
    const list = new Checklist({ id: "lead.checklist", items: ["data: data read", "!post: posted"], owner: "desk" })
    expect(list.twin()).toEqual({
      element: "artifact",
      id: "lead.checklist",
      kind: "checklist",
      view: "checklist",
      owner: "desk",
      title: "lead.checklist",
      keep: "day",
      brief: "0/2 done",
      state: { items: [{ id: "data", text: "data read", status: "open", note: null }, { id: "post", text: "posted", required: true, status: "open", note: null }] },
    })
  })

  test("a list view's twin carries its rows as items", () => {
    const picks = Object.assign(new Artifact({ name: "desk.picks" }), { view: "list", live: () => ({ view: "list", data: { items: [{ name: "GAMMA", detail: "long" }] } }) })
    expect(picks.twin().items).toEqual([{ name: "GAMMA", detail: "long" }])
  })
})

describe("twin: agents and the desk", () => {
  test("Agent.twin: definition, tool twins, the agents among them, artifacts held, desk", () => {
    const desk = buildDesk(spec, { infer: quiet })
    const lead = desk.lead.twin()
    expect(lead).toMatchObject({ element: "agent", id: "lead", name: "lead", description: "Leads the desk.", role: "Leads the desk.\nSecond line.", model: "opus", team: "desk", folder: "/desks/d/agents/lead", desk: null, status: "idle" })
    expect(lead.tools.map((t) => t.name)).toEqual(["scout", "clock", "lead.checklist.tick", "lead.checklist.skip", "desk.board.write"])
    expect(lead.tools.every((t) => t.element === "tool")).toBe(true)
    expect(lead.tools[0]).toMatchObject({ type: "agent", agent: "scout", description: "finds names" })
    expect(lead.agents).toEqual(["scout"])
    expect(lead.artifacts).toEqual(["lead.checklist", "desk.board"])
    const scout = desk.agents().get("scout").twin()
    expect(scout).toMatchObject({ desk: "options", team: "desk/hunt", agents: ["reader"], artifacts: ["hunt.board"], folder: null, model: null })
    expect(desk.agents().get("reader").twin().team).toBe("desk/hunt")
  })

  test("Desk.artifacts(): every artifact by id with its holders in tree order", () => {
    const desk = buildDesk(spec, { infer: quiet })
    const all = desk.artifacts()
    expect([...all.keys()]).toEqual(["lead.checklist", "desk.board", "hunt.board"])
    expect(all.get("desk.board").holders).toEqual(["lead"]) // scout leads its own team: it holds hunt.board
    expect(all.get("hunt.board").holders).toEqual(["scout", "reader"])
    expect(all.get("lead.checklist").artifact).toBeInstanceOf(Checklist)
  })

  test("Desk.twin: lead, tree, agent twins, artifact twins with holders", () => {
    const desk = buildDesk(spec, { infer: quiet })
    const twin = desk.twin()
    expect(twin.element).toBe("desk")
    expect(twin.lead).toBe("lead")
    expect(twin.tree).toEqual(desk.tree())
    expect(twin.agents.map((a) => a.name)).toEqual(["lead", "scout", "reader"])
    expect(twin.artifacts["hunt.board"]).toMatchObject({ element: "artifact", id: "hunt.board", kind: "board", holders: ["scout", "reader"], state: { goal: "", entries: {} } })
    expect(twin.artifacts["desk.board"].state).toEqual({ goal: "find the trade", entries: {} })
    expect(twin.artifacts["lead.checklist"]).toMatchObject({ kind: "checklist", holders: ["lead"], brief: "0/1 done" })
    expect(JSON.parse(JSON.stringify(twin))).toEqual(twin) // plain data
  })

  test("Desk.tree() nodes carry the mounted desk's name, else null", () => {
    const tree = buildDesk(spec, { infer: quiet }).tree()
    expect(tree.desk).toBeNull()
    expect(tree.agents[0]).toMatchObject({ name: "scout", desk: "options" })
    expect(tree.agents[0].agents[0]).toMatchObject({ name: "reader", desk: null })
  })
})

describe("run context and tool factories", () => {
  test("env.context reaches every tool call's ctx beside the agent and the signal", async () => {
    const seen = []
    const probe = new Tool({ name: "probe", run: (_, ctx) => (seen.push(ctx), "ok") })
    const host = { call: () => "host" }
    const replies = { lead: [{ thought: "t", calls: [{ tool: "probe", input: {} }] }], sub: [{ thought: "t", calls: [{ tool: "probe", input: {} }] }] }
    const infer = async (_, agent) => JSON.stringify(replies[agent.name]?.shift() ?? { thought: "done", calls: [], answer: "ok" })
    const desk = buildDesk({ name: "lead", report: false, tools: [probe, { type: "agent", name: "sub", report: false, tools: [probe] }] }, { infer, context: { host, agent: "spoofed" } })
    expect(desk.lead.context).toBe(desk.agents().get("sub").context) // one context for the desk
    await desk.lead.ask("go")
    await desk.agents().get("sub").ask("go")
    expect(seen.map((c) => c.agent.name)).toEqual(["lead", "sub"]) // agent is never the context's
    expect(seen.every((c) => c.host === host && "signal" in c)).toBe(true)
  })

  test("a desk built without a context, and an Agent built with one", async () => {
    expect(buildDesk({ name: "x" }, { infer: quiet }).lead.context).toEqual({})
    let ctx = null
    const probe = new Tool({ name: "probe", run: (_, c) => ((ctx = c), "ok") })
    const replies = [{ thought: "t", calls: [{ tool: "probe", input: {} }] }]
    const agent = new Agent({ name: "a", report: false }, { infer: async () => JSON.stringify(replies.shift() ?? { thought: "d", calls: [], answer: "ok" }), tools: [probe], context: { host: 1 } })
    await agent.ask("go")
    expect(ctx).toMatchObject({ host: 1, agent })
  })

  test("a (agent) => Tool factory in a spec's tools is called with the agent being built", async () => {
    const made = []
    const factory = (agent) => (made.push(agent.name), new Tool({ name: `${agent.name}.notes`, description: "notes", run: (_, ctx) => `notes of ${ctx.agent.name}` }))
    const desk = buildDesk({ name: "lead", report: false, tools: [factory, { type: "agent", name: "sub", report: false, tools: [factory] }] }, { infer: quiet })
    expect(made).toEqual(["lead", "sub"])
    expect([...desk.lead.tools.keys()]).toContain("lead.notes")
    expect(await desk.agents().get("sub").tools.get("sub.notes").run({}, { agent: desk.agents().get("sub") })).toBe("notes of sub")
    expect(() => buildDesk({ name: "x", tools: [() => null] }, { infer: quiet })).toThrow("x: a tool factory returned no tool")
  })

  test("a desk's own tool type named like an internal form goes to its builder, never mistaken for one", () => {
    const types = { instance: (t) => new Tool({ name: t.name, description: "built" }), factory: () => null }
    const desk = buildDesk({ name: "lead", report: false, tools: [{ type: "instance", name: "own.tool" }] }, { infer: quiet, types })
    expect(desk.lead.tools.get("own.tool").description).toBe("built")
    expect(() => buildDesk({ name: "x", tools: [{ type: "factory", name: "f" }] }, { infer: quiet, types })).toThrow("x: the factory builder returned no tool")
  })
})

describe("defineTool", () => {
  const good = { name: "market.quote", description: "a quote", input: { symbol: "ticker" }, run: ({ symbol }) => `${symbol} 1` }

  test("a good spec is a Tool with its defaults", async () => {
    const t = defineTool(good)
    expect(t).toBeInstanceOf(Tool)
    expect(t.twin()).toEqual({ element: "tool", id: "market.quote", name: "market.quote", type: "function", view: null, description: "a quote", input: { symbol: "ticker" } })
    expect(await t.run({ symbol: "ACME" })).toBe("ACME 1")
    expect(defineTool({ name: "web_read2.page-text", description: "x", run: () => "", view: "web", type: "mcp" }).spec()).toMatchObject({ input: {}, view: "web", type: "mcp" })
  })

  test("each bad spec throws a precise error", () => {
    expect(() => defineTool({ ...good, name: undefined })).toThrow("defineTool: name is required")
    expect(() => defineTool({ ...good, name: "Market.Quote" })).toThrow('defineTool: name "Market.Quote" must match')
    expect(() => defineTool({ ...good, name: "1quote" })).toThrow("must match")
    expect(() => defineTool({ ...good, name: "market..quote" })).toThrow("must match")
    expect(() => defineTool({ ...good, name: "market.quote." })).toThrow("must match")
    expect(() => defineTool({ ...good, description: "" })).toThrow("defineTool market.quote: description is required")
    expect(() => defineTool({ ...good, description: "   " })).toThrow("description is required")
    expect(() => defineTool({ ...good, run: "quote" })).toThrow("defineTool market.quote: run must be a function")
    expect(() => defineTool({ ...good, input: ["symbol"] })).toThrow("defineTool market.quote: input must be a plain object")
    expect(() => defineTool({ ...good, input: null })).toThrow("input must be a plain object")
    expect(() => defineTool({ ...good, input: new Map() })).toThrow("input must be a plain object")
    expect(() => defineTool({ ...good, input: { symbol: "ticker", n: 3, opts: {} } })).toThrow("defineTool market.quote: input n, opts must be text")
  })
})
