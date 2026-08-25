/**
 * ONE AGENT'S TRANSCRIPT, AS THE PANE READS IT — the rows, the stage, what the
 * turn is waiting on, and how the last one ended.
 *
 * SEPARATE FROM THE ROUTES because five routes answer with it and each of them
 * has a different reason to. Keeping it beside `POST /chat` made the file the
 * one place a reader had to hold both "what a press does" and "what a pane
 * shows" in mind at once.
 * @module
 */

import { statusSentence } from '@harness/kernel'

import { CONVERSATION } from './reducers.js'
import { NO_TURNS, TURNS } from './turns.js'

/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./reducers.js').Conversation} Conversation */

/**
 * ONE AGENT'S TRANSCRIPT, ITS STAGE, AND WHAT IT IS WAITING ON. Read straight
 * off the registered fold — no walk, no clone, no array crossing the seam.
 * @param {Ctx} ctx @param {string} who @returns {Record<string, unknown>}
 */
export function projected(ctx, who) {
  const held = /** @type {Record<string, Conversation>} */ (ctx.project(CONVERSATION))[who] ?? EMPTY
  const ended = /** @type {Record<string, import('./turns.js').Turns>} */ (ctx.project(TURNS))[who] ?? NO_TURNS
  const wait = waiting(held, ctx.driving(who))
  return {
    agent: who,
    stageLabel: held.stage === '' ? `${who} · ${statusSentence(status(held))}` : `${who} · ${held.stage} stage`,
    messages: held.rows,
    emptyNote: `Nothing has been said to ${who} yet. What you type starts a turn.`,
    waitingLabel: wait.label,
    waitingStatus: wait.status,
    // THE SAME ENDING THE BOARD RENDERS, from the same fold. The header used to
    // read a status word nothing cleared while the board read `task == null`,
    // and the two disagreed in front of the person reading both.
    endingTone: ended.last?.tone ?? '',
    endingLabel: ended.last?.label ?? '',
    armedLabel: '',
    attachedLabel: '',
  }
}

/** @type {Conversation} */
const EMPTY = { rows: [], open: false, tools: 0, status: 'idle', detail: '', stage: '' }

/** The status as the kernel's closed vocabulary, so an older record cannot widen it. */
function status(/** @type {Conversation} */ held) {
  return /** @type {import('@harness/kernel').Status} */ (held.status)
}

/**
 * WHAT THE TURN IS WAITING ON, AND WHY.
 *
 * The third case is the one that matters: the log says a turn is open and
 * NOTHING IN THIS PROCESS IS DRIVING IT. That is a reload landing on a turn
 * that was in flight — the shape of the log survives, the fetch behind it does
 * not — and the pane used to render it as "thinking…" with a frozen clock and a
 * disabled composer, recoverable only by wiping storage.
 * @param {Conversation} held @param {boolean} driven
 * @returns {{label: string, status: string}}
 */
function waiting(held, driven) {
  if (!held.open) return { label: '', status: 'idle' }
  if (driven) return { label: `Working — ${held.detail || 'this turn is running'}`, status: status(held) === 'idle' ? 'thinking' : held.status }
  return {
    label: 'That turn is not running any more — the page was reloaded while it was in flight, so nothing is driving it. Nothing was lost; ask again.',
    status: 'stopped',
  }
}
