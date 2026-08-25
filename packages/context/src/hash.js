/**
 * One content hash, used for two jobs that must agree with each other: a
 * component's `inputHash` — identical hash means identical rendered bytes —
 * and the nonce that delimits an untrusted envelope.
 *
 * FNV-1a over 64 bits in `BigInt`, not `Math.imul` over 32: two sections that
 * differ collide at 32 bits often enough to matter for provenance, and a
 * nonce a payload can hit by accident is not a delimiter. It is not a
 * cryptographic hash and nothing here treats it as one — the envelope escapes
 * its own marker, so guessing the nonce buys nothing.
 * @module
 */

const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x00000100000001b3n
const MASK = 0xffffffffffffffffn

/**
 * The 16-hex-digit hash of a string, over its UTF-16 code units. Code units
 * and not UTF-8 bytes because the input is always a JavaScript string and
 * encoding it first would buy nothing but a TextEncoder.
 * @param {string} text
 */
export function fnv1a(text) {
  let hash = OFFSET
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}
