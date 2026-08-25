/**
 * THE DEBUG MODULE — the log, folded into turns, as facts.
 *
 * IT READS A BOUNDED TAIL AND NOT THE LOG (I20). The predecessor's debug pane
 * rendered `log.iter()`, so opening it against a browser holding 39,237 events
 * cloned all of them into a handler and then into React. `panels.js` keeps the
 * newest 200 already worded; this groups them by the turn they belong to, which
 * is what makes the pane readable rather than a wall.
 *
 * GROUPED BY `turnId`, WHICH IS ON THE ENVELOPE. That is the payoff of I21
 * putting it there: no fact had to remember to carry it, so every fact can be
 * filed under the attempt it belonged to, and the facts belonging to no turn —
 * a boot, a store failure, a request — group under one heading that says so.
 * @module
 */

import { ok } from '@harness/kernel'

import { ACTIVITY, TRACE, TRACE_KEPT } from './panels.js'
import { plural } from './dashboard.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./panels.js').Activity} Activity */
/** @typedef {import('./panels.js').Traced} Traced */

/** @type {Manifest} */
export const debugManifest = {
  id: 'debug',
  version: '1',
  title: 'Debug',
  summary: 'The newest facts in the log, grouped by the turn they belong to.',
  capabilities: [],
  view: 'debug',
  routes: [{ method: 'GET', path: '/debug' }],
}

/** @param {Request} _request @param {Ctx} ctx @returns {Response} */
export function debug(_request, ctx) {
  const traced = /** @type {Traced[]} */ (ctx.project(TRACE))
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  return ok('debug', {
    groups: grouped(traced),
    factsLabel: reach(traced.length),
    countsLabel: `${plural(activity.modelCalls, 'model call')} and ${plural(activity.toolCalls, 'tool call')}, ${plural(activity.toolFailures, 'failure')} among them.`,
    storeLabel: activity.storeFailures === 0
      ? 'Storage has not failed in this session.'
      : `Storage failed ${plural(activity.storeFailures, 'time')}; the last was ${activity.lastStoreFailure}.`,
  })
}

/**
 * ONE GROUP PER TURN, in the order the turns first appear. A `Map` keyed by
 * `turnId` and not a sort: facts arrive in sequence and a turn's facts are
 * contiguous in practice but not by guarantee, and re-sorting would move a
 * system fact out of the order it actually happened in.
 * @param {Traced[]} traced @returns {Array<Record<string, unknown>>}
 */
function grouped(traced) {
  /** @type {Map<string, Traced[]>} */
  const byTurn = new Map()
  for (const row of traced) {
    const held = byTurn.get(row.turnId)
    if (held) held.push(row)
    else byTurn.set(row.turnId, [row])
  }
  return [...byTurn].map(([turnId, rows]) => ({
    id: turnId === '' ? 'no-turn' : turnId,
    turnId,
    headingLabel: turnId === ''
      ? `${plural(rows.length, 'fact')} belonging to no turn — boots, requests and storage.`
      : `Turn ${turnId.slice(0, 8)} · ${plural(rows.length, 'fact')}`,
    rows,
  }))
}

/** WHAT THIS PANE CAN AND CANNOT REACH, said out loud rather than implied by a short list. */
function reach(/** @type {number} */ held) {
  if (held < TRACE_KEPT) return `${plural(held, 'fact')}, which is the whole of this session's log.`
  return `The newest ${TRACE_KEPT} facts. Everything older is in the segments and is read back only by a projection, never by this pane.`
}
