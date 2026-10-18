import { expect, test } from "bun:test"
import { eventTarget, liveFeed, questAsk, toolCall } from "./follow.js"
import { callLook } from "./visual.js"

const engine = {
  id: "a1",
  name: "lead",
  tools: [
    { name: "research", type: "agent", view: "quest" },
    { name: "github.search", type: "mcp", view: "data" },
    { name: "web.search", type: "function", view: "web" },
    { name: "lead.checklist.check", type: "artifact", view: "checklist" },
    { name: "notes.read", type: "function", view: "text" },
  ],
}

test("toolCall: a tool message as the call callLook draws", () => {
  expect(toolCall(engine, { name: "research", kind: "agent" })).toEqual({ name: "research", kind: "agent", type: "agent", view: "quest" })
  expect(toolCall(engine, { name: "github.search", kind: "tool", view: "data" })).toEqual({ name: "github.search", kind: "tool", type: "mcp", view: "data" })
  // No view from the kernel: a quest's for an agent call, else data; an unknown tool has no type.
  expect(toolCall(engine, { name: "research", kind: "agent", view: null }).view).toBe("quest")
  expect(toolCall(engine, { name: "gone" })).toEqual({ name: "gone", kind: "tool", type: null, view: "data" })
  expect(toolCall(null, { name: "web.read" }).type).toBe(null)

  const kind = (m) => callLook(toolCall(engine, m)).kind
  expect(kind({ name: "research", kind: "agent" })).toBe("quest")
  expect(kind({ name: "github.search", view: "data" })).toBe("mcp")
  expect(kind({ name: "web.search", view: "web" })).toBe("web")
  expect(kind({ name: "lead.checklist.check", view: "checklist" })).toBe("checklist")
  expect(kind({ name: "notes.read", view: "text" })).toBe("function")
  expect(kind({ name: "gone" })).toBe("data")
})

test("liveFeed events carry toolCall's shape, so the feed and the thread draw a call alike", () => {
  const messages = [
    { id: "m1", role: "tool", name: "research", kind: "agent", view: "quest", ok: true, at: "2026-10-17T10:00:00Z" },
    { id: "m2", role: "tool", name: "github.search", kind: "tool", view: "data", ok: false, at: "2026-10-17T10:00:01Z" },
    { id: "m3", role: "tool", name: "web.search", kind: "tool", ok: true, at: "2026-10-17T10:00:02Z" },
    { id: "m4", role: "assistant", action: "gate", content: "checklist open", at: "2026-10-17T10:00:03Z" },
  ]
  const state = { messages, activity: { since: "2026-10-17T10:00:04Z", calls: [{ name: "lead.checklist.check", view: "checklist" }] } }
  const events = liveFeed([engine], [state])
  for (const m of messages.filter((m) => m.role === "tool")) {
    const event = events.find((e) => e.id === m.id)
    expect(event).toMatchObject(toolCall(engine, m))
    expect(callLook(event)).toEqual(callLook(toolCall(engine, m)))
  }
  expect(events.find((e) => e.state === "running")).toMatchObject({ name: "lead.checklist.check", kind: "tool", type: "artifact", view: "checklist" })
  // A refused answer is a gate, drawn red, in the feed and the thread alike.
  expect(callLook(events.find((e) => e.id === "m4"))).toEqual(callLook({ kind: "gate" }))
  expect(callLook({ kind: "gate" })).toMatchObject({ kind: "gate", tone: "red" })
})

// One step of three parallel calls (the step's thread row k2) as kernel-team.js streams it: the calls not answered yet,
// each with its index in the step, and the results that arrived as thread rows, each naming its step row (`row`).
const SINCE = "2026-10-17T10:00:00.000Z"
const trio = [
  { index: 0, name: "alpha", inputs: { q: "a" }, kind: "tool", view: "web" },
  { index: 1, name: "beta", inputs: { q: "b" }, kind: "tool", view: "web" },
  { index: 2, name: "gamma", inputs: { q: "c" }, kind: "tool", view: "web" },
]
const stepState = (running, results = []) => ({
  messages: [
    { id: "k1", role: "user", kind: "request", content: "go", at: "2026-10-17T09:59:59.000Z" },
    { id: "k2", role: "assistant", action: "tool", content: "three\nalpha({})\nbeta({})\ngamma({})", at: SINCE },
    ...results.map((r, i) => ({ id: `k${3 + i}`, role: "tool", name: r.name, kind: "tool", view: "web", index: r.index, row: "k2", inputs: r.inputs, ok: true, output: `${r.name} done`, at: `2026-10-17T10:00:0${1 + i}.000Z` })),
  ],
  activity: { phase: running.length > 1 ? "tools" : "tool", names: running.map((c) => c.name), calls: running, since: SINCE, stage: 1, row: "k2" },
})
const idsOf = (state) => Object.fromEntries(liveFeed([engine], [state]).map((e) => [e.name, e.id]))

