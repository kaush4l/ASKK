/**
 * Results of the last actions — the most volatile block in the paper, and the
 * last thing before the directive, so a tool result is the freshest thing the
 * model read.
 *
 * THE BLOCK THE DEFECT IS NAMED AFTER. `operating_rules` tells the model never
 * to claim an action succeeded without an observation proving it, and a 4096
 * ceiling elided this block on every work turn — the agent was instructed to
 * read something the budget had removed, and nothing said so. `assemble` now
 * refuses to elide a block another block's prose names; what keeps this one
 * honest at the other end is the sentence below.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * An agent that has done nothing is told so. "Nothing here" and "this block
 * was dropped" are different facts and a model cannot tell them apart from an
 * absence, so the first one is stated.
 */
const NONE = 'No actions taken yet.'

/**
 * @param {string[]} [lines]
 * @returns {Component}
 */
export function observations(lines = []) {
  return {
    id: 'observations',
    slot: SLOT.OBSERVATIONS,
    intent: 'Results of the last actions.',
    stability: 'volatile',
    priority: 7,
    floor: 'elided',
    cacheable: false,
    render: () => text(lines.length === 0 ? NONE : lines.join('\n')),
  }
}
