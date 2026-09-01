import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import {
  createSpeaker,
  createTranscriber,
  defaultModelFor,
  Ear,
  earOwnsInput,
  Voice,
  voiceOwnsOutput,
} from '../../../src/core/speech/index.js'
import { TransformersSpeaker } from '../../../src/core/speech/TransformersSpeaker.js'
import { TransformersTranscriber } from '../../../src/core/speech/TransformersTranscriber.js'
import { WebSpeechSpeaker } from '../../../src/core/speech/WebSpeechSpeaker.js'

/**
 * The speech registry, at the seam where a row becomes a call.
 *
 * This file exists because four config records used to be spelled as classes
 * and nothing anywhere executed them. `bun test` was green at 277 with
 * `WhisperTranscriber.options()` returning `{}`, with its default model
 * misspelled, and with moonshine's token floor deleted — the whole family was
 * reachable only through a transformers.js pipeline no test builds.
 *
 * So the assertions below stop at the pipeline and read what it was handed.
 * Substituting `_pipeline` is what makes `load()` a no-op and turns
 * `transcribe` into the shortest path from a registry row to the options the
 * checkpoint is actually called with. Asserting on `transcriber.options(...)`
 * directly would prove the row holds a function and nothing about whether it
 * reaches the model.
 */

/** Run one transcription against a stub pipeline and report the options it saw. */
async function optionsPassedTo(transcriber, seconds) {
  let seen = null
  transcriber._pipeline = (_samples, options) => {
    seen = options
    return { text: ' heard ' }
  }
  const said = await transcriber.transcribe({
    samples: new Float32Array(Math.round(seconds * 16_000)),
    sampleRate: 16_000,
  })
  expect(said.ok).toBe(true)
  expect(said.value).toBe('heard')
  return seen
}

/**
 * The shape `SpeechService` actually calls with: every field it knows of is an
 * own key, and the ones the user never filled in hold `undefined`. This is the
 * argument that a spread merge silently loses a row to, so it is the argument
 * these assertions are made against.
 *
 * One helper for both calls, holding the union of what `dictate` and `speak`
 * pass. A field the other call never sends still arrives as `undefined`, which
 * is the only thing being guarded here, and two helpers would have to be kept in
 * step with two signatures to prove the same thing once.
 */
function asTheServiceCalls(overrides) {
  return {
    kind: undefined,
    model: undefined,
    voice: undefined,
    language: undefined,
    partialEvery: undefined,
    segmentSeconds: undefined,
    rate: undefined,
    pitch: undefined,
    dtype: undefined,
    device: undefined,
    ...overrides,
  }
}

describe('the transcriber registry', () => {
  test('the default kind is whisper, built on the shared transformers loader', () => {
    const built = createTranscriber()
    expect(built.ok).toBe(true)
    expect(built.notes).toEqual([])
    expect(built.value).toBeInstanceOf(TransformersTranscriber)
    expect(built.value.model).toBe('onnx-community/whisper-base')
  })

  test('each row names its own checkpoint', () => {
    expect(createTranscriber({ kind: Ear.MOONSHINE }).value.model).toBe(
      'onnx-community/moonshine-base-ONNX',
    )
    expect(defaultModelFor(Ear.WHISPER)).toBe('onnx-community/whisper-base')
    expect(defaultModelFor(Ear.MOONSHINE)).toBe('onnx-community/moonshine-base-ONNX')
    expect(defaultModelFor(Ear.NATIVE)).toBe('')
  })

  test('a model the user typed beats the row', () => {
    expect(createTranscriber({ model: 'Xenova/whisper-tiny.en' }).value.model).toBe(
      'Xenova/whisper-tiny.en',
    )
  })

  test('an unrecognised kind is corrected and said out loud', () => {
    const built = createTranscriber({ kind: 'wav2vec' })
    expect(built.ok).toBe(true)
    expect(built.value.model).toBe('onnx-community/whisper-base')
    expect(built.notes).toEqual(['speech-to-text engine "wav2vec" is not available; used whisper'])
  })

  test('a setting nobody filled in does not cost whisper its full-precision export', () => {
    const built = createTranscriber(asTheServiceCalls({ kind: Ear.WHISPER }))
    expect(built.value.dtype).toBe('fp32')
    expect(built.value.device).toBe('wasm')
  })

  test('a dtype the user chose beats the loader default', () => {
    expect(createTranscriber({ dtype: 'q8' }).value.dtype).toBe('q8')
  })

  test('only the native ear claims the microphone', () => {
    expect(earOwnsInput(Ear.NATIVE)).toBe(true)
    expect(earOwnsInput(Ear.WHISPER)).toBe(false)
    expect(earOwnsInput(Ear.MOONSHINE)).toBe(false)
    // The kind this question is asked with comes out of stored settings, so it
    // can name an engine this build no longer has. Answering `true` there sends
    // the audio to a realm with no getUserMedia.
    expect(earOwnsInput('wav2vec')).toBe(false)
  })
})

