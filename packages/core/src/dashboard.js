/**
 * THE DASHBOARD — the tiles, the roster, and the one line that says whether
 * this build is healthy.
 *
 * `/tiles` exists so a poll costs a tile and not a page: the predecessor's four
 * panes each re-projected everything at their own interval, which is how a
 * session became O(history²). Both routes read the SAME fold, so the number on
 * the tile and the number on the page cannot disagree.
 *
 * THE STATUS LINE NAMES WHAT IS MISSING (I15, I16). A capability this build did
 * not grant is stated, by name, before anything reaches for it — silence reads
 * as absence and a model plans from it.
 * @module
 */

import { CAPABILITIES, CAPABILITY_SENTENCE, ok } from '@harness/kernel'

import { ACTIVITY } from './panels.js'
import { IN_MEMORY } from './folder.js'
import { NO_TURNS, TURNS } from './turns.js'
import { rows } from './board.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./panels.js').Activity} Activity */
/** @typedef {import('./turns.js').Turns} Turns */

/** @type {Manifest} */
export const dashboardManifest = {
  id: 'dashboard',
  version: '1',
  title: 'Dashboard',
  summary: "Every pane's tile, the roster, and what is running.",
  capabilities: [],
  view: 'dashboard',
  routes: [
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/tiles' },
    { method: 'GET', path: '/panels/status' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function dashboard(request, ctx) {
  if (request.path === '/tiles') return ok('tiles', { tiles: tiles(ctx) })
  if (request.path === '/panels/status') return ok('status', health(ctx))
  const cards = rows(ctx)
  return ok('dashboard', {
    tiles: tiles(ctx),
    rows: cards,
    runningLabel: running(cards),
    ...health(ctx),
  })
}

/**
 * FOUR FACTS AT A GLANCE. Each carries the machine value AND the sentence, so
 * the pane places them and words none of them (I5).
 * @param {Ctx} ctx @returns {Array<Record<string, unknown>>}
 */
function tiles(ctx) {
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  const turns = /** @type {Record<string, Turns>} */ (ctx.project(TURNS))[ctx.me] ?? NO_TURNS
  const known = new Set([ctx.me, ...ctx.roster.specs.map((s) => s.name)])
  return [
    tile('agents', 'Agents', known.size, `${known.size === 1 ? '1 agent file' : `${known.size} agent files`} loaded in this browser.`),
    tile('messages', 'Messages', activity.messages, `${plural(activity.messages, 'message')} sent from this page.`),
    tile('tokens', 'Tokens', activity.spentTokens, `${plural(activity.spentTokens, 'token')} across ${plural(activity.modelCalls, 'model call')}.`),
    tile('unanswered', 'Unanswered', turns.unanswered, turns.unanswered === 0
      ? 'Every turn that ended here ended with an answer.'
      : `${plural(turns.unanswered, 'turn')} ended without an answer.`),
  ]
}

/** @param {string} id @param {string} label @param {number} value @param {string} note */
function tile(id, label, value, note) {
  return { id, label, value, valueLabel: String(value), note }
}

/** @param {Array<Record<string, unknown>>} cards */
function running(cards) {
  const live = cards.filter((c) => c.live === true).map((c) => String(c.name))
  if (live.length === 0) return 'Nothing is running.'
  return `${live.join(', ')} ${live.length === 1 ? 'is' : 'are'} running now.`
}

/**
 * THE ONE-LINE HEALTH OF THE BUILD, and the detail under it. The headline is
 * whichever thing is actually wrong, in the order a person would care: storage
 * that is failing outranks a capability that was never offered, because the
 * first is losing work and the second is a build that was assembled this way.
 * @param {Ctx} ctx @returns {Record<string, unknown>}
 */
function health(ctx) {
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  const withheld = CAPABILITIES.filter((id) => !ctx.available.includes(id))
  const notes = [
    ...(ctx.durable ? [] : [`${IN_MEMORY}, so anything written to it is lost on refresh.`]),
    ...withheld.map((id) => `This build cannot ${CAPABILITY_SENTENCE[id]}.`),
  ]
  return {
    healthy: activity.storeFailures === 0,
    statusLabel: activity.storeFailures > 0
      ? `Storage has failed ${plural(activity.storeFailures, 'time')} — the most recent was ${activity.lastStoreFailure}.`
      : notes[0] ?? 'Everything this build offers is working.',
    notes,
    withheld: [...withheld],
  }
}

/** A count and its noun. Spelling, not opinion — and said here so no pane says it differently. */
export function plural(/** @type {number} */ n, /** @type {string} */ noun) {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`
}
