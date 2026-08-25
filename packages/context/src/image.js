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

/** OpenAI's published high-detail arithmetic: a base charge plus a charge per 512px tile. */
const BASE_TOKENS = 85
const TILE_TOKENS = 170
const TILE = 512

/** The provider's own downscale, in the order it applies it. */
const MAX_SQUARE = 2048
const SHORT_SIDE = 768

/**
 * What an image whose header we could not read is charged: four tiles, the
 * cost of a ~1024×1024 image. Stated rather than guessed at zero — an unknown
 * that costs nothing is an unknown that overruns the window.
 */
export const UNKNOWN_IMAGE_TOKENS = BASE_TOKENS + TILE_TOKENS * 4

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
 * The provider's downscale, then the tile count. Both steps are the published
 * rule and not an approximation of it: fit inside a 2048 square, then shrink
 * until the shorter side is 768, then count 512px tiles.
 * @param {number} width
 * @param {number} height
 */
export function imageTokens(width, height) {
  let [w, h] = [width, height]
  const fit = Math.min(1, MAX_SQUARE / Math.max(w, h))
  w = Math.round(w * fit)
  h = Math.round(h * fit)
  const short = Math.min(1, SHORT_SIDE / Math.min(w, h))
  w = Math.round(w * short)
  h = Math.round(h * short)
  return BASE_TOKENS + TILE_TOKENS * Math.ceil(w / TILE) * Math.ceil(h / TILE)
}
