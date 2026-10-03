// Web Worker that runs one engine on its own thread. The main thread talks to
// it through EngineProxy (engine-proxy.js).
//
// The engine's inbox lives here: letters (the owner's requests, quests from
// other agents, reports on quests this engine sent) arrive as "deposit"
// messages, and postMessage is the thread-safe queue that carries them. A
// deposit while idle starts the work; nothing ever waits on another agent.
//
// main → worker
//   { type: "init", id, name, agent, model, descriptions }
//   { type: "deposit", letter }            a letter for the inbox (BaseEngine.deposit)
//   { type: "call", callId, method: "restore" | "clearMemory" | "summarizeMemory" | "preview", args }
//   { type: "stop" }
//   { type: "configure", agent, model, descriptions }
//   { type: "sent", callId, ok, value, error }   reply to "send": delivered (value: engine id)
//   { type: "approval", id, ok }           the owner's answer to a pending tool call
//
// worker → main
//   { type: "state", patch }               changed state keys; `messages` as
//                                          { from, items } (unchanged prefix kept)
//   { type: "result", callId, ok, value, error }
//   { type: "send", callId, to, letter }   deliver a letter to another engine's inbox
//                                          (`to`: { name } for quests, { id } for replies)

import { createEngine } from "@/backend/engines"

let engine = null
let model = null // the connection, sent by the main thread (the catalogue lives there)
let descriptions = {}

// ── state → main thread, batched ─────────────────────────────────────────

const FLUSH_MS = 33
let sent = {}
let timer = null

function flush() {
  clearTimeout(timer)
  timer = null
  const state = engine.getSnapshot()
  const patch = {}
  for (const [key, value] of Object.entries(state)) {
    if (key !== "messages" && value !== sent[key]) patch[key] = value
  }
  if (state.messages !== sent.messages) {
    // Send only messages from the first one that changed (usually the last).
    const before = sent.messages ?? []
    let from = 0
    while (from < before.length && from < state.messages.length && before[from] === state.messages[from]) from++
    patch.messages = { from, items: state.messages.slice(from) }
  }
  sent = state
  if (Object.keys(patch).length) postMessage({ type: "state", patch })
}

const schedule = () => {
  timer ??= setTimeout(flush, FLUSH_MS)
}

// ── letters to other engines, routed through the main thread ─────────────

let sendCount = 0
const sending = new Map() // callId -> { resolve, reject }

// Resolves once the letter is in the other engine's inbox (with its id).
function send(to, letter) {
  return new Promise((resolve, reject) => {
    const callId = ++sendCount
    sending.set(callId, { resolve, reject })
    postMessage({ type: "send", callId, to, letter })
  })
}

const directory = {
  describe: (name) => descriptions[name],
  send,
}

const toError = (data) => Object.assign(new Error(data?.message ?? "Unknown error"), { name: data?.name ?? "Error" })

// ── messages from the main thread ────────────────────────────────────────

async function call({ callId, method, args = [] }) {
  try {
    let value
    if (["restore", "clearMemory", "summarizeMemory", "preview"].includes(method)) {
      value = await engine[method](...args)
    } else {
      throw new Error(`Unknown method ${method}`)
    }
    flush() // the caller sees the final state before the result
    postMessage({ type: "result", callId, ok: true, value: value ?? null })
  } catch (error) {
    flush()
    postMessage({ type: "result", callId, ok: false, error: { name: error.name, message: error.message } })
  }
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case "init":
      model = data.model
      descriptions = data.descriptions ?? {}
      engine = createEngine({ agent: data.agent, id: data.id, name: data.name, directory, getModel: () => model })
      engine.subscribe(schedule)
      engine.init()
      break
    case "configure":
      model = data.model
      descriptions = data.descriptions ?? descriptions
      engine.reconfigure(data.agent)
      break
    case "deposit":
      // Outcomes are in state (and reported to a quest's sender).
      engine.deposit(data.letter).catch(() => {})
      break
    case "call":
      call(data)
      break
    case "stop":
      engine.stop()
      break
    case "approval":
      engine.resolveApproval(data.id, data.ok)
      break
    case "sent": {
      const pending = sending.get(data.callId)
      sending.delete(data.callId)
      if (data.ok) pending?.resolve(data.value)
      else pending?.reject(toError(data.error))
      break
    }
  }
}