describe('the options a row hands the pipeline', () => {
  test('whisper asks for a transcription with no timestamps', async () => {
    const built = createTranscriber({ kind: Ear.WHISPER, language: 'fr' })
    const options = await optionsPassedTo(built.value, 3)
    expect(options).toEqual({ task: 'transcribe', return_timestamps: false, language: 'fr' })
  })

  test('whisper drops the language for an English-only checkpoint', async () => {
    for (const model of ['Xenova/whisper-tiny.en', 'onnx-community/whisper-small.en-ONNX']) {
      const built = createTranscriber({ kind: Ear.WHISPER, model, language: 'en' })
      const options = await optionsPassedTo(built.value, 3)
      expect(options).toEqual({ task: 'transcribe', return_timestamps: false })
    }
  })

  test('moonshine floors its token budget so the first partial is not empty', async () => {
    const built = createTranscriber({ kind: Ear.MOONSHINE })
    expect(await optionsPassedTo(built.value, 0.5)).toEqual({ max_new_tokens: 12 })
    expect(await optionsPassedTo(built.value, 10)).toEqual({ max_new_tokens: 60 })
  })

  test('an engine nobody handed options to still calls the pipeline', async () => {
    const bare = new TransformersTranscriber({ model: 'onnx-community/whisper-base' })
    expect(await optionsPassedTo(bare, 3)).toEqual({})
  })

  test('an ear whose options refuse is refused before the pipeline runs', async () => {
    const refusing = new TransformersTranscriber({
      model: 'onnx-community/whisper-base',
      options: () => Outcome.failed(Reason.BAD_REQUEST, 'this checkpoint needs a language'),
    })
    let called = false
    refusing._pipeline = () => {
      called = true
      return { text: 'heard' }
    }
    const said = await refusing.transcribe({
      samples: new Float32Array(16_000),
      sampleRate: 16_000,
    })
    expect(said.ok).toBe(false)
    expect(said.failure.message).toBe('this checkpoint needs a language')
    expect(called).toBe(false)
  })
})

/** Run one synthesis against a stub pipeline and report the options it saw. */
async function optionsHandedTo(speaker, text = 'hello') {
  let seen = null
  speaker._pipeline = (_text, options) => {
    seen = options
    return { audio: new Float32Array(8), sampling_rate: 24_000 }
  }
  const spoken = await speaker.synthesize(text)
  expect(spoken.ok).toBe(true)
  expect(spoken.value.sampleRate).toBe(24_000)
  return seen
}

describe('the speaker registry', () => {
  test('the default voice is the one the browser already has', () => {
    const built = createSpeaker()
    expect(built.ok).toBe(true)
    expect(built.notes).toEqual([])
    expect(built.value).toBeInstanceOf(WebSpeechSpeaker)
    expect(built.value.model).toBe('')
    expect(defaultModelFor(Voice.NATIVE)).toBe('')
  })

  test('each row names its own checkpoint', () => {
    expect(createSpeaker({ kind: Voice.VITS }).value.model).toBe('Xenova/mms-tts-eng')
    expect(createSpeaker({ kind: Voice.SUPERTONIC }).value.model).toBe(
      'onnx-community/Supertonic-TTS-ONNX',
    )
    expect(defaultModelFor(Voice.VITS)).toBe('Xenova/mms-tts-eng')
    expect(defaultModelFor(Voice.SUPERTONIC)).toBe('onnx-community/Supertonic-TTS-ONNX')
  })

  test('a setting nobody filled in does not cost mms-vits its q8 export', () => {
    const built = createSpeaker(asTheServiceCalls({ kind: Voice.VITS }))
    expect(built.value.dtype).toBe('q8')
    expect(built.value.model).toBe('Xenova/mms-tts-eng')
    expect(built.value.device).toBe('wasm')
  })

  test('a row with no dtype falls back to the loader default', () => {
    expect(createSpeaker(asTheServiceCalls({ kind: Voice.SUPERTONIC })).value.dtype).toBe('fp32')
  })

  test('a dtype the user chose beats the row', () => {
    expect(createSpeaker({ kind: Voice.VITS, dtype: 'fp16' }).value.dtype).toBe('fp16')
  })

  test('an unrecognised kind is corrected and said out loud', () => {
    const built = createSpeaker({ kind: 'speecht5' })
    expect(built.value).toBeInstanceOf(WebSpeechSpeaker)
    expect(built.notes).toEqual(['voice "speecht5" is not available; used native'])
  })

  test('only the native voice plays its own audio', () => {
    expect(voiceOwnsOutput(Voice.NATIVE)).toBe(true)
    expect(voiceOwnsOutput(Voice.VITS)).toBe(false)
    expect(voiceOwnsOutput(Voice.SUPERTONIC)).toBe(false)
    // As `earOwnsInput`: an unknown kind falls back to the engine that can play
    // its own audio, because that is the one that works with nothing wired up.
    expect(voiceOwnsOutput('speecht5')).toBe(true)
  })
})

