import { Outcome, Reason } from '../Outcome.js'
import { Speaker } from './Speaker.js'
import { Transcriber } from './Transcriber.js'
import { TransformersSpeaker } from './TransformersSpeaker.js'
import { TransformersTranscriber } from './TransformersTranscriber.js'
import { WebSpeechSpeaker } from './WebSpeechSpeaker.js'
import { WebSpeechTranscriber } from './WebSpeechTranscriber.js'

/**
 * The ways this app can hear. Three, because they fail in different places: the
 * native one is absent on a whole browser, whisper is accurate and slow, and
 * moonshine is fast and English-only. A user who cannot dictate with one of them
 * can dictate with another.
 *
 * Whisper is slow for a reason worth naming, because it is what buys moonshine
 * its row: **whisper's feature extractor pads every input to thirty seconds**,
 * so a two-second partial costs what a full segment costs. Moonshine's encoder
 * takes the audio at whatever length it is, which is what makes live partials
 * cheap enough to produce while somebody is still talking on a machine with no
 * GPU. It is English-only and has no timestamps; that is the trade.
 */
export const Ear = Object.freeze({
  NATIVE: 'native',
  WHISPER: 'whisper',
  MOONSHINE: 'moonshine',
})

/**
 * The ways this app can speak, chosen on the same grounds.
 *
 * The two local voices are a real pair rather than two sizes of one thing.
 * Supertonic is a diffusion vocoder conditioned on a **style vector**, one file
 * per voice, so it is the one that can sound like somebody in particular.
 * MMS-VITS is a single-stage generator, one 65 MB file, no vector to find — the
 * local voice that works on a first try, and where the language lives in the
 * model id (`Xenova/mms-tts-eng`, `-fra`, `-deu`, and eleven hundred others), so
 * changing language is changing a string.
 */
export const Voice = Object.freeze({
  NATIVE: 'native',
  SUPERTONIC: 'supertonic',
  VITS: 'vits',
})

/**
 * Whisper's call options.
 *
 * An Outcome and not a bare record, as every row's `options` is. Supertonic has
 * to be able to refuse before a 200 MB download, and one field name carrying a
 * record in one registry and an Outcome in the other is the same trap this file
 * was written to delete, one layer up: the caller reads `options.ok`, a record
 * has no such key, and the record travels on as if it were an Outcome.
 *
 * Timestamps are off because nothing here reads them and asking for them makes
 * the decoder emit — and the tokenizer keep — tokens that are not words.
 *
 * The language is dropped for an English-only checkpoint. Those models have no
 * language tokens at all, so naming one is not a narrower request, it is an
 * invalid decoder prompt, and the failure names a token id rather than the
 * setting that caused it.
 */
function whisperOptions({ model, language }) {
  const englishOnly = /\.en(-ONNX)?$/i.test(model)
  return Outcome.ok({
    task: 'transcribe',
    return_timestamps: false,
    ...(language && !englishOnly ? { language } : {}),
  })
}

/**
 * Moonshine's token budget, set here rather than left to the pipeline.
 *
 * Measured in the pipeline's source: it derives `max_new_tokens` as
 * `floor(seconds) * 6`, following the paper's heuristic. For audio under one
 * second that is **zero**, and a partial produced from the first block of a
 * dictation comes back as an empty string with no failure to report. The floor
 * is what makes the first partial appear at all; the ceiling is the same
 * heuristic, kept, because it is what stops a greedy decoder looping on a held
 * vowel.
 */
function moonshineOptions({ seconds }) {
  return Outcome.ok({ max_new_tokens: Math.max(12, Math.floor(seconds) * 6) })
}

/**
 * Kind -> the class that runs it, and the defaults it is configured with.
 *
 * A row and not a subclass: both local ears reach the same pipeline through the
 * same loader, and differ only by the checkpoint they name and the options that
 * checkpoint is called with. A class for that pair of literals is a file, an
 * import and a link in an inheritance chain bought with nothing.
 */
const EARS = {
  [Ear.NATIVE]: { engine: WebSpeechTranscriber },
  [Ear.WHISPER]: {
    engine: TransformersTranscriber,
    // `base` rather than `tiny`: at this size the difference between them is
    // whether "recognise speech" comes back as "wreck a nice beach", and 145 MB
    // is still one download. Anything else the user types is honoured as-is.
    model: 'onnx-community/whisper-base',
    options: whisperOptions,
  },
  [Ear.MOONSHINE]: {
    engine: TransformersTranscriber,
    model: 'onnx-community/moonshine-base-ONNX',
    options: moonshineOptions,
  },
}

/** Ten voices are published beside the supertonic weights; this is the first of them. */
const SUPERTONIC_VOICE =
  'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/F1.bin'

