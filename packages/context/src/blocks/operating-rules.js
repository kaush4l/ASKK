/**
 * The standing behavioural rules. Fixed: these are the house's, not the agent
 * file's, which is why nothing overwrites them and this factory takes no
 * argument.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

const RULES =
  'Do one thing per turn. Never claim an action succeeded without an observation ' +
  'proving it. Prefer asking over guessing.'

/** @returns {Component} */
export function operatingRules() {
  return {
    id: 'operating_rules',
    slot: SLOT.OPERATING_RULES,
    intent: 'How to behave; the response discipline.',
    stability: 'static',
    priority: 1,
    floor: 'summarized',
    render: () => text(RULES),
  }
}
