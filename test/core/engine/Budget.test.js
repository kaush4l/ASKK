import { describe, expect, test } from 'bun:test'
import { Budget } from '../../../src/core/engine/Budget.js'

/**
 * The accounting, on its own, because the loop's tests can only see it through
 * a prompt string.
 *
 * Two things here are worth more than the rest. The first is that a provider's
 * measurement REPLACES this tree's estimate for the same call rather than being
 * added to it — the bug that shape exists to prevent is silent, doubling every
 * counted step and running a budget out at half its stated size. The second is
 * that `exhausted` is asked about the NEXT step FOR STEPS ONLY, so a run
 * declaring N steps makes N model calls and the Nth is the one told it is the
 * last; an off-by-one there is a budget that spends one more turn than anybody
 * wrote. Tokens and seconds cannot be asked the same question and are asserted
 * as what they are — floors that one call can overshoot.
 */

/** A clock the test moves by hand, so no test waits for a real second. */
function clock(start = 0) {
  let at = start
  return { now: () => at * 1000, tick: (seconds) => (at += seconds) }
}

describe('Budget counting', () => {
  test('a provider measurement replaces this tree its estimate, and is not added to it', () => {
    const budget = new Budget({})

    budget.open(500)
    budget.measure({ prompt: 800, completion: 40 })

    expect(budget.steps).toBe(1)
    expect(budget.tokens).toBe(840)
  })

  test('a pass nobody measured keeps its estimate, and it is what the bound spends', () => {
    // The estimate/measurement distinction is no longer PRINTED — the lines
    // that printed it were measured against an arm without them and cut — but
    // it still decides when a run closes, which is the half that was never
    // decoration.
    const budget = new Budget({ tokens: 600 })

    budget.open(500)
    expect(budget.exhausted).toBe('')
    budget.open(600)
    budget.measure({ prompt: 100, completion: 10 })

    expect(budget.tokens).toBe(610)
    expect(budget.exhausted).toBe('the 600-token budget')
  })

  test('usage reported against no pass at all is a no-op rather than a throw', () => {
    const budget = new Budget({})

    budget.measure({ prompt: 10, completion: 1 })

    expect(budget.tokens).toBe(0)
  })
})

describe('Budget.exhausted', () => {
  test('a run declaring N steps makes N calls, and the Nth is the one told it is the last', () => {
    const budget = new Budget({ steps: 3 })

    // Asked before each call, as the loop asks it.
    expect(budget.exhausted).toBe('')
    budget.open(10)
    expect(budget.exhausted).toBe('')
    budget.open(10)
    // Two calls made; the third would be the last the budget can pay for.
    expect(budget.exhausted).toBe('the 3-step budget')
  })

  test('tokens run out on the provider its number, not on the step count', () => {
    const budget = new Budget({ steps: 100, tokens: 1000 })

    budget.open(50)
    budget.measure({ prompt: 900, completion: 200 })

    expect(budget.exhausted).toBe('the 1,000-token budget')
  })

  test('the clock runs out on a run that is doing nothing at all', () => {
    const time = clock()
    const budget = new Budget({ steps: 100, tokens: 1_000_000, seconds: 60, now: time.now })

    expect(budget.exhausted).toBe('')
    time.tick(61)

    expect(budget.exhausted).toBe('the 60-second budget')
  })
})

describe('a token or time limit is a FLOOR, and says so', () => {
  test('a single call can overshoot the token limit by any factor', () => {
    // Not a defect and not hidden: what the next call will cost cannot be known
    // until it has been made, so the alternative to overshooting is forecasting,
    // which would put an invented number beside two measured ones. The step
    // limit is what actually bounds a runaway loop.
    const budget = new Budget({ steps: 100, tokens: 500 })

    budget.open(50)
    budget.measure({ prompt: 200_000, completion: 4000 })

    expect(budget.tokens).toBe(204_000)
    expect(budget.exhausted).toBe('the 500-token budget')
  })

  test('below the line it says nothing, even one token below', () => {
    const budget = new Budget({ steps: 100, tokens: 1000 })

    budget.open(0)
    budget.measure({ prompt: 999, completion: 0 })

    expect(budget.exhausted).toBe('')
  })
})

describe('Budget.render', () => {
  test('while there is room it renders NOTHING, so the block leaves the prompt', () => {
    // The three running lines that used to sit here cost 30 tokens on every
    // turn of every run against an endpoint measured at `cached_tokens: 0`, and
    // an A/B against an arm without them produced the same distribution of
    // answers and tool calls. An empty body is dropped by `PromptTemplate`.
    const time = clock()
    const budget = new Budget({ steps: 4, tokens: 5000, seconds: 90, now: time.now })
    budget.open(120)
    time.tick(7)
    budget.close()

    expect(budget.render()).toBe('')
  })

  test('closing renders the hand-over, and it names which budget went', () => {
    const budget = new Budget({ steps: 2 })
    budget.open(10)
    budget.close()

    const body = budget.render()

    expect(budget.closing).toBe('the 2-step budget')
    expect(body).toContain('THIS IS YOUR LAST TURN. the 2-step budget is spent')
    expect(body).toContain('no tool call you write now will be run')
    expect(body).toContain('Set act to answer')
  })

  test('close cannot be told a reason that did not happen', () => {
    const budget = new Budget({ steps: 50 })

    budget.close()

    expect(budget.closing).toBe('')
    expect(budget.render()).toBe('')
  })
})
