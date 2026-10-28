// The speaker on an answer (voice-out, 2026-10-27; components/agents/speak-button.jsx): what it shows per state, pure.
//   speech: the host's capability "speech" (HOST_CAPABILITIES, backend/live/host.js) — true, false (off: not macOS), null (not known yet)
//   state:  idle | loading (the host makes the voice) | playing | failed (error: why)
// → { icon: speak | busy | stop | off, disabled, label, title, line: the short failure under the answer, or null }
// 2026-10-27 speak-polish: speakText speaks only an answer's VERDICT (the whole text when it has none); a failure is one
// short line (failLine), the full error stays in title.

import { parseReport } from "../../backend/kernel/agent/report.js"

export function speakText(text) {
  const verdict = parseReport(text).VERDICT?.trim()
  return verdict || String(text ?? "").trim()
}

export function failLine(error) {
  const e = String(error ?? "unknown error")
  const http = /HTTP (\d{3})/.exec(e)
  if (http) return `Not spoken (HTTP ${http[1]})`
  const last = e.split(": ").pop().trim() || "unknown error"
  return `Not spoken: ${last.length > 40 ? `${last.slice(0, 39)}…` : last}`
}

export function speakLook({ state = "idle", speech = null, error = null } = {}) {
  return { line: state === "failed" ? failLine(error) : null, ...lookOf({ state, speech, error }) }
}

function lookOf({ state, speech, error }) {
  if (speech === false) return { icon: "off", disabled: true, label: "Speech is off on this host", title: "No speech on this host: macOS only (the host's `say`, capability speech)" }
  if (state === "loading") return { icon: "busy", disabled: false, label: "Stop: the voice is being made", title: "The host makes the voice… click to stop" }
  if (state === "playing") return { icon: "stop", disabled: false, label: "Stop speaking", title: "Speaking the answer… click to stop" }
  if (state === "failed") return { icon: "speak", disabled: false, label: "Speak the answer again", title: `Not spoken: ${error ?? "unknown error"}` }
  return { icon: "speak", disabled: speech !== true, label: "Speak the answer", title: speech === true ? "Hear this answer (the host's voice)" : "Checking whether this host speaks…" }
}
