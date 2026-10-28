import { describe, expect, test } from "bun:test"
import { Agent, contractOf, REPORT_FIELDS, reportOf } from "../index.js"
import { nextStats } from "../../live/team-rows.js"

// The response contract: which report fields an agent's newest answer missed, the newest check only.
describe("response contract", () => {
  const FULL = "VERDICT: built\nEVIDENCE: 2 tests (bun, 04:40)\nCONFIDENCE: 0.8\nFALSIFIER: a failing test\nGAPS: none"

  test("an answer missing GAPS lists it as missed", () => {
    const answer = FULL.replace("\nGAPS: none", "")
    expect(contractOf(answer, REPORT_FIELDS)).toEqual({ fields: REPORT_FIELDS, missed: ["GAPS"] })
  })

  test("a full answer misses nothing", () => {
    expect(contractOf(FULL, REPORT_FIELDS).missed).toEqual([])
  })

  test("**brief**: x counts as held", () => {
    expect(contractOf("**brief**: x\n- outcome: done", ["brief", "outcome", "evidence"]).missed).toEqual(["evidence"])
  })

  test("a second answer replaces agent.answerContract", async () => {
    const replies = ["answer: <<<\nbrief: one\n>>>", "answer: <<<\nbrief: two\nGAPS: none\n>>>"]
    let i = 0
    const a = new Agent({ name: "b", soul: "Be plain.", role: "builds one thing", report: false }, { infer: async () => replies[i++] })
    const seen = []
    a.on("step", (e) => seen.push(e.contract))
    await a.ask("go", { from: "lead", contract: ["brief", "GAPS"] })
    const first = a.answerContract
    expect(first).toEqual({ fields: ["brief", "GAPS"], missed: ["GAPS"] })
    await a.ask("again", { from: "lead", contract: ["brief", "GAPS"] })
    expect(a.answerContract).not.toBe(first)
    expect(a.answerContract.missed).toEqual([])
    expect(seen.map((c) => c?.missed)).toEqual([["GAPS"], []])
  })

  test("an agent with no contract checks nothing", async () => {
    const a = new Agent({ name: "b", soul: "Be plain.", role: "builds one thing", report: false }, { infer: async () => "answer: <<<\ndone\n>>>" })
    const seen = []
    a.on("step", (e) => seen.push("contract" in e))
    await a.ask("go", { from: "lead" })
    expect(a.answerContract ?? null).toBe(null)
    expect(seen).toEqual([false])
  })

  test("nextStats keeps only the newest contract", () => {
    const one = { fields: ["GAPS"], missed: ["GAPS"] }
    const two = { fields: ["GAPS"], missed: [] }
    const s1 = nextStats(null, null, { ms: 5, prompt_chars: 10, reply_chars: 1, contract: one })
    const s2 = nextStats(s1, null, { ms: 5, prompt_chars: 10, reply_chars: 1, contract: two })
    expect(s2.contract).toEqual(two)
    // a step without a final answer keeps the last check
    expect(nextStats(s2, null, { ms: 5, prompt_chars: 3, reply_chars: 1 }).contract).toEqual(two)
  })

  test("reportOf: the 5-line report gives 5 fields, a missing one left out", () => {
    const r = reportOf(FULL, REPORT_FIELDS)
    expect(Object.keys(r)).toEqual(REPORT_FIELDS)
    expect(r.VERDICT).toBe("built")
    expect(r.CONFIDENCE).toBe("0.8")
    expect(reportOf("**brief**: x", ["brief", "GAPS"])).toEqual({ brief: "x" })
  })

  test("a second answer replaces agent.answerReport", async () => {
    const replies = ["answer: <<<\nbrief: one\n>>>", "answer: <<<\nbrief: two\nGAPS: none\n>>>"]
    let i = 0
    const a = new Agent({ name: "b", soul: "Be plain.", role: "builds one thing", report: false }, { infer: async () => replies[i++] })
    const seen = []
    a.on("step", (e) => seen.push(e.report))
    await a.ask("go", { from: "lead", contract: ["brief", "GAPS"] })
    expect(a.answerReport).toEqual({ brief: "one" })
    await a.ask("again", { from: "lead", contract: ["brief", "GAPS"] })
    expect(a.answerReport).toEqual({ brief: "two", GAPS: "none" })
    expect(seen.map((r) => r?.brief)).toEqual(["one", "two"])
  })

  test("nextStats keeps only the newest report", () => {
    const s1 = nextStats(null, null, { ms: 5, prompt_chars: 10, reply_chars: 1, report: { VERDICT: "a" } })
    const s2 = nextStats(s1, null, { ms: 5, prompt_chars: 10, reply_chars: 1, report: { VERDICT: "b" } })
    expect(s2.report).toEqual({ VERDICT: "b" })
    expect(nextStats(s2, null, { ms: 5, prompt_chars: 3, reply_chars: 1 }).report).toEqual({ VERDICT: "b" })
  })
})
