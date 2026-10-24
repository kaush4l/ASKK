// Talk (2026-10-18 owner: "The desk should be able to talk with me too. The work and build can run in the
// background."): an agent tells the owner results (talk.say) and asks what only the owner decides (talk.ask), never
// waiting for a reply; the owner's reply (ownerCall reply) answers the question and hands its text to the agent that
// asked. The host's delivery (guidance while it runs, else a run): companion/team/kernel-team-artifact.test.js.

import { describe, expect, test } from "bun:test"
import { Agent, BUILTIN, Talk } from "../index.js"

const clock = () => new Date("2026-10-18T18:00:00Z")
const ctx = (name) => ({ agent: { name } })
const run = (talk, cmd, input, name = "lead") => talk.commands().find((t) => t.name === `talk.${cmd}`).run(input, ctx(name))

describe("talk: the desk's side of the conversation", () => {
  test("say and ask post messages; the work goes on (no gate); the prompt shows them and the open questions", async () => {
    const talk = new Talk({ clock })
    expect(await run(talk, "say", { text: "r07 GQA kv=2: val_bpb 2.1903 vs 2.2065, 103k tok/s" })).toBe("told the owner (m1) — they read it in the talk panel; your work goes on")
    expect(await run(talk, "ask", { question: "Measure TCR on FLORES-200 first?", options: "yes | no, Itihasa first" })).toContain("asked the owner (q2)")
    expect(talk.state.messages.map((m) => [m.id, m.kind, m.status ?? null, m.options ?? null])).toEqual([
      ["m1", "say", null, null],
      ["q2", "ask", "open", ["yes", "no, Itihasa first"]],
    ])
    expect(talk.gate?.({ name: "lead" }) ?? null).toBeNull()
    const prompt = talk.render({ name: "lead", tools: new Set(["talk.say", "talk.ask", "talk.drop"]) })
    expect(prompt.split("\n")[0]).toBe("your conversation with the owner: talk.say, talk.ask, talk.drop — tell them results and findings as they come, ask what only they decide; the work never waits for a reply")
    expect(prompt).toContain("10-18 18:00 lead → owner [q2 open; options: yes | no, Itihasa first]: Measure TCR on FLORES-200 first?")
    expect(prompt.split("\n").at(-1)).toBe("OPEN (waiting for the owner): q2")
    expect(talk.brief()).toBe("1 question for the owner · lead: Measure TCR on FLORES-200 first?")
  })

  test("refused: empty or long text, the same note twice, the same question twice, more than 3 open, 5 options", async () => {
    const talk = new Talk({ clock })
    await expect(run(talk, "say", { text: " " })).rejects.toThrow("text: what to tell the owner")
    await expect(run(talk, "say", { text: "x".repeat(1501) })).rejects.toThrow("at most 1500 chars")
    await run(talk, "say", { text: "hi" })
    await expect(run(talk, "say", { text: "hi" })).rejects.toThrow("you told the owner this already (m1)")
    await run(talk, "ask", { question: "a?" })
    await expect(run(talk, "ask", { question: "a?" })).rejects.toThrow("you asked this already (q2)")
    await run(talk, "ask", { question: "b?" })
    await run(talk, "ask", { question: "c?" })
    await expect(run(talk, "ask", { question: "d?" })).rejects.toThrow("3 of your questions are open (q2, q3, q4)")
    expect(await run(talk, "ask", { question: "d?" }, "coder")).toContain("(q5)") // per agent
    await expect(run(talk, "ask", { question: "e?", options: ["1", "2", "3", "4", "5"] }, "planner")).rejects.toThrow("options: at most 4")
    // 2026-10-18: a long option is refused whole (never cut mid-sentence on the owner's button)
    await expect(run(talk, "ask", { question: "f?", options: `short | ${"x".repeat(161)}` }, "planner")).rejects.toThrow("options: each at most 160 chars (one is 161)")
  })

  test("drop: only the asker, an open question, with a reason", async () => {
    const talk = new Talk({ clock })
    await run(talk, "ask", { question: "a?" })
    await expect(run(talk, "drop", { ask: "q1", reason: "x" }, "coder")).rejects.toThrow("q1 is lead's question")
    await expect(run(talk, "drop", { ask: "q1" })).rejects.toThrow("reason: why")
    expect(await run(talk, "drop", { ask: "[q1]", reason: "the scan answered it" })).toBe("dropped q1")
    expect(talk.state.messages[0]).toMatchObject({ status: "dropped", reason: "the scan answered it" })
    await expect(run(talk, "drop", { ask: "q1", reason: "x" })).rejects.toThrow("q1 is dropped")
  })

  test("the owner replies: the question answered, the reply recorded, the text for the asker; seen marks read", async () => {
    const talk = new Talk({ clock })
    await run(talk, "ask", { question: "Measure TCR first?" }, "planner")
    const r = talk.ownerCall("reply", [{ id: "talk", ask: "q1", text: "yes, FLORES first" }])
    expect(r.keeper).toBe("planner")
    expect(r.reply).toMatchObject({ id: "r2", kind: "reply", from: "owner", re: "q1", text: "yes, FLORES first" })
    expect(r.deliver).toStartWith('The owner replies to your question q1 ("Measure TCR first?"): "yes, FLORES first"')
    expect(talk.state.messages[0].status).toBe("answered")
    expect(() => talk.ownerCall("reply", [{ ask: "q1", text: "again" }])).toThrow("q1 is answered")
    expect(() => talk.ownerCall("reply", [{ ask: "q9", text: "x" }])).toThrow("no question q9")
    expect(() => talk.ownerCall("delete", [{}])).toThrow("talk: the owner can reply or mark seen (not delete)")
    expect(talk.ownerCall("seen", [{ upto: "r2" }])).toEqual({ seen: "r2" })
    expect(talk.state.seen).toBe("r2")
    expect(talk.render({ name: "planner", tools: new Set() })).toContain("owner → planner (re q1): yes, FLORES first")
    // a reply from Telegram brings the conversation before it there (2026-10-24)
    await run(talk, "ask", { question: "Which voice?", options: "storyteller | regal" }, "lead")
    const t = talk.ownerCall("reply", [{ id: "talk", ask: "q3", text: "regal", via: "Telegram", conversation: "lead: [audio sent: regal sample]\nowner: I liked this one" }])
    expect(t.deliver).toStartWith('The owner replies on Telegram to your question q3 ("Which voice?"): "regal"\n(On Telegram, the conversation before the reply, oldest first:\nlead: [audio sent: regal sample]\nowner: I liked this one)')
  })

  test("snapshot / restore keep the conversation and go on numbering", async () => {
    const a = new Talk({ clock })
    await run(a, "say", { text: "one" })
    await run(a, "ask", { question: "two?" })
    const b = new Talk({ clock })
    b.restore(JSON.parse(JSON.stringify(a.snapshot())))
    expect(b.state.messages.map((m) => m.id)).toEqual(["m1", "q2"])
    expect(await run(b, "say", { text: "three" })).toContain("(m3)")
  })

  test("in the kit: one instance per desk, its commands on an agent, its twin", async () => {
    const make = BUILTIN.artifacts.talk({ clock })
    const one = make({ name: "lead" }, { type: "talk" })
    expect(make({ name: "coder" }, { type: "talk" })).toBe(one)
    const agent = new Agent({ name: "lead", report: false }, { infer: async () => '{"answer":"x"}' })
    agent.addArtifact(one)
    expect(["talk.say", "talk.ask", "talk.drop"].every((t) => agent.tools.has(t))).toBe(true)
    expect(one.twin()).toMatchObject({ kind: "talk", view: "talk", keep: "always", brief: "nothing said yet" })
  })
})

