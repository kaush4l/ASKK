/**
 * THE SUB-AGENT'S HALF: the goal becomes an ordinary turn, and the turn's own
 * ending becomes the answer.
 *
 * Nothing here is special-cased for being an errand. The `begin` message is
 * turned into the same `user_message` fact a person's message makes, and the
 * same `step` runs the same stages against the same reducer — which is the
 * whole point of one Worker per agent: a sub-agent is not a lesser mode of the
 * loop, it is the loop, somewhere else.
 *
 * THE ENDING IS READ OFF THE `ENDED` FACT AND NOT INFERRED. The predecessor's
 * caller wrote an `agent_status: idle` record after its own await returned and
 * every surface read THAT as the outcome, so a callee that answered, one that
 * exhausted its rounds and one that was refused by its provider were the same
 * event upstream. Here the reducer that ended the turn is the thing that says
 * why, and `ok` is that reason being `answered` and nothing else — a turn that
 * ran out of rounds reports a failure carrying whatever it had managed to say.
 * @module
 */

import { ANSWERED, ENDED, endedWhy } from '../ending.js'
import { endedMessage } from './protocol.js'

/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('@harness/kernel').TurnId} TurnId */
/** @typedef {import('../effect.js').Effect} Effect */
/** @typedef {import('../turn.js').Incoming} Incoming */
/** @typedef {import('./protocol.js').Begin} Begin */
/** @typedef {import('./protocol.js').Ended} Ended */

/** The errand this Worker is running: which one it is, and the last thing its model actually said. @typedef {{errandId: string, said: string}} Errand */

/**
 * THE GOAL, AS THE FACT THAT STARTS A TURN. `turnId` is injected like every
 * other id (I7) — the Worker's own driver mints it, because the turn belongs to
 * this agent and not to the one that asked.
 * @param {Begin} begin @param {TurnId} turnId @param {Timestamp} at
 * @returns {{errand: Errand, incoming: Incoming}}
 */
export function errandBegun(begin, turnId, at) {
  return {
    errand: { errandId: begin.errandId, said: '' },
    incoming: { at, turnId, fact: { type: 'user_message', text: begin.goal, agent: '', from: 'person' } },
  }
}

/**
 * ONE FACT THIS TURN HANDLED, AND WHAT — IF ANYTHING — GOES HOME.
 *
 * The answer is the last thing the model SAID, kept as it arrives rather than
 * dug out of the log afterwards: an ending fact carries the reason a turn
 * stopped and never the words, and a Worker reading its own log back to find
 * them would be a second authority on its own transcript.
 *
 * An empty reply never overwrites a full one. A turn can end on a zero-output
 * completion after a real answer (`retry.js`), and reporting the silence would
 * throw away the sentence the caller is waiting for.
 * @param {Errand} errand @param {Incoming} incoming @param {readonly Effect[]} effects
 * @returns {{errand: Errand, ended: Ended | null}}
 */
export function errandHeard(errand, incoming, effects) {
  const fact = incoming.fact
  const spoke = fact.type === 'model_replied' && fact.text.trim() !== ''
  const said = spoke ? fact.text : errand.said
  const ending = effects.find(isEnding)
  if (!ending || ending.type !== 'Emit' || ending.fact.type !== 'custom') return { errand: { ...errand, said }, ended: null }
  const why = endedWhy(ending.fact.payload)
  return {
    errand: { ...errand, said },
    ended: endedMessage(errand.errandId, { ok: why === ANSWERED, text: said, why }),
  }
}

/** @param {Effect} effect @returns {boolean} */
function isEnding(effect) {
  return effect.type === 'Emit' && effect.fact.type === 'custom' && effect.fact.kind === ENDED
}
