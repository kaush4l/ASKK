/**
 * What is being attempted.
 *
 * Kept apart from the transcript on purpose: the request the model is serving
 * should not have to be re-derived by reading the conversation back, and it
 * must survive the compaction that eventually eats the turn it arrived in.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/** An agent with nothing to do says so; the alternative is a model inventing one. */
const IDLE = 'Idle; awaiting a task.'

/**
 * @param {string} [what]
 * @returns {Component}
 */
export function task(what = '') {
  return {
    id: 'task',
    slot: SLOT.TASK,
    intent: 'What is being attempted.',
    stability: 'dynamic',
    priority: 2,
    floor: 'summarized',
    cacheable: false,
    render: () => text(what.trim() || IDLE),
  }
}
