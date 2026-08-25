/**
 * What a part will cost the window, per MODALITY, each with its basis stated.
 *
 * The estimate is of the RENDERED artifact and not of the source bytes: what a
 * provider bills is what it receives after its own decoding, and the two
 * differ by orders of magnitude for everything that is not text. One flat
 * `bytes/4` over base64 is the arithmetic that made image parts
 * unrepresentable in practice (`docs/RULINGS.md` Attack 4, point 4).
 *
 * `basis` travels with every number because this is an ESTIMATE and the person
 * reading a compaction report needs to know which of these numbers is close
 * and which one is a bound. It is never a tokenizer: a tokenizer per provider
 * is megabytes of vocabulary in a page that must stay static and offline.
 * @module
 */

import { imageSize, imageTokens, UNKNOWN_IMAGE_TOKENS } from './image.js'

/** @typedef {import('./types.js').Part} Part */

/** One part's cost and the reason to believe it. */
/** @typedef {{tokens: number, basis: string}} Estimate */

/** English averages about four characters per token; every provider's tokenizer is near it. */
const CHARS_PER_TOKEN = 4

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
 * @returns {Estimate}
 */
export function estimatePart(part) {
  switch (part.type) {
    case 'text':
      return { tokens: Math.max(FLOOR, Math.ceil(part.text.length / CHARS_PER_TOKEN)), basis: 'characters/4' }
    case 'image': {
      const size = imageSize(part.dataBase64)
      if (!size) return { tokens: UNKNOWN_IMAGE_TOKENS, basis: `${part.mediaType} header unreadable; charged as four tiles (OpenAI high-detail rule)` }
      return { tokens: imageTokens(size.width, size.height), basis: `${size.width}x${size.height}, billed as 512px tiles (OpenAI high-detail rule)` }
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
 * What a part list costs, with the per-part arithmetic kept. The total is the
 * only number the budget reads; the breakdown is what makes it checkable.
 * @param {Part[]} parts
 * @returns {{tokens: number, parts: Estimate[]}}
 */
export function estimateParts(parts) {
  const each = parts.map(estimatePart)
  return { tokens: each.reduce((sum, e) => sum + e.tokens, 0), parts: each }
}
