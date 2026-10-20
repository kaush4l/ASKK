import { expect, test } from "bun:test"
import { openQuestions, talkOf, talkTimeline, unreadCount } from "./talk.js"

const talk = {
  id: "talk",
  view: "talk",
  state: {
    seen: "m1",
    messages: [
      { id: "m1", kind: "say", from: "lead", text: "r07 done", at: "2026-10-18T18:00:00Z" },
      { id: "q2", kind: "ask", from: "lead", text: "TCR first?", options: ["yes", "no"], status: "answered", at: "2026-10-18T18:02:00Z" },
      { id: "r3", kind: "reply", from: "owner", text: "yes", re: "q2", at: "2026-10-18T18:05:00Z" },
      { id: "q4", kind: "ask", from: "planner", text: "FLORES or Itihasa?", options: [], status: "open", at: "2026-10-18T18:07:00Z" },
    ],
  },
}
const chat = [
  { role: "user", content: "run", at: "2026-10-18T17:00:00Z" },
  { role: "user", kind: "chat", from: "owner", content: "what is the goal?", at: "2026-10-18T18:01:00Z" },
  { role: "assistant", kind: "chat", content: "TCR at scale", at: "2026-10-18T18:01:30Z" },
]

test("talkOf finds the talk twin by its view", () => {
  expect(talkOf({ preview: { view: "preview" }, talk })).toBe(talk)
  expect(talkOf({})).toBeNull()
})

test("one timeline: the desk's messages and the owner's chats with the lead, oldest first; runs left out", () => {
  const t = talkTimeline(talk, chat)
  expect(t.map((i) => (i.type === "desk" ? i.message.id : `chat:${i.answer.content}`))).toEqual(["m1", "chat:TCR at scale", "q2", "r3", "q4"])
  expect(talkTimeline(talk, chat, { limit: 2 }).map((i) => i.message.id)).toEqual(["r3", "q4"])
  expect(talkTimeline(null, [])).toEqual([])
})

test("open questions and unread: the desk's messages after seen, replies not counted", () => {
  expect(openQuestions(talk).map((q) => q.id)).toEqual(["q4"])
  expect(unreadCount(talk)).toBe(2)
  expect(unreadCount({ state: { ...talk.state, seen: null } })).toBe(3)
  expect(unreadCount({ state: { ...talk.state, seen: "q4" } })).toBe(0)
})
