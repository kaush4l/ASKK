/**
 * The wire, checked as a wire.
 *
 * The observers in `core/telemetry.js` are the only place a live core object is
 * turned into something a `postMessage` can carry, so the one thing worth
 * asserting here is exactly that: every payload survives `structuredClone`, and
 * carries the fields the two views actually read back. A class instance or a
 * function on any of these is a page that renders and then throws
 * `DataCloneError` at the first turn — which no unit test of the core would see,
 * because on the host the object is simply passed along.
 */

import { expect, test } from "bun:test"

import { PHASE_ENTER, PROMPT_ASSEMBLED, TELEMETRY, TOOL_RESULTS, agentObserver } from "../core/telemetry.js"
import { Critique, Session, Step, StepResult } from "../core/session.js"
import { ToolResult } from "../core/tool-call.js"

/** A worker scope that keeps what was posted instead of posting it.
 * @returns {{ posted: any[], postMessage(m: any): void }} */
function recorder() {
  /** @type {any[]} */ const posted = []
  return { posted, postMessage: (m) => void posted.push(m) }
}

/** A blackboard with something written in every field a view renders. */
function filled() {
  const session = new Session({ query: "q", enhanced: "ENHANCED q", complexity: "complex", round: 2 })
  // A loaded Skill is a class instance carrying methods; only its name crosses.
  session.skills.push({ name: "summarize-file", read: () => "body" })
  session.plan.push(new Step({ description: "first", status: "done", notes: "went fine" }))
  session.stepResults.push(new StepResult({ step: "first", outcome: "ok then", ok: true }))
  session.critiques.push(new Critique({ finding: "step two is wrong", severity: "blocking" }))
  session.verifyReport = "the verifier's words"
  session.messages.push({ role: "user", content: "q" })
  return session
}

test("the envelope names the event, and only the three declared ones exist", () => {
  const scope = recorder()
  const observer = agentObserver(scope)

  observer.assembled(/** @type {any} */ ({ phase: "react", bytes: 1, bands: [], hits: 0, misses: 1 }))
  observer.entered({ phase: "plan", flow: "full", maxRounds: 3, session: new Session() })
  observer.results({ call: 'echo({"text": "hi"})', results: [new ToolResult({ tool: "echo", ok: true, output: "hi" })] })

  expect(scope.posted.map((m) => m.type)).toEqual([TELEMETRY, TELEMETRY, TELEMETRY])
  expect(scope.posted.map((m) => m.event)).toEqual([PROMPT_ASSEMBLED, PHASE_ENTER, TOOL_RESULTS])
})

test("a phase entry carries the blackboard flattened to what the Flow view reads", () => {
  const scope = recorder()

  agentObserver(scope).entered({ phase: "verify", flow: "full", maxRounds: 3, session: filled() })

  const { payload } = scope.posted[0]
  expect(payload.phase).toBe("verify")
  expect(payload.flow).toBe("full")
  expect(payload.maxRounds).toBe(3)
  expect(payload.session).toEqual({
    query: "q", enhanced: "ENHANCED q", complexity: "complex", round: 2,
    skills: ["summarize-file"],
    plan: [{ description: "first", status: "done", notes: "went fine" }],
    stepResults: [{ step: "first", outcome: "ok then", ok: true }],
    critiques: [{ finding: "step two is wrong", severity: "blocking", resolved: false }],
    verifyReport: "the verifier's words",
  })
  // The transcript already rides home on the invoke reply; copying it once per
  // phase would put the whole conversation on the wire seven times a run.
  expect(payload.session.messages).toBeUndefined()
})

test("a ToolResult crosses as its four fields and not as itself", () => {
  const scope = recorder()
  const results = [new ToolResult({ tool: "echo", ok: true, output: "hi" }),
    new ToolResult({ tool: "weather", ok: false, error: "no such city" })]

  agentObserver(scope).results({ call: "echo(), weather()", results })

  const { payload } = scope.posted[0]
  expect(payload.call).toBe("echo(), weather()")
  expect(payload.results).toEqual([
    { tool: "echo", ok: true, output: "hi", error: "" },
    { tool: "weather", ok: false, output: "", error: "no such city" },
  ])
  expect(payload.results[0] instanceof ToolResult).toBe(false)
})

test("every payload survives structuredClone — the contract the whole channel rests on", () => {
  const scope = recorder()
  const observer = agentObserver(scope)

  observer.assembled(/** @type {any} */ ({ phase: "react", bytes: 12, bands: [{ slot: 0, name: "SystemInstructions" }], hits: 0, misses: 1 }))
  observer.entered({ phase: "work", flow: "full", maxRounds: 3, session: filled() })
  observer.results({ call: "echo()", results: [new ToolResult({ tool: "echo", ok: true, output: "hi" })] })

  for (const message of scope.posted) expect(structuredClone(message)).toEqual(message)
})
