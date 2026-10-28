import { Tool } from "../tool/tool.js"

// speech.say: an answer spoken through the host's existing POST speech/say {text, voice?, rate?} → {audio, type} (base64
// WAV from `say`; companion/server/host-api.js registers it only when hardware speech loads, macOS). No new host route
// (goal ledger l5). Off macOS the route is absent (404) or refused (501): both become one clear 501-style error, and
// HOST_CAPABILITIES "speech" (backend/live/host.js) tells the UI the speaker is off there.
//
// sayThrough(host, input) → {audio, type, chars}: the speaker button's call; the tool's run answers the agent in one line
// (the audio itself never enters a prompt).
// transcribeThrough(host, {audio, locale?}) → {text, seconds, ms} (voice-in, 2026-10-27): the composer mic's call to the
// existing POST speech/transcribe (base64 16 kHz mono PCM); 404/501 → the same clear 501 error.

const MAX_CHARS = 4000 // one answer; longer text is cut, and the result says so

const msg = (e) => String(e?.message ?? e)
const statusOf = (e) => Number(e?.status ?? msg(e).match(/HTTP (\d{3})/)?.[1] ?? 0)

export class SpeechUnavailable extends Error {
  constructor(detail, tool = "speech.say") {
    const what = tool === "speech.say" ? "the host's `say`" : "the host's recognizer"
    super(`${tool}: 501 no speech on this host (macOS only: ${what}, capability speech) — ${detail}`)
    this.status = 501
  }
}

export async function sayThrough(host, input = {}, signal) {
  if (!host?.post) throw new Error("speech.say: no host here (ctx.host) — the desk server speaks")
  const whole = String(input.text ?? "").trim()
  if (!whole) throw new Error("text: what to say")
  const text = whole.slice(0, MAX_CHARS)
  const body = { text, ...(input.voice ? { voice: String(input.voice) } : {}), ...(input.rate ? { rate: Number(input.rate) } : {}) }
  let out
  try {
    out = await host.post("speech/say", body, signal)
  } catch (e) {
    const s = statusOf(e)
    if (s === 404 || s === 501) throw new SpeechUnavailable(s === 404 ? "the route speech/say is absent" : msg(e))
    throw new Error(`speech.say: ${msg(e)}`)
  }
  if (!out?.audio) throw new Error("speech.say: the host answered without audio")
  return { audio: out.audio, type: out.type ?? "audio/wav", chars: text.length, cut: whole.length > text.length }
}

export async function transcribeThrough(host, input = {}, signal) {
  if (!host?.post) throw new Error("speech.transcribe: no host here (ctx.host) — the desk server transcribes")
  const audio = String(input.audio ?? "")
  if (!audio) throw new Error("audio: base64 16 kHz mono PCM")
  const body = { audio, ...(input.locale ? { locale: String(input.locale) } : {}) }
  let out
  try {
    out = await host.post("speech/transcribe", body, signal)
  } catch (e) {
    const s = statusOf(e)
    if (s === 404 || s === 501) throw new SpeechUnavailable(s === 404 ? "the route speech/transcribe is absent" : msg(e), "speech.transcribe")
    throw new Error(`speech.transcribe: ${msg(e)}`)
  }
  if (typeof out?.text !== "string") throw new Error("speech.transcribe: the host answered without text")
  return { text: out.text.trim(), seconds: out.seconds ?? null, ms: out.ms ?? null }
}

export function speechSayTool() {
  return new Tool({
    name: "speech.say",
    description: "speak a text aloud through the host (macOS `say`): the owner hears it. Off macOS: a 501 error (no speech there)",
    input: { text: "what to say", voice: "a voice name (optional)", rate: "words per minute (optional)" },
    run: async (input = {}, ctx = {}) => {
      const { audio, type, chars, cut } = await sayThrough(ctx.host, input, ctx.signal)
      const kb = Math.round((audio.length * 3) / 4 / 1024)
      return `spoke ${chars} chars (${type}, ${kb} KB)${cut ? ` — cut at ${MAX_CHARS} chars` : ""}`
    },
  })
}

export const SPEECH_TOOLS = { "speech.say": speechSayTool }
