import {
  createSpeaker,
  createTranscriber,
  earOwnsInput,
  MODEL_SAMPLE_RATE,
  voiceOwnsOutput,
  WebSpeechSpeaker,
} from '../core/speech/index.js'
import { EventName } from '../protocol/Envelope.js'
import { BackendClient } from './BackendClient.js'

/**
 * Speech, from the page's side.
 *
 * This file exists because two of the six engines cannot be anywhere else. The
 * microphone, the loudspeaker and the browser's own recogniser are page APIs;
 * the models are megabytes of wasm that must not run on the thread drawing the
 * transcript. So the same capability is served by two paths, and the point of
 * this module is that the component above it sees one.
 *
 *     native engine    → constructed here, owns the device, no worker involved
 *     model engine     → speech worker; audio out, transcript back as events
 *
 * It is the first thing in `client/` to import `core/`, and that is a widening
 * of the layer rule rather than a hole in it: dependencies still point inward,
 * and the classes it reaches for are the ones that declare — with `OWNS_INPUT`
 * and `OWNS_OUTPUT` — that they need a device this realm has. `app/` still
 * imports neither `core/` nor `backend/`.
 */

/**
 * The speech thread, started once and kept.
 *
 * Not per dictation: the weights are the expensive part and a fresh worker
 * would re-download nothing but would re-initialise everything, so the second
 * dictation would cost what the first one did. Started lazily, so a user who
 * never dictates never pays for the thread.
 */
let speechThread = null

export function speechBackend() {
  if (!speechThread) {
    speechThread = new BackendClient(
      // The URL must be a literal for the bundler to find the chunk, and the
      // name is what makes this thread identifiable in devtools as the one that
      // is busy when the transcript is late.
      new Worker(new URL('../backend/speechWorker.js', import.meta.url), {
        type: 'module',
        name: 'speech',
      }),
    )
  }
  return speechThread
}

/**
 * The capture chain: microphone in, fixed-size blocks of float32 out.
 *
 * The samples are collected on the browser's audio thread by an AudioWorklet,
 * not on the page's. That is the difference between dictation that costs
 * nothing to draw and dictation that stutters the whole interface — a
 * `ScriptProcessorNode` does the same job on the main thread, which is why it is
 * only the fallback and why taking it is reported.
 *
 * The processor is a blob rather than a file in `public/`: it is nine lines, it
 * belongs to this module, and a separate asset would be a second thing to keep
 * in step with a build that already has a base path to get wrong.
 */
