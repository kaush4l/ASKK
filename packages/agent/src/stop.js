/**
 * THE STOP (R16-P0-2). Every other button on the page that says "Stop" means
 * "stop looking". This one means "stop working", and it has the same shape as a
 * steer: a fact the person made, recorded by the reducer, acted on at the next
 * step boundary.
 *
 * It is an ABORT AT THE NEXT BOUNDARY and not a kill — nothing here can reach
 * into a command already running or a sub-agent already in flight, because
 * `step` describes work and never holds it. What it can do, exactly and
 * deterministically, is refuse to describe any more. (The abort of the calls
 * ALREADY outstanding is the driver's, through the `AbortSignal` every port
 * takes; that lands with the deadline increment.)
 *
 * ONE FUNNEL, NOT FIVE GUARDS. Every arm that starts work does it by RETURNING
 * an effect, so one check on the way out covers the model call at the top of a
 * turn, the batch a reply asked for, and the next round after the last result.
 * Guarding them one at a time is four chances to miss the fifth.
 * @module
 */

import { emit } from './effect.js'
import { isEnding } from './ending.js'
import { isSteer } from './steer.js'
import { idle } from './turn.js'

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */

/** The person pressed Stop. Carries nothing: only this process's own agent runs in this loop. */
export const STOP_REQUESTED = 'core.stop_requested'

/** The fact the boundary records, with the rounds the stopped turn had behind it. */
export const STOPPED = 'core.stopped'

/** Whether a fact is the press. @param {Fact} fact */
export function isStopRequest(fact) {
  return fact.type === 'custom' && fact.kind === STOP_REQUESTED
}

/**
 * THE BOUNDARY. An empty effect list is not one — results are still landing,
 * and the last of them will produce the effect this catches.
 *
 * AN ENDING IS NOT NEW WORK, and neither is a steer or a dropped-fact record:
 * an unfiltered check would read a turn that answered on its own as one you cut
 * off, and would report a completed run as stopped. The exemption is by fact
 * kind and not by position, so it holds however many arms end a turn.
 * @param {AgentState} state @param {Effect[]} effects @returns {{state: AgentState, effects: Effect[]}}
 */
export function boundary(state, effects) {
  const startsWork = effects.some((effect) => !isRecord(effect))
  if (!state.stopping || !startsWork) return { state, effects }
  return halted(state)
}

/** A record says what happened; work asks for something to happen. @param {Effect} effect */
function isRecord(effect) {
  return isEnding(effect) || isSteer(effect)
}

/**
 * The turn ends here, and says the number of rounds it got through — the one
 * thing a person wants to know about work they interrupted.
 * @param {AgentState} state @returns {{state: AgentState, effects: Effect[]}}
 */
function halted(state) {
  const effect = emit({
    type: 'custom',
    kind: STOPPED,
    payload: { rounds: state.toolRounds, turnId: state.turnId },
  })
  return { state: idle(state), effects: [effect] }
}
