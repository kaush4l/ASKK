// The owner's chat (2026-10-17 owner: "I want to be able to talk with the lead to understand what is currently already
// there and what I want to check"): Agent.chat is one model call beside the runs — it never starts, waits for or changes
// a run, except a GUIDE: line (guidance for the run in progress); a QUEUE: line comes back for the host to start.

import { describe, expect, test } from "bun:test"
import { Agent, Artifact, CHAT_FORMAT, RESPONSE_FORMAT, Tool } from "../index.js"

const SOUL = "You build small models and say what you measured."
const ROLE = "You are the lead of the model line."
const headers = (prompt) => [...prompt.matchAll(/(?:^|\n\n)(# [^\n]*)/g)].map((m) => m[1])

// The line's state, refreshed before each prompt (a host-backed artifact).
class Line extends Artifact {
  constructor() {
    super({ name: "line", title: "the line" })
    this.refreshed = 0
  }
  async refresh() {
    this.refreshed++
  }
  render() {
    return `BASE: sample-app 12M, val_bpb 1.42 (refreshed ${this.refreshed})`
  }
}
const look = () => new Tool({ name: "look", description: "reads the loss", run: () => "loss 2.31" })

// A model whose run replies come from `run` (a list; a function is awaited) and whose chat replies from `chat`.
function model({ run = [], chat = [] } = {}) {
  const prompts = { run: [], chat: [] }
  const infer = async (prompt) => {
    const isChat = prompt.includes("# OWNER CHAT")
    prompts[isChat ? "chat" : "run"].push(prompt)
    let next = (isChat ? chat : run).shift()
    if (typeof next === "function") next = await next(prompt)
    if (next instanceof Error) throw next
    return typeof next === "string" ? next : JSON.stringify(next ?? { thought: "done", calls: [], answer: "ok" })
  }
  return { infer, prompts }
}

describe("Agent.chat", () => {
  test("idle: one model call answers from the agent's prompt; no run starts, status and history unchanged; the chat event carries the call", async () => {
    const answer = "Built: sample-app 12M at val_bpb 1.42 (projects/sample-app/results.tsv). Nothing runs now."
    const { infer, prompts } = model({ chat: [answer] })
    const line = new Line()
    const agent = new Agent({ name: "lead", soul: SOUL, role: ROLE }, { infer, tools: [look()], artifacts: [line] })
    agent.history.push({ from: "owner", request: "train the base", answer: "val_bpb 1.42" })
    const events = []
    agent.on("*", (e) => events.push(e))
    const out = await agent.chat("what is built?")
    const p = prompts.chat[0]
    expect(out).toEqual({ answer, guided: false, queued: null, ms: expect.any(Number), prompt_chars: p.length, reply_chars: answer.length })
    expect(agent.status).toBe("idle")
    expect(agent.current).toBeNull()
    expect(agent.history).toEqual([{ from: "owner", request: "train the base", answer: "val_bpb 1.42" }])
    expect(prompts.run).toEqual([])
    expect(events.map((e) => e.event)).toEqual(["chat"])
    expect(events[0]).toMatchObject({ agent: "lead", from: "owner", text: "what is built?", answer, guided: false, queued: null, prompt_chars: p.length, reply_chars: answer.length })
    expect(events[0].ms).toBeGreaterThanOrEqual(0)
    // The same sections as a step's prompt, the run's REQUEST idle, then the chat and its format.
    expect(p.startsWith(`${SOUL}\n\n# YOU ARE lead\n${ROLE}`)).toBe(true)
    expect(headers(p)).toEqual(["# YOU ARE lead", "# line — the line", "# REQUEST", "# EARLIER RUNS", "# TOOLS", "# OWNER CHAT", "# RESPONSE"])
    expect(p).toContain("# REQUEST\n(idle: no run in progress)")
    expect(p).toContain("BASE: sample-app 12M, val_bpb 1.42 (refreshed 1)") // artifacts refreshed first
    expect(p).toContain("> owner: train the base\n< val_bpb 1.42")
    expect(p).toContain("- look {} — reads the loss")
    expect(p).toContain("# OWNER CHAT\nThe owner talks with you outside your runs (newest last): answer the last message.\n> owner: what is built?")
    expect(p.endsWith(`# RESPONSE\n${CHAT_FORMAT}`)).toBe(true)
    expect(p).not.toContain(RESPONSE_FORMAT)
    expect(agent.chats).toEqual([{ from: "owner", text: "what is built?", answer, at: expect.any(Number) }])
  })

  test("while a run is blocked in its model call: the chat answers at once from the run's request and steps; the run goes on unchanged", async () => {
    let release
    let entered
    const blocked = new Promise((r) => (release = r))
    const inStep2 = new Promise((r) => (entered = r))
    const { infer, prompts } = model({
      run: [{ thought: "read the loss", calls: [{ tool: "look", input: {} }] }, async () => (entered(), await blocked, { thought: "done", calls: [], answer: "loss 2.31" })],
      chat: ["Step 1 read the loss: 2.31. Next: the eval on the fixed shard."],
    })
    const agent = new Agent({ name: "lead", soul: SOUL, role: ROLE, report: false }, { infer, tools: [look()] })
    const run = agent.ask("train the base model")
    await inStep2
    expect(agent.current.request).toEqual({ text: "train the base model", from: "owner" })
    expect(agent.current.steps.length).toBe(1)
    const out = await agent.chat("where are you?") // resolves while the run's model call is still blocked
    expect(out).toMatchObject({ answer: "Step 1 read the loss: 2.31. Next: the eval on the fixed shard.", guided: false, queued: null })
    expect(agent.status).toBe("running")
    const c = prompts.chat[0]
    expect(c).toContain("# REQUEST (from owner)\ntrain the base model")
    expect(c).toContain("# WORK DONE ON THIS REQUEST")
    expect(c).toContain("step 1: read the loss\n  look → loss 2.31")
    expect(c.indexOf("# WORK DONE ON THIS REQUEST")).toBeLessThan(c.indexOf("# OWNER CHAT"))
    expect(c).toContain("> owner: where are you?")
    release()
    expect(await run).toBe("loss 2.31")
    // The run never saw the chat: no chat section, no chat text, one run in history.
    expect(prompts.run.length).toBe(2)
    expect(prompts.run.some((p) => p.includes("# OWNER CHAT") || p.includes("where are you?"))).toBe(false)
    expect(agent.history.map((h) => h.request)).toEqual(["train the base model"])
  })

  test("a GUIDE: line while running is guidance for the run (guided) and leaves the answer; the run reads it at its next step", async () => {
    let release
    let entered
    const blocked = new Promise((r) => (release = r))
    const inStep2 = new Promise((r) => (entered = r))
    const { infer, prompts } = model({
      run: [
        { thought: "read the loss", calls: [{ tool: "look", input: {} }] },
        async () => (entered(), await blocked, { thought: "done", calls: [], answer: "loss 2.31" }),
        { thought: "owner: eval first", calls: [], answer: "eval bpb 1.40" },
      ],
      chat: ["You are right, the eval comes first.\n`GUIDE: run the eval on the fixed shard before more training`"],
    })
    const agent = new Agent({ name: "lead", report: false }, { infer, tools: [look()] })
    const guides = []
    agent.on("guide", (e) => guides.push(e))
    const run = agent.ask("train the base model")
    await inStep2
    const out = await agent.chat("check the eval before you train more", { from: "telegram" })
    expect(out).toMatchObject({ answer: "You are right, the eval comes first.", guided: true, queued: null })
    expect(guides).toMatchObject([{ from: "telegram", text: "run the eval on the fixed shard before more training" }])
    expect(prompts.chat[0]).toContain("> telegram: check the eval before you train more")
    release()
    expect(await run).toBe("eval bpb 1.40") // the answer written meanwhile was held for the note
    expect(prompts.run[2]).toContain("# OWNER GUIDANCE")
    expect(prompts.run[2]).toContain("> telegram: run the eval on the fixed shard before more training")
    expect(agent.chats[0]).toMatchObject({ from: "telegram", answer: "You are right, the eval comes first." })
  })

  test("a QUEUE: line — or a GUIDE: line while idle — comes back as queued; the kernel starts no run", async () => {
    const { infer, prompts } = model({
      chat: ["Nothing runs now; the 24M model is next.\nQUEUE: train the 24M model for 5 minutes and compare val_bpb", "On it.\n**GUIDE:** check the tokenizer's bytes per token", "No action needed."],
    })
    const agent = new Agent({ name: "lead", report: false }, { infer })
    const starts = []
    agent.on("start", (e) => starts.push(e))
    expect(await agent.chat("what next?")).toMatchObject({ answer: "Nothing runs now; the 24M model is next.", guided: false, queued: "train the 24M model for 5 minutes and compare val_bpb" })
    expect(await agent.chat("check the tokenizer")).toMatchObject({ answer: "On it.", guided: false, queued: "check the tokenizer's bytes per token" })
    expect(await agent.chat("thanks")).toMatchObject({ answer: "No action needed.", guided: false, queued: null })
    expect(starts).toEqual([])
    expect(prompts.run).toEqual([])
    expect(agent.status).toBe("idle")
    expect(agent.history).toEqual([])
    expect(agent.guidance).toEqual([])
  })

  test("chats: at most 12 kept, the last 6 in a chat's prompt (each side clipped), never in a run's prompt", async () => {
    const chat = Array.from({ length: 14 }, (_, i) => (i === 12 ? "x".repeat(900) : `answer ${i}`))
    const { infer, prompts } = model({ chat })
    const agent = new Agent({ name: "lead", report: false }, { infer })
    for (let i = 0; i < 14; i++) await agent.chat(`question ${i}`)
    expect(agent.chats.length).toBe(12)
    expect(agent.chats[0].text).toBe("question 2")
    const last = prompts.chat[13]
    expect(last).toContain("> owner: question 7\n< answer 7")
    expect(last).not.toContain("> owner: question 6\n")
    expect(last).toContain(`> owner: question 12\n< ${"x".repeat(800)}…`)
    expect(last).not.toContain("x".repeat(801))
    expect(last.endsWith(`> owner: question 13\n\n# RESPONSE\n${CHAT_FORMAT}`)).toBe(true)
    await agent.ask("go")
    expect(prompts.run[0]).not.toContain("# OWNER CHAT")
    expect(prompts.run[0]).not.toContain("question")
  })

  test("empty text throws; a model call that throws rejects without an event; two chats at once both answer", async () => {
    const { infer } = model({ chat: [new Error("model down"), async () => (await Bun.sleep(5), "first"), "second"] })
    const agent = new Agent({ name: "lead", report: false }, { infer })
    const events = []
    agent.on("chat", (e) => events.push(e))
    await expect(agent.chat("   ")).rejects.toThrow("a chat needs text")
    await expect(agent.chat(null)).rejects.toThrow("a chat needs text")
    await expect(agent.chat("are you there?")).rejects.toThrow("model down")
    expect(events).toEqual([])
    expect(agent.chats).toEqual([])
    const both = await Promise.all([agent.chat("one"), agent.chat("two")])
    expect(both.map((o) => o.answer)).toEqual(["first", "second"])
    expect(events.length).toBe(2)
  })

  test("a reply in the run's JSON shape gives its answer; config.system never replaces the chat's format; render without options is a step's", async () => {
    const { infer, prompts } = model({ chat: [JSON.stringify({ thought: "t", calls: [], answer: "val_bpb 1.42\nQUEUE: rerun seed 2" })] })
    const agent = new Agent({ name: "lead", report: false, system: "Answer in one word." }, { infer })
    expect(await agent.chat("bpb?")).toMatchObject({ answer: "val_bpb 1.42", queued: "rerun seed 2" })
    expect(prompts.chat[0].endsWith(`# RESPONSE\n${CHAT_FORMAT}`)).toBe(true)
    expect(prompts.chat[0]).not.toContain("# SYSTEM")
    const request = { text: "go", from: "owner" }
    const steps = [{ thought: "look", results: [{ tool: "look", ok: true, output: "x" }] }]
    expect(agent.render(request, steps)).toBe(agent.render(request, steps, {}))
    expect(agent.render(request, steps).endsWith("# SYSTEM\nAnswer in one word.")).toBe(true)
    expect(agent.render(request, steps)).not.toContain("# OWNER CHAT")
  })
})