describe('the options a voice row hands the pipeline', () => {
  test('supertonic sends the published style vector when the user named none', async () => {
    const built = createSpeaker(asTheServiceCalls({ kind: Voice.SUPERTONIC }))
    expect(await optionsHandedTo(built.value)).toEqual({
      speaker_embeddings:
        'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/F1.bin',
    })
  })

  test('supertonic sends the style vector the user named', async () => {
    const built = createSpeaker({
      kind: Voice.SUPERTONIC,
      voice: 'https://example.test/voices/M2.bin',
    })
    expect(await optionsHandedTo(built.value)).toEqual({
      speaker_embeddings: 'https://example.test/voices/M2.bin',
    })
  })

  test('supertonic refuses a style vector that is not a URL, before the pipeline runs', async () => {
    const built = createSpeaker({ kind: Voice.SUPERTONIC, voice: 'F1' })
    let called = false
    built.value._pipeline = () => {
      called = true
      return { audio: new Float32Array(8), sampling_rate: 24_000 }
    }
    const spoken = await built.value.synthesize('hello')
    expect(spoken.ok).toBe(false)
    expect(spoken.failure.code).toBe(Reason.BAD_REQUEST)
    expect(spoken.failure.message).toBe('supertonic needs a style vector, and "F1" is not a URL')
    expect(called).toBe(false)
  })

  test('mms-vits needs no options and is called with none', async () => {
    const built = createSpeaker(asTheServiceCalls({ kind: Voice.VITS }))
    expect(await optionsHandedTo(built.value)).toEqual({})
  })

  test('a voice nobody handed options to still calls the pipeline', async () => {
    const bare = new TransformersSpeaker({ model: 'Xenova/mms-tts-eng' })
    expect(await optionsHandedTo(bare)).toEqual({})
  })
})

describe('what a synthesis reports besides the samples', () => {
  test('a voice that loaded at a precision it was not asked for says so, once', async () => {
    const speaker = createSpeaker(asTheServiceCalls({ kind: Voice.VITS })).value
    const note = '"Xenova/mms-tts-eng" could not be built at q8 (…); loaded at fp32 instead'
    // `_build` is the download, and it is the only thing substituted: what it
    // does on a successful retry is set the pipeline and report the precision it
    // actually got. The real `load()` runs, memo and short-circuit included,
    // which is what the second assertion below is about.
    speaker._build = async () => {
      speaker._pipeline = () => ({ audio: new Float32Array(8), sampling_rate: 24_000 })
      return Outcome.ok(null).withNote(note)
    }

    expect((await speaker.synthesize('hello')).notes).toEqual([note])
    // The second sentence is spoken by a model that is already loaded, and a
    // download that happened once is not news twice.
    expect((await speaker.synthesize('and again')).notes).toEqual([])
  })

  test('a voice that returns an empty waveform names the checkpoint that went quiet', async () => {
    const speaker = createSpeaker({ kind: Voice.VITS }).value
    speaker._pipeline = () => ({ audio: new Float32Array(0), sampling_rate: 24_000 })
    const spoken = await speaker.synthesize('hello')
    expect(spoken.ok).toBe(false)
    expect(spoken.failure.code).toBe(Reason.INTERNAL)
    expect(spoken.failure.message).toBe('Xenova/mms-tts-eng produced no audio')
  })
})
