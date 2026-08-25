import { expect, test, describe } from 'bun:test'
import { requestFor, paperOf, soul, MIN_CACHEABLE_TOKENS } from '@harness/context'
import { blocksFor, cardFor, AT } from './matrix.js'

/**
 * THE TWO DECISIONS A CALL MAKES, WITH A READER.
 *
 * `cacheOffer` was correct, exported and tested, and had nobody to tell: no
 * surface in this build could say "the stable head was 275 tokens, below this
 * provider's 4096-token minimum, so nothing was cached". `CompactionReport` was
 * the same defect from the other side — it reached the model in the compaction
 * notice and reached no person at all. A truth the system holds and does not
 * state is a defect whether or not anything is wrong underneath it (I16), so
 * both now ride on the request as a receipt, and these are the tests that drive
 * a reader through them.
 *
 * THE POINT OF EVERY ASSERTION HERE IS THAT THE SENTENCE AND THE BYTES ARE ONE
 * DECISION. A receipt recomputed beside the wire is a second opinion, and a
 * second opinion that agrees today is how the Rust ended up billing an
 * Anthropic paper on OpenAI's arithmetic.
 */

/** @param {string} provider @param {import('@harness/context').Component[]} blocks @param {number} window */
function ask(provider, blocks, window) {
  return requestFor({
    state: paperOf('work', blocks, AT),
    card: { ...cardFor(provider, 'text'), contextTokens: window },
  })
}

/** The same paper with a soul long enough to clear the highest published minimum. @param {number} chars */
function longWinded(chars) {
  const blocks = blocksFor('text')
  blocks[0] = soul(`# Notes\n${'the archivist keeps what matters. '.repeat(Math.ceil(chars / 34))}`)
  return blocks
}

describe('the cache decision reaches a person, in the words it was decided in', () => {
  test('below the minimum: the sentence names the head, the floor, and that nothing was offered', () => {
    const { receipt, body } = ask('anthropic', blocksFor('text'), 200_000)
    expect(receipt.cache.offered).toBe(false)
    expect(receipt.cache.minimum).toBe(MIN_CACHEABLE_TOKENS['anthropic'] ?? 0)
    expect(receipt.cacheLabel).toBe(
      `The stable head was ${receipt.cache.tokens} tokens, below this provider's 4096-token minimum; nothing was offered for caching.`,
    )
    // The same decision, read off the bytes: nothing was stamped either.
    expect(JSON.stringify(body)).not.toContain('cache_control')
  })

  test('above it: the head is offered, and the breakpoint is ON THE WIRE', () => {
    const { receipt, body } = ask('anthropic', longWinded(20_000), 200_000)
    expect(receipt.cache.tokens).toBeGreaterThanOrEqual(4096)
    expect(receipt.cache.offered).toBe(true)
    expect(receipt.cacheLabel).toContain('so it was offered for caching')
    expect(JSON.stringify(body)).toContain('"cache_control":{"type":"ephemeral"}')
  })

  test('a provider with no published floor says what it actually does instead of reporting a silence', () => {
    const { receipt } = ask('openai', blocksFor('text'), 200_000)
    expect(receipt.cache.minimum).toBeNull()
    expect(receipt.cacheLabel).toContain('caches prefixes implicitly')
    expect(receipt.cacheLabel).not.toContain('no cache accounting')
  })

  test('the head is priced by the provider whose body was built, not by a shared guess', () => {
    const blocks = blocksFor('text')
    const heads = ['openai', 'anthropic', 'gemini'].map((p) => ask(p, blocks, 200_000).receipt.cache.provider)
    expect(heads).toStrictEqual(['openai', 'anthropic', 'gemini'])
  })
})

describe('what the budget took away is readable, and says why', () => {
  test('a window that bites lists every step in the report\'s own vocabulary', () => {
    const { receipt, document } = ask('openai', blocksFor('text'), 584)
    expect(document.report.steps.length).toBeGreaterThan(0)
    expect(receipt.compactionLines).toStrictEqual(
      document.report.steps.map((s) => `${s.section} was reduced from ${s.from} to ${s.to}.`),
    )
    expect(receipt.compactionLabel).toContain(`to fit ${document.report.budget.maxTokens} tokens.`)
  })

  test('a window that does not bite says so, rather than showing an empty list', () => {
    const { receipt } = ask('openai', blocksFor('text'), 200_000)
    expect(receipt.compactionLines).toStrictEqual([])
    expect(receipt.compactionLabel).toBe('Nothing was compacted: the whole paper fit.')
  })

  test('a withheld part is worded as a lost part and never as a degraded section', () => {
    const { receipt, document } = ask('anthropic', blocksFor('image'), 8192)
    expect(document.report.withheld).toStrictEqual(['page'])
    expect(receipt.compactionLines).toContain('page lost a part too large to charge against this budget.')
    expect(receipt.compactionLabel).toContain('1 oversized part was withheld')
  })

  test('the spend names the arithmetic it was counted under, which is the receipt\'s whole point', () => {
    const { receipt, document } = ask('gemini', blocksFor('image'), 200_000)
    expect(receipt.spentLabel).toBe(
      `The paper spent ${document.report.spent} of ${document.report.budget.maxTokens} tokens, counted under the gemini image rule.`,
    )
    expect(receipt.budgetLabel).toContain(`${document.report.budget.maxTokens} tokens for the paper`)
  })
})
