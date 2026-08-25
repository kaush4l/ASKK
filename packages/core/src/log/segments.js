/**
 * THE SEGMENT FORMAT, and the contract of the store that holds one.
 *
 * The Rust wrote `events/{seq:08}` — one record per fact — and its own module
 * header documented a segment format that was never written. So a browser
 * holding 39,237 facts booted by issuing 39,237 read-only transactions. Here
 * one record holds ~512 facts as NDJSON: a header line stating the range, then
 * one envelope per line. Boot is a range read, not a read per fact (I20).
 *
 * NDJSON and not a JSON array because a damaged record is then damaged by the
 * LINE: the lines that parse still replay, and only the ones that do not are
 * quarantined. A single `JSON.parse` over the whole record loses the batch.
 *
 * THE KEY IS COMPOUND AND NUMERIC — `[stream, index]`, two arguments, never a
 * concatenated string. A zero-padded key has a ceiling nobody notices until it
 * is reached, and the rule that keeps `{:08}` sorted lives in a comment where
 * no test can reach it. Here the store sorts numbers, and `range` returning
 * segment 2 before segment 10 is a claim a test executes.
 * @module
 */

import { EVENT_VERSION, isKnownFact } from '@harness/kernel'

import { LogError } from '../errors.js'

/** @typedef {import('@harness/kernel').Event} Event */

/** Facts per record. Segments too small are transactions; too large are memory. */
export const SEGMENT_SIZE = 512

/**
 * A record store keyed by `[stream, index]`, both parts kept apart all the way
 * down. `range` is ascending by index and is ONE transaction however many
 * records it returns — that is the property I20 is asserted against.
 * @typedef {{
 *   put: (stream: string, index: number, text: string) => Promise<void>,
 *   range: (stream: string, from?: number) => Promise<Array<{index: number, text: string}>>,
 *   delete: (stream: string, index: number) => Promise<void>,
 * }} SegmentStore
 */

/** One agent's facts. A prefix per agent, so one agent's history can never replay into another's. */
export const segStream = (/** @type {string} */ agent) => `seg/${agent}`

/** One agent's snapshots, keyed by the boundary seq they were taken at. */
export const snapStream = (/** @type {string} */ agent) => `snap/${agent}`

/** What could not be read, kept beside the history rather than instead of it. */
export const quarantineStream = (/** @type {string} */ agent) => `quarantine/${agent}`

/** Which record a fact belongs in. The only place this arithmetic exists. */
export function segmentIndexOf(/** @type {number} */ seq) {
  return Math.floor(seq / SEGMENT_SIZE)
}

/** @typedef {{firstSeq: number, lastSeq: number, count: number}} SegmentHeader */

/** @typedef {{line: number, reason: string, raw: string}} Damage */

/**
 * @param {Event[]} events non-empty, in seq order, all from one segment. `flush`
 *   checks the emptiness before it calls, so the refusal below is an assertion
 *   about this build and never a thing that happens to a person's log — and it
 *   is typed, because a `RangeError` reaching a caller told that persisting
 *   does not throw is a contract broken by an internal check.
 * @returns {string}
 */
export function packSegment(events) {
  const first = events[0]
  const last = events[events.length - 1]
  if (!first || !last) {
    throw new LogError('empty_segment', 'a segment record cannot be empty', {
      detail: 'the index came from a pending fact, so the tail must hold that fact too',
    })
  }
  /** @type {SegmentHeader} */
  const header = { firstSeq: first.seq, lastSeq: last.seq, count: events.length }
  return [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n')
}

/**
 * Read one record back. NEVER throws: an unreadable line is reported, not
 * raised, because refusing to boot over one bad record is data loss with extra
 * steps — the caller quarantines what came back damaged and carries on.
 * @param {string} text
 * @returns {{header: SegmentHeader|null, events: Event[], damage: Damage[]}}
 */
export function readSegment(text) {
  const lines = text.split('\n')
  const header = readHeader(lines[0] ?? '')
  if (!header) {
    return { header: null, events: [], damage: [{ line: 0, reason: 'the segment header is not readable JSON', raw: excerpt(lines[0] ?? '') }] }
  }
  /** @type {Event[]} */
  const events = []
  /** @type {Damage[]} */
  const damage = []
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    if (raw === '') continue
    const read = readEvent(raw)
    if (typeof read === 'string') damage.push({ line: i, reason: read, raw: excerpt(raw) })
    else events.push(read)
  }
  const seen = events.length + damage.length
  if (seen !== header.count) {
    damage.push({ line: -1, reason: `the header claims ${header.count} facts and the record holds ${seen}`, raw: '' })
  }
  return { header, events, damage }
}

/** @returns {SegmentHeader|null} */
function readHeader(/** @type {string} */ raw) {
  const value = parse(raw)
  if (!value || typeof value !== 'object') return null
  const { firstSeq, lastSeq, count } = /** @type {Record<string, unknown>} */ (value)
  if (typeof firstSeq !== 'number' || typeof lastSeq !== 'number' || typeof count !== 'number') return null
  return { firstSeq, lastSeq, count }
}

/**
 * One envelope, or the sentence saying why it could not be read. The three
 * refusals are the three ways a record outlives the build that wrote it (I18):
 * malformed bytes, a newer envelope, and a fact type this build has no name for.
 * @returns {Event|string}
 */
function readEvent(/** @type {string} */ raw) {
  const value = parse(raw)
  if (!value || typeof value !== 'object') return 'the line is not readable JSON'
  const event = /** @type {Partial<Event>} */ (value)
  if (typeof event.seq !== 'number' || typeof event.at !== 'number' || typeof event.v !== 'number') {
    return 'the envelope is missing seq, at or v'
  }
  if (event.v > EVENT_VERSION) return `the envelope is version ${event.v} and this build reads ${EVENT_VERSION}`
  if (!isKnownFact(event.fact)) {
    const type = /** @type {{type?: unknown}} */ (event.fact ?? {}).type
    return `this build has no fact type named ${JSON.stringify(type ?? null)}`
  }
  return /** @type {Event} */ (value)
}

function parse(/** @type {string} */ raw) {
  try {
    return /** @type {unknown} */ (JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * The head of a damaged line, for the person who opens the quarantine record.
 * The head and not the tail because a record's shape — what it claimed to be —
 * is at the front, and this is a diagnostic, never a model's context.
 */
function excerpt(/** @type {string} */ raw) {
  return raw.length <= 200 ? raw : `${raw.slice(0, 200)}…`
}
