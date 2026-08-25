/**
 * WRITING, TRANSACTIONALLY. The Rust did `std::mem::take(&mut a.unpersisted)`
 * BEFORE the write loop and returned on the first error, so one quota hiccup
 * lost the rest of the batch forever. Here nothing leaves the queue until its
 * record is on disk, and a failure sets a retry time instead of dropping work.
 *
 * A batch lands as ONE record per segment it touches — usually one `put`. The
 * partial segment at the head is REWRITTEN in place as it fills, which is why
 * the log keeps that segment's events resident: rewriting a record needs its
 * whole content, and reading it back would be the per-fact read I20 exists to
 * remove.
 * @module
 */

import { StoreError } from '@harness/kernel'

import { serialiseSnapshot } from './reducers.js'
import { packSegment, readSegment, segStream, segmentIndexOf, snapStream, SEGMENT_SIZE } from './segments.js'

/** @typedef {import('./log.js').LogState} LogState */

/** Segments between snapshots. Eight is 4,096 facts — the boot tail's ceiling. */
export const SNAPSHOT_EVERY = 8

/**
 * How many snapshots survive. Two, not one: the newest can be refused by a
 * reducer version bump, and the one behind it may still match. Keeping all of
 * them would put a growing read back into boot, which is the defect itself.
 */
export const SNAPSHOTS_KEPT = 2

/** Doubling from a quarter second, capped at half a minute. Deterministic — the clock is injected (I7). */
export function backoffMs(/** @type {number} */ attempts) {
  return Math.min(30_000, 250 * 2 ** Math.max(0, attempts - 1))
}

/**
 * What one flush did. `failure` is the write that stopped it — which may be a
 * SNAPSHOT write, after every fact in the batch is already durable, so a caller
 * reads `written` and `pending` for whether the facts landed and `failure` for
 * what to tell the person.
 * @typedef {{written: number, pending: number, deferred: boolean, failure: StoreError|null}} Flushed
 */

/**
 * Write everything queued. Returns what happened rather than throwing: the
 * caller records a `store_failed` fact and the turn carries on, because losing
 * the log must not cost the conversation. The one thing that still comes out as
 * a throw is a build assembled wrong — a projection that cannot be persisted —
 * because no retry and no message to the person can repair that.
 * @param {LogState} state
 * @returns {Promise<Flushed>}
 */
export async function flush(state) {
  if (state.pending.length === 0) return { written: 0, pending: 0, deferred: false, failure: null }
  if (state.clock.now() < state.retryAt) {
    return { written: 0, pending: state.pending.length, deferred: true, failure: null }
  }
  let written = 0
  for (const index of segmentsDue(state)) {
    const events = state.tail.filter((e) => segmentIndexOf(e.seq) === index)
    // The record is built BEFORE the write, so `packSegment`'s own assertion
    // can never be caught by the clause below and re-told as "the store refused
    // record N" — a sentence about a store that was never asked.
    if (events.length === 0) continue
    const record = packSegment(events)
    try {
      await state.store.put(segStream(state.stream), index, record)
    } catch (cause) {
      state.attempts += 1
      state.retryAt = state.clock.now() + backoffMs(state.attempts)
      return { written, pending: state.pending.length, deferred: false, failure: asStoreError(cause, index) }
    }
    state.pending = state.pending.filter((e) => segmentIndexOf(e.seq) !== index)
    written += events.length
  }
  state.attempts = 0
  state.retryAt = 0
  state.tail = state.tail.filter((e) => segmentIndexOf(e.seq) === segmentIndexOf(state.nextSeq))
  const failure = await afterWrite(state)
  return { written, pending: state.pending.length, deferred: false, failure }
}

/** The segment indices this batch touches, oldest first. */
function segmentsDue(/** @type {LogState} */ state) {
  return [...new Set(state.pending.map((e) => segmentIndexOf(e.seq)))].sort((a, b) => a - b)
}

/**
 * Take a snapshot if enough segments have gone by, and prune the ones it makes
 * redundant. A snapshot is an OPTIMISATION, so a failure to write one is
 * reported and never blocks the facts that are already durable.
 *
 * `snapshotAttempts` is the snapshot's OWN run-counter because `flush` clears
 * `attempts` the line before this runs: a snapshot store that refuses forever
 * would otherwise never reach the `state.attempts === 1` test, and a log that
 * silently stops snapshotting quietly gives up the record bound I20 is about.
 * @param {LogState} state
 * @returns {Promise<StoreError|null>}
 */
async function afterWrite(state) {
  const behind = segmentIndexOf(state.nextSeq) - segmentIndexOf(state.snapshotAt)
  if (behind < SNAPSHOT_EVERY) return null
  const seq = state.projections.seq
  const body = serialiseSnapshot(state.projections.snapshot())
  try {
    await state.store.put(snapStream(state.stream), seq, body)
  } catch (cause) {
    state.snapshotAttempts += 1
    return asStoreError(cause, seq)
  }
  state.snapshotAttempts = 0
  state.snapshots.push(seq)
  state.snapshotAt = seq
  while (state.snapshots.length > SNAPSHOTS_KEPT) {
    const old = state.snapshots.shift()
    if (old !== undefined) await state.store.delete(snapStream(state.stream), old).catch(() => {})
  }
  return null
}

/**
 * The events of the head segment, resident so it can be rewritten in place.
 * Used at boot to resume appending into a partial record.
 * @param {string} text
 * @returns {import('@harness/kernel').Event[]}
 */
export function residentTail(text) {
  const { events } = readSegment(text)
  const last = events[events.length - 1]
  if (!last || (last.seq + 1) % SEGMENT_SIZE === 0) return []
  return events
}

/**
 * The failure, always naming the record it was about. A `StoreError` the
 * adapter already typed keeps its kind and its sentence — it knows quota from
 * corruption and this layer does not — and gains the key it did not know.
 * @returns {StoreError}
 */
function asStoreError(/** @type {unknown} */ cause, /** @type {number} */ index) {
  if (cause instanceof StoreError) {
    return cause.key === ''
      ? new StoreError(/** @type {any} */ (cause.kind), cause.message, { cause, detail: cause.detail, key: String(index) })
      : cause
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return new StoreError('io', `the store refused record ${index}`, { cause, detail: message, key: String(index) })
}
