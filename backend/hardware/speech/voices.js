// Voices (TTS): text → speech, one sentence at a time so speaking starts
// fast and can stop between sentences.
//
//   browser — speechSynthesis with the system's voices (on a Mac: the same
//             on-device voices); word boundaries drive the caption.
//   mac     — the host's tts model (POST speech/say → WAV: `say` by default, Kokoro, Qwen3-TTS … from the models folder), played through an
//             analyser, so the visual moves with the real voice. The next
//             sentence renders while this one plays.
//
//   const voice = createVoice("mac", { name, rate })
//   await voice.speak(text, { onSentence, onWord })   resolves when done or cancelled
//   voice.cancel() · voice.level() (0..1, or null when unknown) · voice.speaking

import { hostGet, hostPost } from "@/backend/hardware/speech/recognizers"
import { LIMITS } from "@/lib/config"

// Sentences, short enough to start fast (Chrome also cuts long utterances).
function sentences(text) {
  const parts = text.match(/[^.!?;:\n]+(?:[.!?;:]+|\n+|$)/g) ?? [text]
  const out = []
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (out.length && (out.at(-1).length < LIMITS.voices.minSentenceChars || part.length < LIMITS.voices.minPartChars)) out[out.length - 1] += ` ${part}`
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

// A short silent WAV: played inside the click, it unlocks the page's audio element for the sentences that come later
// (Safari plays an element only after a gesture-started play()).
function silentWav(samples = 2400, rate = 24000) {
  const b = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(b)
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF"), v.setUint32(4, 36 + samples * 2, true), text(8, "WAVEfmt "), v.setUint32(16, 16, true), v.setUint16(20, 1, true)
  v.setUint16(22, 1, true), v.setUint32(24, rate, true), v.setUint32(28, rate * 2, true), v.setUint16(32, 2, true), v.setUint16(34, 16, true)
  text(36, "data"), v.setUint32(40, samples * 2, true)
  return new Blob([b], { type: "audio/wav" })
}

// 2026-10-24 (owner: "Kokoro test the voice is not working" — on the Mac's Safari): Web Audio first (its analyser moves
// the visual); when the page's AudioContext is not running after a resume — Safari leaves it "suspended" or
// "interrupted", and a resume outside a gesture never settles — the sentences play through an audio element unlocked in
// the click instead, so the voice is heard either way.
class MacVoice {
  id = "mac"
  speaking = false
  #token = 0
  #context = null
  #analyser = null
  #source = null
  #bins = null
  #element = null
  #unlocked = false
  #web = true

  constructor({ name = null, rate = null } = {}) {
    this.name = name
    this.rate = rate
  }

  #audio() {
    if (!this.#context || this.#context.state === "closed") {
      this.#context = new AudioContext()
      this.#analyser = this.#context.createAnalyser()
      this.#analyser.fftSize = LIMITS.voices.fftSize
      this.#analyser.connect(this.#context.destination)
      this.#bins = new Uint8Array(this.#analyser.frequencyBinCount)
    }
    return this.#context
  }

  // The audio element, unlocked once inside the click (a silent play()).
  #player() {
    if (!this.#element && typeof Audio !== "undefined") this.#element = new Audio()
    if (this.#element && !this.#unlocked) {
      this.#unlocked = true
      const url = URL.createObjectURL(silentWav())
      this.#element.src = url
      this.#element.play().catch(() => {}).finally(() => URL.revokeObjectURL(url))
    }
    return this.#element
  }

  level() {
    if (!this.speaking) return 0
    if (!this.#web || !this.#analyser) return null // the element's sound is not measured
    this.#analyser.getByteFrequencyData(this.#bins)
    let sum = 0
    for (const b of this.#bins) sum += b
    return Math.min(1, sum / this.#bins.length / LIMITS.voices.levelScale)
  }

  async #render(sentence) {
    // no name or rate: the host's tts model speaks with its own values (models/tts/<name>/model.md)
    const { audio } = await hostPost("speech/say", { text: sentence, ...(this.name ? { voice: this.name } : {}), ...(this.rate ? { rate: Math.round(LIMITS.voices.sayWordsPerMinute * this.rate) } : {}) })
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
    return this.#web ? this.#audio().decodeAudioData(bytes.buffer) : new Blob([bytes], { type: "audio/wav" })
  }

  // One sentence: a decoded buffer through the analyser, or a WAV through the element. Resolves when it ends.
  #play(sound) {
    return new Promise((resolve, reject) => {
      if (this.#web) {
        const source = this.#audio().createBufferSource()
        source.buffer = sound
        source.connect(this.#analyser)
        source.onended = resolve
        this.#source = source
        source.start()
        return
      }
      const el = this.#element
      const url = URL.createObjectURL(sound)
      const done = () => (URL.revokeObjectURL(url), (el.onended = el.onpause = el.onerror = null), resolve())
      el.onended = el.onpause = done
      el.onerror = () => (URL.revokeObjectURL(url), reject(new Error("the browser could not play the voice's audio")))
      el.src = url
      el.play().catch((error) => (URL.revokeObjectURL(url), reject(new Error(`the browser did not play the voice (${error.name}): click Test the voice again`))))
    })
  }

  async speak(text, { onSentence } = {}) {
    const token = ++this.#token
    // both started inside the click: the context's resume and the element's unlock
    const context = this.#audio()
    this.#player()
    if (context.state !== "running") await Promise.race([context.resume().catch(() => {}), new Promise((r) => setTimeout(r, 800))])
    this.#web = context.state === "running" || !this.#element
    this.speaking = true
    try {
      const parts = sentences(text)
      let next = parts.length ? this.#render(parts[0]) : null
      for (let i = 0; i < parts.length; i++) {
        const sound = await next
        next = i + 1 < parts.length ? this.#render(parts[i + 1]) : null
        next?.catch(() => {})
        if (token !== this.#token) return
        onSentence?.(parts[i])
        await this.#play(sound)
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
    if (this.#element && !this.#element.paused) this.#element.pause()
  }

  // A voice dropped (the model panel changed it): its AudioContext closed, so contexts never pile up.
  dispose() {
    this.cancel()
    this.#context?.close?.().catch(() => {})
    this.#context = null
  }
}

export function createVoice(id, options) {
  return id === "mac" ? new MacVoice(options) : new BrowserVoice(options)
}

export const browserVoices = () => (typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices())
export const macVoices = async () => (await hostGet("speech/voices")).voices ?? []
