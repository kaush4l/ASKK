// The speaker on an answer (voice-out, 2026-10-27): the kernel's sayThrough (backend/kernel/builtin/speech.js) with this
// page's host — the same-origin POST /__askk/speech/say (companion/server/host-api.js, macOS only) — and the WAV it
// answers played in the page. Off macOS the route is absent or 501: sayThrough's one clear error; HOST_CAPABILITIES
// "speech" keeps the button off there (components/agents/speak-button.jsx).
//
//   await playAnswer(text, { signal, onPlay })   resolves when it has played (or was stopped through signal)

import { withBase } from "@/backend/live/base-path"
import { sayThrough } from "@/backend/kernel/builtin/speech"

const API = withBase("/__askk/")

// The host as the kernel sees it (ctx.host's post): a non-2xx answer throws with its status, as hostClient does.
export const pageHost = {
  post: async (path, body, signal) => {
    let res
    try {
      res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })
    } catch (e) {
      if (e?.name === "AbortError") throw e
      throw new Error(`POST ${path}: the desk server is not reachable`)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw Object.assign(new Error(`POST ${path}: HTTP ${res.status} ${data?.error ?? ""}`.trim()), { status: res.status })
    return data
  },
}

export async function playAnswer(text, { signal, onPlay } = {}) {
  const { audio, type } = await sayThrough(pageHost, { text }, signal)
  if (signal?.aborted) return
  const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const el = new Audio(url)
  try {
    await new Promise((resolve, reject) => {
      el.onended = resolve
      el.onerror = () => reject(new Error("the browser could not play the voice's audio"))
      signal?.addEventListener("abort", () => (el.pause(), resolve()), { once: true })
      el.play().then(onPlay, (error) => reject(new Error(`the browser did not play the voice (${error.name}): click the speaker again`)))
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
