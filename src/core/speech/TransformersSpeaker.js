import { Outcome, Reason } from '../Outcome.js'
import { Speaker } from './Speaker.js'

/**
 * The transformers.js half of text-to-speech: weights fetched once, run here,
 * samples handed back.
 *
 * Shared by every checkpoint the `text-to-speech` pipeline supports, so the
 * model id is a setting here exactly as it is for speech-to-text. What the two
 * subclasses below differ by is one method — the options the checkpoint is
 * called with — because that is genuinely the only place two of these models
 * disagree.
 */
export class TransformersSpeaker extends Speaker {
  static LABEL = 'transformers.js text-to-speech'
  static DEFAULT_MODEL = ''

  /**
   * `fp32`. Not the `q8` the speech-to-text side uses: a quantised vocoder is
   * audible — the artefacts land in the output waveform rather than in a
   * probability distribution that gets argmaxed anyway.
   */
  static DEFAULT_DTYPE = 'fp32'

  constructor(settings = {}) {
    super(settings)
    this.dtype = settings.dtype || new.target.DEFAULT_DTYPE
    this.device = settings.device || 'wasm'
    this._pipeline = null
    this._loading = null
  }

  /** Call options this checkpoint needs. The one thing the subclasses differ by. */
  async options() {
    return Outcome.ok({})
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
    const options = await this.options()
    if (!options.ok) return options

    const spoken = await Outcome.attempt(() => this._pipeline(String(text), options.value), {
      code: Reason.INTERNAL,
      hint: 'The voice loaded but could not say this text.',
    })
    if (!spoken.ok) return spoken

    const result = Array.isArray(spoken.value) ? spoken.value[0] : spoken.value
    const samples = result?.audio
    if (!samples?.length) {
      return Outcome.failed(Reason.INTERNAL, `${this.constructor.LABEL} produced no audio`, {
        hint: 'The model ran and returned an empty waveform. Try shorter text, or a different voice.',
      })
    }
    return Outcome.ok({ samples, sampleRate: result.sampling_rate ?? 16_000 }, options.notes)
  }

  async close() {
    await this._pipeline?.dispose?.()
    this._pipeline = null
    this._loading = null
  }
}
