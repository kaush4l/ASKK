// Voices (TTS): text → speech, one sentence at a time so speaking starts
// fast and can stop between sentences.
//
//   browser — speechSynthesis with the system's voices (on a Mac: the same
//             on-device voices); word boundaries drive the caption.
//   mac     — the host's `say` (POST speech/say → WAV), played through an
//             analyser, so the visual moves with the real voice. The next
//             sentence renders while this one plays.
//
//   const voice = createVoice("mac", { name, rate })
//   await voice.speak(text, { onSentence, onWord })   resolves when done or cancelled
//   voice.cancel() · voice.level() (0..1, or null when unknown) · voice.speaking

import { hostGet, hostPost } from "@/backend/hardware/speech/recognizers"

// Sentences, short enough to start fast (Chrome also cuts long utterances).
export function sentences(text) {
  const parts = text.match(/[^.!?;:\n]+(?:[.!?;:]+|\n+|$)/g) ?? [text]
  const out = []
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (out.length && (out.at(-1).length < 40 || part.length < 12)) out[out.length - 1] += ` ${part}`
    else out.push(part)
  }
  return out
}

// Markdown and symbols → what reads well aloud.
export function speakable(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " (code on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s*\|.*\|\s*$/gm, "") // tables are for the screen
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1: ")
    .replace(/[*_~>]+/g, "")
    .replace(/•+\s*(\d{4})/g, "ending $1")
    .replace(/→/g, " to ")
    .replace(/≥/g, " at least ")
    .replace(/≤/g, " at most ")
    .replace(/\s+·\s+/g, ", ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
}

class BrowserVoice {
  id = "browser"
  speaking = false
  #token = 0

  constructor({ name = null, rate = 1 } = {}) {
    this.name = name
    this.rate = rate
  }

  level() {
    return null // speechSynthesis gives no audio to measure
  }

  async speak(text, { onSentence, onWord } = {}) {
    if (typeof speechSynthesis === "undefined") throw new Error("This browser has no speech output.")
    const token = ++this.#token
    this.speaking = true
    const voice = browserVoices().find((v) => v.name === this.name) ?? null
    try {
      for (const sentence of sentences(text)) {
        if (token !== this.#token) return
        onSentence?.(sentence)
        await new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(sentence)
          if (voice) u.voice = voice
          u.rate = this.rate
          u.onboundary = (e) => e.name === "word" && onWord?.(e.charIndex)
          u.onend = u.onerror = () => resolve()
          speechSynthesis.speak(u)
        })
      }
    } finally {
      if (token === this.#token) this.speaking = false
    }
  }

  cancel() {
    this.#token++
    this.speaking = false
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
  }
}

class MacVoice {
  id = "mac"
  speaking = false
  #token = 0
  #context = null
  #analyser = null
  #source = null
  #bins = null

  constructor({ name = null, rate = 1 } = {}) {
    this.name = name
    this.rate = rate
  }

  #audio() {
    if (!this.#context) {
      this.#context = new AudioContext()
      this.#analyser = this.#context.createAnalyser()
      this.#analyser.fftSize = 256
      this.#analyser.connect(this.#context.destination)
      this.#bins = new Uint8Array(this.#analyser.frequencyBinCount)
    }
    return this.#context
  }

  level() {
    if (!this.#analyser || !this.speaking) return 0
    this.#analyser.getByteFrequencyData(this.#bins)
    let sum = 0
    for (const b of this.#bins) sum += b
    return Math.min(1, sum / this.#bins.length / 90)
  }

  async #render(sentence) {
    const { audio } = await hostPost("speech/say", { text: sentence, voice: this.name || undefined, rate: Math.round(185 * this.rate) })
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
    return this.#audio().decodeAudioData(bytes.buffer)
  }

  async speak(text, { onSentence } = {}) {
    const token = ++this.#token
    const context = this.#audio()
    if (context.state === "suspended") await context.resume()
    this.speaking = true
    try {
      const parts = sentences(text)
      let next = parts.length ? this.#render(parts[0]) : null
      for (let i = 0; i < parts.length; i++) {
        const buffer = await next
        next = i + 1 < parts.length ? this.#render(parts[i + 1]) : null
        next?.catch(() => {})
        if (token !== this.#token) return
        onSentence?.(parts[i])
        await new Promise((resolve) => {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(this.#analyser)
          source.onended = resolve
          this.#source = source
          source.start()
        })
      }
    } finally {
      if (token === this.#token) this.speaking = false
    }
  }

  cancel() {
    this.#token++
    this.speaking = false
    try {
      this.#source?.stop()
    } catch {}
    this.#source = null
  }
}

export function createVoice(id, options) {
  return id === "mac" ? new MacVoice(options) : new BrowserVoice(options)
}

export const browserVoices = () => (typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices())
export const macVoices = async () => (await hostGet("speech/voices")).voices ?? []
