/**
 * The SegmentStore, in memory, plus what a test needs to see about it: how
 * many transactions it was asked for and how many records those returned.
 * Those two counters are the whole of I20 — the invariant is about the SHAPE of
 * the access, so a test that cannot count accesses cannot execute it (I17).
 *
 * It lives here and not in `@harness/adapters-test` because `SegmentStore` is
 * declared in `core/log/segments.js` this round; when the port moves into the
 * kernel the double moves beside the others.
 */

import { CAPABILITIES } from '@harness/kernel'
import { testPorts } from '@harness/adapters-test'
import { createApp, freshLog } from '@harness/core'

/** @typedef {import('@harness/core').SegmentStore} SegmentStore */

/**
 * @param {{fail?: (stream: string, index: number) => Error|null}} [opts]
 * @returns {SegmentStore & {txns: () => number, read: () => number, indices: (stream: string) => number[]}}
 */
export function memorySegments(opts = {}) {
  /** @type {Map<string, Map<number, string>>} */
  const streams = new Map()
  let txns = 0
  let read = 0
  const of = (/** @type {string} */ stream) => {
    const held = streams.get(stream) ?? new Map()
    streams.set(stream, held)
    return held
  }
  return {
    txns: () => txns,
    read: () => read,
    indices: (stream) => [...of(stream).keys()],
    async put(stream, index, text) {
      txns += 1
      numeric(index)
      const err = opts.fail?.(stream, index)
      if (err) throw err
      of(stream).set(index, text)
    },
    async range(stream, from = 0) {
      txns += 1
      const rows = [...of(stream)]
        .filter(([index]) => index >= from)
        .sort((a, b) => a[0] - b[0])
        .map(([index, text]) => ({ index, text }))
      read += rows.length
      return rows
    },
    async delete(stream, index) {
      txns += 1
      numeric(index)
      of(stream).delete(index)
    },
  }
}

/**
 * The key's index part is a NUMBER. IndexedDB sorts a compound `[stream,
 * index]` key numerically; a zero-padded string sorts lexically and has a
 * ceiling, so the double refuses one outright rather than quietly working
 * until the day segment 10 sorts before segment 2.
 */
function numeric(/** @type {number} */ index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`a segment key must be a non-negative integer, got ${JSON.stringify(index)}`)
  }
}

/** Every event, in order. The projection a test reads history through. */
export const historyReducer = {
  name: 'history',
  version: 1,
  init: () => /** @type {import('@harness/kernel').Event[]} */ ([]),
  fold: (/** @type {import('@harness/kernel').Event[]} */ state, /** @type {import('@harness/kernel').Event} */ e) => [...state, e],
}

/** How many facts, by type. O(1) per fact, which is what a 10,000-fact test needs. */
export const countsReducer = {
  name: 'counts',
  version: 1,
  init: () => /** @type {Record<string, number>} */ ({}),
  fold: (/** @type {Record<string, number>} */ state, /** @type {import('@harness/kernel').Event} */ e) => {
    state[e.fact.type] = (state[e.fact.type] ?? 0) + 1
    return state
  },
}

/** @param {{log: {read: (name: string) => unknown}}} app @returns {import('@harness/kernel').Event[]} */
export function history(app) {
  return /** @type {import('@harness/kernel').Event[]} */ (app.log.read('history'))
}

/** @param {{log: {read: (name: string) => unknown}}} app @param {string} type */
export function ofType(app, type) {
  return history(app).filter((e) => e.fact.type === type)
}

/**
 * An app whose log is real — segments, projections and all — over a store this
 * test can inspect. The same clock reaches the ports and the log, because a
 * backoff timed against a different clock than the facts is a test that proves
 * nothing about the product.
 * @param {import('@harness/kernel').ClockPort} clock
 * @param {import('@harness/kernel').CapabilityId[]} [available]
 */
export function testApp(clock, available = [...CAPABILITIES]) {
  const log = freshLog(memorySegments(), { clock, reducers: [historyReducer] })
  return createApp(testPorts({ clock }), available, { log })
}

/**
 * THE DEADLINE, UNDER A TEST'S CONTROL. Time is injected (I7), and a deadline
 * that fires on a real timer is a deadline no test can execute (I17): the hang
 * this is here to end is a promise that never settles, and racing it against a
 * real 120 seconds is not a test anybody runs.
 *
 * `wait` never resolves on its own. `fire` resolves every wait outstanding,
 * which is the test SAYING the deadline passed. `auto` is the other half: a
 * test about the RETRY has to let the backoff elapse, and one about the
 * DEADLINE has to hold it open — one double, told which.
 * @param {{auto?: boolean}} [opts]
 */
export function manualTimer(opts = {}) {
  /** @type {Array<() => void>} */
  let waiting = []
  return {
    /** @param {number} _ms @param {AbortSignal} [_signal] @returns {Promise<void>} */
    wait: (_ms, _signal) => new Promise((resolve) => {
      if (opts.auto) setTimeout(resolve, 0)
      else waiting.push(() => resolve())
    }),
    pending: () => waiting.length,
    fire() {
      const due = waiting
      waiting = []
      for (const resolve of due) resolve()
    },
  }
}

/**
 * A tool that RECORDS WHEN IT RAN, so a test can assert two calls OVERLAPPED
 * rather than assert on a wall clock — which measures the machine the suite is
 * running on and not the driver. `ticks` is how many turns of the microtask
 * queue it takes to answer, so a test can make the SECOND call finish first and
 * still demand the results land in the order the model wrote them.
 * @param {string} answer @param {string[]} into @param {number} ticks
 * @returns {import('@harness/core').ToolRun}
 */
export function watchedTool(answer, into, ticks) {
  return async (args) => {
    into.push(`start ${answer}`)
    for (let i = 0; i < ticks; i++) await Promise.resolve()
    into.push(`end ${answer}`)
    return { ok: true, output: `${answer} saw ${args}` }
  }
}

/**
 * A tool that never answers — the hang every deadline exists for — and says
 * when it was REACHED. `fire()` drains every wait outstanding, so a test that
 * fires as soon as one exists may be firing the MODEL's deadline instead of
 * this one; the flag is how a test names the call it meant.
 * @param {() => void} [onCall] @returns {import('@harness/core').ToolRun}
 */
export function silentTool(onCall) {
  return () => {
    onCall?.()
    return new Promise(() => {})
  }
}