test("D2 a running call keeps its id when an earlier call of its step finishes; a finished call keeps the id it ran under", () => {
  const before = idsOf(stepState(trio))
  const after = idsOf(stepState(trio.slice(1), [trio[0]])) // alpha finished
  expect(after.beta).toBe(before.beta)
  expect(after.gamma).toBe(before.gamma)
  expect(new Set(Object.values(before)).size).toBe(3)
  // alpha's row, now done, is the same row: the Live page's selection by id (live-page.jsx) stays on it.
  expect(after.alpha).toBe(before.alpha)
  const chosen = before.beta
  const events = liveFeed([engine], [stepState(trio.slice(2), [trio[0], trio[1]])]) // beta finished too
  expect(events.find((e) => e.id === chosen)).toMatchObject({ name: "beta", state: "done", inputs: { q: "b" } })
  expect(events.map((e) => `${e.name} ${e.state}`)).toEqual(["gamma running", "alpha done", "beta done"]) // by time: a running call at its step's start
  // Out of order: gamma finishes before beta; beta keeps its id.
  const gammaFirst = idsOf(stepState([trio[1]], [trio[0], trio[2]]))
  expect(gammaFirst).toEqual(before)

  // The same call in a later step (a new step row) is another call; a row without an index keeps its message id.
  const next = stepState([], trio)
  next.messages.push({ id: "k6", role: "assistant", action: "tool", content: "again\nalpha({})", at: "2026-10-17T10:01:00.000Z" })
  next.messages.push({ id: "k7", role: "tool", name: "alpha", kind: "tool", index: 0, row: "k6", inputs: {}, ok: true, output: "", at: "2026-10-17T10:01:01.000Z" })
  next.messages.push({ id: "k8", role: "tool", name: "beta", kind: "tool", inputs: {}, ok: true, output: "", at: "2026-10-17T10:01:02.000Z" })
  next.messages.push({ id: "k9", role: "tool", name: "gamma", kind: "tool", index: 1, inputs: {}, ok: true, output: "", at: "2026-10-17T10:01:03.000Z" }) // no `row`: an older server's row
  next.activity = { phase: "idle" }
  const ids = liveFeed([engine], [next]).map((e) => e.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.slice(-2)).toEqual(["k8", "k9"])
})

test("E3 a finished call keeps its id once the thread's window starts after its step row", () => {
  const done = stepState([], trio)
  const before = idsOf(done)
  expect(Object.values(before).every((id) => id.includes("-call-k2-"))).toBe(true)
  // The 400-row window (kernel-team.js MAX_MESSAGES) dropped the request and the step row k2; its results remain.
  const windowed = { ...done, messages: done.messages.slice(2) }
  expect(windowed.messages.some((m) => m.id === "k2")).toBe(false)
  expect(windowed.messages.map((m) => m.name)).toEqual(["alpha", "beta", "gamma"])
  expect(idsOf(windowed)).toEqual(before)
  // Only the first result left too: the other two keep theirs.
  const later = idsOf({ ...done, messages: done.messages.slice(3) })
  expect(later).toEqual({ beta: before.beta, gamma: before.gamma })
  // While running, before any result arrived, each call had the same id.
  expect(idsOf(stepState(trio))).toEqual(before)
})

test("eventTarget: a call's inputs in one short line — web.search's q, a quest's ask, else the first text or the first fields", () => {
  expect(eventTarget({ kind: "tool", inputs: { limit: 6, source: "arxiv", q: "small caps breadth" } })).toBe("small caps breadth")
  expect(eventTarget({ kind: "agent", inputs: { requirement: "r", ask: "is GAMMA moving?", outcome: "o" } })).toBe("is GAMMA moving?")
  expect(eventTarget({ kind: "agent", inputs: { quest: { ask: "nested ask" } } })).toBe("nested ask")
  expect(eventTarget({ kind: "tool", inputs: { url: "https://example.com", find: "x" } })).toBe("https://example.com")
  expect(eventTarget({ kind: "tool", inputs: { note: "", text: "first text" } })).toBe("first text")
  expect(eventTarget({ kind: "tool", inputs: { ids: [1, 2], limit: 5 } })).toBe("ids: [1,2], limit: 5")
  expect(eventTarget({ kind: "tool", inputs: {} })).toBe("")
  expect(eventTarget({ kind: "tool", inputs: { text: "y".repeat(500) } })).toBe(`${"y".repeat(200)}…`)
})

