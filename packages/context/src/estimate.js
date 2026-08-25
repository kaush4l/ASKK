/**
 * What a part will cost the window, per MODALITY, each with its basis stated.
 *
 * The estimate is of the RENDERED artifact and not of the source bytes: what a
 * provider bills is what it receives after its own decoding, and the two
 * differ by orders of magnitude for everything that is not text. One flat
 * `bytes/4` over base64 is the arithmetic that made image parts
 * unrepresentable in practice (`docs/RULINGS.md` Attack 4, point 4).
 *
 * `basis` travels with one part's number because this is an ESTIMATE and the
 * caller weighing it needs to know which numbers are close and which are
 * bounds; the fact a whole paper's reader needs — WHICH provider's image
 * arithmetic billed it — travels instead in `CompactionReport.imageRule`,
 * where it is on the wire rather than in this comment. It is never a
 * tokenizer: a tokenizer per provider is megabytes of vocabulary in a page
 * that must stay static and offline.
 * @module
 */

import { imageSize, IMAGE_RULES } from './image.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./image.js').ImageRule} ImageRule */

/**
 * The rule an estimate uses when the caller states no provider. It is
 * OpenAI's, and that is the catalogue's own default rather than a preference:
 * `models.json` keys entries by NAME and treats an entry with no `kind` as the
 * OpenAI protocol, so this is the same fallback spelled in one more place.
 * A caller that knows the provider passes its adapter's rule and this is not
 * consulted.
 */
const DEFAULT_RULE = IMAGE_RULES.openai

/** One part's cost and the reason to believe it. */
/** @typedef {{tokens: number, basis: string}} Estimate */

/**
 * English averages about four characters per token; every provider's tokenizer
 * is near it. Exported because `fit` sizes a cut in CHARACTERS and the two
 * must use one number: a divisor spelled twice is a budget that disagrees
 * with the estimate it was derived from.
 */
export const CHARS_PER_TOKEN = 4

/**
 * Audio is billed by DURATION, and a base64 blob does not carry one. 16 kB/s
 * is the middle of the speech codecs a browser produces, and 32 tokens/second
 * is the published rate. Both are stated because this is the one estimate here
 * that can be wrong by a factor rather than by a fraction.
 */
const AUDIO_BYTES_PER_SECOND = 16000
const AUDIO_TOKENS_PER_SECOND = 32

/** Every part costs at least this, so a part list's length is never free. */
const FLOOR = 1

/** Bytes a base64 payload decodes to, without decoding it. */
function decodedBytes(/** @type {string} */ base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/**
 * What one part costs. Text is measured in CHARACTERS and not in UTF-8 bytes:
 * a byte count charges a Japanese sentence three times over, and the models
 * this addresses tokenize codepoints.
 * @param {Part} part
 * @param {ImageRule} [images] how THIS provider bills an image; see `DEFAULT_RULE`
 * @returns {Estimate}
 */
export function estimatePart(part, images = DEFAULT_RULE) {
  switch (part.type) {
    case 'text':
      return { tokens: Math.max(FLOOR, Math.ceil(part.text.length / CHARS_PER_TOKEN)), basis: 'characters/4' }
    case 'image': {
      const size = imageSize(part.dataBase64)
      if (!size) return { tokens: images.unknown, basis: `${part.mediaType} header unreadable; charged as a ~1024x1024 image by the ${images.provider} rule` }
      return { tokens: images.tokens(size.width, size.height), basis: `${size.width}x${size.height}, billed by the ${images.provider} rule` }
    }
    case 'audio': {
      const seconds = Math.ceil(decodedBytes(part.dataBase64) / AUDIO_BYTES_PER_SECOND)
      return {
        tokens: Math.max(FLOOR, seconds * AUDIO_TOKENS_PER_SECOND),
        basis: `~${seconds}s at ${AUDIO_BYTES_PER_SECOND} bytes/s, ${AUDIO_TOKENS_PER_SECOND} tokens/s`,
      }
    }
    case 'file':
      return {
        tokens: Math.max(FLOOR, Math.ceil(decodedBytes(part.dataBase64) / CHARS_PER_TOKEN)),
        basis: 'decoded bytes/4, as though the document were its own text',
      }
  }
}

/**
 * What a part list costs. The total is the only number here anything reads —
 * the per-part breakdown this used to return beside it had no caller, and a
 * returned value nobody reads is a claim nobody checks. One part's basis is
 * still available from `estimatePart`.
 * @param {Part[]} parts
 * @param {ImageRule} [images]
 * @returns {{tokens: number}}
 */
export function estimateParts(parts, images) {
  return { tokens: parts.reduce((sum, p) => sum + estimatePart(p, images).tokens, 0) }
}
