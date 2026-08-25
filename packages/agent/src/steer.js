/**
 * THE STEER, AS A FACT (R18-P0-1).
 *
 * A sentence typed into a running turn is steering, not a new turn: the round
 * in flight finishes and the next model call carries the sentence, which is
 * already in the log as the person's message. Starting a second turn on it
 * would ask the model twice at once and then count the first batch's results
 * down through a counter the second turn had reset.
 *
 * It was recorded in `state.steered` and NOWHERE ELSE, so no projection could
 * see it — and the conversation, reading the only shape it had (a message with
 * no answer under it), drew the RELOAD note over a turn that was still running:
 * *"the page was reloaded while it was in flight, so nothing is driving it"*.
 * Two causes, one sentence, and the sentence named the wrong one. The machine
 * knew the difference; a serialized state field is not reachable by a fold of
 * the log (I8), so the steer says so in the log.
 * @module
 */

import { emit } from './effect.js'

/** @typedef {import('./effect.js').Effect} Effect */

/** The one steer fact. It carries nothing: the sentence is the `user_message` immediately before it, already in the log in full. */
export const STEERED = 'core.steered'

/** The record a steer leaves. Not an ending and not work, which is exactly why `stop.boundary` must let it past. @returns {Effect} */
export function carried() {
  return emit({ type: 'custom', kind: STEERED, payload: null })
}
