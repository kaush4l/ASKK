/**
 * COLD BOOT, BOUNDED (I20). Two range reads: the snapshots, then the segments
 * from the newest usable one onward. Neither read grows with how long the
 * history is, and that is the property `test/bounded-boot.test.js` asserts by
 * counting the store calls a boot issues over 1,000 facts and over 10,000.
 *
 * The Rust read one record per fact in one read-only transaction each, against
 * a real browser holding 39,237 of them, and refused to boot at all if any one
 * of them failed to parse. Both halves are fixed here: the reads are ranges,
 * and a record this build cannot read is QUARANTINED — named, with the reason,
 * beside the history rather than instead of it — while boot completes.
 * @module
 */

import { createProjections, readSnapshot, snapshotMatches } from './reducers.js'
import { residentTail } from './persist.js'
import { readSegment, segStream, segmentIndexOf, snapStream, quarantineStream, SEGMENT_SIZE } from './segments.js'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('./reducers.js').Reducer} Reducer */
/** @typedef {import('./reducers.js').Snapshot} Snapshot */
/** @typedef {import('./segments.js').SegmentStore} SegmentStore */

/** What could not be read, and where. Carried out of boot so a projection can say so (I16). */
/** @typedef {import('./segments.js').Damage & {segment: number}} Quarantined */

/**
 * @typedef {{
 *   projections: import('./reducers.js').Projections,
 *   nextSeq: number,
 *   tail: Event[],
 *   snapshots: number[],
 *   snapshotAt: number,
 *   quarantined: Quarantined[],
 * }} Restored
 */

/**
 * @param {SegmentStore} store
 * @param {{stream: string, reducers: Reducer[], at: number}} opts
 * @returns {Promise<Restored>}
 */
export async function restore(store, opts) {
  const stored = await store.range(snapStream(opts.stream))
  const usable = pickSnapshot(opts.reducers, stored)
  const from = usable ? segmentIndexOf(usable.seq) : 0
  const records = await store.range(segStream(opts.stream), from)
  const replayed = replay(records, createProjections(opts.reducers, usable), usable?.seq ?? 0)
  await quarantine(store, opts, replayed.quarantined)
  return {
    ...replayed,
    snapshots: stored.map((r) => r.index),
    snapshotAt: usable?.seq ?? 0,
  }
}

/**
 * The newest snapshot this build still agrees with. An older one is tried
 * before giving up, because a reducer bump invalidates the newest and the one
 * behind it may predate the bump — and an unreadable snapshot is skipped, not
 * fatal: the segments are the history, a snapshot is only a shortcut into it.
 * @param {Reducer[]} reducers
 * @param {Array<{index: number, text: string}>} records
 * @returns {Snapshot|null}
 */
function pickSnapshot(reducers, records) {
  for (const record of [...records].reverse()) {
    const snap = readSnapshot(record.text)
    if (typeof snap !== 'string' && snapshotMatches(reducers, snap)) return snap
  }
  return null
}

/**
 * Fold every segment from `from` onward, skipping facts the snapshot already
 * covers. `nextSeq` comes from the HEADER and not from the facts that parsed,
 * so a quarantined line cannot renumber the history behind it — and `expected`
 * walks the same headers so a record that never came back is named rather than
 * folded over in silence.
 * @param {Array<{index: number, text: string}>} records
 * @param {import('./reducers.js').Projections} projections
 * @param {number} from the first seq not already folded into the snapshot
 */
function replay(records, projections, from) {
  /** @type {Quarantined[]} */
  const quarantined = []
  let nextSeq = from
  let expected = from
  for (const record of records) {
    const { header, events, damage } = readSegment(record.text)
    for (const d of damage) quarantined.push({ segment: record.index, ...d })
    const firstSeq = header ? header.firstSeq : record.index * SEGMENT_SIZE
    if (firstSeq > expected) quarantined.push(gap(record.index, expected, firstSeq))
    expected = header ? header.lastSeq + 1 : (record.index + 1) * SEGMENT_SIZE
    for (const event of events) if (event.seq >= from) projections.apply(event)
    if (header) nextSeq = Math.max(nextSeq, header.lastSeq + 1)
    for (const event of events) nextSeq = Math.max(nextSeq, event.seq + 1)
  }
  const head = records[records.length - 1]
  if (!head) return { projections, nextSeq, tail: [], quarantined }
  // A RECORD WE COULD NOT FULLY READ IS NEVER REWRITTEN. Appending into it
  // would repack it from the lines that parsed, deleting the one line the
  // quarantine exists to keep. So the rest of that record's sequence numbers
  // are abandoned and the next fact opens the following record — a gap in seq,
  // which an append-only log can afford, and a lost fact, which it cannot.
  if (quarantined.some((q) => q.segment === head.index)) {
    return { projections, nextSeq: (head.index + 1) * SEGMENT_SIZE, tail: [], quarantined }
  }
  return { projections, nextSeq, tail: residentTail(head.text), quarantined }
}

/**
 * A WHOLE RECORD THAT IS GONE — the one damage no line of a surviving record
 * can show. `length` keeps coming back from the headers, so it stays right
 * while the fold behind it goes short, and the log would report both numbers
 * and neither disagreement. This is `header.firstSeq`'s reader: the field is
 * the check, and a gap reaches the quarantine record by the path damage already
 * takes (I16).
 * @returns {Quarantined}
 */
function gap(/** @type {number} */ index, /** @type {number} */ expected, /** @type {number} */ firstSeq) {
  const reason = `facts ${expected}..${firstSeq - 1} are missing: this record starts at ${firstSeq} and the record before it ended at ${expected - 1}`
  return { segment: index, line: -1, reason, raw: '' }
}

/**
 * Write what could not be read into `quarantine/{stream}`, keyed by the segment
 * it came from — so a second boot over the same damage overwrites the record
 * rather than piling up a new one every refresh. The segment itself is LEFT
 * ALONE: a boot that deletes what it cannot understand is a boot that eats the
 * facts sitting either side of the damage.
 * @param {SegmentStore} store
 * @param {{stream: string, at: number}} opts
 * @param {Quarantined[]} quarantined
 */
async function quarantine(store, opts, quarantined) {
  if (quarantined.length === 0) return
  /** @type {Map<number, Quarantined[]>} */
  const bySegment = new Map()
  for (const q of quarantined) bySegment.set(q.segment, [...(bySegment.get(q.segment) ?? []), q])
  for (const [segment, damage] of bySegment) {
    const body = JSON.stringify({ stream: opts.stream, segment, at: opts.at, damage })
    await store.put(quarantineStream(opts.stream), segment, body).catch(() => {})
  }
}
