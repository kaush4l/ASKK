import { expect, test, describe } from 'bun:test'
import { estimatePart, estimateParts, imageSize, UNKNOWN_IMAGE_TOKENS } from '@harness/context'

/** @typedef {import('@harness/context').Part} Part */

/**
 * A real file, base64'd exactly as an adapter would put it on the wire. The
 * PNG is 512x512 noise (~170 KB, incompressible on purpose); the JPEG was
 * written by `sips`, so its JFIF and EXIF segments sit ahead of the frame
 * header and the size walk has to step over them.
 * @param {string} name
 */
async function payload(name) {
  const bytes = await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).bytes()
  return Buffer.from(bytes).toString('base64')
}

describe('an image is estimated by what it renders to, not by its bytes', () => {
  test('a 170 KB 512x512 PNG costs one tile, where bytes/4 charged it 57,000 tokens', async () => {
    const dataBase64 = await payload('noise-512.png')
    expect(dataBase64.length).toBeGreaterThan(200_000)
    const part = /** @type {Part} */ ({ type: 'image', mediaType: 'image/png', dataBase64 })

    const { tokens, basis } = estimatePart(part)

    expect(tokens).toBe(255) // 85 base + 170 for the single 512px tile
    expect(basis).toBe('512x512, billed as 512px tiles (OpenAI high-detail rule)')
    // The arithmetic this replaces, stated so the regression is visible:
    expect(Math.ceil(dataBase64.length / 4)).toBeGreaterThan(50_000)
  })

  test('a 1600x1200 JPEG is sized past its EXIF segment and billed as four tiles', async () => {
    const dataBase64 = await payload('wide-1600.jpg')
    expect(imageSize(dataBase64)).toEqual({ width: 1600, height: 1200 })
    // Downscaled to a 768 short side -> 1024x768 -> 2x2 tiles.
    expect(estimatePart({ type: 'image', mediaType: 'image/jpeg', dataBase64 }).tokens).toBe(765)
  })

  test('an unreadable header is charged a stated amount, and says it is a guess', () => {
    const { tokens, basis } = estimatePart({
      type: 'image', mediaType: 'image/webp', dataBase64: 'UklGRhoAAABXRUJQVlA4TA0=',
    })
    expect(tokens).toBe(UNKNOWN_IMAGE_TOKENS)
    expect(basis).toBe('image/webp header unreadable; charged as four tiles (OpenAI high-detail rule)')
  })
})

describe('the other modalities are charged on their own basis', () => {
  test('text is counted in characters, so a Japanese sentence is not billed three times', () => {
    const jp = 'こんにちは世界'
    const ascii = 'hello world abc'
    expect(estimatePart({ type: 'text', text: jp }).tokens).toBe(2)
    expect(Buffer.byteLength(jp)).toBe(21) // bytes/4 would have said 6
    expect(estimatePart({ type: 'text', text: ascii }).tokens).toBe(4)
  })

  test('audio is charged by the seconds its bytes imply, and the rate is stated', () => {
    const oneSecond = 'A'.repeat(Math.ceil((16000 * 4) / 3))
    const { tokens, basis } = estimatePart({
      type: 'audio', mediaType: 'audio/wav', dataBase64: oneSecond,
    })
    expect(tokens).toBe(32)
    expect(basis).toContain('tokens/s')
  })

  test('a document is charged by what it decodes to, not by its base64', () => {
    const text = '# notes\n' + 'x'.repeat(392)
    const dataBase64 = Buffer.from(text).toString('base64')
    expect(dataBase64.length).toBeGreaterThan(text.length)
    expect(estimatePart({
      type: 'file', name: 'notes.md', mediaType: 'text/markdown', dataBase64,
    }).tokens).toBe(100)
  })

  test('every part costs something, so a hundred empty parts are not free', () => {
    const parts = /** @type {Part[]} */ (Array.from({ length: 100 }, () => ({ type: 'text', text: '' })))
    expect(estimateParts(parts).tokens).toBe(100)
  })
})

describe('a part list keeps its arithmetic', () => {
  test('the total is the sum, and each part still carries its own basis', async () => {
    const dataBase64 = await payload('noise-512.png')
    const { tokens, parts } = estimateParts([
      { type: 'text', text: 'x'.repeat(400) },
      { type: 'image', mediaType: 'image/png', dataBase64 },
    ])
    expect(parts.map((p) => p.tokens)).toEqual([100, 255])
    expect(tokens).toBe(355)
    expect(parts.map((p) => p.basis)).toEqual(['characters/4', '512x512, billed as 512px tiles (OpenAI high-detail rule)'])
  })
})