test("eventTarget clips refused answers and guidance, and skips empty values for the next one worth naming", () => {
  expect(eventTarget({ kind: "gate", output: "z".repeat(5000) })).toBe(`${"z".repeat(200)}…`)
  expect(eventTarget({ kind: "guidance", output: "g".repeat(300) })).toBe(`${"g".repeat(200)}…`)
  expect(eventTarget({ kind: "gate", output: "short reason" })).toBe("short reason")
  expect(eventTarget({ kind: "tool", inputs: { path: {}, url: { a: 1 } } })).toBe("a: 1")
  expect(eventTarget({ kind: "tool", inputs: { path: "", q: "  ", url: "https://x.dev" } })).toBe("https://x.dev")
  expect(eventTarget({ kind: "agent", inputs: { quest: ["check ACME", "check BETA"] } })).toBe('["check ACME","check BETA"]')
  expect(eventTarget({ kind: "agent", inputs: { quest: "a plain quest" } })).toBe("a plain quest")
  // Whitespace is not a value: the next real one is named, the last resort lists only filled fields.
  expect(eventTarget({ kind: "tool", inputs: { url: "   ", ask: "word 61" } })).toBe("word 61")
  expect(eventTarget({ kind: "tool", inputs: { a: "", b: {}, c: [], d: 5 } })).toBe("d: 5")
  expect(eventTarget({ kind: "agent", inputs: { quest: { ask: "   " }, path: "/real" } })).toBe("/real")
  expect(eventTarget({ kind: "agent", inputs: { ask: "  ", requirement: "R" } })).toBe("R")
  expect(questAsk({ quest: { ask: "nested" } })).toBe("nested")
  expect(questAsk({ ask: "  ", requirement: "R" })).toBeNull()
  // Blanks are trimmed and left out of objects; text or number inputs are their own target.
  expect(eventTarget({ kind: "tool", inputs: { path: `${" ".repeat(250)}real` } })).toBe("real")
  expect(eventTarget({ kind: "agent", inputs: { quest: { requirement: "R", ask: "\t\n" } } })).toBe("requirement: R")
  expect(eventTarget({ kind: "tool", inputs: { path: { a: " ", b: "x" } } })).toBe("b: x")
  expect(eventTarget({ kind: "tool", inputs: { query: { a: { b: " ", c: 1 } } } })).toBe('a: {"c":1}')
  expect(eventTarget({ kind: "agent", inputs: { quest: { requirement: { x: " ", y: "R" } } } })).toBe('requirement: {"y":"R"}')
  expect(eventTarget({ kind: "tool", inputs: { ids: [" ", "a", [], { k: "" }] } })).toBe('ids: ["a"]')
  expect(eventTarget({ kind: "tool", inputs: "search terms" })).toBe("search terms")
  expect(eventTarget({ kind: "agent", inputs: 5 })).toBe("5")
  // Clipping never splits an emoji's surrogate pair.
  const clipped = eventTarget({ kind: "tool", inputs: { text: `a${"😀".repeat(150)}` } })
  expect(clipped.endsWith("…")).toBe(true)
  expect(/[\uD800-\uDBFF]…$/.test(clipped)).toBe(false)
})

test("E4 eventTarget never prints [object Object]: an object or list in query, path, url, symbol or any first field reads as text, clipped", () => {
  const target = eventTarget({ kind: "tool", inputs: { query: { ticker: "ACME" } } })
  expect(target).toContain("ACME")
  expect(target).not.toContain("[object Object]")
  expect(target).toBe("ticker: ACME")
  expect(eventTarget({ kind: "tool", inputs: { path: ["notes", "a.md"] } })).toBe('["notes","a.md"]')
  expect(eventTarget({ kind: "tool", inputs: { url: { href: "https://example.com", find: ["x"] } } })).toBe('href: https://example.com, find: ["x"]')
  expect(eventTarget({ kind: "tool", inputs: { symbol: { root: "GAMMA", legs: [{ strike: 217 }] } } })).toBe('root: GAMMA, legs: [{"strike":217}]')
  expect(eventTarget({ kind: "tool", inputs: { q: [1, 2] } })).toBe("[1,2]")
  expect(eventTarget({ kind: "tool", inputs: { filter: { side: "call" }, limit: 5 } })).toBe('filter: {"side":"call"}, limit: 5')
  expect(eventTarget({ kind: "agent", inputs: { ask: { name: "GAMMA", why: "breadth" } } })).toBe("name: GAMMA, why: breadth")
  expect(eventTarget({ kind: "gate", output: { reasons: ["checklist open"] } })).toBe('reasons: ["checklist open"]')
  expect(eventTarget({ kind: "gate", output: "Answer refused: x" })).toBe("Answer refused: x")
  // Clipped like the rest.
  const long = eventTarget({ kind: "tool", inputs: { query: { text: "z".repeat(500) } } })
  expect(long).toBe(`text: ${"z".repeat(194)}…`)
  for (const inputs of [{ query: { a: { b: 1 } } }, { path: [{ a: 1 }] }, { url: {} }, { symbol: { s: null } }, { x: { y: 1 } }])
    expect(eventTarget({ kind: "tool", inputs })).not.toContain("[object Object]")
})

test("runSteps: an owner chat neither starts the run nor shows as one of its steps (2026-10-17: kind chat)", async () => {
  const { runSteps } = await import("./follow.js")
  const messages = [
    { id: "r", role: "user", content: "train the base" },
    { id: "t", role: "tool", name: "web.search", ok: true, output: "3 results" },
    { id: "q", role: "user", kind: "chat", from: "owner", content: "what runs now?" },
    { id: "a", role: "assistant", kind: "chat", content: "the trainer, step 400" },
    { id: "g", role: "user", kind: "guidance", content: "lease the gpu" },
  ]
  const { steps } = runSteps({ messages })
  expect(steps.map((s) => s.step)).toEqual(["tool", "guidance"])
  // the Live feed has no row for a chat either
  expect(liveFeed([engine], [{ messages }]).map((e) => e.kind)).toEqual(["tool", "guidance"])
})
