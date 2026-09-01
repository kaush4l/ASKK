import { Outcome, Reason } from '../Outcome.js'
import { Speaker } from './Speaker.js'

/**
 * `fp32`. Not the `q8` the speech-to-text side uses: a quantised vocoder is
 * audible — the artefacts land in the output waveform rather than in a
 * probability distribution that gets argmaxed anyway.
 *
 * A module constant and not a `static`, for the reason the transcriber's is: the
 * subclass that `static` existed to serve is gone. It stays separate from the
 * transcriber's constant of the same value because the two argue opposite facts
 * — that one says the runtime cannot build the quantised export, this one says
 * it can and you would hear it.
 */
const DEFAULT_DTYPE = 'fp32'

/**
 * The transformers.js half of text-to-speech: weights fetched once, run here,
 * samples handed back.
 *
 * Shared by every checkpoint the `text-to-speech` pipeline supports, so the
 * model id is a setting here exactly as it is for speech-to-text. The only place
 * two of these models genuinely disagree is the options they are called with,
 * and those arrive from the registry row that chose the checkpoint rather than
 * from a subclass per row.
 */
export class TransformersSpeaker extends Speaker {
  static LABEL = 'transformers.js text-to-speech'

  constructor(settings = {}) {
    super(settings)
    this.dtype = settings.dtype || DEFAULT_DTYPE
    this.device = settings.device || 'wasm'
    // The call options this checkpoint needs, supplied by the registry row that
    // chose the checkpoint. It answers an Outcome, not a record, because
    // supertonic can refuse: a style vector it cannot use is worth saying so
    // about before a 200 MB download, not after a reshape throws.
    this.options = settings.options ?? (() => Outcome.ok({}))
    this._pipeline = null
    this._loading = null
  }

  async load() {
    if (this._pipeline) return Outcome.ok(null)
    if (!this._loading) this._loading = this._build()
    const loaded = await this._loading
    if (!loaded.ok) this._loading = null
    return loaded
  }

  /**
   * Same fallback as the transcriber's, for the same measured reason: a
   * quantised export that this runtime cannot build is indistinguishable, from
   * the user's side, from a model id they got wrong. Full precision is the one
   * export every checkpoint publishes.
   */
  async _build(dtype = this.dtype) {
    const built = await Outcome.attempt(
      async () => {
        const { pipeline } = await import('@huggingface/transformers')
        this._pipeline = await pipeline('text-to-speech', this.model, {
          dtype,
          device: this.device,
          progress_callback: (event) => this.onProgress(event),
        })
        return null
      },
      {
        code: Reason.UNAVAILABLE,
        hint: `Check that "${this.model}" exists on the Hugging Face hub and has ONNX weights. The weights are downloaded on first use.`,
      },
    )
    if (built.ok || dtype === 'fp32') return built
    const retried = await this._build('fp32')
    return retried.ok
      ? retried.withNote(
          `"${this.model}" could not be built at ${dtype} (${built.failure.message.slice(0, 120)}); loaded at fp32 instead`,
        )
      : built
  }

  async synthesize(text) {
    const loaded = await this.load()
    if (!loaded.ok) return loaded
    const options = await this.options({ voice: this.voice })
    if (!options.ok) return options

    const spoken = await Outcome.attempt(() => this._pipeline(String(text), options.value), {
      code: Reason.INTERNAL,
      hint: 'The voice loaded but could not say this text.',
    })
    if (!spoken.ok) return spoken

    const result = Array.isArray(spoken.value) ? spoken.value[0] : spoken.value
    const samples = result?.audio
    if (!samples?.length) {
      // The model id and not `LABEL`: one class now runs every transformers
      // voice, so the label is the same string for supertonic and for mms-vits,
      // and this is the message where a user needs to know which one went quiet.
      return Outcome.failed(Reason.INTERNAL, `${this.model} produced no audio`, {
        hint: 'The model ran and returned an empty waveform. Try shorter text, or a different voice.',
      })
    }
    // `loaded.notes`, not `options.notes`. No row's `options` can produce a note
    // — the set of them is closed by the registry and every arm answers
    // `Outcome.ok(record)` — whereas `_build` writes one whenever it had to fall
    // back to fp32, and that is a bigger download the user is owed an account of.
    // It arrives once, because `load()` short-circuits after the first build.
    // `Transcriber.start` carries its own load's notes for the same reason.
    return Outcome.ok({ samples, sampleRate: result.sampling_rate ?? 16_000 }, loaded.notes)
  }

  async close() {
    await this._pipeline?.dispose?.()
    this._pipeline = null
    this._loading = null
  }
}
