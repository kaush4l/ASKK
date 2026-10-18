import { describe, expect, test } from "bun:test"
import { Agent, Artifact, Checklist, REPORT_FORMAT, RESPONSE_FORMAT, Tool } from "../index.js"

// The prompt's top-level section headers, in order: a part starts the prompt or follows a blank line (render joins
// its parts with "\n\n"); the soul has no header.
const headers = (prompt) => [...prompt.matchAll(/(?:^|\n\n)(# [^\n]*)/g)].map((m) => m[1])
// Every header's indexOf, in the order given: strictly increasing means the prompt renders them in that order.
const ascending = (prompt, list) => {
  const at = list.map((h) => prompt.indexOf(h))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
  expect(new Set(at).size).toBe(at.length)
}

const SOUL = "You are honest: you say what you measured and what you did not."
const ROLE = "You are working as the tester: you check one thing at a time."
const REPORT = "VERDICT: GAMMA leads\nEVIDENCE: GAMMA +1.2% (look, 09:50); ACME +0.4% (look, 09:50)\nCONFIDENCE: 0.6\nFALSIFIER: GAMMA loses 217\nGAPS: none"

// The owner's reading order (2026-10-17): soul, agent instructions, context, quest, history, tools, response format.
describe("prompt order", () => {
  test("all present: soul → YOU ARE → artifacts → REQUEST → OWNER GUIDANCE → EARLIER RUNS → WORK DONE → TOOLS → RESPONSE", async () => {
    const prompts = []
    let agent
    const replies = [
      { thought: "done", calls: [], answer: REPORT }, // run 1: a past run in history
      { thought: "look", calls: [{ tool: "look", input: {} }] }, // run 2, step 1: the tool's run guides the agent
      { thought: "done", calls: [], answer: REPORT }, // run 2, step 2: one finished step, a waiting note
    ]
    const infer = async (prompt) => (prompts.push(prompt), JSON.stringify(replies.shift()))
    const look = new Tool({ name: "look", description: "quotes", run: () => (agent.guide("focus GAMMA"), "ACME +0.4% GAMMA +1.2%") })
    const notes = new Artifact({ name: "a.notes", title: "notes" })
    const list = new Checklist({ id: "a.checklist", items: [] })
    agent = new Agent({ name: "a", soul: SOUL, role: ROLE }, { infer, tools: [look], artifacts: [notes, list] })
    expect(agent.config.report).toBe(true)
    await agent.ask("first")
    await agent.ask("second")
    const p = prompts[2]
    const order = ["# YOU ARE a", "# a.notes — notes", "# a.checklist — a.checklist", "# REQUEST (from owner)", "# OWNER GUIDANCE", "# EARLIER RUNS", "# WORK DONE ON THIS REQUEST", "# TOOLS", "# RESPONSE"]
    expect(p.startsWith(`${SOUL}\n\n# YOU ARE a\n${ROLE}`)).toBe(true)
    expect(headers(p)).toEqual(order)
    ascending(p, [SOUL, ...order])
    // the guidance sits right under the request, the response format (with the report) closes the prompt
    expect(p).toContain("# REQUEST (from owner)\nsecond\n\n# OWNER GUIDANCE\n")
    expect(p).toContain("> owner: focus GAMMA")
    expect(p.endsWith(`# RESPONSE\n${RESPONSE_FORMAT}\n${REPORT_FORMAT}`)).toBe(true)
  })

  test("optional parts absent (no soul, artifacts, history, steps, guidance): YOU ARE → REQUEST → TOOLS → RESPONSE", () => {
    const agent = new Agent({ name: "a", role: ROLE }, { infer: async () => "", tools: [new Tool({ name: "look", run: () => "x" })] })
    const p = agent.render({ text: "go", from: "owner" }, [])
    expect(p.startsWith(`# YOU ARE a\n${ROLE}\n\n# REQUEST (from owner)\ngo`)).toBe(true)
    expect(headers(p)).toEqual(["# YOU ARE a", "# REQUEST (from owner)", "# TOOLS", "# RESPONSE"])
    ascending(p, ["# YOU ARE a", "# REQUEST (from owner)", "# TOOLS", "# RESPONSE"])
    expect(p.endsWith(`# RESPONSE\n${RESPONSE_FORMAT}\n${REPORT_FORMAT}`)).toBe(true)
    // no tools and no report: the request, then the response format alone
    const bare = new Agent({ name: "b", report: false }, { infer: async () => "" }).render({ text: "go", from: "lead" }, [])
    expect(headers(bare)).toEqual(["# YOU ARE b", "# REQUEST (from lead)", "# RESPONSE"])
    expect(bare.endsWith(`# RESPONSE\n${RESPONSE_FORMAT}`)).toBe(true)
  })

  test("config.system replaces # RESPONSE in the last position", () => {
    const system = "Answer in one word."
    const notes = new Artifact({ name: "a.notes", title: "notes" })
    const agent = new Agent({ name: "a", soul: SOUL, role: ROLE, system }, { infer: async () => "", tools: [new Tool({ name: "look", run: () => "x" })], artifacts: [notes] })
    agent.history.push({ from: "owner", request: "first", answer: "GAMMA" })
    agent.guidance.push({ from: "owner", text: "focus GAMMA", at: 0 })
    const p = agent.render({ text: "second", from: "owner" }, [{ thought: "look", results: [{ tool: "look", ok: true, output: "x" }] }])
    const order = ["# YOU ARE a", "# a.notes — notes", "# REQUEST (from owner)", "# OWNER GUIDANCE", "# EARLIER RUNS", "# WORK DONE ON THIS REQUEST", "# TOOLS", "# SYSTEM"]
    expect(headers(p)).toEqual(order)
    ascending(p, [SOUL, ...order])
    expect(p).not.toContain("# RESPONSE")
    expect(p).not.toContain(RESPONSE_FORMAT)
    expect(p.endsWith(`# SYSTEM\n${system}`)).toBe(true)
  })
})

// Every prompt string that points at another section names one that is there, where the text says (2026-10-17).
describe("prompt references hold under the order", () => {
  const scripted = (replies, prompts) => async (prompt) => (prompts.push(prompt), JSON.stringify(replies.shift() ?? { thought: "done", calls: [], answer: "ok" }))
  const look = () => new Tool({ name: "look", description: "quotes", run: () => "ACME 500" })

  test("# RESPONSE: the tools it names are under # TOOLS; a call's result comes back under # WORK DONE ON THIS REQUEST", async () => {
    const prompts = []
    const agent = new Agent({ name: "a", report: false }, { infer: scripted([{ thought: "look", calls: [{ tool: "look", input: {} }] }], prompts), tools: [look()] })
    await agent.ask("go")
    expect(RESPONSE_FORMAT).toContain("# TOOLS")
    expect(RESPONSE_FORMAT).toContain("# WORK DONE ON THIS REQUEST")
    expect(headers(prompts[1])).toContain("# TOOLS")
    expect(prompts[1]).toContain("# WORK DONE ON THIS REQUEST\nYour steps so far")
    expect(prompts[1].indexOf("  look → ACME 500")).toBeGreaterThan(prompts[1].indexOf("# WORK DONE ON THIS REQUEST"))
    expect(prompts[1].indexOf("- look {} — quotes")).toBeGreaterThan(prompts[1].indexOf("# TOOLS"))
  })

  test("HELD: the answer held for guidance points at # OWNER GUIDANCE, which is in that prompt above the held row", async () => {
    const prompts = []
    let agent
    const replies = [{ thought: "done", calls: [], answer: "BETA" }, { thought: "owner says GAMMA", calls: [], answer: "GAMMA" }]
    const infer = async (prompt) => (prompts.push(prompt), prompts.length === 1 && agent.guide("GAMMA, not BETA"), JSON.stringify(replies.shift()))
    agent = new Agent({ name: "a", report: false }, { infer })
    expect(await agent.ask("pick")).toBe("GAMMA")
    const p = prompts[1]
    expect(p).toContain("read # OWNER GUIDANCE, then answer")
    expect(headers(p)).toContain("# OWNER GUIDANCE")
    expect(p.indexOf("# OWNER GUIDANCE")).toBeLessThan(p.indexOf("answer held"))
  })

  test("format: 'read them above' — the call results sit above the row, in the same step", async () => {
    const prompts = []
    const replies = [{ thought: "look and answer", calls: [{ tool: "look", input: {} }], answer: "ACME" }, { thought: "done", calls: [], answer: "ACME 500" }]
    await new Agent({ name: "a", report: false }, { infer: scripted(replies, prompts), tools: [look()] }).ask("go")
    const p = prompts[1]
    expect(p).toContain("read them above")
    expect(p.indexOf("# WORK DONE ON THIS REQUEST")).toBeLessThan(p.indexOf("  look → ACME 500"))
    expect(p.indexOf("  look → ACME 500")).toBeLessThan(p.indexOf("answer not taken"))
  })

  test("repeat: 'its result is above' — the earlier step's result is above the repeat's row", async () => {
    const prompts = []
    const call = { thought: "look", calls: [{ tool: "look", input: {} }] }
    await new Agent({ name: "a", report: false }, { infer: scripted([call, { ...call }], prompts), tools: [look()] }).ask("go")
    const p = prompts[2]
    expect(p).toContain("same call as step 1: its result is above")
    expect(p.indexOf("  look → ACME 500")).toBeLessThan(p.indexOf("same call as step 1"))
  })

  test("minCalls gate: 'your tools are listed under # TOOLS' — # TOOLS is in that prompt", async () => {
    const prompts = []
    await new Agent({ name: "a", report: false, minCalls: 1 }, { infer: scripted([{ thought: "guess", calls: [], answer: "500" }], prompts), tools: [look()] }).ask("go")
    expect(prompts[1]).toContain("your tools are listed under # TOOLS")
    expect(headers(prompts[1])).toContain("# TOOLS")
  })

  test("artifact called by name: 'the same view is in your prompt' — its section is there", async () => {
    const prompts = []
    const notes = new Artifact({ name: "a.notes", title: "notes" })
    await new Agent({ name: "a", report: false }, { infer: scripted([{ thought: "read", calls: [{ tool: "a.notes", input: {} }] }], prompts), artifacts: [notes] }).ask("go")
    expect(prompts[1]).toContain("the same view is in your prompt")
    expect(headers(prompts[1])).toContain("# a.notes — notes")
  })
})
