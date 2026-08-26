/**
 * The Agent, checked the way `test_core.py` checked it.
 *
 * No model and no network: a marker-driven `FakeInference` plays the model's
 * part. It answers on what the prompt *contains* rather than on how many times
 * it has been called, which is the good idea in the Python worth keeping — the
 * phase order can change and these tests still say what they mean.
 *
 * `render()` is checked against the recordings in `tests/golden/`. Those are the
 * oracle: a byte that differs means the port is wrong, not the fixture. The
 * context facts are pinned rather than derived, because the recordings pin
 * `2026-08-16 12:00:00 PDT` beside `day: Saturday` and 2026-08-16 is a Sunday —
 * `test_core.py` replaced `Agent.context` wholesale for the same reason, and
 * `docs/FOUND-IN-THE-PYTHON.md` records why no clock can produce that pair.
 */

import { expect, test } from "bun:test"

import { Agent } from "../core/agent.js"
import { Inference } from "../core/inference.js"
import { fixedClock, memoryFs } from "../core/ports/memory-fs.js"
import { defaultPorts } from "../core/ports.js"
import { DONE } from "../core/session.js"
import { tool } from "../core/tool-call.js"

const GOLDEN = new URL("./golden/", import.meta.url)
const SKILL = new URL("../skills/summarize-file/SKILL.md", import.meta.url)

const FIXED_CONTEXT = { "current time": "2026-08-16 12:00:00 PDT", day: "Saturday" }

/** Answers by prompt marker, so phase order can change without breaking tests. */
class FakeInference extends Inference {
  /** @param {{ complexity?: string, verifyVerdicts?: string[], critiqueVerdicts?: string[] }} [o] */
  constructor(o = {}) {
    super({ model: "fake", baseUrl: "http://fake", apiKey: "none" })
    this.complexity = o.complexity ?? "complex"
    this.verifyVerdicts = o.verifyVerdicts ?? ["pass"]
    this.critiqueVerdicts = o.critiqueVerdicts ?? ["approve"]
    /** @type {string[]} */ this.calls = []
  }

  /** @param {string} prompt @returns {Promise<string>} */
  async infer(prompt) {
    const said = (/** @type {string} */ phase, /** @type {string} */ reply) => {
      this.calls.push(phase)
      return reply
    }
    if (prompt.includes("Decide whether it is")) {
      return said("understand", `think: [looking]\n\ncomplexity: ${this.complexity}\n\nenhanced_query: ENHANCED task`)
    }
    if (prompt.includes("available skills listed above")) return said("select", "think: [one fits]\n\nskills: [summarize-file]")
    if (prompt.includes("Lay out the sequence of steps")) {
      return said("plan", "think: [two steps]\n\nsteps: [do first thing, do second thing]")
    }
    if (prompt.includes("You are working step")) return said("work", "act: answer\n\nresult: step finished fine")
    if (prompt.includes("You are a verifier")) {
      const verdict = this.verifyVerdicts.shift() ?? "pass"
      return said("verify", `checks: [looked]\n\nevidence: seen with my own eyes\n\nverdict: ${verdict}`)
    }
    if (prompt.includes("bar-raiser")) {
      const verdict = this.critiqueVerdicts.shift() ?? "approve"
      const findings = verdict === "revise" ? "[blocking: step two is wrong]" : "[]"
      return said("critique", `findings: ${findings}\n\nverdict: ${verdict}`)
    }
    if (prompt.includes("Write the reply the user should see")) {
      return said("respond", "thinking: done\n\nresponse: FINAL ANSWER for the user")
    }
    return said("react", "act: answer\n\nresult: simple answer")
  }
}

/** A model that reads from a script, for the recorded loop. */
class Scripted extends FakeInference {
  /** @param {string[]} replies */
  constructor(replies) {
    super()
    this.replies = replies
  }
  /** @returns {Promise<string>} */
  async infer() {
    return this.replies.shift() ?? ""
  }
}

/** @param {Record<string, string>} [files] */
function ports(files = {}) {
  return { ...defaultPorts(), fs: memoryFs({ files }), clock: fixedClock("2026-08-16T12:00:00-07:00") }
}

/** An agent with the golden context block pinned onto it.
 * @param {Partial<import("../core/agent-config.js").AgentOptions> & { inference: Inference, observer?: import("../core/agent.js").Observer }} options */
function agentOf(options) {
  const built = new Agent({ ports: ports(), ...options })
  built.context = () => ({ ...FIXED_CONTEXT })
  return built
}

/** @param {string} name @returns {Promise<string>} */
const golden = (name) => Bun.file(new URL(name, GOLDEN)).text()

