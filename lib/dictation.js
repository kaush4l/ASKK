// Dictation: live transcription (speech.js) with periodic punctuation and
// grammar correction by the default model (single-call punctuator).
//
//   const d = new Dictation({ onChange, onStatus, onEnd })
//   d.start() · d.stop() (finish; final correction runs) · d.release() (drop)
//   onChange(text)                     display text: corrected + newest words
//   onStatus({ correcting, error })    correction progress
//   onEnd({ text, error })             after stop and the final correction
//
// After each pause in speech the whole final transcript is corrected, while
// listening goes on. A correction applies to the text it was made from;
// words spoken since are appended uncorrected until the next pause. A reply
// that changes the words too much (the model answered instead of correcting)
// is ignored.

import { resolveModel } from "@/backend/models/catalog"
import { createPunctuator } from "@/backend/core/single-call"
import { LiveTranscriber } from "@/lib/speech"

const PAUSE_MS = 1200 // correct after this long without new final words
const MIN_SIMILARITY = 0.8 // share of words a correction must keep

const join = (...parts) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)

// Longest common subsequence of words over the longer length (0..1).
function similarity(a, b) {
  const x = words(a)
  const y = words(b)
  if (!x.length || !y.length) return x.length === y.length ? 1 : 0
  let prev = new Array(y.length + 1).fill(0)
  for (const word of x) {
    const row = [0]
    for (let j = 1; j <= y.length; j++) row[j] = word === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    prev = row
  }
  return prev[y.length] / Math.max(x.length, y.length)
}

export class Dictation {
  #transcriber = null
  #punctuator = createPunctuator()
  #final = ""
  #interim = ""
  #fix = null // { source, text }: the correction of final text `source`
  #timer = null
  #pending = null // { controller, done } of the running correction
  #again = false
  #released = false
  #error = null

  constructor({ onChange, onStatus, onEnd } = {}) {
    this.onChange = onChange
    this.onStatus = onStatus
    this.onEnd = onEnd
  }

  get listening() {
    return !!this.#transcriber?.listening
  }

  get text() {
    return join(this.#correctedFinal(), this.#interim)
  }

  #correctedFinal() {
    const fix = this.#fix
    if (fix && this.#final.startsWith(fix.source)) return join(fix.text, this.#final.slice(fix.source.length))
    return this.#final
  }

  start() {
    this.#transcriber = new LiveTranscriber({
      onChange: ({ final, interim }) => {
        if (this.#released) return
        const grew = final !== this.#final
        this.#final = final
        this.#interim = interim
        this.onChange?.(this.text)
        if (grew) this.#schedule()
      },
      onEnd: ({ error }) => this.#finish(error),
    })
    this.#transcriber.start()
  }

  stop() {
    this.#transcriber?.stop()
  }

  // Stop at once; no more callbacks.
  release() {
    this.#released = true
    clearTimeout(this.#timer)
    this.#pending?.controller.abort()
    this.#transcriber?.abort()
  }

  #schedule() {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#correct(), PAUSE_MS)
  }

  #status(correcting) {
    if (!this.#released) this.onStatus?.({ correcting, error: this.#error })
  }

  async #correct() {
    if (this.#released) return
    if (this.#pending) {
      this.#again = true
      return this.#pending.done
    }
    const source = this.#final
    const model = resolveModel()
    if (!source || this.#fix?.source === source || !model) return

    const controller = new AbortController()
    const run = async () => {
      this.#status(true)
      try {
        const { parsed } = await this.#punctuator.call(source, { model, signal: controller.signal })
        const text = String(parsed.response ?? "").trim()
        if (text && similarity(source, text) >= MIN_SIMILARITY) this.#fix = { source, text }
        this.#error = null
      } catch (error) {
        if (error.name === "AbortError") return
        this.#error = `Auto-punctuation failed: ${error.message}`
      } finally {
        this.#pending = null
        this.#status(false)
      }
      if (this.#released) return
      this.onChange?.(this.text)
      if (this.#again) {
        this.#again = false
        await this.#correct()
      }
    }
    this.#pending = { controller, done: run() }
    return this.#pending.done
  }

  // Listening ended: make the final correction, then report.
  async #finish(error) {
    clearTimeout(this.#timer)
    if (this.#released) return
    this.#interim = ""
    await this.#pending?.done
    await this.#correct()
    if (this.#released) return
    this.onEnd?.({ text: this.text, error })
  }
}
