// The desk's one stream into this tab: GET /__askk/team/stream (companion/team/kernel-team.js). The registry
// (registry.js) opens it once at start and hands every event to the stores of the live UI — agents
// (registry.js), the desk's tree, boards and artifacts (desk.js), the background log (log.js) — so each store is
// current whether or not a view is mounted. Actions go back as calls.
//
//   events: snapshot {registry, states, kernel, log} | registry | state {id, patch} | kernel {artifact, boards?}
//           | log {at, source, text}
//   POST /__askk/team/call { target: <agent> | "desk", method, args } -> { ok, value | error }

import { withBase } from "@/backend/live/base-path"

// onEvent(event) for every event; EventSource reconnects on its own and every (re)connect starts with a
// snapshot. onError() when the connection drops. Returns close().
export function connectTeam(onEvent, onError = () => {}) {
  const source = new EventSource(withBase("/__askk/team/stream"))
  source.onmessage = ({ data }) => {
    let event
    try {
      event = JSON.parse(data)
    } catch {
      return // a malformed event is dropped
    }
    onEvent(event)
  }
  source.onerror = onError
  return () => source.close()
}

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
