// The team running on the local server (capability `team`), mirrored in this
// tab. In local mode one team runs beside the folder (companion/team.js) and
// every tab, browser and window shows the same engines: state streams in
// over Server-Sent Events, and actions (a message, an approval, stop, …) go
// back as calls. RemoteEngine has the surface the UI uses on EngineProxy.
//
//   GET  /__askk/team/stream   events: snapshot | registry | state | models
//   POST /__askk/team/call     { target: "registry" | <engine id>, method, args } -> { ok, value | error }

import { EMPTY_STATE, EngineSurface, patchMessages } from "@/backend/runtime/engine-surface"
import { withBase } from "@/backend/platform/base-path"

export async function teamCall(target, method, args = []) {
  const response = await fetch(withBase("/__askk/team/call"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, method, args }),
  })
  const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }))
  if (!result.ok) throw Object.assign(new Error(result.error?.message ?? "Team call failed"), { name: result.error?.name ?? "Error" })
  return result.value
}

export class RemoteEngine extends EngineSurface {
  constructor({ id, name, agent }) {
    super()
    this.id = id
    this.name = name
    this.describe(agent)
  }

  // Definition fields the UI reads (as EngineProxy).
  describe(agent) {
    super.describe(agent)
    this.memory = { path: `agents/${this.name}/memory.md` }
  }

  // From the stream: a full state, or changed keys (messages as { from, items }).
  apply(patch, full = false) {
    const { messages, ...rest } = patch
    const next = full ? { ...EMPTY_STATE, ...rest } : { ...this.getSnapshot(), ...rest }
    if (messages) next.messages = full ? messages : patchMessages(this.getSnapshot().messages, messages)
    this.replaceState(next)
  }

  #call(method, args = []) {
    return teamCall(this.id, method, args)
  }

  init() {
    return this
  }

  deposit(letter) {
    this.#call("deposit", [letter]).catch(() => {})
  }

  ask(text, options) {
    return this.#call("ask", [text, options])
  }

  send(text) {
    this.#call("send", [text]).catch(() => {})
  }

  preview(text = "") {
    return this.#call("preview", [text])
  }

  restore() {
    return Promise.resolve() // the server restored it
  }

  clearMemory() {
    return this.#call("clearMemory")
  }

  summarizeMemory() {
    return this.#call("summarizeMemory")
  }

  stop() {
    this.#call("stop").catch(() => {})
  }

  resolveApproval(id, ok) {
    this.#call("resolveApproval", [id, !!ok]).catch(() => {})
  }

  guide(text) {
    return this.#call("guide", [text])
  }

  reconfigure() {} // the server reconfigures its engines

  dispose() {
    this.clearListeners()
  }
}

// Open the stream. onEvent(event) for every event; reconnects on its own
// (EventSource), and every (re)connect starts with a full snapshot.
export function connectTeam(onEvent) {
  const source = new EventSource(withBase("/__askk/team/stream"))
  source.onmessage = ({ data }) => {
    try {
      onEvent(JSON.parse(data))
    } catch {
      // a malformed event is dropped
    }
  }
  return () => source.close()
}
