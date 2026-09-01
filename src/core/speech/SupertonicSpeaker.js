import { Outcome, Reason } from '../Outcome.js'
import { TransformersSpeaker } from './TransformersSpeaker.js'

/**
 * Supertonic — a diffusion vocoder conditioned on a **style vector**, one file
 * per voice.
 *
 * This is the checkpoint that justifies the shape of this layer. It does not
 * take text and give back a waveform: it needs a tensor saying whose voice to
 * use, and it takes a number of denoising steps that trades quality against
 * time. Neither of those is true of the voice beside it in the same menu, and
 * neither of them reaches the caller — which is the whole point of `Speaker`
 * having one verb.
 *
 * `Xenova/speecht5_tts` was the obvious choice for this slot and it is measured
 * not to work. The `text-to-speech` task is registered in transformers.js 4.2.0
 * with `type: 'text'`, so the pipeline loads a tokenizer and a model and never a
 * processor — and `TextToAudioPipeline._call` reaches its SpeechT5 branch only
 * `if (this.processor)`. The call therefore falls through to the plain
 * text-to-waveform path, the speaker embedding is dropped in silence, and the
 * session fails with `Missing the following inputs: speaker_embedding` after a
 * 200 MB download. Supertonic is that library version's own default for this
 * task and has a branch of its own that reads the embedding.
 *
 * The voice is a URL rather than a bundled file: it is a small tensor published
 * beside the model, and baking one in would make "a different voice" a rebuild
 * instead of a setting.
 */
export class SupertonicSpeaker extends TransformersSpeaker {
  static LABEL = 'supertonic'
  static DEFAULT_MODEL = 'onnx-community/Supertonic-TTS-ONNX'

  /** Ten voices are published beside the weights; this is the first of them. */
  static DEFAULT_VOICE =
    'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/F1.bin'

  /**
   * Refused early rather than passed on empty: without an embedding the pipeline
   * throws from inside a tensor reshape, and the message names a dimension
   * rather than the setting the user emptied.
   */
  async options() {
    const embeddings = this.voice || SupertonicSpeaker.DEFAULT_VOICE
    if (!/^https?:/.test(embeddings)) {
      return Outcome.failed(
        Reason.BAD_REQUEST,
        `${SupertonicSpeaker.LABEL} needs a style vector, and "${embeddings}" is not a URL`,
        {
          hint: 'Leave the voice field empty for the published default, or paste the URL of one of the model’s voices/*.bin files.',
        },
      )
    }
    return Outcome.ok({ speaker_embeddings: embeddings })
  }
}