const echo = tool("echo", "Echo the text back.", '{"text": "<text>"}', (a) => String(a.text))
const weather = tool("weather", "Report the weather for a city.", '{"city": "<city>"}', () => "sunny")

// Wave 4.6: the toolbox was built with NO_LOG and nothing replaced it, so its one
// warning could not be reached from a real agent at all. This is that wiring.
test("the agent's own log is the toolbox's log, and addTools keeps it", async () => {
  /** @type {string[]} */ const said = []
  const agent = agentOf({
    name: "l", inference: new FakeInference(), tools: [echo],
    log: { warning: (m) => said.push(m), info() {}, error() {} },
  })
  await agent.toolbox.invoke('echo({"text": "hi"})', () => {
    throw new Error("boom")
  })
  agent.addTools(weather)
  await agent.toolbox.invoke('weather({"city": "x"})', () => {
    throw new Error("boom again")
  })
  expect(said).toEqual(["tool result callback failed: boom", "tool result callback failed: boom again"])
})

// ── render parity ────────────────────────────────────────────────────────

test("render parity: full", async () => {
  const agent = agentOf({
    name: "p", system: "You are helpful.\nBe brief.", inference: new FakeInference(),
    tools: [echo, weather],
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello there" }],
  })
  expect(agent.render()).toBe(await golden("render-full.prompt"))
})

test("render parity: bare", async () => {
  const agent = agentOf({ name: "p2", system: "Sys.", inference: new FakeInference() })
  expect(agent.render()).toBe(await golden("render-bare.prompt"))
})

test("render parity: plain-text", async () => {
  const agent = agentOf({ name: "p3", system: "Sys.", inference: new FakeInference(), responseModel: null })
  expect(agent.render()).toBe(await golden("render-plain-text.prompt"))
})

// ── the react loop ───────────────────────────────────────────────────────

test("the react loop leaves the recorded answer and the recorded turns behind", async () => {
  const expected = JSON.parse(await golden("react-loop.json"))
  const script = ['act: tool\n\nresult: echo({"text": "hey"})', "act: answer\n\nresult: done: hey"]
  const agent = agentOf({ name: "lp", system: "Sys.", inference: new Scripted(script), tools: [echo] })

  const out = await agent.invoke("please echo hey")

  expect(out.answer).toBe(expected.answer)
  expect(agent.messages.map((m) => [m.role, m.content])).toEqual(expected.history)
})

test("the repeat guard ends a loop the model will not end", async () => {
  const stubborn = new FakeInference()
  stubborn.infer = async () => 'act: tool\n\nresult: echo({"text": "same"})'
  const agent = agentOf({ name: "rg", system: "Sys.", inference: stubborn, tools: [echo], repeatLimit: 2 })

  const out = await agent.invoke("loop forever")

  expect(String(out.answer)).toContain("could not complete")
  // The give-up is synthesized rather than inferred, so it is not a fourth turn:
  // the observation the model was handed on the way out is the last user line.
  expect(agent.messages.at(-1)?.content).toContain("was tried 3 times without progress")
})

// ── the phase graph ──────────────────────────────────────────────────────

/** @returns {Promise<Record<string, string>>} */
async function withSkill() {
  return { "skills/summarize-file/SKILL.md": await Bun.file(SKILL).text() }
}

test("the full flow walks the Python's phase order and answers", async () => {
  const inference = new FakeInference()
  const agent = agentOf({ name: "ff", system: "Sys.", inference, flow: "full", ports: ports(await withSkill()) })

  const out = await agent.invoke("do the complex thing")

  expect(out.answer).toBe("FINAL ANSWER for the user")
  expect(inference.calls).toEqual(["understand", "select", "plan", "work", "work", "verify", "critique", "respond"])
  expect(agent.session.skills.map((s) => /** @type {any} */ (s).name)).toEqual(["summarize-file"])
  expect(agent.session.plan.length).toBe(2)
  expect(agent.session.plan.every((step) => step.status === DONE)).toBe(true)
  expect(agent.session.enhanced).toBe("ENHANCED task")
  // Meta phases stayed out of the transcript: two work turns and the respond turn.
  expect(agent.messages.filter((m) => m.role === "assistant").length).toBe(3)
})

test("a simple query short-circuits to react", async () => {
  const inference = new FakeInference({ complexity: "simple" })
  const agent = agentOf({ name: "sc", system: "Sys.", inference, flow: "full" })

  const out = await agent.invoke("what is 2+2")

  expect(inference.calls).toEqual(["understand", "react"])
  expect(out.answer).toBe("simple answer")
})

