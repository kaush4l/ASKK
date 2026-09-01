import { Outcome, Reason } from '../Outcome.js'
import { MODEL_SAMPLE_RATE } from './audio.js'
import { Transcriber } from './Transcriber.js'

/**
 * The transformers.js half of speech-to-text: weights fetched once, run here,
 * no endpoint and no key.
 *
 * Shared by every model this app can be pointed at, because from this side they
 * differ only in what they are handed and what they will accept — the loading,
 * the progress reporting, the single-flight guard and the failure vocabulary are
 * the same for all of them. Which is why the model id is a *setting*: any
 * checkpoint the `automatic-speech-recognition` pipeline supports can be typed
 * into the box, and the two subclasses below exist only where a model needs
 * different call options, not because it needs a different loader.
 *
 * The import is dynamic for the reason it is dynamic everywhere in this tree: a
 * static one drags tens of megabytes of runtime into the initial chunk of a page
 * that may never dictate, and — measured — pulls native binaries into the Node
 * process that runs the static prerender.
 */
export class TransformersTranscriber extends Transcriber {
  static LABEL = 'transformers.js speech-to-text'
  static DEFAULT_MODEL = ''

  /**
   * Full precision, which is three times the download of the quantised export
   * and is not a preference.
   *
   * Measured in a browser on this tree, against transformers.js 4.2.0 and the
   * onnxruntime-web it carries: `onnx-community/whisper-base`,
   * `Xenova/whisper-tiny.en` and `onnx-community/moonshine-base-ONNX` all fetch
   * their `*_quantized.onnx` files successfully and then fail to build a session
   * — `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required
   * scale`. The same three checkpoints load at `fp32`. The quantised exports are
   * newer than the runtime that has to read them.
   *
   * It is a setting, so a machine with a runtime that can read them says so
   * once. The default is the one that works.
   */
  static DEFAULT_DTYPE = 'fp32'

  constructor(settings = {}) {
    super(settings)
    this.dtype = settings.dtype || new.target.DEFAULT_DTYPE
    // Not webgpu. The encoder of every model here falls back to wasm for at
    // least one operator, and a device that is requested and unavailable fails
    // the load rather than degrading — which would cost the user the whole
    // download to find out. `webgpu` remains a setting for a machine known to
    // have it.
    this.device = settings.device || 'wasm'
    this._pipeline = null
    this._loading = null
  }

  /** Call options this checkpoint needs. The one thing the subclasses differ by. */
  options(_seconds) {
    return {}
  }

  async load() {
    if (this._pipeline) return Outcome.ok(null)
    // Two dictations started at once must share one download rather than
    // starting two of the same gigabyte.
    if (!this._loading) this._loading = this._build()
    const loaded = await this._loading
    // A failed load is not a permanent verdict: the network may come back, or
    // the user may name a model that does exist.
    if (!loaded.ok) this._loading = null
    return loaded
  }

  /**
   * Load at the chosen precision, and fall back to `fp32` rather than refusing.
   *
   * The case it is for is a repository that does not publish the dtype that was
   * asked for. That fails as a 404 on a filename the user never typed, before
   * any session exists, and full precision is the one export every checkpoint
   * has — so the retry turns a dead end into a bigger download.
   *
   * The case it is measured *not* to help is the one above, and the reason is
   * worth writing down: **once onnxruntime-web has failed to create a session,
   * every later attempt in that realm fails with the same message.** A probe run
   * in a fresh page loaded `onnx-community/whisper-base` at fp32 in one attempt;
   * the identical call made after a failed q8 build in the same page failed
   * instantly, quoting the first failure. The retry is honest about what it
   * cannot repair by leaving the original failure as the one reported.
   */
  async _build(dtype = this.dtype) {
    const built = await Outcome.attempt(
      async () => {
        const { pipeline } = await import('@huggingface/transformers')
        this._pipeline = await pipeline('automatic-speech-recognition', this.model, {
          dtype,
          device: this.device,
          progress_callback: (event) => this.onProgress(event),
        })
        return null
      },
      {
        code: Reason.UNAVAILABLE,
        hint: `Check that "${this.model}" exists on the Hugging Face hub and has ONNX weights. The weights are downloaded on first use and this browser must have room for them.`,
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

  async transcribe({ samples, sampleRate = MODEL_SAMPLE_RATE }) {
    if (!samples?.length) return Outcome.ok('')
    const loaded = await this.load()
    if (!loaded.ok) return loaded

    const seconds = samples.length / sampleRate
    const said = await Outcome.attempt(() => this._pipeline(samples, this.options(seconds)), {
      code: Reason.INTERNAL,
      hint: 'The model loaded but could not transcribe this audio.',
    })
    if (!said.ok) return said
    const value = said.value
    const text = Array.isArray(value) ? (value[0]?.text ?? '') : (value?.text ?? '')
    return Outcome.ok(String(text).trim())
  }

  async close() {
    await this._pipeline?.dispose?.()
    this._pipeline = null
    this._loading = null
  }
}
