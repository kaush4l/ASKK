/**
 * The conversation so far, oldest first.
 *
 * ONE PART PER ENTRY, not one joined blob. That is not an implementation
 * detail: it is what lets `fit.dropOldest` remove whole turns from the oldest
 * end, what lets the budget count turns rather than characters, and what lets
 * a screenshot sit in the middle of a conversation instead of only at its end.
 *
 * The highest priority number in the paper, so the transcript is what the
 * budget eats first. Everything else is either who the agent is or what it is
 * doing now; the middle of a long conversation is the one part that can be
 * compacted without the turn becoming incoherent.
 * @module
 */

import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */
/** @typedef {import('../types.js').Part} Part */

/**
 * WHAT A FRESH WINDOW HOLDS. Not the empty list: a cleared conversation must
 * go back to what a new one starts on rather than to something no new one has
 * ever been, and the window arithmetic that decides when to compact counts
 * entries — starting at zero would move the trigger by one for every agent.
 */
export const SESSION_STARTED = 'session started'

/**
 * @param {string[]} [entries] one line per turn, each already tagged `role: text`
 * @returns {Component}
 */
export function history(entries = [SESSION_STARTED]) {
  return {
    id: 'history',
    slot: SLOT.HISTORY,
    intent: 'Conversation and prior steps, oldest first; the last line is the newest.',
    stability: 'dynamic',
    priority: 9,
    floor: 'pointer',
    cacheable: false,
    render: () => entries.map((text) => ({ type: 'text', text })),
  }
}