test("a revise verdict sends the plan back for one more round", async () => {
  const inference = new FakeInference({ critiqueVerdicts: ["revise", "approve"], verifyVerdicts: ["pass", "pass"] })
  const agent = agentOf({ name: "cr", system: "Sys.", inference, flow: "full" })

  await agent.invoke("do it well")

  expect(inference.calls.filter((c) => c === "plan").length).toBe(2)
  expect(inference.calls.filter((c) => c === "critique").length).toBe(2)
  expect(agent.session.round).toBe(1)
})

test("exhausted rounds still answer, once", async () => {
  const inference = new FakeInference({ verifyVerdicts: ["fail", "fail", "fail", "fail", "fail"] })
  const agent = agentOf({ name: "rx", system: "Sys.", inference, flow: "full", maxRounds: 2 })

  const out = await agent.invoke("impossible task")

  expect(out).not.toBeNull()
  expect(inference.calls.filter((c) => c === "respond").length).toBe(1)
  expect(agent.session.round).toBe(2)
})

test("an empty skills folder skips the selection call entirely", async () => {
  const inference = new FakeInference()
  const agent = agentOf({ name: "ns", system: "Sys.", inference, flow: "full", skillsDir: "nothing-here" })

  await agent.invoke("complex job")

  expect(inference.calls).not.toContain("select")
})

// ── the two findings this increment fixes ────────────────────────────────

test("F-2: the registry decides what a component name means, and a typo only warns", async () => {
  /** @type {string[]} */
  const warnings = []
  const log = { warning: (/** @type {string} */ m) => void warnings.push(m), info() {}, error() {} }
  const agent = agentOf({
    // `phase` is registered and was unreachable from a Python `components:` list;
    // `nonsense` is registered nowhere at all.
    inference: new FakeInference(), system: "Sys.", components: ["system", "phase", "nonsense"], log,
    responseModel: null,
  })

  expect(agent.render()).toBe("Sys.\n\n[ASSISTANT]:")
  expect(warnings.join("\n")).toContain("unknown base component 'nonsense' skipped")
  expect(agent.baseComponents().map((c) => c.constructor.name)).toEqual([
    "SystemInstructions",
    "PhaseInstructions",
  ])
})

test("F-4: messages follows the transcript through a compaction", async () => {
  const agent = agentOf({ name: "cp", system: "Sys.", inference: new FakeInference(), compactAt: 4, keepRecent: 2 })
  for (let i = 0; i < 4; i++) agent.transcript.add(i % 2 === 0 ? "user" : "assistant", `turn ${i}`)
  const before = agent.messages

  await agent.transcript.compact({ invoke: async () => "the summary" })

  expect(agent.messages.length).toBe(3)
  expect(agent.messages[0].content).toContain("the summary")
  // The Python's `Agent.messages` was a second name for the pre-compaction list
  // and went on reporting four turns. The same array, still current, is the fix.
  expect(agent.messages).toBe(before)
})

// ── the observer: the prompt inspector's seam into a turn ────────────────

test("an observer given at construction sees one breakdown per assemble, phase named", async () => {
  /** @type {any[]} */ const seen = []
  const agent = agentOf({
    name: "obs", system: "Sys.", inference: new Scripted(["act: answer\n\nresult: done"]),
    observer: { assembled: (/** @type {any} */ a) => void seen.push(a) },
  })

  const answer = await agent.invoke("hello")
  expect(String(answer.answer)).toBe("done")
  expect(seen.length).toBe(1)

  const [first] = seen
  expect(first.phase).toBe("react") // the flow's entry, recorded before the phase ran
  expect(first.bands.map((/** @type {any} */ b) => b.name)).toEqual([
    "SystemInstructions", "ContextBlock", "History", "ResponseContract",
  ])
  expect(first.bytes).toBeGreaterThan(0)
  expect(first.hits).toBe(0)
  expect(first.misses).toBeGreaterThan(0)
  // Structured clone is the contract: plain data, no class instances, no functions.
  expect(JSON.parse(JSON.stringify(first))).toEqual(first)
})

test("an agent built without an observer takes the same path and reports nothing", async () => {
  const options = { name: "obs", system: "Sys.", inference: new Scripted(["act: answer\n\nresult: done"]) }
  const silent = agentOf(options)
  /** @type {any[]} */ const seen = []
  const watched = agentOf({ ...options, inference: new Scripted(["act: answer\n\nresult: done"]), observer: { assembled: (/** @type {any} */ a) => void seen.push(a) } })

  expect(silent.observer).toBe(null)
  const quiet = await silent.invoke("hello")
  const loud = await watched.invoke("hello")

  expect(String(quiet.answer)).toBe(String(loud.answer))
  expect(silent.messages).toEqual(watched.messages)
  expect(seen.length).toBe(1)
})
