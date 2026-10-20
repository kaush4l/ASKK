// The desk's talk with the owner (kernel builtin/talk.js; 2026-10-18 owner: "I want to talk with the desk to understand
// and guide the build. The desk should be able to talk with me too. The work and build can run in the background."),
// pure: the conversation as one timeline — what the agents tell and ask the owner (the talk artifact's messages) and
// what the owner asked the lead and its answers (the lead's chat rows) — oldest first; the questions waiting for the
// owner; how many of the desk's messages came after the owner last read (`seen`, kept in the artifact, so every device
// agrees). The owner's calls go through team/call target "artifact", like the preview's ask.
//   talk: the artifact twin {id, state: {messages: [{id, kind: say | ask | reply, from, text, options, re, status, at}],
//   seen}}; leadMessages: the lead's state.messages (chat rows {role, kind: "chat", from, content, at, …}).

import { teamCall } from "@/backend/live/stream"
import { threadItems } from "@/backend/live/agent"

export const talkOf = (artifacts) => Object.values(artifacts ?? {}).find((a) => a?.view === "talk") ?? null

// [{type: "desk", at, message} | {type: "chat", at, question, answer, taken}], oldest first; a reply sits under its
// question (type "desk", message.kind "reply").
export function talkTimeline(talk, leadMessages = [], { limit = 30 } = {}) {
  const desk = (talk?.state?.messages ?? []).map((m) => ({ type: "desk", key: `t:${m.id}`, at: m.at ?? "", message: m }))
  const chats = threadItems((leadMessages ?? []).filter((m) => m?.kind === "chat"))
    .filter((i) => i.type === "chat")
    .map((i, n) => ({ type: "chat", key: `c:${i.question?.at ?? i.answer?.at ?? n}`, at: i.question?.at ?? i.answer?.at ?? "", question: i.question, answer: i.answer, taken: i.taken }))
  return [...desk, ...chats].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-limit)
}

export const openQuestions = (talk) => (talk?.state?.messages ?? []).filter((m) => m.kind === "ask" && m.status === "open")

// The desk's messages (says and asks, not the owner's replies) after `seen`; with no `seen`, all of them.
export function unreadCount(talk) {
  const messages = talk?.state?.messages ?? []
  const after = messages.findIndex((m) => m.id === talk?.state?.seen)
  return messages.slice(after + 1).filter((m) => m.kind !== "reply").length
}

export const latestId = (talk) => talk?.state?.messages?.at(-1)?.id ?? null

// context: what the owner pointed at in the question's drawing (its element's context), or null.
export const replyTalk = (id, ask, text, context = null) => teamCall("artifact", "reply", [{ id, ask, text, ...(context ? { context } : {}) }])
export const seenTalk = (id, upto) => teamCall("artifact", "seen", [{ id, upto }])
