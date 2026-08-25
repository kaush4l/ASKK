/**
 * THE DEADLINE EVERY OUTSTANDING CALL RUNS AGAINST (I21), and the two small
 * things that go with it.
 *
 * A call this build has stopped waiting for is a call it has also stopped
 * paying for: the port is handed an `AbortSignal` and it is aborted the moment
 * the deadline wins. The Rust awaited each port call bare, so a workspace that
 * stopped answering left a turn outstanding for the life of the tab.
 * @module
 */

/**
 * How this build waits. NOT `setTimeout` reached for directly: a deadline is a
 * clock, time is injected (I7), and a driver whose deadline a test cannot fire
 * is a deadline no test can execute (I17). `wait` resolves after `ms`, or never
 * — the caller aborts the signal once the race is decided, and the adapter
 * clears its timer on that.
 * @typedef {{timer: {wait: (ms: number, signal?: AbortSignal) => Promise<void>}, deadlineMs?: number}} Driving
 */

/** How long a turn waits for one call before it is told the call is not coming. */
export const DEFAULT_DEADLINE_MS = 120_000

/** What a call that ran out of time comes back as. A symbol, so no port's own answer can be mistaken for it. */
export const LATE = Symbol('deadline')

/**
 * THE RACE EVERY OUTSTANDING CALL RUNS. The port is handed a signal and the
 * signal is aborted the moment the deadline wins, so a call this build has
 * stopped waiting for is a call it has also stopped paying for.
 * @template T
 * @param {Driving} opts @param {(signal: AbortSignal) => Promise<T>} start
 * @returns {Promise<T|typeof LATE>}
 */
export async function within(opts, start) {
  const call = new AbortController()
  const clock = new AbortController()
  try {
    const late = opts.timer.wait(deadline(opts), clock.signal).then(() => /** @type {typeof LATE} */ (LATE))
    const outcome = /** @type {T|typeof LATE} */ (await Promise.race([start(call.signal), late]))
    if (outcome === LATE) call.abort()
    return outcome
  } finally {
    clock.abort()
  }
}

function deadline(/** @type {Driving} */ opts) {
  return opts.deadlineMs ?? DEFAULT_DEADLINE_MS
}

/** The deadline in force, in seconds — the number the sentence a person reads carries. */
export function lateAfter(/** @type {Driving} */ opts) {
  return deadline(opts) / 1000
}

/** What a thrown thing says, without pretending an unknown one is an Error. */
export function said(/** @type {unknown} */ cause) {
  return cause instanceof Error ? cause.message : String(cause)
}
