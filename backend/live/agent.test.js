import { afterEach, expect, test } from "bun:test"

import { AgentView, askChat, chatNote, chatShown, isRunRequest, threadItems } from "./agent.js"

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

test("chat(text) → team call chat [text] → {answer, guided, queued}", async () => {
  const calls = serve({ ok: true, value: { answer: "3 runs so far; val_bpb 1.42", guided: false, queued: null } })
  expect(await lead().chat("what is built?")).toEqual({ answer: "3 runs so far; val_bpb 1.42", guided: false, queued: null })
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("/__askk/team/call")
  expect(calls[0].body).toEqual({ target: "lead", method: "chat", args: ["what is built?"] })
})

test("askChat: the outcome, never a throw", async () => {
  serve({ ok: true, value: { answer: "on it", guided: true, queued: null } })
  expect(await askChat(lead(), "check the tokenizer")).toEqual({ question: "check the tokenizer", answer: "on it", guided: true, queued: null, error: null })
  serve({ ok: true, value: { answer: "starting", guided: false, queued: "run the eval" } })
  expect((await askChat(lead(), "run the eval")).queued).toBe("run the eval")
  serve({ ok: false, error: { message: "empty question" } })
  expect(await askChat(lead(), "")).toMatchObject({ question: "", answer: null, error: "empty question" })
})

test("chatNote: guidance, queued work, else nothing", () => {
  expect(chatNote({ guided: true })).toBe("→ guidance: its run reads it at the next step")
  expect(chatNote({ queued: "train  the\nbase" })).toBe("→ queued: train the base")
  expect(chatNote({ guided: false, queued: null })).toBeNull()
  expect(chatNote()).toBeNull()
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
    { id: "4", role: "assistant", kind: "chat", content: "nothing yet", guided: false, queued: null },
    { id: "5", role: "assistant", kind: "chat", content: "an answer without its question" },
    { id: "6", role: "user", kind: "chat", content: "still waiting" },
  ]
  const items = threadItems(rows)
  expect(items.map((i) => (i.type === "chat" ? `chat:${i.question?.id ?? "-"}/${i.answer?.id ?? "-"}` : i.message.id))).toEqual(["1", "chat:2/4", "3", "chat:-/5", "chat:6/-"])
  expect(threadItems()).toEqual([])
})

test("chatShown: the thread already has this answer as a chat row", () => {
  const messages = [{ role: "assistant", kind: "chat", content: "42" }, { role: "assistant", action: "answer", content: "done" }]
  expect(chatShown(messages, "42")).toBe(true)
  expect(chatShown(messages, "done")).toBe(false) // a run's answer is not a chat row
  expect(chatShown(messages, null)).toBe(false)
})
