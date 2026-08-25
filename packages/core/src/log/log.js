/**
 * THE LOG THE APP HOLDS. It is append-only like `EventLog` and it is NOT an
 * `EventLog`: that one keeps every fact it has ever seen in one array and
 * numbers a new fact by that array's length, which is only correct for a log
 * replayed from zero — the thing I20 forbids. This one carries the sequence
 * itself, so it can boot from a snapshot and hold nothing behind it.
 *
 * WHAT IS RESIDENT is bounded on purpose: the facts of the head segment (up to
 * 512, so the partial record can be rewritten) plus whatever has not reached
 * the store yet. Everything older is in the segments, and its MEANING is in the
 * projections — which is why there is no iterator here and no `ofType`. A view
 * reads a registered reducer or it does not read the log at all (I5, I8).
 * @module
 */

import { EVENT_VERSION } from '@harness/kernel'

import { flush } from './persist.js'
import { restore } from './boot.js'
import { createProjections } from './reducers.js'
import { segStream, snapStream } from './segments.js'

/** @typedef {import('@harness/kernel').ClockPort} ClockPort */
/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./reducers.js').Reducer} Reducer */
/** @typedef {import('./segments.js').SegmentStore} SegmentStore */
/** @typedef {import('./boot.js').Quarantined} Quarantined */

/**
 * Everything one log is, in one object so `persist` and `boot` can work on it
 * without the log handing out its own internals. `retryAt` and `attempts` are
 * the backoff; `snapshotAt` is the seq the newest kept snapshot was taken at,
 * and `snapshotAttempts` counts the run of snapshot writes that have failed,
 * which `attempts` cannot: it is cleared before the snapshot is even tried.
 * @typedef {{
 *   store: SegmentStore, clock: ClockPort, stream: string,
 *   projections: import('./reducers.js').Projections,
 *   nextSeq: number, tail: Event[], pending: Event[],
 *   snapshots: number[], snapshotAt: number, quarantined: Quarantined[],
 *   attempts: number, retryAt: number, snapshotAttempts: number,
 * }} LogState
 */

/** @typedef {ReturnType<typeof createLog>} Log */

/**
 * Record one fact. The ONLY mutation the log offers — no edit, no delete — and
 * the FOLD HAPPENS HERE, once per fact, which is what makes a projection a
 * read instead of a replay.
 * @param {LogState} state
 * @param {Fact} fact
 * @param {Timestamp} at injected (I7)
 * @param {string} [turnId] which turn this fact belongs to; '' for none
 * @returns {Event}
 */
function appendTo(state, fact, at, turnId = '') {
  /** @type {Event} */
  const event = { id: state.nextSeq, seq: state.nextSeq, at, turnId, v: EVENT_VERSION, fact }
  state.nextSeq += 1
  state.tail.push(event)
  state.pending.push(event)
  state.projections.apply(event)
  return event
}

/**
 * The log itself. `length` is every fact ever recorded — the next seq — while
 * `resident` is how many memory is actually holding, and the gap between those
 * two numbers is the whole of I20. `persist` is safe after every turn: it
 * writes one record per segment the batch touches, leaves the queue intact on
 * failure, and defers while a backoff is running.
 * @param {LogState} state
 */
function createLog(state) {
  return {
    /**
     * The four-argument door, not a two-argument narrowing of it. I21 needs the
     * turn PERSISTED — a replay that cannot see which turn a fact belonged to
     * cannot reproduce the drops the reducer makes live — and a `log` that
     * accepted only two would have made that unreachable from every caller.
     * @param {Fact} fact @param {Timestamp} at @param {string} [turnId]
     */
    append: (fact, at, turnId) => appendTo(state, fact, at, turnId),
    get length() {
      return state.nextSeq
    },
    /** Facts recorded but not yet on disk. */
    get unpersisted() {
      return state.pending.length
    },
    /** Facts memory is holding: the head record, once the queue has drained. */
    get resident() {
      return state.tail.length
    },
    /** What could not be read at boot. Empty is the answer a healthy log gives. */
    get quarantined() {
      return state.quarantined
    },
    /** One projection's folded state. Throws by name if nobody registered it. */
    read: (/** @type {string} */ name) => state.projections.read(name),
    persist: () => persistOnce(state),
  }
}

/**
 * Write, and RECORD A FAILURE AS A FACT — once per run of failures, not once
 * per attempt. A store that has gone away is retried behind a backoff, and a
 * fact appended on every retry would be a queue that grows while offline for
 * the sole purpose of describing being offline.
 * @param {LogState} state
 */
async function persistOnce(state) {
  const flushed = await flush(state)
  const key = flushed.failure ? firstOfRun(state, flushed.failure) : null
  if (flushed.failure && key !== null) {
    appendTo(state, { type: 'store_failed', key, message: flushed.failure.message }, state.clock.now())
  }
  return flushed
}

/**
 * The key to record this failure under, or null if the same run of failures has
 * already been told. Two counters and not one, because a snapshot fails on a
 * path where the segment counter is already back at zero — and the key says
 * WHICH of the two, so `snap/main/4096` and `seg/main/8` never read alike.
 * @param {LogState} state
 * @param {import('@harness/kernel').StoreError} failure
 * @returns {string|null}
 */
function firstOfRun(state, failure) {
  if (state.attempts === 1) return `${segStream(state.stream)}/${failure.key}`
  if (state.snapshotAttempts === 1) return `${snapStream(state.stream)}/${failure.key}`
  return null
}

/**
 * A log with nothing behind it. The store is REQUIRED — a log assembled
 * without one would record facts that quietly evaporate on refresh, which is
 * the same defect as a capability descriptor answering on an adapter's behalf.
 * @param {SegmentStore} store
 * @param {{clock: ClockPort, reducers?: Reducer[], stream?: string}} opts
 * @returns {Log}
 */
export function freshLog(store, opts) {
  const reducers = opts.reducers ?? []
  return createLog({
    store,
    clock: opts.clock,
    stream: opts.stream ?? 'main',
    projections: createProjections(reducers),
    nextSeq: 0,
    tail: [],
    pending: [],
    snapshots: [],
    snapshotAt: 0,
    quarantined: [],
    attempts: 0,
    retryAt: 0,
    snapshotAttempts: 0,
  })
}

/**
 * A log read back from storage: the newest usable snapshot plus the segments
 * after it. Two range reads, however long the history is (I20).
 * @param {SegmentStore} store
 * @param {{clock: ClockPort, reducers?: Reducer[], stream?: string}} opts
 * @returns {Promise<Log>}
 */
export async function bootLog(store, opts) {
  const reducers = opts.reducers ?? []
  const stream = opts.stream ?? 'main'
  const restored = await restore(store, { stream, reducers, at: opts.clock.now() })
  return createLog({
    store,
    clock: opts.clock,
    stream,
    projections: restored.projections,
    nextSeq: restored.nextSeq,
    tail: restored.tail,
    pending: [],
    snapshots: restored.snapshots,
    snapshotAt: restored.snapshotAt,
    quarantined: restored.quarantined,
    attempts: 0,
    retryAt: 0,
    snapshotAttempts: 0,
  })
}