const PROCESSOR = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(2048)
    this.at = 0
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.block[this.at++] = channel[i]
      if (this.at === this.block.length) {
        // Transferred, not copied: at 16 kHz this fires eight times a second
        // for as long as somebody is talking.
        const full = this.block
        this.block = new Float32Array(2048)
        this.at = 0
        this.port.postMessage(full, [full.buffer])
      }
    }
    return true
  }
}
registerProcessor('capture', Capture)
`

export class Microphone {
  constructor() {
    this._stream = null
    this._context = null
    this._node = null
    this.sampleRate = MODEL_SAMPLE_RATE
  }

  /** Where captured blocks go. Assigned by whoever opened the microphone. */
  onBlock(_samples, _sampleRate) {}

  /**
   * @returns {Promise<{ok: boolean, error?: object, notes: string[]}>}
   */
  async open() {
    const notes = []
    /**
     * The four ways this fails, told apart.
     *
     * They used to be two, and the pair did not match: the headline said the
     * API was "Not supported" while the remedy underneath said to grant
     * permission — which no amount of granting can fix. A reviewer met exactly
     * that on the first press of the microphone and reported it as guidance
     * sending them into a loop of a fix that cannot succeed.
     *
     * The absent-API case is checked BEFORE the call rather than caught after
     * it, because a page served over plain http has no `navigator.mediaDevices`
     * at all and the failure is then a TypeError about reading a property of
     * undefined — a sentence about this app's internals, in front of somebody
     * whose real problem is the address bar.
     */
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        error: {
          message: 'this page cannot open a microphone',
          hint: 'A microphone needs a secure page. Open this over https, or on localhost.',
        },
        notes,
      }
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        // The browser's own cleanup, asked for explicitly. Every model here was
        // trained on speech recorded through something that did this, and a raw
        // room with echo transcribes noticeably worse.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const named = err?.name ?? ''
      const said =
        named === 'NotAllowedError' || named === 'SecurityError'
          ? {
              message: 'the microphone was refused',
              hint: 'Allow microphone access for this page in your browser, then press speak again.',
            }
          : named === 'NotFoundError' || named === 'OverconstrainedError'
            ? {
                message: 'no microphone was found on this device',
                hint: 'Plug one in, or choose it as the input in your system settings.',
              }
            : named === 'NotReadableError'
              ? {
                  message: 'the microphone is in use by something else',
                  hint: 'Close whatever else is recording, then press speak again.',
                }
              : {
                  message: `the microphone could not be opened: ${err?.message ?? err}`,
                  // No remedy invented for a fault nobody here recognises. A
                  // hint that names the wrong fix is worse than none.
                  hint: '',
                }
      return { ok: false, error: said, notes }
    }

    // Asked for at the models' own rate so the common 48 kHz downsample happens
    // in the browser's resampler rather than in ours. A browser that refuses is
    // not an error: `Transcriber.feed` is told the real rate and resamples.
    try {
      this._context = new AudioContext({ sampleRate: MODEL_SAMPLE_RATE })
    } catch {
      this._context = new AudioContext()
    }
    this.sampleRate = this._context.sampleRate
    if (this.sampleRate !== MODEL_SAMPLE_RATE) {
      notes.push(
        `this browser captures at ${this.sampleRate} Hz, so the audio is resampled to ${MODEL_SAMPLE_RATE} Hz here`,
      )
    }
    // A context created before a user gesture starts suspended, and a suspended
    // context delivers no audio and reports no fault.
    await this._context.resume().catch(() => {})

    const source = this._context.createMediaStreamSource(this._stream)
    const deliver = (samples) => this.onBlock(samples, this.sampleRate)

    const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }))
    try {
      await this._context.audioWorklet.addModule(url)
      const node = new AudioWorkletNode(this._context, 'capture')
      node.port.onmessage = (event) => deliver(event.data)
      // Connected to the destination because some browsers do not pull audio
      // through a node whose output goes nowhere. The node emits nothing, so
      // nothing is heard.
      source.connect(node).connect(this._context.destination)
      this._node = node
    } catch (err) {
      notes.push(
        `the audio worklet could not start (${err?.message ?? err}), so capture is running on the page's own thread`,
      )
      const node = this._context.createScriptProcessor(2048, 1, 1)
      node.onaudioprocess = (event) =>
        deliver(new Float32Array(event.inputBuffer.getChannelData(0)))
      source.connect(node).connect(this._context.destination)
      this._node = node
    } finally {
      URL.revokeObjectURL(url)
    }

    return { ok: true, notes }
  }

  async close() {
    this._node?.disconnect()
    for (const track of this._stream?.getTracks() ?? []) track.stop()
    await this._context?.close().catch(() => {})
    this._node = null
    this._stream = null
    this._context = null
  }
}

/**
 * One dictation, whichever engine is behind it.
 *
 * The caller says `start` and `stop` and reads `onPartial`, `onFinal` and
 * `onProgress`. Which of the two paths it got is answerable — `usesWorker` —
 * but nothing above has to branch on it.
 */
export class Dictation {
  constructor(settings = {}) {
    this.settings = settings
    this.usesWorker = !earOwnsInput(settings.sttKind)
    this._native = null
    this._microphone = null
    this._client = null
    this._session = null
    this._stopped = null
    this._ending = false
  }

  onPartial(_text) {}
  onFinal(_text) {}
  onProgress(_progress) {}

  /**
   * The dictation ended without being asked to.
   *
   * It has one real cause and it is the expensive one: the model failed to
   * build, minutes into its own download. Without this the session would resolve
   * into nothing, the microphone would stay open, and the interface would go on
   * saying "listening" until the user pressed stop and was finally told why they
   * had not been heard.
   */
  onEnded(_result) {}

  /** @returns {Promise<{ok: boolean, error?: object, notes: string[]}>} */
  async start() {
    return this.usesWorker ? this._startModel() : this._startNative()
  }

