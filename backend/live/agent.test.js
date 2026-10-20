import { afterEach, expect, test } from "bun:test"

import { AgentView, askChat, chatAnswer, chatNote, chatShown, isRunRequest, queueProposal, threadItems } from "./agent.js"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// The desk server's team/call, answering `value` (or refusing with `error`); the calls it heard land in `calls`.
function serve(reply) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    const result = typeof reply === "function" ? reply(calls.at(-1).body) : reply
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } })
  }
  return calls
}

const lead = () => new AgentView({ id: "lead", name: "lead", agent: { tools: [] } })

test("chat(text) → team call chat [text] → {answer, guided, proposed}", async () => {
  const calls = serve({ ok: true, value: { answer: "3 runs so far; val_bpb 1.42", guided: false, proposed: null } })
  expect(await lead().chat("what is built?")).toEqual({ answer: "3 runs so far; val_bpb 1.42", guided: false, proposed: null })
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("/__askk/team/call")
  expect(calls[0].body).toEqual({ target: "lead", method: "chat", args: ["what is built?"] })
})

test("askChat: the outcome, never a throw; proposed work comes back, nothing reads queued (amendment M1)", async () => {
  serve({ ok: true, value: { answer: "on it", guided: true, proposed: null } })
  expect(await askChat(lead(), "check the tokenizer")).toEqual({ question: "check the tokenizer", answer: "on it", guided: true, proposed: null, visual: null, visualError: null, error: null })
  serve({ ok: true, value: { answer: "worth a run", guided: false, proposed: "  run the\neval " } })
  const outcome = await askChat(lead(), "run the eval?")
  expect(outcome.proposed).toBe("run the eval")
  expect(outcome).not.toHaveProperty("queued")
  // an older server's queued key is not read: a chat never starts work on its own
  serve({ ok: true, value: { answer: "starting", guided: false, queued: "run the eval" } })
  expect((await askChat(lead(), "run the eval")).proposed).toBeNull()
  serve({ ok: false, error: { message: "empty question" } })
  expect(await askChat(lead(), "")).toMatchObject({ question: "", answer: null, proposed: null, error: "empty question" })
})

test("chatAnswer: an askChat outcome as the chat row ChatPair draws; null while pending or failed", () => {
  expect(chatAnswer({ question: "q", answer: "42", guided: false, proposed: "train the base", error: null })).toEqual({ content: "42", guided: false, proposed: "train the base", visual: null, visualError: null })
  expect(chatAnswer({ question: "q", answer: "", guided: true, proposed: null, error: null })).toEqual({ content: "", guided: true, proposed: null, visual: null, visualError: null })
  // 2026-10-18: a chat answer's drawing comes along
  expect(chatAnswer({ answer: "see", visual: { show: "arch" } }).visual).toEqual({ show: "arch" })
  expect(chatAnswer({ question: "q", pending: true })).toBeNull()
  expect(chatAnswer({ question: "q", answer: null, error: "boom" })).toBeNull()
  expect(chatAnswer(null)).toBeNull()
})

test("chatNote: guidance added to the run, else nothing (proposed work is an action, not a note)", () => {
  expect(chatNote({ guided: true })).toBe("→ added to the run as guidance")
  expect(chatNote({ guided: false, proposed: "train the base" })).toBeNull()
  expect(chatNote({ guided: false, proposed: null })).toBeNull()
  expect(chatNote()).toBeNull()
})

test("queueProposal: Queue it sends the proposed text as new work through engine.send (team call send)", async () => {
  const calls = serve({ ok: true, value: null })
  expect(await queueProposal(lead(), "  train  the\nbase ")).toEqual({ sent: "train the base", error: null })
  expect(calls).toHaveLength(1)
  expect(calls[0].body).toEqual({ target: "lead", method: "send", args: ["train the base"] })
  // through the engine's own send, whatever the engine is
  const sent = []
  expect(await queueProposal({ send: async (text) => sent.push(text) }, "run the eval")).toEqual({ sent: "run the eval", error: null })
  expect(sent).toEqual(["run the eval"])
})

