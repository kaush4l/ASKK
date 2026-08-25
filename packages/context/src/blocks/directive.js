/**
 * What this turn, specifically, is being asked to do.
 *
 * Stage briefs used to be pushed into the transcript as `user:` turns wrapped
 * in square brackets. Three things were wrong with that, and the brackets are
 * the tell — they marked text as not-really-a-turn inside a structure that had
 * no way to say so:
 *
 * 1. The person never said it. A prompt whose transcript contains turns nobody
 *    took is a prompt that lies about its own history.
 * 2. It stayed. A brief written on the plan stage was still in the window ten
 *    turns later, competing with the instruction for the stage being run.
 * 3. It was compacted away, because it looked like conversation and
 *    conversation is what compaction eats — so the goal had to be copied into
 *    the shared space to survive its own prompt.
 *
 * As a block it is rebuilt each turn from the stage the agent is on, so it is
 * always the current instruction, and compaction cannot reach it because it is
 * not part of the conversation.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * Empty on stages that have none — `work` has nothing to add, because the
 * person's own request is the instruction and a second one would compete with
 * it. Never degraded when present: an instruction summarised to its gist is an
 * instruction the model will follow approximately.
 * @param {string} [brief]
 * @returns {Component}
 */
export function directive(brief = '') {
  return {
    id: 'directive',
    slot: SLOT.DIRECTIVE,
    intent: 'What to do on this turn, before replying.',
    stability: 'volatile',
    priority: 1,
    floor: 'elided',
    cacheable: false,
    render: () => text(brief.trim()),
  }
}