  /**
   * End the dictation and produce the final transcript.
   *
   * Idempotent by construction: `stop` called twice — a click and a keystroke a
   * frame apart — must not transcribe the tail twice or leave a second call
   * awaiting a session that has already gone.
   */
  async stop() {
    if (!this._stopped) this._stopped = this._stop()
    return this._stopped
  }

  async _startNative() {
    const built = createTranscriber({
      kind: this.settings.sttKind,
      language: this.settings.sttLanguage,
    })
    const transcriber = built.value
    transcriber.onPartial = (text) => this.onPartial(text)
    this._native = transcriber

    const started = await transcriber.start()
    return started.ok
      ? { ok: true, notes: [...built.notes, ...started.notes] }
      : {
          ok: false,
          error: { message: started.failure.message, hint: started.failure.hint },
          notes: built.notes,
        }
  }

  async _startModel() {
    const client = speechBackend()
    this._client = client

    // Opened before the model is asked for, so a refused microphone costs
    // nothing — the alternative is a user who waits out a 145 MB download and
    // is then told they were never going to be heard.
    const microphone = new Microphone()
    const opened = await microphone.open()
    if (!opened.ok) return opened
    this._microphone = microphone

    const notes = [...opened.notes]
    let settled = false
    // The session is one long call. It stays pending for the whole dictation and
    // its Response is the final transcript — the same shape `chat.send` has, and
    // the reason the partials can ride on its id.
    this._session = client
      .call(
        'speech.dictate',
        {
          kind: this.settings.sttKind,
          model: this.settings.sttModel,
          language: this.settings.sttLanguage,
          // Forwarded, and they were not. `SpeechService.dictate` has taken
          // both since it was written and this call named neither, so the
          // quantisation and the backend a person chose were settings with
          // nowhere to go.
          dtype: this.settings.sttDtype,
          device: this.settings.sttDevice,
        },
        (name, data) => {
          if (name === EventName.PARTIAL) this.onPartial(data.text)
          else if (name === EventName.PROGRESS) this.onProgress(data)
        },
      )
      .then((result) => {
        settled = true
        return result
      })

    microphone.onBlock = (samples, sampleRate) => {
      // Fire and forget. Awaiting the acknowledgement would make the audio
      // thread's delivery rate depend on how long a transcription pass takes,
      // and the blocks would arrive in bursts after every pass instead of
      // steadily.
      if (!settled) client.call('speech.push', { samples, sampleRate })
    }

    // A session that resolves on its own has failed — a deliberate stop goes
    // through `_stop`, which sets `_ending` first. The microphone must not be
    // left open listening to nobody, and the caller must be told now rather
    // than when it next asks.
    this._session.then((result) => {
      if (this._ending) return
      this._microphone?.close()
      this._microphone = null
      this.onEnded(result)
    })
    return { ok: true, notes }
  }

  async _stop() {
    this._ending = true
    if (this._native) {
      const done = await this._native.finish()
      this._native = null
      this.onFinal(done.value ?? '')
      return { ok: true, text: done.value ?? '', notes: done.notes }
    }
    await this._microphone?.close()
    this._microphone = null
    if (!this._session) return { ok: true, text: '', notes: [] }

    // `finish` is what resolves the open session, so both are awaited: this call
    // reports whether the tail could be transcribed, and the session carries the
    // transcript itself.
    const [, session] = await Promise.all([this._client.call('speech.finish'), this._session])
    this._session = null
    const text = session.ok ? (session.value ?? '') : ''
    this.onFinal(text)
    return session.ok
      ? { ok: true, text, notes: session.notes }
      : { ok: false, text, error: session.error, notes: session.notes }
  }
}

/**
 * Reading a reply aloud, whichever voice is chosen.
 *
 * Two paths again, and the same rule: the browser's voice speaks for itself and
 * a model hands back samples that only this realm can play. `say` hides the
 * difference; what it will not hide is a first load, which arrives on
 * `onProgress` exactly as the transcriber's does.
 */
export class Voice {
  constructor(settings = {}) {
    this.settings = settings
    this._native = null
  }

  onProgress(_progress) {}

  /** @returns {Promise<{ok: boolean, error?: object, notes: string[]}>} */
  async say(text) {
    const said = String(text ?? '').trim()
    if (!said) return { ok: true, notes: [] }
    return voiceOwnsOutput(this.settings.ttsKind) ? this._sayNative(said) : this._sayModel(said)
  }

