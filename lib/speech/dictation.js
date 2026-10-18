// Dictation: live transcription (recognition.js) into the message box.
//
//   const d = new Dictation({ onChange, onStatus, onEnd })
//   d.start() · d.stop() (finish) · d.release() (drop)
//   onChange(text)                     display text: final words + the newest interim words
//   onStatus({ correcting, error })    kept for the hook's shape; there is no correction pass
//   onEnd({ text, error })             after stop
//
// The text is what the browser's recognizer heard. (A punctuation pass by the browser engines' default model went
// with the browser engines on 2026-10-15; the desk's models run on the server.)

import { LiveTranscriber } from "@/lib/speech/recognition"

const join = (...parts) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")

export class Dictation {
  #transcriber = null
  #final = ""
  #interim = ""
  #released = false

  constructor({ onChange, onStatus, onEnd } = {}) {
    this.onChange = onChange
    this.onStatus = onStatus
    this.onEnd = onEnd
  }

  get listening() {
    return !!this.#transcriber?.listening
  }

  get text() {
    return join(this.#final, this.#interim)
  }

  start() {
    this.#transcriber = new LiveTranscriber({
      onChange: ({ final, interim }) => {
        if (this.#released) return
        this.#final = final
        this.#interim = interim
        this.onChange?.(this.text)
      },
      onEnd: ({ error }) => {
        if (this.#released) return
        this.#interim = ""
        this.onEnd?.({ text: this.text, error })
      },
    })
    this.#transcriber.start()
  }

  stop() {
    this.#transcriber?.stop()
  }

  // Stop at once; no more callbacks.
  release() {
    this.#released = true
    this.#transcriber?.abort()
  }
}
