import { TransformersTranscriber } from './TransformersTranscriber.js'

/**
 * Moonshine — the same job as whisper, minus the padding.
 *
 * Its encoder takes the audio at whatever length it is, so a two-second partial
 * costs two seconds of work instead of thirty. That is the whole reason it is
 * here: it is the engine that makes live partials cheap enough to produce while
 * somebody is still talking, on a machine with no GPU.
 *
 * It is English-only and has no timestamps, which is the trade. For dictation —
 * short utterances, one language, revised every second — that is the right side
 * of it.
 */
export class MoonshineTranscriber extends TransformersTranscriber {
  static LABEL = 'moonshine'
  static DEFAULT_MODEL = 'onnx-community/moonshine-base-ONNX'

  /**
   * The token budget is set here rather than left to the pipeline.
   *
   * Measured in the pipeline's source: it derives `max_new_tokens` as
   * `floor(seconds) * 6`, following the paper's heuristic. For audio under one
   * second that is **zero**, and a partial produced from the first block of a
   * dictation comes back as an empty string with no failure to report. The floor
   * is what makes the first partial appear at all; the ceiling is the same
   * heuristic, kept, because it is what stops a greedy decoder looping on a
   * held vowel.
   */
  options(seconds) {
    return { max_new_tokens: Math.max(12, Math.floor(seconds) * 6) }
  }
}
