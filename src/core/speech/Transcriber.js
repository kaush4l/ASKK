import { Outcome, Reason } from '../Outcome.js'
import { concat, loudness, MODEL_SAMPLE_RATE, resample } from './audio.js'

/**
 * Abstract speech-to-text. One subclass per way of turning sound into words.
 *
 * A subclass declares one thing — `transcribe(audio)`, a complete utterance in
 * and text out — and gets live dictation for free, exactly as an `Inference`
 * subclass declares `invoke` and gets `stream`. The parallel is deliberate and
 * the reasoning is the same: **liveness is a difference in timing, never in
 * result**, so nothing downstream may depend on partials arriving. A model that
 * can only be handed a finished recording still dictates; it simply speaks less
 * often.
 *
 * How that is done is worth stating plainly, because it decides what a partial
 * *means* here. Every partial is a re-transcription of the whole segment so far,
 * not a fragment appended to the last one. Words already on screen therefore
 * change as more audio arrives — which is not a glitch, it is a language model
 * revising an ambiguous ending once it hears what followed. The alternative,
 * transcribing each block independently and concatenating, produces text that
 * never changes and is wrong at every block boundary.
 *
 * Lives in `core/` and is used from both realms. The classes that download
 * weights run in the speech worker; the one that wraps the browser's own
 * recogniser can only run in the page, and says so with `OWNS_INPUT` rather
 * than by asking where it is. A class knows what API it needs. It does not know,
 * and must not ask, what tier it was loaded into.
 */
export class Transcriber {
  /**
   * Stable name for messages. NOT `constructor.name`: the production bundle
   * renames classes, so a message built from it is wrong in exactly the build a
   * user reads it in.
   */
  static LABEL = 'transcriber'

  /**
   * Whether this engine opens the microphone itself.
   *
   * The browser's own recogniser does — it is handed no audio, it is switched
   * on — and a model in a worker cannot, because a worker has no getUserMedia.
   * That is the one shape difference between the two families, and naming it
   * here is what lets one controller drive both: it asks, rather than branching
   * on which class it happens to hold.
   */
  static OWNS_INPUT = false

  /** What the user gets if they name no model. Empty where there is nothing to download. */
  static DEFAULT_MODEL = ''

  constructor({
    model = '',
    language = 'en',
    // How often a partial is produced. Below about a second the re-transcription
    // of the growing segment costs more than the audio it is transcribing, and
    // the passes queue behind each other until the speaker stops.
    partialEvery = 1.2,
    // A segment is closed and committed at this length, and a fresh one starts.
    // Without it every pass would re-transcribe the whole dictation, so the cost
    // of the tenth minute would be ten times the cost of the first — and whisper
    // truncates at thirty seconds regardless, so the later audio would be
    // dropped in silence.
    segmentSeconds = 20,
    // Below this RMS a block is the room, not a voice. Skipping the pass is the
    // difference between an idle microphone costing nothing and costing a model
    // run every second.
    silence = 0.004,
  } = {}) {
    this.model = model || new.target.DEFAULT_MODEL
    this.language = language
    this.partialEvery = partialEvery
    this.segmentSeconds = segmentSeconds
    this.silence = silence

    this._blocks = []
    this._samples = 0
    this._committed = ''
    this._segment = ''
    this._lastPass = 0
    this._running = false
    this._pass = null
  }

  /** Model-download progress, in transformers.js's own event shape. Overridden by the caller. */
  onProgress(_event) {}

  /** The transcript so far, revised. Called every time a pass resolves. */
  onPartial(_text) {}

  /** Everything that has been said, once dictation ends. */
  onFinal(_text) {}

  /**
   * Fetch whatever this engine needs before it can be used.
   *
   * Separate from `start` because it is the slow part — minutes on a first run,
   * nothing on a second — and the user is owed the difference between "loading
   * a model" and "listening". Nothing to load is a success, not a no-op that
   * has to be special-cased by every caller.
   */
  async load() {
    return Outcome.ok(null)
  }

  /**
   * One complete utterance, transcribed. The only method a subclass must write.
   *
   * @param {{samples: Float32Array, sampleRate: number}} _audio
   * @returns {Promise<Outcome>} value is the text
   */
  async transcribe(_audio) {
    return Outcome.failed(
      Reason.NOT_IMPLEMENTED,
      `${this.constructor.LABEL} does not implement transcribe()`,
      { hint: 'Choose a different speech-to-text engine in settings.' },
    )
  }

