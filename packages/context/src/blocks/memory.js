/**
 * The lines this one agent chose to keep, across every conversation it has had.
 *
 * There is no header, no count and no apology around them. The block already
 * carries its own `## memory` heading and its intent sentence from the wire,
 * and every word spent restating that is a word of budget not spent on what
 * was actually kept.
 *
 * EMPTY when nothing is kept, and that is the whole rule: an empty body elides
 * the block, so an agent that has kept nothing gets no heading rather than a
 * paragraph saying it remembers nothing. Every capability may be absent (I15),
 * and this is how the paper spells it.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * @param {string[]} [notes]
 * @returns {Component}
 */
export function memory(notes = []) {
  return {
    id: 'memory',
    slot: SLOT.MEMORY,
    intent: 'What you chose to keep, across every conversation you have had.',
    stability: 'semi_static',
    priority: 6,
    floor: 'elided',
    render: () => text(notes.map((note) => `- ${note}`).join('\n')),
  }
}
