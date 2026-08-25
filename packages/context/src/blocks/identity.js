/**
 * Name and one-line role.
 *
 * Separate from `soul` so a long character brief can be summarised away under
 * budget pressure while the model still knows what to call itself — the two
 * degrade independently because they answer different questions, and that is
 * the whole reason this is not two fields of one block.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * @param {string} [name]
 * @param {string} [description]
 * @returns {Component}
 */
export function identity(name = '', description = '') {
  return {
    id: 'identity',
    slot: SLOT.IDENTITY,
    intent: 'Name, role, presentation.',
    stability: 'static',
    priority: 1,
    floor: 'pointer',
    render: () => text(line(name.trim(), description.trim())),
  }
}

/**
 * A name with no role behind it still ends cleanly. The string build this
 * replaced left a trailing space here whenever the description was absent,
 * which is exactly the class of thing a component stops.
 * @param {string} name @param {string} role
 */
function line(name, role) {
  if (name === '') return 'Name: HARNESS. Role: resident assistant.'
  return role === '' ? `Name: ${name}.` : `Name: ${name}. ${role}`
}
