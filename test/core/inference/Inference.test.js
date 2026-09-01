import { afterEach, describe, expect, test } from 'bun:test'
import { Inference } from '../../../src/core/inference/Inference.js'
import { OpenAICompatible } from '../../../src/core/inference/OpenAICompatible.js'
import { ScriptedFetch } from '../../support/ScriptedFetch.js'

/**
 * The stop, at the only seam where it means anything.
 *
 * This file exists because of a hole, and the hole is worth naming precisely.
 * The slice that added cancellation claimed "an AbortSignal reaching the actual
 * fetch", and its tests asserted that the signal OBJECT was passed along, or
 * aborted before the scripted call and watched the loop decline to make it.
 * Neither touches a request. Five separate mutations proved it: `_either`
 * ignoring the user stop entirely, `stream` never forwarding it, `invoke` never
 * forwarding it, the stopped-versus-timeout branch deleted, and
 * `BackendClient.stop` made a no-op — every one of them left the suite at
 * 208 pass, 0 fail.
 *
 * So the assertions below are against a `fetch` that answers nothing until the
 * signal fires. That is the only shape that can tell a stop which reaches the
 * socket apart from a flag polled between iterations, and it is the difference
 * between a button that ends a thirty-second wait and one that decides not to
 * start a thirty-first.
 *
 * The three-way message matters as much as the abort. A stopped call, a quiet
 * endpoint and a broken connection are the same `AbortError` to script, and
 * telling a user their server is unreachable because they pressed stop is
 * exactly the lie this tree keeps being rebuilt to stop telling.
 */

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

function transport(replies, settings = {}) {
  const fetching = new ScriptedFetch(replies)
  restore = fetching.install()
  return new OpenAICompatible({ baseUrl: 'http://127.0.0.1:8873/v1', timeout: 50_000, ...settings })
}

/** How long a promise took, so "promptly" is a number rather than a feeling. */
async function timed(work) {
  const started = Date.now()
  const value = await work
  return { value, ms: Date.now() - started }
}

describe('a stop that reaches the request', () => {
  test('an in-flight non-streaming call ends when the signal fires, not when the endpoint answers', async () => {
    const model = transport([{ hang: true }])
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 20)

    const { value, ms } = await timed(model.invoke('hello', [], { signal: stop.signal }))

    // The endpoint never answered and never will. If the signal were only
    // checked between iterations this would sit here for the 50-second timeout.
    expect(ms).toBeLessThan(2000)
    expect(value.ok).toBe(false)
    expect(value.failure.message).toBe('openai-compatible: the call was stopped')
    expect(value.failure.hint).toBe('You ended this run.')
  })

  test('an in-flight STREAM ends the same way, on the same signal', async () => {
    const model = transport([{ hang: true }])
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 20)

    const { value, ms } = await timed(
      model.stream('hello', [], { onDelta: () => {}, signal: stop.signal }),
    )

    expect(ms).toBeLessThan(2000)
    expect(value.ok).toBe(false)
    expect(value.failure.message).toBe('openai-compatible: the call was stopped')
  })

  test('a stopped call is NOT reported as an endpoint that went quiet', async () => {
    // The whole point of telling the two aborts apart. Both arrive as
    // `AbortError`; only one of them is the user's own decision, and the other
    // message sends them to debug a server that is working.
    const model = transport([{ hang: true }])
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 20)

    const answered = await model.invoke('hello', [], { signal: stop.signal })

    expect(answered.failure.message).not.toContain('no answer within')
    expect(answered.failure.hint).not.toContain('CORS')
  })

  test('a deadline with no user stop still reports a timeout, not a stop', async () => {
    const model = transport([{ hang: true }], { timeout: 30 })

    const answered = await model.invoke('hello', [], { signal: null })

    expect(answered.ok).toBe(false)
    expect(answered.failure.message).toBe('openai-compatible: no answer within 30ms')
  })

  test('a stop already fired before the call is made never reaches the network', async () => {
    const fetching = new ScriptedFetch([{ json: { choices: [{ message: { content: 'hi' } }] } }])
    restore = fetching.install()
    const model = new OpenAICompatible({ baseUrl: 'http://127.0.0.1:8873/v1' })
    const stop = new AbortController()
    stop.abort()

    const answered = await model.invoke('hello', [], { signal: stop.signal })

    expect(answered.ok).toBe(false)
    expect(answered.failure.message).toBe('openai-compatible: the call was stopped')
  })
})

describe('Inference._either', () => {
  test('with no user stop it is the deadline alone', () => {
    const deadline = new AbortController()

    expect(Inference._either(null, deadline)).toBe(deadline.signal)
  })

  test('either signal aborts the combined one', () => {
    const stop = new AbortController()
    const deadline = new AbortController()

    const both = Inference._either(stop.signal, deadline)
    expect(both.aborted).toBe(false)
    stop.abort()

    expect(both.aborted).toBe(true)
  })

  test('the deadline still fires when the user is holding a signal that never does', () => {
    const stop = new AbortController()
    const deadline = new AbortController()

    const both = Inference._either(stop.signal, deadline)
    deadline.abort()

    expect(both.aborted).toBe(true)
  })

  /**
   * The floor, and what it cost to leave it unstated.
   *
   * `AbortSignal.any` is Chrome 116, Safari 17.4, Firefox 124. `Kernel.handle`
   * makes a controller for EVERY call, so `stop` is always truthy and the
   * branch is always taken — which meant an older browser lost not its stop
   * button but every turn of every chat, with `AbortSignal.any is not a
   * function` wearing the hint that says to check your CORS headers.
   */
  test('a browser with no AbortSignal.any still stops, and still times out', () => {
    const real = AbortSignal.any
    delete AbortSignal.any
    try {
      const stop = new AbortController()
      const deadline = new AbortController()

      const both = Inference._either(stop.signal, deadline)
      expect(both).toBe(deadline.signal)
      expect(both.aborted).toBe(false)
      stop.abort()

      expect(both.aborted).toBe(true)
    } finally {
      AbortSignal.any = real
    }
  })

  test('with no AbortSignal.any, a stop that already fired is honoured at once', () => {
    const real = AbortSignal.any
    delete AbortSignal.any
    try {
      const stop = new AbortController()
      stop.abort()
      const deadline = new AbortController()

      expect(Inference._either(stop.signal, deadline).aborted).toBe(true)
    } finally {
      AbortSignal.any = real
    }
  })

  test('a whole turn survives on a browser with no AbortSignal.any', async () => {
    const real = AbortSignal.any
    delete AbortSignal.any
    try {
      const model = transport([{ json: { choices: [{ message: { content: 'still here' } }] } }])

      // The failure this replaces was total: not a degraded stop, no chat at
      // all, blamed on the user's server.
      const answered = await model.invoke('hello', [], { signal: new AbortController().signal })

      expect(answered.ok).toBe(true)
      expect(answered.value).toBe('still here')
    } finally {
      AbortSignal.any = real
    }
  })
})