  /** Begin a dictation. Clears anything the previous one left behind. */
  async start() {
    const loaded = await this.load()
    if (!loaded.ok) return loaded
    this._blocks = []
    this._samples = 0
    this._committed = ''
    this._segment = ''
    this._lastPass = 0
    this._running = true
    return Outcome.ok(null, loaded.notes)
  }

  /**
   * Push captured audio in, and produce a partial when enough has arrived.
   *
   * Resampling happens here rather than at the microphone because it is the
   * model that has the requirement, and a capture pipeline that already knows
   * the model's rate is a capture pipeline coupled to the model.
   *
   * A pass in flight is not joined by a second one. Transcription is slower than
   * real time on a modest machine, and starting a pass per block would build a
   * queue that never drains — the partials would fall further behind the speaker
   * for as long as they kept talking. Skipping is right: the block is still in
   * the buffer, and the next pass reads it.
   */
  async feed(samples, sampleRate = MODEL_SAMPLE_RATE) {
    if (!this._running) {
      return Outcome.failed(Reason.BAD_REQUEST, 'no dictation is running', {
        hint: 'Start dictation before feeding audio to it.',
      })
    }
    const block = resample(samples, sampleRate)
    if (block.length) {
      this._blocks.push(block)
      this._samples += block.length
    }

    const seconds = this._samples / MODEL_SAMPLE_RATE
    if (seconds >= this.segmentSeconds) return this._commit()
    if (this._pass) return Outcome.ok(null)
    if (seconds - this._lastPass < this.partialEvery) return Outcome.ok(null)
    // Measured against the whole segment, not the newest block: a pause between
    // words must not be read as an empty utterance and skip a pass that has
    // real speech behind it.
    if (loudness(this._current()) < this.silence) {
      this._lastPass = seconds
      return Outcome.ok(null)
    }

    this._lastPass = seconds
    this._pass = this._run()
    const said = await this._pass
    this._pass = null
    if (said.ok && said.value) this.onPartial(said.value)
    return said
  }

  /**
   * End the dictation and report everything that was said.
   *
   * One last pass over the tail on purpose. The final result is not the last
   * partial: the partial was produced before the speaker finished the sentence,
   * and the words most likely to be wrong are the ones at its end.
   */
  async finish() {
    if (!this._running) return Outcome.ok(this._committed.trim())
    // Awaited, not cancelled: a pass already running holds the same audio this
    // one would read, and letting it settle first keeps the two from writing
    // `_segment` in the wrong order.
    if (this._pass) await this._pass
    const last = this._samples ? await this._run() : Outcome.ok('')
    this._running = false
    const text = this._joined(last.ok ? last.value : this._segment)
    this._blocks = []
    this._samples = 0
    this.onFinal(text)
    return last.ok
      ? Outcome.ok(text)
      : Outcome.ok(text, [`the last pass failed: ${last.failure.message}`])
  }

  /** Stop without transcribing the tail. What was heard so far is still returned. */
  async cancel() {
    this._running = false
    this._blocks = []
    this._samples = 0
    return Outcome.ok(this._joined(this._segment))
  }

  /** Release weights and any device they were loaded onto. */
  async close() {}

  _current() {
    return this._blocks.length === 1 ? this._blocks[0] : concat(this._blocks)
  }

  _joined(tail) {
    return `${this._committed} ${tail ?? ''}`.replace(/\s+/g, ' ').trim()
  }

  async _run() {
    const said = await this.transcribe({
      samples: this._current(),
      sampleRate: MODEL_SAMPLE_RATE,
    })
    if (!said.ok) return said
    this._segment = String(said.value ?? '').trim()
    return Outcome.ok(this._joined(this._segment), said.notes)
  }

  /** Close the current segment, keep its text, and start collecting a fresh one. */
  async _commit() {
    if (this._pass) await this._pass
    const said = await this._run()
    this._committed = this._joined(this._segment)
    this._segment = ''
    this._blocks = []
    this._samples = 0
    this._lastPass = 0
    if (said.ok) this.onPartial(this._committed)
    return said.ok ? Outcome.ok(this._committed) : said
  }
}
