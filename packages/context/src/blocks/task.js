/**
 * What is being attempted.
 *
 * Kept apart from the transcript on purpose: the request the model is serving
 * should not have to be re-derived by reading the conversation back, and it
 * must survive the compaction that eventually eats the turn it arrived in.
 *
 * NOTHING TO ATTEMPT IS NO BLOCK — and this reverses what this file said in
 * its first increment. It carried an `Idle; awaiting a task.` sentence, on the
 * argument that an agent with nothing to do should say so rather than let a
 * model invent one. The argument is wrong for a reason the assembly makes
 * plain: a paper is only ever assembled in order to make a call, so the one
 * moment this sentence could render is a moment when the agent is demonstrably
 * NOT idle — the person's message is sitting in `## history` two blocks below
 * it. A stated truth must be checkable against the fact underneath it (I16),
 * and this one contradicted it. The other wording of this block, in the loop's
 * own file, rendered nothing here; that is the one that was right.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

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
    render: () => text(what.trim()),
  }
}
