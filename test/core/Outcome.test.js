import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../src/core/Outcome.js'

/**
 * The rule the whole tree rests on: nothing throws, so a failure has to survive
 * being carried around as a value.
 *
 * What these check is not that `Outcome.ok` returns something truthy. It is the
 * three properties every caller silently assumes and none of which the type
 * enforces: `attempt` converts a throw into a value INCLUDING a throw that is
 * not an Error, `withNote` on a failure is still that failure, and a failed
 * outcome survives JSON — the shape it is actually reduced to when it crosses
 * out of the worker, which is the reason the class exists at all.
 */

describe('Outcome.attempt', () => {
  test('a throwing function becomes a failure carrying its message', async () => {
    const outcome = await Outcome.attempt(() => {
      throw new Error('the disk is on fire')
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.value).toBe(null)
    expect(outcome.failure.code).toBe(Reason.INTERNAL)
    expect(outcome.failure.message).toBe('the disk is on fire')
    expect(outcome.failure.hint).toBe('')
  })

  test('a thrown non-Error is stringified rather than lost', async () => {
    // JSON.parse throws SyntaxError, but a rejected promise or foreign code can
    // throw a string, and `err?.message` is undefined for those.
    const outcome = await Outcome.attempt(() => {
      throw 'just a string'
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe('just a string')
  })

  test('a thrown null still produces a readable message', async () => {
    const outcome = await Outcome.attempt(() => {
      throw null
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe('null')
  })

  test('the code and hint given at the boundary reach the failure', async () => {
    const outcome = await Outcome.attempt(() => JSON.parse('{nope}'), {
      code: Reason.BAD_REQUEST,
      hint: 'Write them as {"key": "value"}.',
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.code).toBe(Reason.BAD_REQUEST)
    expect(outcome.failure.hint).toBe('Write them as {"key": "value"}.')
  })

  test('a rejected promise is a failure, not an unhandled rejection', async () => {
    const outcome = await Outcome.attempt(async () => {
      await Promise.reject(new Error('the endpoint hung up'))
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toBe('the endpoint hung up')
  })

  test('an awaited value comes back as ok', async () => {
    const outcome = await Outcome.attempt(async () => 41 + 1)

    expect(outcome.ok).toBe(true)
    expect(outcome.value).toBe(42)
    expect(outcome.failure).toBe(null)
  })
})

describe('Outcome.withNote', () => {
  test('a note on a failure keeps the failure', () => {
    const failed = Outcome.failed(Reason.UNAVAILABLE, 'no answer', { hint: 'Check the URL.' })
    const noted = failed.withNote('while calling the model')

    expect(noted.ok).toBe(false)
    expect(noted.failure.code).toBe(Reason.UNAVAILABLE)
    expect(noted.failure.message).toBe('no answer')
    expect(noted.failure.hint).toBe('Check the URL.')
    expect(noted.notes).toEqual(['while calling the model'])
  })

  test('notes accumulate in the order they were added, on a new outcome', () => {
    const first = Outcome.ok('value').withNote('one')
    const second = first.withNote('two')

    expect(second.notes).toEqual(['one', 'two'])
    // The original is untouched: an outcome handed to two callers must not be
    // annotated by one of them on behalf of the other.
    expect(first.notes).toEqual(['one'])
  })

  test('an empty note is not recorded', () => {
    const outcome = Outcome.ok('value').withNote('')

    expect(outcome.notes).toEqual([])
  })
})

describe('Outcome.asFailure', () => {
  test('re-labelling a failure keeps the notes it collected on the way up', () => {
    const relabelled = Outcome.failed(Reason.INTERNAL, 'raw')
      .withNote('read the roster')
      .asFailure(Reason.UNAVAILABLE, 'the roster could not be read', 'Rebuild the app.')

    expect(relabelled.failure.code).toBe(Reason.UNAVAILABLE)
    expect(relabelled.failure.message).toBe('the roster could not be read')
    expect(relabelled.failure.hint).toBe('Rebuild the app.')
    expect(relabelled.notes).toEqual(['read the roster'])
  })

  test('an ok outcome passes through unchanged', () => {
    const ok = Outcome.ok('kept')

    expect(ok.asFailure(Reason.INTERNAL, 'ignored')).toBe(ok)
  })
})

describe('Outcome across a realm boundary', () => {
  test('a failure survives JSON with its code, hint and notes', () => {
    const failed = Outcome.failed(Reason.NOT_FOUND, 'no conversation 7', {
      hint: 'Start a new chat.',
      notes: ['nothing was saved'],
    })

    const crossed = JSON.parse(JSON.stringify(failed))

    expect(crossed).toEqual({
      ok: false,
      value: null,
      failure: { code: 'NOT_FOUND', message: 'no conversation 7', hint: 'Start a new chat.' },
      notes: ['nothing was saved'],
    })
  })

  test('unwrapOr gives the fallback only when the outcome failed', () => {
    expect(Outcome.ok('real').unwrapOr('fallback')).toBe('real')
    expect(Outcome.failed(Reason.INTERNAL, 'x').unwrapOr('fallback')).toBe('fallback')
    // An ok outcome carrying a falsy value is still an ok outcome.
    expect(Outcome.ok('').unwrapOr('fallback')).toBe('')
  })
})
