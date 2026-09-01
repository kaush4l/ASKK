import { Outcome } from '../Outcome.js'
import { MoonshineTranscriber } from './MoonshineTranscriber.js'
import { Speaker } from './Speaker.js'
import { SupertonicSpeaker } from './SupertonicSpeaker.js'
import { Transcriber } from './Transcriber.js'
import { TransformersSpeaker } from './TransformersSpeaker.js'
import { TransformersTranscriber } from './TransformersTranscriber.js'
import { VitsSpeaker } from './VitsSpeaker.js'
import { WebSpeechSpeaker } from './WebSpeechSpeaker.js'
import { WebSpeechTranscriber } from './WebSpeechTranscriber.js'
import { WhisperTranscriber } from './WhisperTranscriber.js'

/**
 * The ways this app can hear. Three, because they fail in different places: the
 * native one is absent on a whole browser, whisper is accurate and slow, and
 * moonshine is fast and English-only. A user who cannot dictate with one of them
 * can dictate with another.
 */
export const Ear = Object.freeze({
  NATIVE: 'native',
  WHISPER: 'whisper',
  MOONSHINE: 'moonshine',
})

/** The ways this app can speak, chosen on the same grounds. */
export const Voice = Object.freeze({
  NATIVE: 'native',
  SUPERTONIC: 'supertonic',
  VITS: 'vits',
})

const EARS = {
  [Ear.NATIVE]: WebSpeechTranscriber,
  [Ear.WHISPER]: WhisperTranscriber,
  [Ear.MOONSHINE]: MoonshineTranscriber,
}

const VOICES = {
  [Voice.NATIVE]: WebSpeechSpeaker,
  [Voice.SUPERTONIC]: SupertonicSpeaker,
  [Voice.VITS]: VitsSpeaker,
}

/**
 * Build a transcriber, correcting an unrecognised kind instead of refusing.
 *
 * Same rule as `createInference`, for the same reason: a stored setting can
 * name an engine a later build no longer has, and an app that will not start is
 * worse than one that says what it substituted.
 *
 * @returns {Outcome} value is a Transcriber
 */
export function createTranscriber({ kind = Ear.WHISPER, ...settings } = {}) {
  const notes = []
  let chosen = kind
  if (!EARS[chosen]) {
    notes.push(
      `speech-to-text engine ${JSON.stringify(kind)} is not available; used ${Ear.WHISPER}`,
    )
    chosen = Ear.WHISPER
  }
  return Outcome.ok(new EARS[chosen](settings), notes)
}

/**
 * Build a voice, correcting an unrecognised kind instead of refusing.
 *
 * @returns {Outcome} value is a Speaker
 */
export function createSpeaker({ kind = Voice.NATIVE, ...settings } = {}) {
  const notes = []
  let chosen = kind
  if (!VOICES[chosen]) {
    notes.push(`voice ${JSON.stringify(kind)} is not available; used ${Voice.NATIVE}`)
    chosen = Voice.NATIVE
  }
  return Outcome.ok(new VOICES[chosen](settings), notes)
}

/** Whether an engine has to be constructed in the page because it owns a device there. */
export function earOwnsInput(kind) {
  return (EARS[kind] ?? EARS[Ear.WHISPER]).OWNS_INPUT === true
}

/** Whether a voice plays its own audio, rather than returning samples to be played. */
export function voiceOwnsOutput(kind) {
  return (VOICES[kind] ?? VOICES[Voice.NATIVE]).OWNS_OUTPUT === true
}

/** The model a kind uses when the user has named none. Empty where nothing is downloaded. */
export function defaultModelFor(kind) {
  return (EARS[kind] ?? VOICES[kind])?.DEFAULT_MODEL ?? ''
}

export { MODEL_SAMPLE_RATE, resample, toWav } from './audio.js'
export {
  MoonshineTranscriber,
  Speaker,
  SupertonicSpeaker,
  Transcriber,
  TransformersSpeaker,
  TransformersTranscriber,
  VitsSpeaker,
  WebSpeechSpeaker,
  WebSpeechTranscriber,
  WhisperTranscriber,
}
