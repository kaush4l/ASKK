/**
 * Durable facts about the person, in their own words.
 *
 * NO RUST ANCESTOR. `Slot::USER` existed in the Rust build and nothing ever
 * filled it — the person's settled facts lived in the shared space, where they
 * were a property of a GROUP rather than of whoever is typing. This block is
 * the slot finally having a filler, and it is deliberately the thinnest one
 * here: it arranges lines somebody else settled and words nothing itself.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * @param {string[]} [facts] one settled fact per entry
 * @returns {Component}
 */
export function user(facts = []) {
  return {
    id: 'user',
    slot: SLOT.USER,
    intent: 'What is durably true of the person this agent works for.',
    stability: 'semi_static',
    priority: 4,
    floor: 'summarized',
    render: () => text(facts.map((f) => `- ${f}`).join('\n')),
  }
}
