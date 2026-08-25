/**
 * What an image COSTS, read from the image itself.
 *
 * A vision model is billed by TILES, not by bytes: a 512×512 photograph costs
 * the same whether it arrived as a 6 KB JPEG or a 200 KB PNG. The Rust build
 * charged `base64.len()/4`, so that 200 KB PNG cost about 66,000 tokens
 * against a 2048-token ceiling — which is how the type system carefully
 * preserved image parts all the way to the wire while the arithmetic
 * guaranteed they never arrived.
 *
 * Sizing is a DECODER and the budget is arithmetic, which is why it is its own
 * file. It reads a bounded prefix of the header and never the whole payload.
 * @module
 */

/**
 * ONE PROVIDER'S ARITHMETIC IS NOT EVERY PROVIDER'S. OpenAI charges a base
 * plus a charge per 512px tile; Anthropic charges about w*h/750, which the
 * tile rule understates by ~3x — a 1600x1200 JPEG is ~2560 tokens there
 * against the 765 counted here. Billing an Anthropic entry on OpenAI's rule
 * is how a window overruns in the middle of a turn, so each rule is named
 * below and the adapter for a provider is what selects between them.
 * @typedef {{provider: string, tokens: (width: number, height: number) => number, unknown: number}} ImageRule
 */
const BASE_TOKENS = 85
const TILE_TOKENS = 170
const TILE = 512

/** The provider's own downscale, in the order it applies it. */
const MAX_SQUARE = 2048
const SHORT_SIDE = 768

/**
 * How far into the payload a size is looked for. A JPEG can carry a large EXIF
 * thumbnail ahead of its frame header, and decoding a whole 200 KB attachment
 * to learn two numbers is the cost this file exists to avoid.
 */
const SCAN_BYTES = 8192

/**
 * Decode a bounded prefix of a base64 payload. `atob` is a host global in Bun
 * and in the browser alike, and it is neither a clock, a network, nor the DOM.
 * @param {string} dataBase64
 * @param {number} maxBytes
 * @returns {Uint8Array|null} null when the payload is not base64 at all
 */
function decodePrefix(dataBase64, maxBytes) {
  const chars = Math.min(dataBase64.length, Math.ceil(maxBytes / 3) * 4)
  try {
    const binary = atob(dataBase64.slice(0, chars - (chars % 4)))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** @param {Uint8Array} b @param {number} at */
function u16(b, at) {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
}

/** @param {Uint8Array} b @param {number} at */
function u32(b, at) {
  return u16(b, at) * 0x10000 + u16(b, at + 2)
}

/** PNG: the IHDR chunk is first, always, and its two dimensions sit at a fixed offset. */
function pngSize(/** @type {Uint8Array} */ b) {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null
  return { width: u32(b, 16), height: u32(b, 20) }
}

/**
 * JPEG: walk the segment chain to the start-of-frame marker. The frame is the
 * only segment that states the size, and everything before it is metadata of
 * unbounded length — hence the bounded scan.
 */
function jpegSize(/** @type {Uint8Array} */ b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1] ?? 0
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16(b, at + 7), height: u16(b, at + 5) }
    }
    at += 2 + u16(b, at + 2)
  }
  return null
}

/**
 * The pixel size of an image part, or `null` when the header did not say.
 * GIF and WebP are deliberately absent: no provider in this catalogue accepts
 * them, and a parser for a format nothing sends is a parser nothing tests.
 * @param {string} dataBase64
 * @returns {{width: number, height: number}|null}
 */
export function imageSize(dataBase64) {
  const bytes = decodePrefix(dataBase64, SCAN_BYTES)
  if (!bytes || bytes.length < 4) return null
  const size = pngSize(bytes) ?? jpegSize(bytes)
  return size && size.width > 0 && size.height > 0 ? size : null
}

/**
 * OpenAI's downscale, then its tile count. Both steps are the published rule
 * and not an approximation of it: fit inside a 2048 square, then shrink until
 * the shorter side is 768, then count 512px tiles.
 * @param {number} width
 * @param {number} height
 */
export function openaiImageTokens(width, height) {
  let [w, h] = [width, height]
  const fit = Math.min(1, MAX_SQUARE / Math.max(w, h))
  w = Math.round(w * fit)
  h = Math.round(h * fit)
  const short = Math.min(1, SHORT_SIDE / Math.min(w, h))
  w = Math.round(w * short)
  h = Math.round(h * short)
  return BASE_TOKENS + TILE_TOKENS * Math.ceil(w / TILE) * Math.ceil(h / TILE)
}

/**
 * What an image whose header we could not read is charged under the OpenAI
 * rule: what a ~1024x1024 image costs, DERIVED rather than restated, so the
 * sentence stays true if a downscale constant moves. Stated rather than
 * guessed at zero — an unknown that costs nothing is an unknown that overruns
 * the window.
 */
export const UNKNOWN_IMAGE_TOKENS = openaiImageTokens(1024, 1024)

/**
 * Anthropic bills by AREA, after its own downscale to a 1568px longest side.
 * There are no tiles and no base charge, which is why the tile rule cannot be
 * made to approximate it by tuning a constant.
 * @param {number} width @param {number} height
 */
export function anthropicImageTokens(width, height) {
  const fit = Math.min(1, ANTHROPIC_MAX_SIDE / Math.max(width, height))
  return Math.ceil((Math.round(width * fit) * Math.round(height * fit)) / ANTHROPIC_PIXELS_PER_TOKEN)
}

/** Anthropic's published downscale and its area divisor. */
const ANTHROPIC_MAX_SIDE = 1568
const ANTHROPIC_PIXELS_PER_TOKEN = 750

/** Gemini's flat charge for anything inside one crop, and the crop it tiles by. */
const GEMINI_TILE_TOKENS = 258
const GEMINI_SMALL = 384
const GEMINI_TILE = 768

/**
 * Gemini charges a FLAT 258 for an image that fits inside 384px both ways, and
 * 258 per 768px crop for anything larger. Flat-then-tiled, so it is neither of
 * the other two rules at either end of the size range.
 * @param {number} width @param {number} height
 */
export function geminiImageTokens(width, height) {
  if (width <= GEMINI_SMALL && height <= GEMINI_SMALL) return GEMINI_TILE_TOKENS
  const crops = Math.ceil(width / GEMINI_TILE) * Math.ceil(height / GEMINI_TILE)
  return GEMINI_TILE_TOKENS * crops
}

/**
 * The rules, by the provider that bills them. `unknown` is what an image whose
 * header would not decode costs under each: a ~1024x1024 image by that
 * provider's own arithmetic, stated rather than guessed at zero.
 * @type {Record<'openai'|'anthropic'|'gemini', ImageRule>}
 */
export const IMAGE_RULES = Object.freeze({
  openai: { provider: 'openai', tokens: openaiImageTokens, unknown: openaiImageTokens(1024, 1024) },
  anthropic: { provider: 'anthropic', tokens: anthropicImageTokens, unknown: anthropicImageTokens(1024, 1024) },
  gemini: { provider: 'gemini', tokens: geminiImageTokens, unknown: geminiImageTokens(1024, 1024) },
})
