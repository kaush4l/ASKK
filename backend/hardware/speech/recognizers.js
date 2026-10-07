// Speech recognizers (ASR): speech → text.
//
//   mac     — the host's on-device recognizer (Apple SpeechAnalyzer, host
//             capability `speech`): the page's own mic (microphone.js) cuts
//             utterances, each goes to POST speech/transcribe as PCM. Any
//             browser; live text by re-reading the audio so far.
//   safari  — WebKit's SpeechRecognition (Apple dictation, lib/speech.js),
//             when there is no host: it listens itself; an utterance ends
//             after a pause with no new words.

import { withBase } from "@/backend/platform/base-path"
import { pcmToBase64 } from "@/backend/hardware/speech/microphone"
import { LiveTranscriber } from "@/lib/speech"

const API = withBase("/__askk/")

export async function hostPost(endpoint, body, signal) {
  let response
  try {
    response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error.name === "AbortError") throw error
    throw new Error("The ASKK host is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Host request failed (${response.status}).`)
  return data
}

export async function hostGet(endpoint) {
  const response = await fetch(`${API}${endpoint}`, { cache: "no-store" })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Host request failed (${response.status}).`)
  return data
}

// The Mac's recognizer. Partials never queue: one asked for while another
// runs is skipped (the next one carries newer audio anyway).
export class MacRecognizer {
  id = "mac"
  #partial = null

  constructor({ locale = "en-US" } = {}) {
    this.locale = locale
  }

  // Full text of one utterance: { text, seconds, ms }.
  final(pcm) {
    return hostPost("speech/transcribe", { audio: pcmToBase64(pcm), locale: this.locale })
  }

  // Text of the audio so far, or null when one is still running.
  async partial(pcm) {
    if (this.#partial) return null
    this.#partial = hostPost("speech/transcribe", { audio: pcmToBase64(pcm), locale: this.locale })
    try {
      return await this.#partial
    } finally {
      this.#partial = null
    }
  }
}

// Safari's dictation as an utterance source (it listens itself).
export class SafariRecognizer {
  id = "safari"
  #transcriber = null
  #timer = null
  #text = ""
  #consumed = 0 // characters of the transcriber's running text already used
  #paused = false

  // onSpeechStart(), onPartial(text) while words come, onUtterance(text)
  // after a pause, onError(message) when it stops for good.
  constructor({ locale = "en-US", pauseMs = 1100, onPartial, onUtterance, onSpeechStart, onError } = {}) {
    Object.assign(this, { locale, pauseMs, onPartial, onUtterance, onSpeechStart, onError })
  }

  start() {
    if (this.#transcriber) return
    this.#text = ""
    this.#consumed = 0
    const transcriber = new LiveTranscriber({
      lang: this.locale,
      onChange: ({ text }) => {
        if (this.#paused || transcriber !== this.#transcriber) return
        const fresh = text.slice(this.#consumed).trim()
        if (!fresh) return
        if (!this.#text) this.onSpeechStart?.()
        this.#text = fresh
        this.onPartial?.(fresh)
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => this.#flush(text), this.pauseMs)
      },
      onEnd: ({ error }) => {
        if (transcriber !== this.#transcriber) return
        this.#transcriber = null
        if (error) this.onError?.(error)
      },
    })
    this.#transcriber = transcriber
    transcriber.start()
  }

  #flush(all) {
    const text = this.#text
    this.#text = ""
    this.#consumed = all.length
    if (text) this.onUtterance?.(text)
  }

  // While the voice speaks back, the words heard are its echo: skip them.
  pause(paused) {
    this.#paused = paused
    clearTimeout(this.#timer)
    this.#text = ""
    this.#consumed = this.#transcriber?.text.length ?? 0
  }

  stop() {
    clearTimeout(this.#timer)
    const transcriber = this.#transcriber
    this.#transcriber = null
    transcriber?.abort()
  }
}
