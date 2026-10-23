import { expect, test } from "bun:test"
import { conversation, deskGoal, deskPhase } from "./focus.js"

const M = [
  { id: "1", role: "user", kind: "request", content: "plan the week", at: "2026-10-23T13:00:00Z" },
  { id: "2", role: "tool", name: "plan.write", ok: true },
  { id: "3", role: "assistant", action: "answer", content: "planned", at: "2026-10-23T13:01:00Z" },
  { id: "4", role: "user", kind: "quest", from: "schedule", content: "08:50 slot" },
  { id: "5", role: "assistant", action: "answer", content: "slot done" },
  { id: "6", role: "user", kind: "chat", from: "owner", content: "what now?" },
  { id: "7", role: "assistant", kind: "chat", content: "waiting on 10:00" },
  { id: "8", role: "user", kind: "guidance", from: "owner", content: "tighter" },
]

test("conversation: only what the owner said and what came back — no quests, tools or guidance", () => {
  const c = conversation(M)
  expect(c.map((x) => (x.kind === "chat" ? `chat:${x.question.content}→${x.answer.content}` : `${x.side}:${x.kind}:${x.text}`))).toEqual(["you:request:plan the week", "lead:answer:planned", "chat:what now?→waiting on 10:00"])
  expect(conversation(M, { limit: 1 })[0]).toMatchObject({ kind: "chat", id: "6" })
  // a request from Telegram is the owner's (audit 19: from "telegram:<sender>", kind quest)
  const T = [{ id: "t", role: "user", kind: "quest", from: "telegram:kaush", content: "status?" }, { id: "u", role: "assistant", action: "answer", content: "flat" }]
  expect(conversation(T).map((x) => x.kind)).toEqual(["request", "answer"])
})

test("deskGoal: the run in progress, else the last run and how it ended", () => {
  expect(deskGoal({ status: "idle", messages: M })).toMatchObject({ text: "08:50 slot", from: "schedule", status: "answered", answer: "slot done" })
  expect(deskGoal({ status: "running", working: { request: "1" }, messages: M })).toMatchObject({ text: "plan the week", from: "you", status: "working" })
  expect(deskGoal({ messages: [] })).toBeNull()
})

test("deskPhase: a workflow's running stages, else a plan's open item, else nothing when idle", () => {
  const flow = { id: "workflow", view: "pipeline", title: "Trade card", state: { status: "running", stages: [{ id: "a", status: "done" }, { id: "b", status: "running", title: "Regime" }, { id: "c", status: "waiting" }] } }
  expect(deskPhase({ workflow: flow })).toMatchObject({ kind: "workflow", now: "Regime", done: 1, total: 3 })
  const doneFlow = { ...flow, state: { status: "done", card: { decision: "WATCH" }, stages: [{ id: "a", status: "done" }] } }
  expect(deskPhase({ workflow: doneFlow }).now).toBe("done · WATCH")
  const plan = { id: "plan", state: { goal: "ship", items: [{ id: "a", text: "x", status: "ticked" }, { id: "b", text: "y", status: "open" }] } }
  expect(deskPhase({ plan })).toMatchObject({ kind: "plan", title: "ship", now: "b: y", done: 1, total: 2 })
  const skip = { id: "plan", state: { items: [{ id: "a", text: "x", status: "skipped" }, { id: "b", text: "y", status: "open" }] } }
  expect(deskPhase({ plan: skip }).segments[0].status).toBe("skipped")
  const skipFlow = { ...flow, state: { status: "done", stages: [{ id: "a", status: "skipped" }, { id: "b", status: "done" }] } }
  expect(deskPhase({ workflow: skipFlow })).toMatchObject({ done: 2, total: 2 })
  expect(deskPhase({}, { activity: { phase: "idle" } })).toBeNull()
})
