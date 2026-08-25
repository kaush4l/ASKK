/**
 * The segment log: how facts persist, how they come back, and how a view reads
 * them. `packages/core/src/log/` is the whole of I20 — bounded boot, segments
 * instead of a record per fact, snapshots, a write that never drains before it
 * succeeds, and a quarantine so damage costs one record and not the session.
 * @module
 */

export { freshLog, bootLog } from './log.js'
export { SEGMENT_SIZE, segStream, snapStream, quarantineStream } from './segments.js'
export { SNAPSHOT_EVERY, SNAPSHOTS_KEPT } from './persist.js'

/** @typedef {import('./log.js').Log} Log */
/** @typedef {import('./reducers.js').Reducer} Reducer */
/** @typedef {import('./reducers.js').Snapshot} Snapshot */
/** @typedef {import('./segments.js').SegmentStore} SegmentStore */
/** @typedef {import('./boot.js').Quarantined} Quarantined */
