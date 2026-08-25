import { expect, test, describe } from 'bun:test'
import { modelCard, modelCards, budgetFor, budgetSentence } from '@harness/context'
import { HarnessError } from '@harness/kernel'

/** @typedef {import('@harness/context').ModelCard} ModelCard */

/** @param {Partial<ModelCard>} [over] @returns {ModelCard} */
function card(over = {}) {
  return {
    name: 'local', model: 'gemma-4-12B', contextTokens: 4096,
    maxOutputTokens: null, acceptsImages: false, reasons: false, ...over,
  }
}

describe('a catalogue entry without a window is refused at install', () => {
  test('by the name of the entry, and by the name of the field to add', () => {
    /** @type {unknown} */
    let thrown
    try {
      modelCard('scratch', { model: 'gpt-5', base_url: 'https://example.invalid/v1' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(HarnessError)
    const err = /** @type {HarnessError} */ (thrown)
    expect(err.kind).toBe('missing_context_window')
    expect(err.message).toContain('"scratch"')
    expect(err.detail).toContain('context_tokens')
  })

  test('and it is a REFUSAL, not a default: no card comes back with a made-up window', () => {
    expect(() => modelCards({ models: { a: { context_tokens: 4096 }, b: { model: 'x' } } })).toThrow(
      /"b"/,
    )
  })

  test('every entry the product actually ships carries one', async () => {
    const file = Bun.file(new URL('../../../apps/web/public/models.json', import.meta.url))
    const cards = modelCards(await file.json())
    expect(Object.keys(cards).length).toBeGreaterThan(0)
    for (const [name, c] of Object.entries(cards)) {
      expect(c.contextTokens, `${name} has a window`).toBeGreaterThan(0)
    }
  })
})

describe('the card states what the entry did not say, instead of inventing it', () => {
  test('an unstated maximum output is null and an unstated modality is off', () => {
    const c = modelCard('local', { model: 'gemma', context_tokens: 4096 })
    expect(c.maxOutputTokens).toBeNull()
    expect(c.acceptsImages).toBe(false)
    expect(c.reasons).toBe(false)
  })

  test('a stated one is read', () => {
    const c = modelCard('sonnet', {
      model: 'claude-sonnet-5', context_tokens: 200000, max_output_tokens: 64000,
      accepts_images: true, reasons: true,
    })
    expect(c).toMatchObject({ maxOutputTokens: 64000, acceptsImages: true, reasons: true })
  })
})

describe('the budget is derived from the window', () => {
  test('a 4k model and a 200k model get different budgets from the same code', () => {
    const small = budgetFor(card({ contextTokens: 4096 }))
    const large = budgetFor(card({ contextTokens: 200000 }))
    expect(small.maxTokens).toBeLessThan(large.maxTokens)
    expect(small.maxTokens).toBeGreaterThan(0)
    // The Rust build's one constant. Neither model may land on it by accident.
    expect(small.maxTokens).not.toBe(8192)
    expect(large.maxTokens).not.toBe(8192)
  })

  test('every subtraction is named, and the named terms ARE the arithmetic', () => {
    const b = budgetFor(card({ contextTokens: 200000 }))
    const taken = b.subtractions.reduce((sum, s) => sum + s.tokens, 0)
    expect(b.window - taken).toBe(b.maxTokens)
    expect(b.subtractions.map((s) => s.name)).toEqual(['reply', 'estimator reserve'])
    for (const s of b.subtractions) expect(s.why.length).toBeGreaterThan(10)
    expect(budgetSentence(b)).toContain(String(b.maxTokens))
    expect(budgetSentence(b)).toContain('for the reply')
  })

  test('nothing branches on a model name: rename the card, get the same numbers', () => {
    const a = budgetFor(card({ name: 'local', model: 'gemma-4-12B', contextTokens: 128000 }))
    const b = budgetFor(card({ name: 'openrouter', model: 'gpt-4o-mini', contextTokens: 128000 }))
    expect(a).toEqual(b)
  })

  test("a model that says what it will emit caps the reservation", () => {
    const capped = budgetFor(card({ contextTokens: 200000, maxOutputTokens: 1024 }))
    const reply = capped.subtractions.find((s) => s.name === 'reply')
    expect(reply?.tokens).toBe(1024)
    expect(reply?.why).toContain('at most 1024')
  })

  test('a turn that asks for a long reply pays for it out of the paper', () => {
    const plain = budgetFor(card({ contextTokens: 128000 }))
    const wordy = budgetFor(card({ contextTokens: 128000 }), { replyTokens: 32000 })
    expect(plain.maxTokens - wordy.maxTokens).toBe(32000 - 4096)
  })

  test('replyTokens: 0 is not an ask, so the derived eighth still meets the ceiling', () => {
    // 0 is a number and a falsy one: the two spellings of "did the turn ask?"
    // disagreed about it, and the eighth of a 200k window escaped the clamp.
    const zero = budgetFor(card({ contextTokens: 200000 }), { replyTokens: 0 })
    expect(zero.subtractions[0]?.tokens).toBe(4096)
    expect(zero).toEqual(budgetFor(card({ contextTokens: 200000 })))
  })

  test('a window with no room left says so rather than handing back a ceiling of zero', () => {
    expect(() => budgetFor(card({ contextTokens: 300 }))).toThrow(/300-token window/)
  })
})