  async stop() {
    await this._native?.stop()
    for (const source of playing) source.stop()
    playing.clear()
  }

  async _sayNative(text) {
    if (!this._native) {
      const built = createSpeaker({
        kind: this.settings.ttsKind,
        voice: this.settings.ttsVoice,
        rate: this.settings.ttsRate,
        pitch: this.settings.ttsPitch,
      })
      this._native = built.value
    }
    // EVERY setting the sheet can change, re-applied on every reply rather than
    // only when the speaker was first built. The speaker is kept for the life of
    // the tab and the settings are not — `page.jsx` hands this object a fresh
    // record before each reply — so a field read once at construction is a field
    // frozen at whatever it was the first time this tab ever spoke. That is not
    // a rate slider that lags by one reply; it is a voice list that chose the
    // voice for reply one and could never be changed again, which is the whole
    // of what the list was added to do. A field left out of these three lines is
    // a setting with a control and no effect, so they are here as a set.
    this._native.voice = this.settings.ttsVoice ?? this._native.voice
    this._native.rate = this.settings.ttsRate ?? this._native.rate
    this._native.pitch = this.settings.ttsPitch ?? this._native.pitch
    const spoken = await this._native.speak(text)
    return spoken.ok
      ? { ok: true, notes: spoken.notes }
      : {
          ok: false,
          error: { message: spoken.failure.message, hint: spoken.failure.hint },
          notes: spoken.notes,
        }
  }

  async _sayModel(text) {
    const result = await speechBackend().call(
      'speech.speak',
      {
        text,
        kind: this.settings.ttsKind,
        model: this.settings.ttsModel,
        voice: this.settings.ttsVoice,
        rate: this.settings.ttsRate,
        pitch: this.settings.ttsPitch,
      },
      (name, data) => {
        if (name === EventName.PROGRESS) this.onProgress(data)
      },
    )
    if (!result.ok) return { ok: false, error: result.error, notes: result.notes }
    const played = await play(result.value)
    return played.ok
      ? { ok: true, notes: result.notes }
      : { ok: false, error: played.error, notes: result.notes }
  }
}

/**
 * Every voice this device can speak with.
 *
 * Here rather than on `Voice` because the caller is a settings form and not a
 * speaker: nothing has to be built, nothing has to be loaded, and a form that
 * had to construct a `Voice` to ask what voices exist would be constructing one
 * before the person had chosen anything.
 */
export async function installedVoices() {
  return await WebSpeechSpeaker.voices()
}

/**
 * Fetch a speech model's weights without using them.
 *
 * `SpeechService.load` has existed since the service was written and had zero
 * callers repo-wide. The first load of whisper is minutes, and without this the
 * only way to spend them is to press the microphone and talk into a page that
 * is not listening yet. Here a person spends them deliberately, from a control
 * that says what it is doing.
 */
export async function preloadSpeech(settings = {}, onProgress = () => {}) {
  const result = await speechBackend().call(
    'speech.load',
    {
      kind: settings.sttKind,
      model: settings.sttModel,
      dtype: settings.sttDtype,
      device: settings.sttDevice,
    },
    (name, data) => {
      if (name === EventName.PROGRESS) onProgress(data)
    },
  )
  return result.ok
    ? { ok: true, model: result.value, notes: result.notes }
    : { ok: false, error: result.error, notes: result.notes }
}

/** Sources still sounding, so `stop` can silence a reply that is halfway read. */
const playing = new Set()

/**
 * Play a waveform the worker produced.
 *
 * A context per utterance rather than one kept open: an AudioContext that is
 * never closed keeps the audio hardware awake for the life of the tab, which on
 * a laptop is audible in the fan and visible in the battery.
 */
async function play({ samples, sampleRate }) {
  try {
    const context = new AudioContext()
    const buffer = context.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    playing.add(source)
    await new Promise((resolve) => {
      source.addEventListener('ended', resolve, { once: true })
      source.start()
    })
    playing.delete(source)
    await context.close()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: {
        message: `the audio could not be played: ${err?.message ?? err}`,
        hint: 'Some browsers require a click on the page before any audio may start.',
      },
    }
  }
}
