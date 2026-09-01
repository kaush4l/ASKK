import { describe, expect, test } from 'bun:test'
import { Kernel } from '../../src/backend/Kernel.js'
import { Outcome } from '../../src/core/Outcome.js'
import { CANCEL, Request } from '../../src/protocol/Envelope.js'

/**
 * The half of cancellation that could not be solved in `core/`.
 *
 * A stop cannot be a field on the request it stops — `CANCEL` in the envelope
 * says why — so the signal stays on this side, which makes the Kernel the only
 * thing in either realm that can hold one.
 *
 * Both tests below are about the seam and not about the abort: that a handler
 * is HANDED a signal, and that a second request can reach it by name while the
 * first is still open. The engine's own tests cover what a loop does with one.
 */

/** A handler that parks until it is stopped, which is what a model call is. */
class SlowService {
  constructor() {
    this.started = null
  }

  async work(_params, _emit, signal) {
    this.started = signal
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    return Outcome.ok('what I had', ['you stopped this'])
  }
}

describe('Kernel cancellation', () => {
  test('a second request stops the first, and the first still answers', async () => {
    const service = new SlowService()
    const kernel = new Kernel().register('slow', service)

    const running = kernel.handle(new Request('r1', 'slow.work'))
    // Sent while the first is open, exactly as the page sends it: a whole
    // request of its own, naming the call it is about.
    const stopped = await kernel.handle(new Request('r2', CANCEL, { id: 'r1' }))
    const answered = await running

    expect(stopped.ok).toBe(true)
    expect(stopped.value).toBe(true)
    // The stopped call replies on its own id with what it had. It does not
    // fail, and it does not go unanswered — a request that never settles is
    // the one thing the page cannot recover from.
    expect(answered.id).toBe('r1')
    expect(answered.ok).toBe(true)
    expect(answered.value).toBe('what I had')
    expect(answered.notes).toEqual(['you stopped this'])
  })

  test('every handler is handed a signal without asking for one', async () => {
    const service = new SlowService()
    const kernel = new Kernel().register('slow', service)

    const running = kernel.handle(new Request('r1', 'slow.work'))
    await kernel.handle(new Request('r2', CANCEL, { id: 'r1' }))
    await running

    // Unconditional, so a service becomes stoppable by declaring a third
    // parameter — there is no list of cancellable methods to keep in step.
    expect(service.started).toBeInstanceOf(AbortSignal)
    expect(service.started.aborted).toBe(true)
  })

  test('stopping a call that already finished is a note, not an error', async () => {
    const kernel = new Kernel()

    const stopped = await kernel.handle(new Request('r9', CANCEL, { id: 'r1' }))

    // The usual way to miss is to press stop as the answer arrives, and a red
    // message for a run that finished correctly would be a lie about it.
    expect(stopped.ok).toBe(true)
    expect(stopped.value).toBe(false)
    // And no note. There was one, and it reached the wire and nobody: the page
    // drops this promise on purpose, so the sentence had exactly one reader,
    // this assertion, asserting that a constant is itself.
    expect(stopped.notes).toEqual([])
  })

  test('the signal is dropped when the call settles, so nothing accumulates', async () => {
    // A class, not an object literal: `register` walks the PROTOTYPE, so a
    // literal registers nothing and this test would pass without ever having
    // put a signal in the map it claims is emptied.
    class Prompt {
      async answer() {
        return Outcome.ok('done')
      }
    }
    const kernel = new Kernel().register('now', new Prompt())

    const answered = await kernel.handle(new Request('r1', 'now.answer'))
    expect(answered.value).toBe('done')
    const late = await kernel.handle(new Request('r2', CANCEL, { id: 'r1' }))

    expect(late.value).toBe(false)
  })
})
