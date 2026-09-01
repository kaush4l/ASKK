import { TransformersSpeaker } from './TransformersSpeaker.js'

/**
 * MMS — one small end-to-end VITS model per language, text in and waveform out.
 *
 * The counterweight to Supertonic in the same menu: no style vector to find and
 * no denoising steps to trade off, one file of about 65 MB. It is the local voice that
 * works on a first try, and the model id is where the language lives —
 * `Xenova/mms-tts-eng`, `-fra`, `-deu`, and eleven hundred others — so changing
 * language here is changing a string, not adding a class.
 */
export class VitsSpeaker extends TransformersSpeaker {
  static LABEL = 'mms-vits'
  static DEFAULT_MODEL = 'Xenova/mms-tts-eng'

  /**
   * Not the `fp32` its parent defaults to. These checkpoints publish `fp32`,
   * `fp16` and `q8` and nothing else, and `q8` is a third of the download for a
   * single-stage generator whose output is already conversational quality.
   */
  static DEFAULT_DTYPE = 'q8'
}
