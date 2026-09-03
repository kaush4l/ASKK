import { Outcome } from '../../core/Outcome.js'
import { defaultModelFor, Ear, Voice } from '../../core/speech/index.js'

export const SETTINGS_ID = 'inference'

/**
 * Where the model endpoint and key live — and nothing else.
 *
 * There is deliberately no system message here. An agent's instructions belong
 * to its `agents/<name>/agent.md` file and nowhere else; a copy in settings
 * would be a second place to change them, and the two would drift.
 *
 * The key is stored in IndexedDB on the user's own machine and is sent only to
 * the endpoint they named. It never reaches this app's origin, because this app
 * has no server to reach — which is the whole reason a browser-only harness can
 * be trusted with one at all.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  id: SETTINGS_ID,
  kind: 'openai',
  agent: 'main',
  // Empty, and every other field here has a default because these two cannot.
  // They used to name the model and the port on the machine this was written on
  // — `docs/TESTBED.md` is that machine — and a default nobody else can satisfy
  // is not a convenience, it is the app asserting something untrue about
  // itself. The header printed that model name beside a lit dot while the page
  // under it said there was no model; the first question failed against a port
  // no runtime uses; and the address field's own placeholder disagreed with the
  // address in it. This app brings no model of its own, and the only honest
  // description of a first visit is that nothing has been named yet.
  model: '',
  baseUrl: '',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 2048,
  // Whether the model is allowed its own scratchpad. On, because the work these
  // agents do is the work thinking is for — see `OpenAICompatible`, which owns
  // the measurement and the argument. It is here at all because that class
  // documented `thinking: false` as the escape hatch from its own false
  // positive and then shipped with no path from settings to the constructor, so
  // the hatch was on the inside of a locked door.
  thinking: true,

  // Speech. Two engines and two model ids, because hearing and speaking fail
  // independently: a machine with no microphone can still read a reply aloud,
  // and a browser with no recogniser can still run a local one.
  //
  // The defaults are the two that need nothing installed and nothing chosen —
  // whisper because it is the engine that exists on every browser, and the
  // operating system's own voice because it starts speaking in milliseconds
  // where a local one starts with a download.
  sttKind: Ear.WHISPER,
  sttModel: '',
  sttLanguage: 'en',
  ttsKind: Voice.NATIVE,
  ttsModel: '',
  // For the browser voice, the name of an installed one. For supertonic, the URL
  // of a style vector. One field because from the user's side it is the
  // same question — which voice — and the engine already knows what it means.
  ttsVoice: '',
  speakReplies: false,

  // How fast and how high the browser voice reads. `SpeechService.speak` and
  // `Speaker` have taken both since they were written and nothing ever sent
  // one, so a reply was read at whatever the operating system defaults to —
  // which on several machines is noticeably too fast to follow.
  ttsRate: 1,
  ttsPitch: 1,

  // Where a local speech model runs and at what precision. Both are arguments
  // `SpeechService.dictate` already takes. `wasm` rather than `webgpu` because
  // the encoder of every model here falls back to wasm for at least one
  // operator, and a device that is requested and unavailable fails the whole
  // build rather than degrading — `TransformersTranscriber` owns that
  // measurement.
  sttDevice: 'wasm',
  sttDtype: 'fp32',
})

export class SettingsService {
  constructor(repository) {
    this.repository = repository
  }

  async get() {
    const found = await this.repository.get(SETTINGS_ID)
    // Unreadable settings are not a reason to be unusable. The defaults are not
    // a working configuration — nothing here can be — but they are a complete
    // and describable one, so the app boots, `HealthService` reports it as a
    // setup nobody has finished, and the read failure travels as a note rather
    // than as a blank screen.
    if (!found.ok) {
      return Outcome.ok({ ...DEFAULT_SETTINGS }, [
        `settings could not be read: ${found.failure.message}`,
      ])
    }
    // Merged, not replaced: a settings record written before a field existed
    // must not leave that field undefined for ever.
    return Outcome.ok({ ...DEFAULT_SETTINGS, ...(found.value ?? {}) })
  }

  /**
   * Save, correcting anything unusable rather than refusing the whole save.
   *
   * A rejected save loses every other edit the user made in the same form. What
   * they meant is nearly always recoverable — a number out of range means the
   * nearest number in it — so the field is repaired, the save proceeds, and the
   * correction is reported so the change is visible rather than surprising.
   *
   * The model and the address are the exception, and they are the exception
   * because they have no default worth restoring. An empty one is not a mistake
   * to repair, it is the state "not configured yet", and it is the state every
   * person is in for the moment between clearing a field and typing the next
   * one. Substituting there made clearing impossible: the form redraws from
   * what this returns, so the field refilled itself as fast as it was emptied.
   */
  async save(patch = {}) {
    const current = await this.get()
    const next = { ...current.value, ...patch, id: SETTINGS_ID }
    const notes = []

    // Trimmed, and nothing else. A field cleared with the spacebar and a field
    // cleared with backspace are the same intention, and only trimming makes
    // them the same value — the difference decides whether `HealthService`
    // builds a probe URL out of a blank and reports the emptiness as a server
    // that is down. There is no note, because a person cannot act on the news
    // that their spaces were removed.
    next.model = String(next.model ?? '').trim()
    next.baseUrl = String(next.baseUrl ?? '').trim()
    const temperature = Number(next.temperature)
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      notes.push(
        `temperature ${JSON.stringify(next.temperature)} is out of range; used ${DEFAULT_SETTINGS.temperature}`,
      )
      next.temperature = DEFAULT_SETTINGS.temperature
    } else {
      next.temperature = temperature
    }
    const maxTokens = Number.parseInt(next.maxTokens, 10)
    if (!Number.isFinite(maxTokens) || maxTokens < 1) {
      notes.push(
        `max tokens ${JSON.stringify(next.maxTokens)} is not a positive number; used ${DEFAULT_SETTINGS.maxTokens}`,
      )
      next.maxTokens = DEFAULT_SETTINGS.maxTokens
    } else {
      next.maxTokens = maxTokens
    }

    // An engine the build no longer has is corrected, not refused — the same
    // rule the factories in `core/speech` follow, applied one layer earlier so
    // the form shows what was actually kept.
    for (const [field, kinds, fallback] of [
      ['sttKind', Ear, DEFAULT_SETTINGS.sttKind],
      ['ttsKind', Voice, DEFAULT_SETTINGS.ttsKind],
    ]) {
      if (!Object.values(kinds).includes(next[field])) {
        notes.push(
          `${field} ${JSON.stringify(next[field])} is not an engine here; used ${fallback}`,
        )
        next[field] = fallback
      }
    }
    // An empty model id means "whatever this engine downloads by default", and
    // the answer is written down rather than left blank: a field showing nothing
    // and a field showing the model it is about to fetch are the same
    // configuration and only one of them can be checked before it is slow.
    for (const [field, kind] of [
      ['sttModel', next.sttKind],
      ['ttsModel', next.ttsKind],
    ]) {
      if (!String(next[field] ?? '').trim()) next[field] = defaultModelFor(kind)
    }
    next.speakReplies = Boolean(next.speakReplies)

    // Clamped rather than refused, like temperature above. The Web Speech
    // ranges are the spec's: rate 0.1–10, pitch 0–2. A value outside them is
    // not an error a person can act on — the browser simply ignores the
    // utterance — so it is corrected and reported.
    for (const [field, low, high] of [
      ['ttsRate', 0.1, 10],
      ['ttsPitch', 0, 2],
    ]) {
      const value = Number(next[field])
      if (!Number.isFinite(value) || value < low || value > high) {
        notes.push(
          `${field} ${JSON.stringify(next[field])} is outside ${low}–${high}; used ${DEFAULT_SETTINGS[field]}`,
        )
        next[field] = DEFAULT_SETTINGS[field]
      } else {
        next[field] = value
      }
    }

    // The backend a local model runs on, and the precision it is built at.
    // Corrected to the default rather than passed through, because an unknown
    // string here fails minutes into a download rather than at the save.
    if (!['wasm', 'webgpu'].includes(next.sttDevice)) {
      notes.push(`sttDevice ${JSON.stringify(next.sttDevice)} is not a backend here; used wasm`)
      next.sttDevice = DEFAULT_SETTINGS.sttDevice
    }
    if (!['fp32', 'fp16', 'q8', 'q4'].includes(next.sttDtype)) {
      notes.push(`sttDtype ${JSON.stringify(next.sttDtype)} is not a precision here; used fp32`)
      next.sttDtype = DEFAULT_SETTINGS.sttDtype
    }

    const written = await this.repository.put(next)
    if (!written.ok) notes.push(`not saved for next time: ${written.failure.message}`)
    // Returned either way: the settings apply to this session even when the
    // write failed, and pretending otherwise would be a second, invented fault.
    return Outcome.ok(next, notes)
  }
}
