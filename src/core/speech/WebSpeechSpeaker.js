import { Outcome, Reason } from '../Outcome.js'
import { Speaker } from './Speaker.js'

/**
 * The voice the operating system already has.
 *
 * Nothing to download, dozens of languages, and it starts speaking in
 * milliseconds — which for reading a reply aloud is worth more than the
 * naturalness a 65 MB model buys. It is the default for that reason.
 *
 * What it cannot do is give anyone the audio. `speechSynthesis` speaks; it does
 * not render. So this class overrides `speak` and leaves `synthesize` reporting
 * the base class's honest refusal, rather than pretending to a waveform it can
 * never produce. It is also page-only — there is no `speechSynthesis` in a
 * worker — which it declares with `OWNS_OUTPUT` and proves by probing for the
 * object, never by asking what realm it is in.
 */
export class WebSpeechSpeaker extends Speaker {
  static LABEL = 'browser voice'
  static OWNS_OUTPUT = true

  static _api() {
    return globalThis.speechSynthesis ?? null
  }

  async load() {
    return WebSpeechSpeaker._api()
      ? Outcome.ok(null)
      : Outcome.failed(Reason.UNAVAILABLE, 'this browser has no speech synthesis API', {
          hint: 'Choose a local voice — supertonic or mms-vits — to run a model instead.',
        })
  }

  /**
   * Resolves when the utterance has finished being spoken, not when it has been
   * queued. A caller that reads a reply aloud and then says something else has
   * to be able to wait for the first one, and `speak()` returns immediately.
   */
  async speak(text) {
    const available = await this.load()
    if (!available.ok) return available
    const said = String(text ?? '').trim()
    if (!said) return Outcome.ok(null)

    const synthesis = WebSpeechSpeaker._api()
    // Anything still queued from a previous reply is abandoned. Two answers
    // spoken over each other is worse than the older one being cut off.
    synthesis.cancel()

    const chosen = await this._voice(synthesis)
    return Outcome.attempt(
      () =>
        new Promise((resolve, reject) => {
          const utterance = new globalThis.SpeechSynthesisUtterance(said)
          utterance.rate = this.rate
          utterance.pitch = this.pitch
          if (chosen) utterance.voice = chosen
          utterance.addEventListener('end', () => resolve(null), { once: true })
          utterance.addEventListener(
            'error',
            (event) => {
              // A cancel is how `stop` works, so it must not be reported as a
              // fault by the call it deliberately interrupted.
              if (event.error === 'canceled' || event.error === 'interrupted') resolve(null)
              else reject(new Error(`the browser voice failed: ${event.error}`))
            },
            { once: true },
          )
          synthesis.speak(utterance)
        }),
      {
        code: Reason.UNAVAILABLE,
        hint: 'The browser refused to speak. Some browsers require a click on the page before any audio may start.',
      },
    ).then((spoken) =>
      spoken.ok && this.voice && !chosen
        ? spoken.withNote(`no installed voice is named "${this.voice}"; used the default one`)
        : spoken,
    )
  }

  async stop() {
    WebSpeechSpeaker._api()?.cancel()
    return Outcome.ok(null)
  }

  /**
   * The voice list is populated asynchronously and is empty on the first call in
   * a fresh tab — reading it once would silently mean "no voices" for the first
   * thing the app ever says. One `voiceschanged` event is waited for, with a
   * deadline, because on a browser that has no voices at all the event never
   * arrives and waiting for it forever would be worse than speaking in the
   * default one.
   */
  async _voice(synthesis) {
    if (!this.voice) return null
    let voices = synthesis.getVoices()
    if (!voices.length) {
      voices = await new Promise((resolve) => {
        const done = setTimeout(() => resolve(synthesis.getVoices()), 1000)
        synthesis.addEventListener(
          'voiceschanged',
          () => {
            clearTimeout(done)
            resolve(synthesis.getVoices())
          },
          { once: true },
        )
      })
    }
    const wanted = this.voice.toLowerCase()
    return (
      voices.find((voice) => voice.name.toLowerCase() === wanted) ??
      voices.find((voice) => voice.name.toLowerCase().includes(wanted)) ??
      null
    )
  }
}
