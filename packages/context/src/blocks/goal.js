/**
 * THE STANDING GOAL, AS THE MODEL READS IT.
 *
 * `outcome` and `doneWhen` are the agent's own declaration of what it is for
 * and what ends the work. If they only lived in the loop they would be the
 * failure this codebase names most often — a setting that looks applied: the
 * loop gated on a goal the model was never told, working toward whatever it
 * inferred from the last message instead.
 *
 * THE CHECK COMMAND IS NOT RENDERED HERE, AND THAT IS DELIBERATE. A goal's
 * command is the machine's instrument, not the model's instruction, and the
 * model meets it the honest way — by being shown its result in
 * `observations`. Printing the command here hands a model that has been
 * acting for sixty rounds a target, and satisfying the command is not the same
 * act as satisfying the outcome.
 *
 * IT IS NOT THE `task`, EITHER. The task is what the person typed this turn;
 * this is what the agent's FILE says it is for and outlives every turn. Two
 * lifetimes, two owners, two blocks — which is why it sits up in the stable
 * cacheable head beside the soul it was declared next to.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * Both empty is an agent that declared no goal, and it renders nothing rather
 * than an empty heading — a floor of `elided` is what spells that.
 * @param {string} [outcome]
 * @param {string} [doneWhen]
 * @returns {Component}
 */
export function goal(outcome = '', doneWhen = '') {
  return {
    id: 'goal',
    slot: SLOT.GOAL,
    intent: 'What this agent is for, and what ends the work.',
    stability: 'static',
    priority: 1,
    floor: 'elided',
    render: () => text(lines(outcome.trim(), doneWhen.trim())),
  }
}

/** @param {string} outcome @param {string} doneWhen */
function lines(outcome, doneWhen) {
  const said = []
  if (outcome) said.push(`OUTCOME — ${outcome}`)
  if (doneWhen) said.push(`DONE WHEN — ${doneWhen}`)
  return said.join('\n')
}
