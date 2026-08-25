import { expect, test, describe } from 'bun:test'
import {
  requestFor, messagesOf, assemble, budgetFor, paperOf, modelCard, adapterFor,
  stablePrefix, cacheHitRatio, cacheSentence, cacheOffer, MIN_CACHEABLE_TOKENS,
  estimateParts, IMAGE_RULES, soul,
} from '@harness/context'
import { PROVIDERS, blocksFor, cardFor, AT } from './matrix.js'

/**
 * WHAT THE STABILITY ARCHITECTURE BUYS, EXECUTED. `Stability` has claimed since
 * the Rust that ordering the paper by how often a section changes earns a
 * prefix cache hit, and `grep -rn cache_control crates/context` was empty
 * (`docs/RULINGS.md` Attack 4, item 7). These tests are that claim's execution:
 * the boundary is where the stability classes say it is, the bytes before it do
 * not move when the volatile tail does, and the one API that takes an explicit
 * breakpoint receives one — WHEN the head is long enough for that provider to
 * keep it. At this build's sizes it is not, which is the second unmeasured
 * claim this file had to stop making: a stamp under the minimum is declined in
 * silence and reads back as a 0% hit rate.
 */

/** The same paper, with one volatile block carrying different words. @param {string} clock */
function paperAt(clock) {
  const blocks = blocksFor('text').map((b) =>
    b.id === 'environment' ? { ...b, render: () => [{ type: 'text', text: clock }] } : b)
  return paperOf('work', /** @type {import('@harness/context').Component[]} */ (blocks), AT)
}

/** @param {string} provider @param {string} clock */
function bodyAt(provider, clock) {
  return requestFor({ state: paperAt(clock), card: cardFor(provider, 'text') }).body
}

/** @param {string} provider @param {string} clock */
function systemOf(provider, clock) {
  const card = cardFor(provider, 'text')
  const doc = assemble(paperAt(clock), budgetFor(card), adapterFor(provider).images)
  const [system] = messagesOf(doc, card)
  return system ?? { content: [], cacheUntil: -1 }
}

describe('the cacheable prefix is a boundary, not a hope', () => {
  test('it ends where the stability classes say it does — at the last undated block', () => {
    const { document } = requestFor({ state: paperAt('two'), card: cardFor('anthropic', 'text') })
    const system = document.sections.filter((s) => s.slot < 80)
    const cut = stablePrefix(system)
    expect(system[cut - 1]?.id).toBe('space')
    expect(system[cut]?.id).toBe('environment')
  })

  test('a block that renders a clock is never inside it', () => {
    const { document } = requestFor({ state: paperAt('two'), card: cardFor('openai', 'text') })
    const dated = document.sections.filter((s) => s.provenance.producedAt !== 0).map((s) => s.id)
    expect(dated).toContain('environment')
    expect(stablePrefix(document.sections)).toBeLessThan(document.sections.length)
  })

  for (const provider of PROVIDERS) {
    test(`${provider}: changing the clock leaves every cached byte where it was`, () => {
      const first = systemOf(provider, '2025-06-15 14:26 UTC')
      const second = systemOf(provider, '2025-06-15 19:03 UTC')
      const kept = (/** @type {typeof first} */ m) => JSON.stringify(m.content.slice(0, m.cacheUntil + 1))
      expect(first.cacheUntil).toBeGreaterThanOrEqual(0)
      expect(kept(second)).toBe(kept(first))
      // The test is only evidence if the tail actually moved.
      expect(JSON.stringify(second.content)).not.toBe(JSON.stringify(first.content))
    })
  }
})

/** The stable head of the system message, as the adapter measures it. @param {string} kind */
function headTokens(kind) {
  const card = cardFor('anthropic', kind)
  const doc = assemble(paperOf('work', blocksFor(kind), AT), budgetFor(card), IMAGE_RULES.anthropic)
  const [system] = messagesOf(doc, card)
  const content = system?.content ?? []
  return estimateParts(content.slice(0, (system?.cacheUntil ?? -1) + 1), IMAGE_RULES.anthropic).tokens
}