test("queueProposal: a refusal comes back as error, never a throw; nothing proposed sends nothing", async () => {
  serve({ ok: false, error: { message: "No agent \"lead\" in this desk." } })
  expect(await queueProposal(lead(), "run the eval")).toEqual({ sent: null, error: "No agent \"lead\" in this desk." })
  const calls = serve({ ok: true, value: null })
  expect(await queueProposal(lead(), "   ")).toEqual({ sent: null, error: "nothing proposed" })
  expect(await queueProposal(null, "run the eval")).toEqual({ sent: null, error: "no agent to send it to" })
  expect(calls).toHaveLength(0)
})

test("send: fire and forget, yet a caller may await what became of it", async () => {
  serve({ ok: true, value: null })
  expect(await lead().send("build it")).toBeNull()
  serve({ ok: false, error: { message: "refused" } })
  lead().send("dropped") // a dropped refusal is no unhandled rejection
  await expect(lead().send("build it")).rejects.toThrow("refused")
})

test("isRunRequest: a request, a quest — never guidance or a chat", () => {
  expect(isRunRequest({ role: "user", content: "build it" })).toBe(true)
  expect(isRunRequest({ role: "user", from: "lead", content: "a quest" })).toBe(true)
  expect(isRunRequest({ role: "user", kind: "guidance", content: "note" })).toBe(false)
  expect(isRunRequest({ role: "user", kind: "chat", from: "owner", content: "what runs?" })).toBe(false)
  expect(isRunRequest({ role: "assistant", action: "answer" })).toBe(false)
  expect(isRunRequest(null)).toBe(false)
})

test("threadItems: each chat question folded with its answer; other rows as they are", () => {
  const rows = [
    { id: "1", role: "user", content: "build it" },
    { id: "2", role: "user", kind: "chat", from: "owner", content: "what is built?" },
    { id: "3", role: "assistant", action: "tool", content: "files.list({})" },
    { id: "4", role: "assistant", kind: "chat", content: "nothing yet", guided: false, proposed: null },
    { id: "5", role: "assistant", kind: "chat", content: "an answer without its question" },
    { id: "6", role: "user", kind: "chat", content: "still waiting" },
  ]
  const items = threadItems(rows)
  expect(items.map((i) => (i.type === "chat" ? `chat:${i.question?.id ?? "-"}/${i.answer?.id ?? "-"}` : i.message.id))).toEqual(["1", "chat:2/4", "3", "chat:-/5", "chat:6/-"])
  expect(threadItems()).toEqual([])
})

test("threadItems: taken once a later run request says what the chat proposed (no second Queue it after a reload)", () => {
  const rows = [
    { id: "1", role: "user", kind: "chat", from: "owner", content: "what next?" },
    { id: "2", role: "assistant", kind: "chat", content: "train it", guided: false, proposed: "train  the base" },
    { id: "3", role: "user", kind: "chat", from: "owner", content: "and the eval?" },
    { id: "4", role: "assistant", kind: "chat", content: "after that", guided: false, proposed: "run the eval" },
    { id: "5", role: "user", kind: "guidance", content: "run the eval" }, // guidance is not the queued run
    { id: "6", role: "user", content: "train the\nbase" }, // the owner's Queue it: a run request
  ]
  const chats = threadItems(rows).filter((i) => i.type === "chat")
  expect(chats.map((c) => [c.id, c.taken])).toEqual([["1", true], ["3", false]])
  // a request before the answer does not count
  expect(threadItems([rows[5], rows[0], rows[1]]).find((i) => i.type === "chat").taken).toBe(false)
})

test("chatShown: the thread already has this answer as a chat row", () => {
  const messages = [{ role: "assistant", kind: "chat", content: "42" }, { role: "assistant", action: "answer", content: "done" }]
  expect(chatShown(messages, "42")).toBe(true)
  expect(chatShown(messages, "done")).toBe(false) // a run's answer is not a chat row
  expect(chatShown(messages, null)).toBe(false)
})
