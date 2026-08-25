/**
 * THE SUMMARISER'S OWN PAPER — the sheet that replaced its `agent.md`.
 *
 * It used to be a whole agent file in `public/agents/`, found by the `role:`
 * it declared and loaded into the state of every other agent as three fields.
 * What that file actually contributed was a system prompt, because a
 * summariser has no tools, no space, no history and no conversation: the
 * transcript is its whole task and its notes are its whole reply. So the
 * prompt is `SUMMARIZE`, the sheet below is the rest of it, and there is
 * nothing left to be missing — a summariser file that failed to load used to
 * mean compaction never ran and nothing said so.
 *
 * It is a Document like every other model call in this codebase (I13), and it
 * is assembled against the SAME budget arithmetic as any other paper. What
 * makes it safe is the one block below.
 * @module
 */

import { text } from './component.js'
import { SLOT } from './slot.js'
import { paperOf, soul, identity, saying } from './blocks/index.js'

/** @typedef {import('./component.js').Component} Component */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */

/**
 * WHO the summarising model is. Short on purpose: everything about HOW to
 * summarise arrives as the transcript's own instructions, and a soul repeating
 * them would be the same instruction twice at two levels of the prompt.
 */
export const SUMMARIZE =
  'You compress conversations. You are handed a transcript and you return notes that ' +
  'replace it. You add nothing that is not in it, and you leave out nothing that the ' +
  'conversation still depends on.'

/** What the summariser is asked of one chunk. */
export const COMPACT_PROMPT =
  'Summarise the conversation transcript below. Your summary replaces it entirely, so the ' +
  'assistant will have nothing else to work from.\n\n' +
  'If the transcript opens with an earlier summary, fold it into yours — what it records ' +
  'still counts, and yours is the only copy that survives.\n\n' +
  'Keep: what the user asked for, decisions made, facts established, tool results that ' +
  'still matter, and anything left unfinished. Drop: greetings, failed attempts that were ' +
  'retried, tool results that were later superseded, and commentary.\n\n' +
  'Write it as plain notes in the third person. No preamble, no sign-off.\n\n' +
  'TRANSCRIPT:\n\n'

/** What the reduce step is asked of the map step's answers. */
export const FOLD_PROMPT =
  'These are notes on consecutive stretches of one conversation, oldest first. Fold them ' +
  'into a single set of notes that replaces all of them, in the same third-person style. ' +
  'Keep every decision, fact and unfinished thread; drop what a later stretch superseded.\n\n' +
  'NOTES:\n\n'

/**
 * THE BLOCK THE WHOLE RULING IS ABOUT. It sits at the task slot because the
 * transcript IS this call's task, and its floor is `full` so no ladder step
 * can reach it. Its priority is irrelevant for that reason and is left at the
 * default rather than given a number that reads as if it did something.
 * @param {string} body
 * @returns {Component}
 */
function transcript(body) {
  return {
    id: 'transcript',
    slot: SLOT.TASK,
    intent: 'The conversation being compressed, and the instructions for compressing it.',
    stability: 'volatile',
    floor: 'full',
    cacheable: false,
    render: () => text(body),
  }
}

/**
 * Stateless and toolless: it reads the transcript and nothing else, so the
 * calling agent's tools and prompt cannot steer it. No history block, because
 * a second copy of the conversation there would be the thing it is being asked
 * to compress, twice. No environment block either: the clock is not part of a
 * text transformation, and a sheet that carries one cannot be golden-tested.
 * @param {string} body the prompt and the stretch it is about
 * @param {Timestamp} at
 * @returns {State}
 */
function sheet(body, at) {
  return paperOf(
    'work',
    [
      soul(SUMMARIZE),
      identity('summarizer'),
      transcript(body),
      saying('Reply with the notes and nothing else.'),
    ],
    at,
  )
}

/**
 * The MAP step: one sheet per chunk. Each is a whole model call.
 * @param {string[]} chunk @param {Timestamp} at
 */
export function mapSheet(chunk, at) {
  return sheet(`${COMPACT_PROMPT}${chunk.join('\n\n')}`, at)
}

/**
 * The REDUCE step: one sheet over the map step's answers. A single chunk needs
 * no fold, and asking a model to fold one set of notes into itself is a call
 * that can only lose something.
 * @param {string[]} summaries @param {Timestamp} at
 */
export function foldSheet(summaries, at) {
  return sheet(`${FOLD_PROMPT}${summaries.join('\n\n')}`, at)
}
