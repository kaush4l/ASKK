import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Voice } from '../../src/client/Speech.js'
import { Voice as VoiceKind } from '../../src/core/speech/index.js'

/**
 * The browser's own voice, driven the way the page drives it.
 *
 * `Voice` keeps ONE speaker for the life of the tab — the object is expensive to
 * nothing, but a second one would abandon the first one's queue — while the
 * settings arrive fresh on every reply, because `page.jsx` assigns
 * `voiceRef.current.settings` before each `say`. That is the whole shape under
 * test: a field the settings sheet can change is only ever heard if it is read
 * off that record again at the moment of speaking.
 *
 * It is here because one field was not. The voice list added this wave chose the
 * voice for the first reply a tab ever spoke and for no later one, so a person
 * who tried a voice, disliked it and picked another went on hearing the first
 * until they reloaded — and the settings sheet said otherwise.
 *
 * `speechSynthesis` is patched onto `globalThis` rather than injected, because
 * `WebSpeechSpeaker` probes for the object itself: it is a page API and there is
 * no seam to hand one through. It is put back afterwards so the next file in the
 * run does not inherit a browser that does not exist.
 */

/** The voices this fake device has installed. */
const INSTALLED = [
  { name: 'Daniel', lang: 'en-GB', localService: true },
  { name: 'Karen', lang: 'en-AU', localService: true },
]

/** Every utterance the fake synthesiser was asked to speak, in order. */
let spoken = []

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.voice = null
    this.rate = 1
    this.pitch = 1
    this._listeners = {}
  }

  addEventListener(type, fn) {
    this._listeners[type] = fn
  }
}

const synthesis = {
  getVoices: () => INSTALLED,
  addEventListener() {},
  cancel() {},
  speak(utterance) {
    spoken.push(utterance)
    // The real API resolves `speak` through an `end` event, which is what the
    // speaker awaits, so a fake that only recorded the utterance would hang.
    utterance._listeners.end?.()
  },
}

const realSynthesis = globalThis.speechSynthesis
const realUtterance = globalThis.SpeechSynthesisUtterance
beforeEach(() => {
  spoken = []
  globalThis.speechSynthesis = synthesis
  globalThis.SpeechSynthesisUtterance = FakeUtterance
})
afterEach(() => {
  globalThis.speechSynthesis = realSynthesis
  globalThis.SpeechSynthesisUtterance = realUtterance
})

describe('reading two replies aloud with the settings changed in between', () => {
  test('the second reply is spoken in the voice that was chosen, not the one that was', async () => {
    const voice = new Voice({
      ttsKind: VoiceKind.NATIVE,
      ttsVoice: 'Daniel',
      ttsRate: 1,
      ttsPitch: 1,
    })

    expect((await voice.say('the first reply')).ok).toBe(true)

    // What the page does when the settings sheet is saved: a new record on the
    // same object. Nothing rebuilds the speaker, which is exactly why every
    // field has to be re-applied rather than only the ones somebody remembered.
    voice.settings = {
      ttsKind: VoiceKind.NATIVE,
      ttsVoice: 'Karen',
      ttsRate: 1.5,
      ttsPitch: 0.8,
    }
    expect((await voice.say('the second reply')).ok).toBe(true)

    expect(spoken.map((one) => [one.text, one.voice?.name, one.rate, one.pitch])).toEqual([
      ['the first reply', 'Daniel', 1, 1],
      ['the second reply', 'Karen', 1.5, 0.8],
    ])
  })

  test('clearing the voice goes back to the one the operating system picks', async () => {
    // An empty name is a choice — "whichever voice this device speaks in" — and
    // not a missing setting, so it must clear a voice that was chosen earlier
    // rather than leave the last named one in place.
    const voice = new Voice({ ttsKind: VoiceKind.NATIVE, ttsVoice: 'Karen' })
    await voice.say('named')

    voice.settings = { ttsKind: VoiceKind.NATIVE, ttsVoice: '' }
    const spokenAgain = await voice.say('unnamed')

    expect(spokenAgain.ok).toBe(true)
    expect(spoken.map((one) => one.voice?.name ?? null)).toEqual(['Karen', null])
  })
})
