import { expect, test, describe } from 'bun:test'
import { requestFor, paperOf, IMAGE_RULES } from '@harness/context'
import { blocksFor, cardFor, AT } from './matrix.js'

/**
 * ONE IMAGE, THREE PROTOCOLS, AND THE ONE CARD THAT CANNOT TAKE IT.
 *
 * The type system carried image parts all the way to the wire in the Rust too.
 * What it did NOT do was arrive: `base64.len()/4` charged a 200 KB screenshot
 * about 66,000 tokens against a 2048-token ceiling, so the part was priced out
 * of every paper it was ever put in (`docs/RULINGS.md` Attack 4). So the claim
 * worth executing is not "an image part exists" — it is that the SAME paper
 * reaches each provider in that provider's own spelling, priced by that
 * provider's own arithmetic, and that a card which cannot take one is told what
 * it is missing rather than handed a paper with a hole in it.
 */

/** The fixture image: a PNG header declaring 1600x1200, which the three rules disagree about by ~3x. */
const MEDIA = 'image/png'

/**
 * A WIDE WINDOW ON PURPOSE. The budget withholds any binary part claiming more
 * than a quarter of it, so the fixture card's 8192 tokens would take this
 * photograph out before the wire ever saw it — which is a real behaviour, and a
 * different one, tested in `matrix.test.js`. What is under test here is what
 * reaches a provider that CAN be reached.
 * @param {string} provider @param {boolean} sighted
 */
function bodyFor(provider, sighted) {
  const card = { ...cardFor(provider, 'image'), acceptsImages: sighted, contextTokens: 200_000 }
  return requestFor({ state: paperOf('work', blocksFor('image'), AT), card })
}

/** Every object in a built body, so a shape can be looked for wherever the protocol puts it. @param {unknown} value @returns {any[]} */
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(nodes)]
  return []
}

describe('an image reaches each provider in that provider\'s own shape', () => {
  test('openai: a data-URL content part', () => {
    const found = nodes(bodyFor('openai', true).body).find((n) => n.type === 'image_url')
    expect(found?.image_url?.url?.startsWith(`data:${MEDIA};base64,`)).toBe(true)
  })

  test('anthropic: a base64 source block, media type beside the bytes', () => {
    const found = nodes(bodyFor('anthropic', true).body).find((n) => n.type === 'image')
    expect(found?.source?.type).toBe('base64')
    expect(found?.source?.media_type).toBe(MEDIA)
    expect(typeof found?.source?.data).toBe('string')
  })

  test('gemini: inlineData, and its own spelling of the media type', () => {
    const found = nodes(bodyFor('gemini', true).body).find((n) => n.inlineData)
    expect(found?.inlineData?.mimeType).toBe(MEDIA)
    expect(typeof found?.inlineData?.data).toBe('string')
  })

  test('the bytes are the same bytes in all three', () => {
    const data = [
      nodes(bodyFor('openai', true).body).find((n) => n.type === 'image_url')?.image_url?.url?.split(',')[1],
      nodes(bodyFor('anthropic', true).body).find((n) => n.type === 'image')?.source?.data,
      nodes(bodyFor('gemini', true).body).find((n) => n.inlineData)?.inlineData?.data,
    ]
    expect(new Set(data).size).toBe(1)
    expect(data[0]).toBeTruthy()
  })
})

describe('a card that cannot take an image is TOLD, by name and by cost', () => {
  test('no bytes go out, and the placeholder names the media type and what it would have cost', () => {
    const { body } = bodyFor('anthropic', false)
    const wire = JSON.stringify(body)
    expect(wire).not.toContain('"source"')
    expect(wire).toContain(`[image (${MEDIA}) withheld: this model does not accept it`)
    // The number is this provider's, not a shared guess: an Anthropic entry
    // billed on OpenAI's tiles is under by about 3x, which is the ruling this
    // lane was handed and the reason the rule is quoted on the line.
    expect(wire).toContain(`~${IMAGE_RULES.anthropic.tokens(1600, 1200)} tokens`)
    expect(wire).toContain('billed by the anthropic rule')
  })

  test('each provider quotes its own arithmetic in the refusal, and no two agree', () => {
    const rules = [IMAGE_RULES.openai, IMAGE_RULES.anthropic, IMAGE_RULES.gemini]
    const quoted = rules.map((rule) => JSON.stringify(bodyFor(rule.provider, false).body).match(/~(\d+) tokens/)?.[1])
    expect(new Set(quoted).size).toBe(3)
    expect(quoted).toStrictEqual(rules.map((rule) => String(rule.tokens(1600, 1200))))
  })

  test('the section the image was in still arrives — a withheld part is not a dropped section', () => {
    const { body, document } = bodyFor('gemini', false)
    expect(document.sections.some((s) => s.id === 'page')).toBe(true)
    expect(JSON.stringify(body)).toContain('## page')
  })
})
