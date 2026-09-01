import { Outcome, Reason } from '../Outcome.js'

/**
 * Abstract text-to-speech. One subclass per way of turning words into sound.
 *
 * The split here is the mirror of the one in `Transcriber`, and it exists for
 * the same reason: the browser's own voice and a model in a worker do not
 * produce the same *kind* of thing. `speechSynthesis` produces an event —
 * it speaks, through the operating system's own audio path, and hands the
 * caller nothing. A model produces samples, in a worker, with no way to play
 * them.
 *
 * So there are two verbs and one of them is universal:
 *
 *     synthesize(text) -> { samples, sampleRate }   data, where there is data
 *     speak(text)      -> it was said                the verb a caller uses
 *
 * `speak` is implemented once, here, as synthesize-then-hand-to-`onAudio`, and
 * the native voice overrides it. A caller therefore says `speak` and never asks
 * which one it is holding — while anything that genuinely needs the waveform,
 * to save it or to draw it, asks for `synthesize` and is told plainly when the
 * chosen voice has none to give.
 */
export class Speaker {
  /** Stable name for messages. NOT `constructor.name` — the production bundle renames classes. */
  static LABEL = 'speaker'

  /** Whether this voice plays its own audio rather than returning samples. */
  static OWNS_OUTPUT = false

  /** What the user gets if they name no model. Empty where there is nothing to download. */
  static DEFAULT_MODEL = ''

  constructor({ model = '', voice = '', rate = 1, pitch = 1 } = {}) {
    this.model = model || new.target.DEFAULT_MODEL
    this.voice = voice
    this.rate = rate
    this.pitch = pitch
  }

  /** Model-download progress, in transformers.js's own event shape. */
  onProgress(_event) {}

  /** Where synthesized samples go when `speak` is used. Supplied by the realm that can play them. */
  onAudio(_audio) {}

  /** Fetch whatever this voice needs. Nothing to load is a success, not a special case. */
  async load() {
    return Outcome.ok(null)
  }

  /**
   * @param {string} _text
   * @returns {Promise<Outcome>} value is `{ samples: Float32Array, sampleRate: number }`
   */
  async synthesize(_text) {
    return Outcome.failed(
      Reason.NOT_IMPLEMENTED,
      `${this.constructor.LABEL} does not produce audio data`,
      {
        hint: 'This voice plays through the operating system. Choose a local model to get samples.',
      },
    )
  }

  /** Say it. The verb every caller uses, whichever engine is underneath. */
  async speak(text) {
    const said = String(text ?? '').trim()
    if (!said) return Outcome.ok(null)
    const audio = await this.synthesize(said)
    if (!audio.ok) return audio
    this.onAudio(audio.value)
    return Outcome.ok(null, audio.notes)
  }

  /** Stop mid-sentence. */
  async stop() {
    return Outcome.ok(null)
  }

  /** Release weights and any device they were loaded onto. */
  async close() {}
}
