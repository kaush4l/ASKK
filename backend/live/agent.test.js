import { afterEach, expect, test } from "bun:test"

import { AgentView, askChat, chatAnswer, chatNote, isRunRequest, lastError, olderLabel, patchMessages, queueProposal, threadItems } from "./agent.js"
import { tailStates } from "./team-core.js"

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

test("lastError: the newest error row's {text, at} wins", () => {
  const state = {
    error: "stale",
    messages: [
      { id: "1", role: "assistant", error: "first failure", at: 1000 },
      { id: "2", role: "assistant", content: "fine" },
      { id: "3", role: "assistant", error: "default: POST llm/claude-cli/v1/chat/completions: HTTP 500", at: 2000 },
    ],
  }
  expect(lastError(state)).toEqual({ text: "default: POST llm/claude-cli/v1/chat/completions: HTTP 500", at: 2000 })
})

test("lastError: only state.error set gives {text, at: null}", () => {
  expect(lastError({ error: "model unreachable", messages: [{ id: "1", role: "user", content: "build it" }] })).toEqual({ text: "model unreachable", at: null })
})

test("lastError: no error gives null", () => {
  expect(lastError({ error: null, messages: [{ id: "1", role: "user", content: "build it" }] })).toBeNull()
  expect(lastError(null)).toBeNull()
})

const rowsOf = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: String(start + i), role: "assistant", content: `row ${start + i}` }))

test("snapshot-tail-40: tailStates sends a 400-row thread's newest 40 rows with messagesSkipped 360", () => {
  const all = rowsOf(400)
  const { critic, coder } = tailStates({ critic: { status: "idle", messages: all }, coder: { status: "idle", messages: rowsOf(3) } })
  expect(critic.messages).toHaveLength(40)
  expect(critic.messages[0].id).toBe("360")
  expect(critic.messages.at(-1).id).toBe("399")
  expect(critic.messagesSkipped).toBe(360)
  expect(critic.status).toBe("idle")
  expect(coder.messages).toHaveLength(3)
  expect(coder.messagesSkipped).toBe(0)
})

test("snapshot-states-lean: a result row rides the snapshot once (content), and its call still reads its output", () => {
  const result = { id: "1", role: "tool", name: "files.read", inputs: { path: "a.js" }, ok: true, content: "x".repeat(5000), output: "x".repeat(5000) }
  const other = { id: "2", role: "tool", name: "files.read", ok: true, content: "short", output: "different" }
  const { critic } = tailStates({ critic: { status: "idle", messages: [result, other] } })
  expect(critic.messages[0]).not.toHaveProperty("output")
  expect(critic.messages[0].content).toBe(result.content)
  expect(critic.messages[1].output).toBe("different")
  expect(JSON.stringify(critic).length).toBeLessThan(JSON.stringify(result).length)
  expect(String(critic.messages[0].output ?? critic.messages[0].content)).toBe(result.output)
  expect(result).toHaveProperty("output") // the host's own state stays whole
})

test("snapshot-inputs-lean: a result row's long input is cut to 300 chars plus …, short inputs stay whole", () => {
  const write = { id: "1", role: "tool", name: "files.write", inputs: { path: "a.js", content: "y".repeat(5000) }, ok: true, content: "wrote a.js" }
  const read = { id: "2", role: "tool", name: "web.read", inputs: { url: "https://example.com", find: "terms" }, ok: true, content: "page" }
  const { coder } = tailStates({ coder: { status: "idle", messages: [write, read] } })
  expect(coder.messages[0].inputs.content).toHaveLength(301)
  expect(coder.messages[0].inputs.content.endsWith("…")).toBe(true)
  expect(coder.messages[0].inputs.path).toBe("a.js")
  expect(coder.messages[0].inputsCut).toBe(true)
  expect(coder.messages[1].inputs).toEqual({ url: "https://example.com", find: "terms" })
  expect(coder.messages[1]).not.toHaveProperty("inputsCut")
  expect(write.inputs.content).toHaveLength(5000) // the host's own row stays whole
})

test("snapshot-steps-lean: a step row's long call line is cut to 300 chars plus …, its thought and short rows stay whole", () => {
  const call = `files.write(${JSON.stringify({ path: "a.js", content: "y".repeat(5000) })})`
  const step = { id: "1", role: "assistant", action: "tool", content: `I write the file.\n${call}\nfiles.read({"path":"a.js"})` }
  const short = { id: "2", role: "assistant", action: "tool", content: 'I read it.\nfiles.read({"path":"a.js"})' }
  const { coder } = tailStates({ coder: { status: "idle", messages: [step, short] } })
  const lines = coder.messages[0].content.split("\n")
  expect(lines[0]).toBe("I write the file.")
  expect(lines[1]).toHaveLength(301)
  expect(lines[1].endsWith("…")).toBe(true)
  expect(lines[2]).toBe('files.read({"path":"a.js"})')
  expect(coder.messages[0].contentCut).toBe(true)
  expect(coder.messages[1]).toEqual(short)
  expect(coder.messages[1]).not.toHaveProperty("contentCut")
  expect(step.content.split("\n")[1]).toBe(call) // the host's own row stays whole
  expect(step).not.toHaveProperty("contentCut")
})

test("snapshot-steps-lean: loadStep fetches a cut step row whole through older [end, start] and puts it in place", async () => {
  const whole = { id: "341", role: "assistant", action: "tool", content: "I write.\nfiles.write(...whole...)" }
  const calls = serve({ ok: true, value: { items: [whole] } })
  const view = new AgentView({ id: "coder", name: "coder", agent: { name: "coder" } })
  view.apply({ status: "idle", messagesSkipped: 340, messages: [{ id: "340", role: "user", content: "build it" }, { ...whole, content: "I write.\nfiles.wr…", contentCut: true }] }, true)
  expect(await view.loadStep("341")).toBe(true)
  expect(calls[0].body).toEqual({ target: "coder", method: "older", args: [342, 341] })
  expect(view.getSnapshot().messages[1]).toEqual(whole)
  expect(view.getSnapshot().messages[0].id).toBe("340")
  expect(await view.loadStep("missing")).toBe(false)
})

test("snapshot-thread-tail: apply of the tail then a patch at from 400 keeps every row in order", () => {
  const all = rowsOf(400)
  const view = new AgentView({ id: "critic", name: "critic", agent: { name: "critic" } })
  view.apply(tailStates({ critic: { status: "idle", messages: all } }).critic, true)
  view.apply({ messages: { from: 400, items: rowsOf(1, 400) } })
  const s = view.getSnapshot()
  expect(s.messagesSkipped).toBe(360)
  expect(s.messages.map((m) => m.id)).toEqual([...all.slice(360), ...rowsOf(1, 400)].map((m) => m.id))
})

test("snapshot-thread-tail: a patch from 0 (the thread restarted) replaces the rows and clears the offset", () => {
  expect(patchMessages({ messages: rowsOf(60, 340), messagesSkipped: 340 }, { from: 0, items: [] })).toEqual({ messages: [], messagesSkipped: 0 })
})

test("snapshot-thread-tail: olderLabel names the rows left out, or null", () => {
  expect(olderLabel(340)).toBe("Show 340 older rows")
  expect(olderLabel(1)).toBe("Show 1 older row")
  expect(olderLabel(0)).toBeNull()
})
