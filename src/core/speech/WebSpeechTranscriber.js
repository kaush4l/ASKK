import { Outcome, Reason } from '../Outcome.js'
import { Transcriber } from './Transcriber.js'

/**
 * The recogniser the browser already has.
 *
 * Nothing is downloaded, nothing is quantised, and the partials arrive as fast
 * as the person is speaking, because the work is being done by the platform. It
 * is the best dictation in this app on the machines that have it and it does not
 * exist at all on the ones that do not — Firefox ships no implementation, and
 * Chrome's is behind the `webkit` prefix to this day.
 *
 * It also is not private. **Chrome's implementation sends the audio to Google's
 * servers**; the local models in this directory do not send anything anywhere.
 * That is a real choice between accuracy and where the sound goes, so it is put
 * to the user as a note rather than settled for them.
 *
 * This is the one engine in this tree that cannot run in a worker: the API is
 * on `window` and there is no way to hand it audio captured elsewhere. It says
 * so with `OWNS_INPUT`, which is a statement about the API, not a question about
 * the realm — and it probes for the constructor rather than for `window`,
 * because the bundler folds `typeof window` to a constant and a build-time
 * decision in a runtime disguise is how this tree has been caught before.
 */
export class WebSpeechTranscriber extends Transcriber {
  static LABEL = 'browser speech recognition'
  static OWNS_INPUT = true

  static _constructor() {
    return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null
  }

  constructor(settings = {}) {
    super(settings)
    this._recognition = null
    this._final = ''
    this._interim = ''
    this._ended = null
    this._fault = null
  }

  async load() {
    return WebSpeechTranscriber._constructor()
      ? Outcome.ok(null)
      : Outcome.failed(Reason.UNAVAILABLE, 'this browser has no speech recognition API', {
          hint: 'Chrome and Safari have one; Firefox does not. Choose whisper or moonshine to run a model locally instead.',
        })
  }

  async start() {
    const available = await this.load()
    if (!available.ok) return available

    this._final = ''
    this._interim = ''
    this._fault = null
    this._running = true

    const Recognition = WebSpeechTranscriber._constructor()
    return Outcome.attempt(
      () => {
        const recognition = new Recognition()
        // Without `continuous` the recogniser stops at the first pause, which
        // turns dictation into one sentence. Without `interimResults` there are
        // no partials at all and the whole point of using this engine is gone.
        recognition.continuous = true
        recognition.interimResults = true
        if (this.language) recognition.lang = this.language

        recognition.addEventListener('result', (event) => {
          // Results are cumulative and revised in place: the engine may replace
          // a result it has already delivered, so the transcript is rebuilt from
          // `resultIndex` rather than appended to.
          let interim = ''
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i]
            if (result.isFinal) this._final += `${result[0].transcript} `
            else interim += result[0].transcript
          }
          this._interim = interim
          this.onPartial(this._text())
        })
        recognition.addEventListener('error', (event) => {
          // `no-speech` and `aborted` are how this API says "nothing happened",
          // not that anything broke, and reporting them would make a silent
          // dictation look like a fault.
          if (event.error === 'no-speech' || event.error === 'aborted') return
          this._fault =
            event.error === 'not-allowed'
              ? 'the microphone was refused'
              : `speech recognition failed: ${event.error}`
        })
        // Held so `finish` can wait for the engine to flush its last result
        // rather than reading the transcript while it is still being written.
        this._ended = new Promise((resolve) => {
          recognition.addEventListener('end', resolve, { once: true })
        })
        recognition.start()
        this._recognition = recognition
        return null
      },
      {
        code: Reason.UNAVAILABLE,
        hint: 'The browser refused to start its recogniser. It needs a secure origin and permission to use the microphone.',
      },
    ).then((started) =>
      started.ok
        ? started.withNote(
            'the browser recogniser may send your audio to the browser vendor to be transcribed',
          )
        : started,
    )
  }

  /**
   * Audio is not pushed into this engine; it is listening to the microphone
   * itself. Accepting the call and doing nothing is deliberate — the controller
   * that drives both families should not have to know which one it is holding.
   */
  async feed() {
    return Outcome.ok(null)
  }

  async finish() {
    if (!this._running) return Outcome.ok(this._text())
    this._running = false
    this._recognition?.stop()
    await this._ended
    this._recognition = null
    const text = this._text()
    this.onFinal(text)
    return Outcome.ok(text, this._fault ? [this._fault] : [])
  }

  async cancel() {
    this._running = false
    this._recognition?.abort?.()
    this._recognition = null
    return Outcome.ok(this._text())
  }

  async close() {
    await this.cancel()
  }

  _text() {
    return `${this._final} ${this._interim}`.replace(/\s+/g, ' ').trim()
  }
}
