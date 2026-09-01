import { TransformersTranscriber } from './TransformersTranscriber.js'

/**
 * Whisper — the encoder-decoder everything else in speech recognition is
 * compared against, and the reason a model id is worth exposing at all: the
 * same class serves `whisper-tiny.en` at 40 MB and `whisper-large-v3-turbo` at
 * eight hundred, because they differ by a string.
 *
 * The one thing it costs, and the reason there is a second engine below it:
 * **whisper's feature extractor pads every input to thirty seconds.** A two
 * second partial is transcribed as two seconds of speech followed by
 * twenty-eight of silence, so the fast case costs what the slow case costs. It
 * is the accuracy option, not the live one.
 */
export class WhisperTranscriber extends TransformersTranscriber {
  static LABEL = 'whisper'

  /**
   * `base` rather than `tiny`: at this size the difference between them is
   * whether "recognise speech" comes back as "wreck a nice beach", and 145 MB is
   * still one download. Anything else the user types is honoured as-is.
   */
  static DEFAULT_MODEL = 'onnx-community/whisper-base'

  /**
   * Timestamps are off because nothing here reads them and asking for them makes
   * the decoder emit — and the tokenizer keep — tokens that are not words.
   *
   * The language is dropped for an English-only checkpoint. Those models have no
   * language tokens at all, so naming one is not a narrower request, it is an
   * invalid decoder prompt, and the failure names a token id rather than the
   * setting that caused it.
   */
  options() {
    const englishOnly = /\.en(-ONNX)?$/i.test(this.model)
    return {
      task: 'transcribe',
      return_timestamps: false,
      ...(this.language && !englishOnly ? { language: this.language } : {}),
    }
  }
}
