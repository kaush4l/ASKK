// The desk's one stream into this tab: GET /__askk/team/stream (companion/team/kernel-team.js). The registry
// (registry.js) opens it once at start and hands every event to the stores of the live UI — agents
// (registry.js), the desk's tree, boards and artifacts (desk.js), the background log (log.js) — so each store is
// current whether or not a view is mounted. Actions go back as calls.
//
//   events: snapshot {registry, states, kernel, log} | registry | state {id, patch} | kernel {artifact, boards?}
//           | log {at, source, text}
//   POST /__askk/team/call { target: <agent> | "desk", method, args } -> { ok, value | error }

import { withBase } from "@/backend/live/base-path"

// 2026-10-20 (the hosted version): a desk run in this tab (backend/browser/team.js) speaks the same protocol; while one
// is in use, the stream and the calls go to it instead of the desk server.
let local = null
export function setLocalTeam(team) {
  local = team ?? null
}
export const localTeam = () => local

// onEvent(event) for every event; EventSource reconnects on its own and every (re)connect starts with a
// snapshot. onError() when the connection drops. Returns close().
// One stream per tab: a new one closes the last (2026-10-17: each hot reload's fresh registry opened another and none
// closed — six open streams took every HTTP/1.1 connection to the host, and the owner's calls queued forever).
const OPEN = "__askkTeamStream"
export function connectTeam(onEvent, onError = () => {}) {
  globalThis[OPEN]?.close()
  if (local) {
    const off = local.subscribe(onEvent)
    globalThis[OPEN] = { close: off }
    return off
  }
  const source = new EventSource(withBase("/__askk/team/stream"))
  globalThis[OPEN] = source
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

// 2026-10-27 ask-answer: a call's error text from either shape — the team's {error: {message}} or a host-api route's
// {error: "<string>"} (companion/server/host-api.js:422) — so the page shows the reason, never a bare "Team call failed"
export function errorText(error) {
  if (typeof error === "string" && error.trim()) return error
  if (typeof error?.message === "string" && error.message.trim()) return error.message
  return "Team call failed"
}

export async function teamCall(target, method, args = []) {
  if (local) {
    const result = await local.call({ target, method, args })
    if (!result.ok) throw new Error(errorText(result.error))
    return result.value
  }
  const response = await fetch(withBase("/__askk/team/call"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, method, args }),
  })
  const result = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }))
  if (!result.ok) throw Object.assign(new Error(errorText(result.error)), { name: result.error?.name ?? "Error" })
  return result.value
}