/** A paper whose stable head is deliberately over the floor. @param {number} chars */
function bigHeaded(chars) {
  const blocks = blocksFor('text').map((b) => (b.id === 'soul' ? soul('x'.repeat(chars)) : b))
  return requestFor({
    state: paperOf('work', /** @type {import('@harness/context').Component[]} */ (blocks), AT),
    card: { ...cardFor('anthropic', 'text'), contextTokens: 400_000 },
  }).body
}

describe('the breakpoint is withheld below the minimum this provider will cache', () => {
  test('the boundary exists in the paper, and the head is still too small to be kept', () => {
    const floor = MIN_CACHEABLE_TOKENS['anthropic'] ?? 0
    expect(floor).toBeGreaterThan(0)
    for (const kind of /** @type {const} */ (['text', 'tools'])) {
      const tokens = headTokens(kind)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(floor)
      expect(cacheOffer('anthropic', tokens).offered).toBe(false)
    }
  })

  test('so no golden-sized paper carries cache_control at all', () => {
    expect(JSON.stringify(bodyAt('anthropic', 'now'))).not.toContain('cache_control')
  })

  test('a head over the floor DOES carry one, on the last block of the prefix and nowhere else', () => {
    const system = /** @type {Array<Record<string, unknown>>} */ (bigHeaded(4 * (MIN_CACHEABLE_TOKENS['anthropic'] ?? 0))['system'])
    const stamped = system.map((b, i) => (b['cache_control'] ? i : -1)).filter((i) => i >= 0)
    expect(stamped).toStrictEqual([0])
    expect(system.length).toBeGreaterThan(1)
    expect(String(system[0]?.['text']).startsWith('## soul')).toBe(true)
    expect(String(system[1]?.['text'])).toContain('## environment')
  })

  test('the two providers that cache implicitly are sent no breakpoint field', () => {
    for (const provider of /** @type {const} */ (['openai', 'gemini'])) {
      expect(JSON.stringify(bodyAt(provider, 'now'))).not.toContain('cache_control')
    }
  })
})

describe('what the provider said the cache was worth', () => {
  const usage = { inputTokens: 300, cachedInputTokens: 1200, outputTokens: 40, reasoningTokens: null }

  test('the ratio is cached over everything that went in', () => {
    expect(cacheHitRatio(usage)).toBe(0.8)
    expect(cacheSentence(usage)).toBe(
      "80% of the input was served from the provider's cache: 1200 cached, 300 read afresh.")
  })

  test('unreported and zero are different facts, and the sentence says which', () => {
    expect(cacheHitRatio({ ...usage, cachedInputTokens: null })).toBe(null)
    expect(cacheHitRatio({ ...usage, cachedInputTokens: 0 })).toBe(0)
    expect(cacheSentence({ ...usage, cachedInputTokens: null })).toContain('no cache accounting')
    expect(cacheSentence(null)).toContain('no cache accounting')
  })

  test('and a head too short to offer is a THIRD fact, not a 0% hit rate', () => {
    const missed = cacheSentence({ ...usage, cachedInputTokens: 0 })
    const below = cacheSentence({ ...usage, cachedInputTokens: 0 }, cacheOffer('anthropic', headTokens('tools')))
    expect(missed).toContain("0% of the input was served from the provider's cache")
    expect(below).toBe(
      `The stable head was ${headTokens('tools')} tokens, below this provider's ` +
      `${MIN_CACHEABLE_TOKENS['anthropic']}-token minimum; nothing was offered for caching.`)
    expect(below).not.toBe(missed)
    // A head that IS offered falls through to what the provider actually said.
    expect(cacheSentence(usage, cacheOffer('anthropic', 99_999))).toBe(cacheSentence(usage))
  })

  test("anthropic's reply is read into that shape, cache write folded into what was paid", () => {
    const reply = adapterFor('anthropic').parseResponse({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 90, cache_read_input_tokens: 400 },
    })
    expect(reply.usage?.inputTokens).toBe(100)
    expect(reply.usage?.cachedInputTokens).toBe(400)
    expect(cacheHitRatio(reply.usage)).toBe(0.8)
  })
})

describe('a card with no context length is refused before any of this matters', () => {
  test('an entry that states no window cannot be installed', () => {
    expect(() => modelCard('nameless', { model: 'x', kind: 'openai' })).toThrow()
  })
})
