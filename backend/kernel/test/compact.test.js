import { describe, expect, test } from "bun:test"
import { Agent, Tool, contextBudget } from "../index.js"

// A data tool whose result is big: every step adds ~2000 chars to the prompt.
const big = new Tool({ name: "big", input: { i: "n" }, run: () => "x".repeat(2000) })
const call = (i) => JSON.stringify({ thought: `step ${i}`, calls: [{ tool: "big", input: { i } }] })
const done = JSON.stringify({ thought: "done", calls: [], answer: "ok" })

describe("prompt compaction", () => {
  test("budget by model, config wins", () => {
    expect(contextBudget("apple")).toBe(12_000)
    expect(contextBudget("claude-opus")).toBe(400_000)
    expect(new Agent({ name: "a", contextChars: 5000 }, { infer: async () => "" }).budget).toBe(5000)
  })

  test("at 90% the older steps fold into a model summary; the request stays verbatim", async () => {
    const prompts = []
    let n = 0
    const infer = async (prompt) => {
      prompts.push(prompt)
      if (prompt.startsWith("# COMPACT")) return "SUMMARY: big returned x's"
      return ++n < 6 ? call(n) : done
    }
    const agent = new Agent({ name: "a", report: false, contextChars: 8000 }, { infer, tools: [big] })
    const events = []
    agent.on("compact", (e) => events.push(e))
    await agent.ask("THE GOAL: find the thing", { from: "owner" })
    expect(events.length).toBeGreaterThan(0)
    const e = events[0]
    expect(e).toMatchObject({ mode: "model", budget: 8000 })
    expect(e.steps_folded).toBeGreaterThan(0)
    expect(e.before_chars).toBeGreaterThanOrEqual(8000 * 0.9)
    expect(e.after_chars).toBeLessThan(e.before_chars)
    const at = prompts.findIndex((p) => p.startsWith("# COMPACT"))
    expect(prompts[at]).toContain("THE GOAL: find the thing")
    const next = prompts[at + 1]
    expect(next).toContain("# REQUEST (from owner)\nTHE GOAL: find the thing")
    expect(next).toContain("SUMMARY: big returned x's")
    expect(next.length).toBe(e.after_chars)
  })

  test("earlier runs fold too, and stay out of the run's later prompts", async () => {
    const prompts = []
    let n = 0
    const infer = async (prompt) => {
      prompts.push(prompt)
      if (prompt.startsWith("# COMPACT")) return "SUMMARY"
      return ++n < 6 ? call(n) : done
    }
    const agent = new Agent({ name: "a", report: false, contextChars: 8000 }, { infer, tools: [big] })
    agent.history.push({ from: "owner", request: "OLD RUN", answer: "old answer" })
    const events = []
    agent.on("compact", (e) => events.push(e))
    await agent.ask("goal")
    expect(events[0].runs_folded).toBe(1)
    const at = prompts.findIndex((p) => p.startsWith("# COMPACT"))
    expect(prompts[at]).toContain("OLD RUN")
    expect(prompts[at + 1]).not.toContain("# EARLIER RUNS")
  })

  test("a failing summary call clips in code", async () => {
    let n = 0
    const infer = async (prompt) => {
      if (prompt.startsWith("# COMPACT")) throw new Error("model down")
      return ++n < 6 ? call(n) : done
    }
    const agent = new Agent({ name: "a", report: false, contextChars: 8000 }, { infer, tools: [big] })
    const events = []
    agent.on("compact", (e) => events.push(e))
    await agent.ask("goal")
    expect(events[0]).toMatchObject({ mode: "clip", error: "model down" })
    expect(events[0].after_chars).toBeLessThan(events[0].before_chars)
  })

  test("under the budget nothing happens", async () => {
    let n = 0
    const infer = async () => (++n < 4 ? call(n) : done)
    const agent = new Agent({ name: "a", report: false }, { infer, tools: [big] })
    const events = []
    agent.on("compact", (e) => events.push(e))
    await agent.ask("goal")
    expect(events).toEqual([])
  })
})