describe("talk: drawings (2026-10-18 owner: \"when asking questions, the lead should have the option to draw the architecture for me to preview and understand\")", () => {
  test("ask and say carry a visual: a checked spec, a preview visual's id, or {show}; a bad one refused", async () => {
    const talk = new Talk({ clock })
    const flow = { kind: "flow", nodes: [{ id: "emb", label: "embed 32k×256" }, { id: "attn", label: "GQA kv=2" }], edges: [{ from: "emb", to: "attn" }] }
    await run(talk, "ask", { question: "GQA kv=2 for the next run?", options: "yes | no", visual: flow })
    expect(talk.state.messages[0].visual).toMatchObject({ kind: "flow", nodes: [{ id: "emb" }, { id: "attn" }] })
    await run(talk, "say", { text: "the architecture now", visual: "arch" })
    expect(talk.state.messages[1].visual).toEqual({ show: "arch" })
    await run(talk, "say", { text: "same, as an object", visual: { show: "arch-next" } })
    expect(talk.state.messages[2].visual).toEqual({ show: "arch-next" })
    await run(talk, "say", { text: "as text", visual: "kind: bars\nbars:\n  - label: sa\n    value: 31\n  - label: en\n    value: 52" })
    expect(talk.state.messages[3].visual).toMatchObject({ kind: "bars" })
    await expect(run(talk, "say", { text: "bad", visual: { kind: "pie" } })).rejects.toThrow('visual.kind: "pie"')
    await expect(run(talk, "say", { text: "bad id", visual: { show: "../x" } })).rejects.toThrow("visual.show")
    const prompt = talk.render({ name: "lead", tools: new Set() })
    expect(prompt).toContain("(drawn: preview arch)")
    expect(prompt).toMatch(/\[q1 open; options: yes \| no\] \(drawn: flow/)
  })

  test("a reply says what the owner pointed at in the drawing (kept clipped), and the asker reads it", async () => {
    const talk = new Talk({ clock })
    await run(talk, "ask", { question: "which block?", visual: "arch" })
    const r = talk.ownerCall("reply", [{ ask: "q1", text: "this one, make it wider", context: { node: "block 3", d_ff: 704, junk: { deep: "x".repeat(400) } } }])
    expect(r.reply.context.node).toBe("block 3")
    expect(r.reply.context.d_ff).toBe(704)
    expect(r.reply.context.junk.length).toBeLessThanOrEqual(120)
    expect(r.deliver).toContain("— pointing at node block 3 · d_ff 704")
    expect(talk.render({ name: "lead", tools: new Set() })).toContain('(pointing at {"node":"block 3"')
  })
})
