import { Outcome, Reason } from '../Outcome.js'
import { Inference } from './Inference.js'
import { Modality } from './Multimodality.js'

/**
 * transformers.js — the model runs in this tab, with no endpoint and no key.
 *
 * The import is dynamic because the runtime is tens of megabytes of wasm and
 * must not be in the initial bundle of a page that may never use it. It is also
 * the only inference class that has no network destination: the weights come
 * from the Hugging Face CDN on first use and are then cached by the browser.
 *
 * The pipeline is held on the instance rather than rebuilt per call — loading
 * weights is the expensive part, and doing it per turn would make the second
 * message as slow as the first.
 */
export class TransformersInference extends Inference {
  static LABEL = 'transformers.js'

  constructor(settings) {
    super({ baseUrl: '', apiKey: '', ...settings })
    this.dtype = settings.dtype ?? 'q4'
    this.device = settings.device ?? 'webgpu'
    this._pipeline = null
    this._loading = null
  }

  /** Report load progress to the caller; the first call takes minutes, not seconds. */
  onProgress(_event) {}

  async _pipe() {
    if (this._pipeline) return Outcome.ok(this._pipeline)
    // Concurrent turns must share one load rather than starting two.
    if (!this._loading) {
      this._loading = Outcome.attempt(
        async () => {
          const { pipeline } = await import('@huggingface/transformers')
          this._pipeline = await pipeline('text-generation', this.model, {
            dtype: this.dtype,
            device: this.device,
            progress_callback: (event) => this.onProgress(event),
          })
          return this._pipeline
        },
        {
          code: Reason.UNAVAILABLE,
          hint: 'The model could not be loaded. Check the model id, and that this browser has enough memory — the weights are downloaded on first use.',
        },
      )
    }
    const loaded = await this._loading
    // A failed load must not be cached as a permanent verdict: the next attempt
    // may succeed once the network is back or a different model is chosen.
    if (!loaded.ok) this._loading = null
    return loaded
  }

  async invoke(prompt, multimodal = []) {
    return this._generate(prompt, multimodal, null)
  }

  /**
   * Local generation, reported token by token.
   *
   * A model running on this device is the slowest of the three transports and
   * the one where waiting in silence is least tolerable, so this is where
   * streaming earns the most. `TextStreamer` is imported beside the pipeline —
   * from the same dynamic module, so it costs nothing until this path is taken.
   */
  async stream(prompt, multimodal = [], { onDelta } = {}) {
    const made = await Outcome.attempt(
      async () => {
        const { TextStreamer } = await import('@huggingface/transformers')
        const pipe = await this._pipe()
        if (!pipe.ok) return null
        return new TextStreamer(pipe.value.tokenizer, {
          // The prompt is echoed back by the generator; without this the whole
          // prompt would stream into the UI ahead of the answer.
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (piece) => {
            if (piece) onDelta?.(piece, 'text')
          },
        })
      },
      {
        code: Reason.INTERNAL,
        hint: 'The in-browser runtime could not start a streamer.',
      },
    )
    // A streamer that could not be built is not a failed turn: generate without
    // one and the answer still arrives, in a single piece.
    const streamer = made.ok ? made.value : null
    const notes = made.ok ? [] : ['this run did not stream: the streamer could not be built']
    const generated = await this._generate(prompt, multimodal, streamer)
    if (!streamer && generated.ok && generated.value) onDelta?.(generated.value, 'text')
    return notes.length ? generated.withNote(notes[0]) : generated
  }

  async _generate(prompt, multimodal, streamer) {
    const pipe = await this._pipe()
    if (!pipe.ok) return pipe

    // Text-generation takes chat messages; images would need an
    // image-text-to-text pipeline. The attachment is dropped rather than
    // failing the turn — the question is usually still answerable without it —
    // but the note says so, so nobody concludes the model looked at the image.
    const notes = multimodal?.some((item) => item.type === Modality.IMAGE && item.urls.length)
      ? ['attachments were ignored: this pipeline is text-only']
      : []

    const generated = await Outcome.attempt(
      () =>
        pipe.value([{ role: 'user', content: prompt }], {
          max_new_tokens: this.maxTokens,
          temperature: this.temperature,
          do_sample: this.temperature > 0,
          ...(streamer ? { streamer } : {}),
        }),
      { code: Reason.INTERNAL, hint: 'Generation failed in the browser runtime.' },
    )
    if (!generated.ok) return generated

    const turns = generated.value?.[0]?.generated_text
    const text = Array.isArray(turns)
      ? (turns.at(-1)?.content ?? '')
      : typeof turns === 'string'
        ? turns.slice(prompt.length)
        : ''
    return Outcome.ok(text, notes)
  }

  async close() {
    await this._pipeline?.dispose?.()
    this._pipeline = null
    this._loading = null
  }
}
