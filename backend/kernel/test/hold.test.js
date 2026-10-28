// How an agent holds an artifact (2026-10-17): refresh(agent) awaited before each step's render, a failed refresh as
// one line in that artifact's block; a commands subset per holder (Agent.addArtifact, a desk spec's {type, commands}).

import { describe, expect, test } from "bun:test"
import { Agent, Artifact, buildDesk, Tool } from "../index.js"

function scripted(replies) {
  const prompts = []
  const infer = async (prompt) => (prompts.push(prompt), JSON.stringify(replies.shift() ?? { thought: "done", calls: [], answer: "ok" }))
  return { infer, prompts }
}

// A host-backed artifact: its state lives elsewhere (a terminal's tail) and refresh() reads it.
class Tail extends Artifact {
  constructor(source) {
    super({ name: "terminal", title: "terminal" })
    this.source = source
    this.state = { lines: [] }
    this.refreshes = 0
  }
  async refresh() {
    this.refreshes++
    await Bun.sleep(5)
    this.state = { lines: await this.source() }
  }
  render() {
    return this.state.lines.join("\n") || "(no output)"
  }
  commands() {
    return ["read", "wait", "start", "stop"].map((c) => new Tool({ name: `${this.name}.${c}`, description: c, run: () => c }))
  }
}

describe("refresh(agent) before each step's render", () => {
  test("every step's prompt shows the state its refresh read just before", async () => {
    let n = 0
    const tail = new Tail(async () => [`epoch ${++n} loss ${(3 / n).toFixed(2)}`])
    const { infer, prompts } = scripted([{ thought: "look", calls: [{ tool: "look", input: {} }] }, { thought: "done", calls: [], answer: "trained" }])
    const look = new Tool({ name: "look", run: () => "looked" })
    const agent = new Agent({ name: "coder", report: false }, { infer, tools: [look], artifacts: [tail] })
    expect(await agent.ask("train")).toBe("trained")
    expect(tail.refreshes).toBe(2) // once per step
    expect(prompts[0]).toContain("# terminal\nepoch 1 loss 3.00")
    expect(prompts[1]).toContain("# terminal\nepoch 2 loss 1.50")
    expect(prompts[1]).not.toContain("epoch 1")
  })

  test("a refresh that throws or hangs is one line in its block; the run goes on with the last state", async () => {
    let fail = false
    const tail = new Tail(async () => {
      if (fail === "hang") return new Promise(() => {})
      if (fail) throw new Error("host down\nstack line")
      return ["ready"]
    })
    const { infer, prompts } = scripted([
      { thought: "a", calls: [{ tool: "flip", input: {} }] },
      { thought: "b", calls: [{ tool: "flip", input: { hang: true } }] },
      { thought: "c", calls: [{ tool: "flip", input: { ok: true } }] },
      { thought: "done", calls: [], answer: "ok" },
    ])
    const flip = new Tool({ name: "flip", run: ({ hang, ok }) => ((fail = ok ? false : hang ? "hang" : true), "flipped") })
    const agent = new Agent({ name: "coder", report: false, refreshMs: 30 }, { infer, tools: [flip], artifacts: [tail] })
    expect(await agent.ask("go")).toBe("ok")
    expect(prompts[0]).not.toContain("refresh failed")
    expect(prompts[1]).toContain("ready\n(refresh failed: host down — this is its last state)")
    expect(prompts[1]).not.toContain("stack line") // one line
    expect(prompts[2]).toContain("(refresh failed: no answer in 0.03 s — this is its last state)")
    expect(prompts[3]).not.toContain("refresh failed") // read again: the line is gone
  })

  test("an artifact without refresh renders as before", async () => {
    const plain = Object.assign(new Artifact({ name: "notes" }), { state: { a: 1 } })
    const { infer, prompts } = scripted([])
    await new Agent({ name: "a", report: false }, { infer, artifacts: [plain] }).ask("go")
    expect(prompts[0]).toContain('# notes\n{\n  "a": 1\n}')
  })
})

describe("a commands subset per holder", () => {
  test("addArtifact(artifact, {commands}) keeps only those, matched after '<id>.'", () => {
    const { infer } = scripted([])
    const tail = new Tail(async () => [])
    const critic = new Agent({ name: "critic" }, { infer }).addArtifact(tail, { commands: ["read", "wait"] })
    expect([...critic.tools.keys()]).toEqual(["terminal.read", "terminal.wait"])
    expect(critic.holding.get("terminal")).toEqual({ commands: ["read", "wait"], gate: false })
    const coder = new Agent({ name: "coder" }, { infer }).addArtifact(new Tail(async () => []))
    expect([...coder.tools.keys()]).toEqual(["terminal.read", "terminal.wait", "terminal.start", "terminal.stop"])
    expect(() => new Agent({ name: "x" }, { infer }).addArtifact(new Tail(async () => []), { commands: ["read", "rm"] })).toThrow("x: terminal has no command rm (has read, wait, start, stop)")
  })

  test("a desk spec's {type, commands} holds the same instance with fewer commands", () => {
    const tail = new Tail(async () => [])
    const spec = { name: "lead", report: false, artifacts: [{ type: "terminal" }], tools: [{ type: "agent", name: "critic", report: false, artifacts: [{ type: "terminal", commands: ["read"] }] }] }
    const desk = buildDesk(spec, { infer: async () => "", artifacts: { terminal: () => tail } })
    expect([...desk.lead.tools.keys()].filter((t) => t.startsWith("terminal."))).toEqual(["terminal.read", "terminal.wait", "terminal.start", "terminal.stop"])
    expect([...desk.agents().get("critic").tools.keys()].filter((t) => t.startsWith("terminal."))).toEqual(["terminal.read"])
    expect(desk.artifacts().get("terminal").holders).toEqual(["lead", "critic"])
  })

  test("{artifact: factory, commands, gate}: a composer's bound factory keeps the spec's subset and gate", () => {
    const tail = new Tail(async () => [])
    const seen = []
    tail.attach = (agent, options) => seen.push([agent.name, options])
    const desk = buildDesk({ name: "lead", report: false, artifacts: [{ artifact: () => tail, commands: ["read"], gate: true }] }, { infer: async () => "" })
    expect([...desk.lead.tools.keys()]).toEqual(["terminal.read"])
    expect(seen).toEqual([["lead", { commands: ["read"], gate: true }]])
    expect(() => buildDesk({ name: "x", artifacts: [{ artifact: () => null }] }, { infer: async () => "" })).toThrow("x: an artifact factory returned no artifact")
  })
})
