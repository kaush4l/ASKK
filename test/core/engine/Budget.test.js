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
 * that `exhausted` is asked about the NEXT step, so a run declaring N steps
 * makes N model calls and the Nth is the one told it is the last; an
 * off-by-one here is a budget that spends one more turn than anybody wrote.
 */

/** A clock the test moves by hand, so no test waits for a real second. */
function clock(start = 0) {
  let at = start
  return { now: () => at * 1000, tick: (seconds) => (at += seconds) }
}

describe('Budget counting', () => {
  test('a provider measurement replaces this tree its estimate, and is not added to it', () => {
    const budget = new Budget({})

    budget.open(500).measure({ prompt: 800, completion: 40 })

    expect(budget.steps).toBe(1)
    expect(budget.tokens).toBe(840)
    expect(budget.counted).toBe(1)
  })

  test('a pass nobody measured keeps its estimate and says the figure is a guess', () => {
    const budget = new Budget({})

    budget.open(500)
    budget.open(600).measure({ prompt: 100, completion: 10 })

    expect(budget.tokens).toBe(610)
    expect(budget.counted).toBe(1)
    expect(budget.render()).toContain(
      'tokens: 610 of 250,000 used (1 of 2 counted by the provider)',
    )
  })

  test('usage reported against no pass at all is a no-op rather than a throw', () => {
    const budget = new Budget({})

    expect(budget.measure({ prompt: 10, completion: 1 }).tokens).toBe(0)
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

    budget.open(50).measure({ prompt: 900, completion: 200 })

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

describe('Budget.render', () => {
  test('the block is three lines of fact and nothing else while there is room', () => {
    const time = clock()
    const budget = new Budget({ steps: 4, tokens: 5000, seconds: 90, now: time.now })
    budget.open(120)
    time.tick(7)

    expect(budget.close().render()).toBe(
      ['steps: 1 of 4 used', 'tokens: 120 of 5,000 used (estimated)', 'time: 7s of 90s used'].join(
        '\n',
      ),
    )
  })

  test('closing adds the hand-over, and it names which budget went', () => {
    const budget = new Budget({ steps: 2 })
    budget.open(10)

    const body = budget.close().render()

    expect(budget.closing).toBe('the 2-step budget')
    expect(body).toContain('THIS IS YOUR LAST TURN. the 2-step budget is spent')
    expect(body).toContain('no tool call you write now will be run')
    expect(body).toContain('Set act to answer')
  })

  test('close cannot be told a reason that did not happen', () => {
    const budget = new Budget({ steps: 50 })

    budget.close()

    expect(budget.closing).toBe('')
    expect(budget.render()).not.toContain('LAST TURN')
  })
})
