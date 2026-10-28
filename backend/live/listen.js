// The composer mic (voice-in, 2026-10-27): which recognizer the page uses, and the host's one as a Dictation.
//
//   pickRecognizer({ hostSpeech, browser })   → { kind: "host" | "browser" | "off", supported, reason } (null: not known yet)
//       hostSpeech: the host has capability "speech" (backend/live/host.js); browser: speechSupport() (lib/speech/recognition.js)
//   new HostDictation({ onChange, onEnd })    the shape of lib/speech/dictation.js: start() · stop() (its text lands) · release()
//
// host: the page's mic (backend/hardware/speech/microphone.js, push mode) → the kernel's transcribeThrough
// (backend/kernel/builtin/speech.js) with this page's host — POST /__askk/speech/transcribe, any browser, macOS hosts only.
// browser: Safari's dictation. off: the reason, shown on the mic.

import { Microphone, pcmToBase64 } from "@/backend/hardware/speech/microphone"
import { transcribeThrough } from "@/backend/kernel/builtin/speech"
import { pageHost } from "@/backend/live/speak"

const join = (...parts) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")

function micReason(browser) {
  if (!browser.secure) return "Speech input needs a secure page (https or localhost)."
  if (!browser.microphone) return "This browser gives no microphone access."
  if (browser.permission === "denied") return "Microphone access is blocked for this site. Allow it in the browser's site settings."
  return null
}

export function pickRecognizer({ hostSpeech, browser }) {
  if (hostSpeech == null || !browser) return null
  if (hostSpeech) {
    const reason = micReason(browser)
    return reason ? { kind: "off", supported: false, reason } : { kind: "host", supported: true, reason: null }
  }
  if (browser.supported) return { kind: "browser", supported: true, reason: null }
  const reason = browser.secure && browser.browser !== "safari" ? "Speech input needs this desk's speech (a Mac host, capability speech) or Safari's dictation." : browser.reason
  return { kind: "off", supported: false, reason }
}

function micError(e) {
  if (e?.name === "NotAllowedError") return "Microphone access was denied."
  if (e?.name === "NotFoundError") return "No microphone was found."
  return e?.message ?? String(e)
}

export class HostDictation {
  #mic = null
  #listening = false
  #stopped = false
  #released = false
  #done = false
  #partialRun = false
  #committed = "" // text of the pieces already transcribed (a long take is cut at 55 s)
  #chain = Promise.resolve()

  constructor({ onChange, onStatus, onEnd, locale = null, host = pageHost, Mic = Microphone } = {}) {
    Object.assign(this, { onChange, onStatus, onEnd, locale, host, Mic })
  }

  get listening() {
    return this.#listening
  }

  get text() {
    return this.#committed
  }

  start() {
    if (this.#mic) return
    this.#listening = true
    const mic = new this.Mic({ onPartial: (pcm) => this.#partial(pcm), onUtterance: (pcm, { forced } = {}) => this.#piece(pcm, forced) })
    mic.mode = "push"
    this.#mic = mic
    mic.start().then(
      () => (this.#mic === mic && !this.#stopped ? mic.hold(true) : mic.stop()),
      (e) => this.#finish(micError(e)),
    )
  }

  // Stop listening: the take goes to the host, its text lands, then onEnd.
  stop() {
    if (this.#stopped) return
    this.#stopped = true
    this.#listening = false
    if (this.#mic?.recording) this.#mic.hold(false)
    else this.#chain.then(() => this.#finish(null), (e) => this.#finish(e?.message ?? String(e)))
  }

  // Stop at once; no more callbacks.
  release() {
    this.#released = this.#stopped = true
    this.#listening = false
    this.#mic?.stop()
    this.#mic = null
  }

  #piece(pcm, forced) {
    const audio = pcmToBase64(pcm)
    this.#chain = this.#chain.then(async () => {
      const { text } = await transcribeThrough(this.host, { audio, locale: this.locale })
      this.#committed = join(this.#committed, text)
      if (!this.#released) this.onChange?.(this.#committed)
    })
    this.#chain.catch(() => {}) // a forced piece's failure is reported when the take ends
    if (!forced) this.#chain.then(() => this.#finish(null), (e) => this.#finish(e?.message ?? String(e)))
  }

  // Live text: the audio so far, never queued (the next one carries newer audio); its failure waits for the final.
  async #partial(pcm) {
    if (this.#partialRun || this.#stopped) return
    this.#partialRun = true
    try {
      const { text } = await transcribeThrough(this.host, { audio: pcmToBase64(pcm), locale: this.locale })
      if (!this.#stopped) this.onChange?.(join(this.#committed, text))
    } catch {
      // the final transcription says what failed
    } finally {
      this.#partialRun = false
    }
  }

  #finish(error) {
    if (this.#done) return
    this.#done = true
    this.#mic?.stop()
    this.#mic = null
    this.#listening = false
    if (!this.#released) this.onEnd?.({ text: this.#committed, error })
  }
}
