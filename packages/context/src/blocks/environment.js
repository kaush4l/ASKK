/**
 * Time, locale, device — what is true of this moment and no other.
 *
 * THE ONE BLOCK THAT IS NEVER CACHED. A cached clock is a wrong clock: reusing
 * it would hand the model a confident statement about a moment that has
 * already passed.
 *
 * The shared space is NOT in here; it is its own block five slots up. Fused,
 * as they were, the clock's uncacheability infected the space and the space's
 * bulk rode inside a block the budget is told is small.
 *
 * `clock` and `machine` arrive as two arguments rather than one joined string
 * because they have different lifetimes and different authors — the clock is
 * rebuilt from the injected timestamp every call, the machine is a property of
 * a frozen image. Joining them is this block's own job, which is the only
 * place I13 allows a prompt's bytes to be decided.
 *
 * `machine` is EMPTY for an agent holding no workspace tool, which is how an
 * agent with nothing to run is told nothing about a shell (I15). It never
 * repeats the workspace PATH: `## space` renders that, and one fact in two
 * blocks is two things to keep in agreement.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/** What is said when nothing sensed the environment at all. */
const UNSENSED = 'A browser tab; environment sensing not yet implemented.'

/**
 * @param {string} [clock] the injected moment, already worded
 * @param {string} [machine] what this stage's grant can say about the computer
 * @returns {Component}
 */
export function environment(clock = '', machine = '') {
  return {
    id: 'environment',
    slot: SLOT.ENVIRONMENT,
    intent: 'Time, locale, device, what is available right now.',
    stability: 'dynamic',
    priority: 5,
    floor: 'elided',
    cacheable: false,
    render: () => text([clock.trim() || UNSENSED, machine.trim()].filter(Boolean).join('\n')),
  }
}