/**
 * Supertonic's style vector, refused early rather than passed on empty.
 *
 * Without an embedding the pipeline throws from inside a tensor reshape, and the
 * message names a dimension rather than the setting the user emptied. This is
 * the row that justifies `options` answering an Outcome at all: every other
 * checkpoint here can be called with whatever it was given.
 *
 * The voice is a URL rather than a bundled file: it is a small tensor published
 * beside the model, and baking one in would make "a different voice" a rebuild
 * instead of a setting.
 */
function supertonicOptions({ voice }) {
  const embeddings = voice || SUPERTONIC_VOICE
  if (!/^https?:/.test(embeddings)) {
    return Outcome.failed(
      Reason.BAD_REQUEST,
      `${Voice.SUPERTONIC} needs a style vector, and "${embeddings}" is not a URL`,
      {
        hint: 'Leave the voice field empty for the published default, or paste the URL of one of the model’s voices/*.bin files.',
      },
    )
  }
  return Outcome.ok({ speaker_embeddings: embeddings })
}

/** Kind -> the class that runs it, and the defaults it is configured with. As `EARS`. */
const VOICES = {
  [Voice.NATIVE]: { engine: WebSpeechSpeaker },
  [Voice.SUPERTONIC]: {
    engine: TransformersSpeaker,
    // `Xenova/speecht5_tts` was the obvious choice for this slot and is measured
    // not to work. The `text-to-speech` task is registered in transformers.js
    // 4.2.0 with `type: 'text'`, so the pipeline loads a tokenizer and a model
    // and never a processor — and `TextToAudioPipeline._call` reaches its
    // SpeechT5 branch only `if (this.processor)`. The call falls through to the
    // plain text-to-waveform path, the speaker embedding is dropped in silence,
    // and the session fails with `Missing the following inputs:
    // speaker_embedding` after a 200 MB download. Supertonic is that library
    // version's own default for this task and has a branch that reads it.
    model: 'onnx-community/Supertonic-TTS-ONNX',
    options: supertonicOptions,
  },
  [Voice.VITS]: {
    engine: TransformersSpeaker,
    model: 'Xenova/mms-tts-eng',
    // Not the `fp32` the loader defaults to. These checkpoints publish `fp32`,
    // `fp16` and `q8` and nothing else, and `q8` is a third of the download for
    // a single-stage generator whose output is already conversational quality.
    dtype: 'q8',
  },
}

/**
 * Construct a row's engine on top of that row's own defaults.
 *
 * The merge is written field by field rather than as a spread of the row under
 * the settings, because `SpeechService` passes every field it knows of as an own
 * key — `undefined` included — and a spread would let a setting nobody filled in
 * overwrite the row's value with nothing. Three parallel `settings.x || row.x`
 * lines say that; a rest-spread reads like the thing it is guarding against.
 *
 * The row is not destructured into a local named `Engine`. `Engine` in this tree
 * is the agent loop's engine, and lending the most loaded noun here a second
 * meaning costs more than the six characters it saves.
 */
function build(row, settings) {
  return new row.engine({
    ...settings,
    model: settings.model || row.model,
    dtype: settings.dtype || row.dtype,
    options: row.options,
  })
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
  return Outcome.ok(build(EARS[chosen], settings), notes)
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
  return Outcome.ok(build(VOICES[chosen], settings), notes)
}

/** Whether an engine has to be constructed in the page because it owns a device there. */
export function earOwnsInput(kind) {
  return (EARS[kind] ?? EARS[Ear.WHISPER]).engine.OWNS_INPUT === true
}

/** Whether a voice plays its own audio, rather than returning samples to be played. */
export function voiceOwnsOutput(kind) {
  return (VOICES[kind] ?? VOICES[Voice.NATIVE]).engine.OWNS_OUTPUT === true
}

/**
 * The model a kind uses when the user has named none. Empty where nothing is
 * downloaded.
 *
 * Ears are searched first, and `native` is a key in both registries — which is
 * safe only because neither `native` row carries a model. The day an ear and a
 * voice share a key and disagree about the checkpoint, `SettingsService` fills
 * the tts field from the ear, silently. Splitting this into `earModel` and
 * `voiceModel` is the fix, and it is an edit to `SettingsService` as well.
 */
export function defaultModelFor(kind) {
  return (EARS[kind] ?? VOICES[kind])?.model ?? ''
}

export { MODEL_SAMPLE_RATE, resample, toWav } from './audio.js'
export {
  Speaker,
  Transcriber,
  TransformersSpeaker,
  TransformersTranscriber,
  WebSpeechSpeaker,
  WebSpeechTranscriber,
}
