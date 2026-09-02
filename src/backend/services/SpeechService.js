import { Outcome, Reason } from '../../core/Outcome.js'
import { describeProgress } from '../../core/progress.js'
import { createSpeaker, createTranscriber } from '../../core/speech/index.js'
import { EventName } from '../../protocol/Envelope.js'

/**
 * Speech, as use cases, on the thread that is allowed to be busy.
 *
 * A transcription pass is hundreds of milliseconds of wasm with no yield in it.
 * Run on the page it would land as dropped frames while somebody is typing;
 * run on the *backend* worker it would sit in front of whatever the agent was
 * doing, because a worker has one message loop and a long call holds it. So this
 * service has a worker to itself, and the chat and the dictation are two threads
 * that are slow at the same time without being slow at each other.
 *
 * `dictate` is a long call in the shape `chat.send` already established: it is
 * made once, it emits events for as long as it runs, and its Response is the
 * final answer. What ends it is another call — `finish` — which is the one thing
 * a streaming reply does not need. Audio has to be pushed in while the call is
 * open, and a request that is still awaiting its own reply cannot be handed
 * anything, so the session's id is the id of the call that is waiting on it.
 */
export class SpeechService {
  constructor() {
    this._transcriber = null
    this._settle = null
    this._speaker = null
    this._voiceKey = ''
  }

  /**
   * Open a dictation. Resolves when `finish` or `cancel` is called, with
   * everything that was said.
   *
   * Partials and download progress arrive as events on this call's id, so the
   * page attributes them without a second channel — the same mechanism that
   * carries a model's tokens, used for the same reason.
   */
  async dictate({ kind, model, language, partialEvery, segmentSeconds, dtype, device } = {}, emit) {
    if (this._transcriber) {
      return Outcome.failed(Reason.BAD_REQUEST, 'a dictation is already running', {
        hint: 'Stop the current dictation before starting another.',
      })
    }

    const built = createTranscriber({
      kind,
      model,
      language,
      partialEvery,
      segmentSeconds,
      dtype,
      device,
    })
    const transcriber = built.value
    // Assigned rather than subclassed: the reporting hooks belong to whoever is
    // watching, and a class per listener would be a class per caller.
    transcriber.onProgress = (event) => emit?.(EventName.PROGRESS, describeProgress(event))
    transcriber.onPartial = (text) => emit?.(EventName.PARTIAL, { text })

    const started = await transcriber.start()
    if (!started.ok) return withNotes(started, built.notes)

    this._transcriber = transcriber
    return new Promise((resolve) => {
      this._settle = (outcome) => resolve(withNotes(outcome, [...built.notes, ...started.notes]))
    })
  }

  /**
   * Feed captured audio into the open dictation.
   *
   * Answered as soon as the block is accepted, and deliberately says nothing
   * about the text: the transcript arrives on the dictation's own event stream,
   * because that is where a caller is already listening. Returning it here as
   * well would give the page two copies of the same fact arriving in an order
   * nothing guarantees.
   */
  async push({ samples, sampleRate } = {}) {
    if (!this._transcriber) {
      return Outcome.failed(Reason.BAD_REQUEST, 'no dictation is running', {
        hint: 'Call speech.dictate before pushing audio.',
      })
    }
    const fed = await this._transcriber.feed(samples, sampleRate)
    return fed.ok ? Outcome.ok(null, fed.notes) : fed
  }

  /** End the dictation, transcribe the tail, and resolve the open `dictate` call. */
  async finish() {
    const transcriber = this._transcriber
    if (!transcriber) {
      return Outcome.failed(Reason.BAD_REQUEST, 'no dictation is running', { hint: '' })
    }
    this._transcriber = null
    const said = await transcriber.finish()
    this._settle?.(said)
    this._settle = null
    // The model is kept loaded on purpose: the next dictation is the same
    // weights, and unloading them would make every session cost the first one.
    return Outcome.ok(said.ok ? said.value : '', said.notes)
  }

  /** End it without transcribing the tail — the user changed their mind, not the audio. */
  async cancel() {
    const transcriber = this._transcriber
    if (!transcriber) return Outcome.ok('')
    this._transcriber = null
    const said = await transcriber.cancel()
    this._settle?.(said)
    this._settle = null
    return said
  }

  /**
   * Say something, and hand back the waveform.
   *
   * Only the page can play audio, so the worker's job ends at the samples. They
   * cross as a Float32Array, which structured-clone carries intact — the one
   * thing that would not survive is a class instance, and this is deliberately
   * a plain record for that reason.
   *
   * The voice is rebuilt only when its configuration changes. Constructing one
   * is free; loading its weights is not, and doing that per sentence would make
   * every reply pay the first reply's cost.
   */
  async speak({ text, kind, model, voice, rate, pitch, dtype, device } = {}, emit) {
    const key = JSON.stringify([kind, model, voice, dtype, device])
    let notes = []
    if (!this._speaker || this._voiceKey !== key) {
      await this._speaker?.close()
      const built = createSpeaker({ kind, model, voice, rate, pitch, dtype, device })
      this._speaker = built.value
      this._voiceKey = key
      notes = built.notes
    }
    this._speaker.rate = rate ?? this._speaker.rate
    this._speaker.pitch = pitch ?? this._speaker.pitch
    this._speaker.onProgress = (event) => emit?.(EventName.PROGRESS, describeProgress(event))

    const audio = await this._speaker.synthesize(text)
    return audio.ok ? Outcome.ok(audio.value, [...notes, ...audio.notes]) : withNotes(audio, notes)
  }

  /**
   * Fetch a model's weights without using them.
   *
   * Worth its own method because the first load is minutes and the user should
   * be able to spend them deliberately, rather than discovering them halfway
   * through the first sentence they wanted transcribed.
   */
  async load({ kind, model, dtype, device } = {}, emit) {
    const built = createTranscriber({ kind, model, dtype, device })
    built.value.onProgress = (event) => emit?.(EventName.PROGRESS, describeProgress(event))
    const loaded = await built.value.load()
    await built.value.close()
    return loaded.ok ? Outcome.ok(built.value.model, built.notes) : withNotes(loaded, built.notes)
  }
}

/** Carry a factory's repairs onto whatever outcome finally travels. `withNote` takes one. */
function withNotes(outcome, notes) {
  return notes.reduce((carried, note) => carried.withNote(note), outcome)
}
