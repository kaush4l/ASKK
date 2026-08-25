/**
 * THE DASHBOARD — the tiles, the fleet GROUPED BY STATE, and the one line that
 * says whether this build is healthy.
 *
 * `/tiles` exists so a poll costs a tile and not a page: the predecessor's four
 * panes each re-projected everything at their own interval, which is how a
 * session became O(history²). Both routes read the SAME fold, so the number on
 * the tile and the number on the page cannot disagree.
 *
 * THE GROUPS ARE MADE HERE AND NOWHERE ELSE. Which state an agent is in is a
 * fold of the log, so a pane that groups the flat list it was handed can
 * disagree with the transcript beside it (I5, I8) — and the only question a
 * roster answers at a glance is which agent needs a person, which is why
 * `waiting` is first by construction rather than by a sort somebody applies.
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
  summary: "Every pane's tile, the fleet grouped by state, and what is running.",
  capabilities: [],
  view: 'dashboard',
  routes: [
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/tiles' },
    { method: 'GET', path: '/panels/status' },
  ],
}

/**
 * THE FOUR GROUPS, AND THE ONE THAT NEEDS A PERSON IS FIRST. Every status the
 * kernel has is in exactly one of them — `test/dashboard.test.js` executes that
 * against `STATUSES`, because a status added to the vocabulary and to no group
 * here is an agent that vanishes off the roster rather than one that looks odd.
 * @type {ReadonlyArray<{id: string, noun: string, of: ReadonlyArray<string>}>}
 */
const GROUPS = [
  { id: 'waiting', noun: 'Needs you', of: ['waiting'] },
  { id: 'live', noun: 'Working', of: ['thinking', 'calling'] },
  { id: 'failed', noun: 'Failed', of: ['failed'] },
  { id: 'resting', noun: 'Not running', of: ['idle', 'stopped'] },
]

/** What an empty roster means, which is never "no agents exist" — it is a manifest that names none. */
const ROSTER_EMPTY = 'No agents are loaded. agents/index.json is the manifest — an agent folder that is not listed there is never fetched.'

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function dashboard(request, ctx) {
  if (request.path === '/tiles') return ok('tiles', tiles(ctx))
  if (request.path === '/panels/status') return ok('status', health(ctx))
  const cards = rows(ctx)
  return ok('dashboard', {
    tiles: tiles(ctx),
    groups: grouped(cards),
    rosterEmptyNote: ROSTER_EMPTY,
    runningLabel: running(cards),
  })
}

/**
 * ONE GROUP PER STATE, EMPTY ONES OMITTED. A heading over no rows is furniture
 * between a person and the thing they came for, and the count is in the label
 * so the pane never takes one.
 * @param {Array<Record<string, unknown>>} cards @returns {Array<Record<string, unknown>>}
 */
function grouped(cards) {
  return GROUPS.flatMap((group) => {
    const mine = cards.filter((card) => group.of.includes(String(card.status)))
    if (mine.length === 0) return []
    return [{
      id: group.id,
      label: `${group.noun} — ${plural(mine.length, 'agent')}`,
      rows: mine.map((card) => ({
        name: String(card.name),
        status: String(card.status),
        statusLabel: String(card.statusLabel),
        // A card with nothing to say about right now still has its turn history,
        // which is what the row would otherwise render as a blank line.
        detail: String(card.detail) || String(card.turnsLabel),
      })),
    }]
  })
}

/**
 * FOUR FACTS AT A GLANCE. Each value arrives ALREADY WORDED, because the pane
 * places facts and words none of them (I5) — the predecessor's strip counted
 * for itself and drifted from the header below it the first time one of the two
 * forgot a state.
 * @param {Ctx} ctx @returns {Record<string, unknown>}
 */
function tiles(ctx) {
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  const turns = /** @type {Record<string, Turns>} */ (ctx.project(TURNS))[ctx.me] ?? NO_TURNS
  const known = new Set([ctx.me, ...ctx.roster.specs.map((s) => s.name)])
  return {
    emptyNote: 'Nothing has happened on this page yet.',
    tiles: [
      tile('agents', 'Agents', plural(known.size, 'agent file'), 'Loaded in this browser.'),
      tile('messages', 'Messages', plural(activity.messages, 'message'), 'Sent from this page.'),
      tile('tokens', 'Tokens', plural(activity.spentTokens, 'token'), `Across ${plural(activity.modelCalls, 'model call')}.`),
      tile('unanswered', 'Unanswered', plural(turns.unanswered, 'turn'), turns.unanswered === 0
        ? 'Every turn that ended here ended with an answer.'
        : `${plural(turns.unanswered, 'turn')} ended without an answer.`),
    ],
  }
}

/** @param {string} id @param {string} label @param {string} value @param {string} note */
function tile(id, label, value, note) {
  return { id, label, value, note }
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
 * first is losing work and the second is a build that was assembled this way —
 * which is why a withheld capability is stated and is still `ok`.
 * @param {Ctx} ctx @returns {Record<string, unknown>}
 */
function health(ctx) {
  const activity = /** @type {Activity} */ (ctx.project(ACTIVITY))
  const withheld = CAPABILITIES.filter((id) => !ctx.available.includes(id))
  const notes = [
    ...(ctx.durable ? [] : [`${IN_MEMORY}, so anything written to it is lost on refresh.`]),
    ...withheld.map((id) => `This build cannot ${CAPABILITY_SENTENCE[id]}.`),
  ]
  const failing = activity.storeFailures > 0
  return {
    status: failing ? 'failed' : 'ok',
    headline: failing
      ? `Storage has failed ${plural(activity.storeFailures, 'time')} — the most recent was ${activity.lastStoreFailure}.`
      : notes[0] ?? 'Everything this build offers is working.',
    // WHEN STORAGE IS FAILING, THE HEADLINE IS THE STORE'S AND NO NOTE WAS
    // PROMOTED — so none may be skipped either, or the sentence that this
    // workspace is in memory disappears in the one case it matters most.
    detail: (failing ? notes : notes.slice(1)).join(' ')
      || 'Read off the log and the capability list this build started with.',
  }
}

/** A count and its noun. Spelling, not opinion — and said here so no pane says it differently. */
export function plural(/** @type {number} */ n, /** @type {string} */ noun) {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`
}

/** Every status one of the groups above claims. Exported for the check that no status falls out of the roster. */
export const GROUPED_STATUSES = GROUPS.flatMap((g) => g.of)
