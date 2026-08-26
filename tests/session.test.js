import { test, expect } from "bun:test"

import {
  Critique,
  DONE,
  PENDING,
  Session,
  Step,
  StepResult,
} from "../core/session.js"

test("status constants", () => {
  expect(PENDING).toBe("pending")
  expect(DONE).toBe("done")
})

test("Step defaults", () => {
  const step = new Step({ description: "read the file" })
  expect(step.description).toBe("read the file")
  expect(step.status).toBe(PENDING)
  expect(step.notes).toBe("")
})

test("StepResult defaults", () => {
  const result = new StepResult({ step: "read the file" })
  expect(result.outcome).toBe("")
  expect(result.ok).toBe(true)
})

test("Critique defaults", () => {
  const critique = new Critique({ finding: "no evidence" })
  expect(critique.severity).toBe("minor")
  expect(critique.resolved).toBe(false)
})

test("a fresh session is empty and simple", () => {
  const session = new Session()
  expect(session.query).toBe("")
  expect(session.enhanced).toBe("")
  expect(session.complexity).toBe("simple")
  expect(session.skills).toEqual([])
  expect(session.plan).toEqual([])
  expect(session.stepResults).toEqual([])
  expect(session.critiques).toEqual([])
  expect(session.messages).toEqual([])
  expect(session.round).toBe(0)
  expect(session.verifyReport).toBe("")
})

test("goal is the query until an enhanced query exists", () => {
  const session = new Session({ query: "task" })
  expect(session.goal).toBe("task")
  session.enhanced = "ENHANCED task"
  expect(session.goal).toBe("ENHANCED task")
  session.enhanced = ""
  expect(session.goal).toBe("task")
})

test("unresolved is the blocking findings that are still open", () => {
  const blocking = new Critique({ finding: "a", severity: "blocking" })
  const fixed = new Critique({ finding: "b", severity: "blocking", resolved: true })
  const minor = new Critique({ finding: "c" })
  const session = new Session({ critiques: [blocking, fixed, minor] })
  expect(session.unresolved).toEqual([blocking])
})

test("resetFor clears working state and keeps the conversation", () => {
  const messages = [{ role: /** @type {const} */ ("user"), content: "hello" }]
  const session = new Session({
    query: "old",
    enhanced: "ENHANCED old",
    complexity: "complex",
    skills: ["summarize-file"],
    plan: [new Step({ description: "one", status: DONE })],
    stepResults: [new StepResult({ step: "one", outcome: "did it" })],
    critiques: [new Critique({ finding: "a", severity: "blocking" })],
    messages,
    round: 2,
    verifyReport: "report",
  })

  session.resetFor("new")

  expect(session.query).toBe("new")
  expect(session.goal).toBe("new")
  expect(session.enhanced).toBe("")
  expect(session.complexity).toBe("simple")
  expect(session.plan).toEqual([])
  expect(session.stepResults).toEqual([])
  expect(session.critiques).toEqual([])
  expect(session.unresolved).toEqual([])
  expect(session.round).toBe(0)
  expect(session.verifyReport).toBe("")
  // The conversation survives the turn; the loaded skills do too, exactly as
  // the Python leaves them.
  expect(session.messages).toBe(messages)
  expect(session.skills).toEqual(["summarize-file"])
})

test("resetFor empties the lists in place so a held reference sees it", () => {
  const plan = [new Step({ description: "one" })]
  const session = new Session({ plan })
  session.resetFor("new")
  expect(session.plan).toBe(plan)
  expect(plan.length).toBe(0)
})

test("messages is the array handed in, not a copy", () => {
  /** @type {import("../core/session.js").Message[]} */
  const transcript = []
  const session = new Session({ messages: transcript })
  transcript.push({ role: "assistant", content: "later" })
  expect(session.messages.length).toBe(1)
})
