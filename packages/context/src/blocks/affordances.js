/**
 * The toolbox, as the model is told about it.
 *
 * This block carries pre-rendered usage lines rather than tool values: tools
 * hold behaviour, a component is a value, and the only thing the prompt ever
 * needed from a tool was the one line describing what it is for.
 *
 * WHAT THIS BLOCK DOES NOT CARRY — AND WHAT STILL DOES, TODAY.
 * The Rust block ended with a paragraph teaching a hand-rolled call protocol —
 * write the calls as text, comma-separated for parallel, one per line for
 * sequential, results come back labelled. That protocol had a matching
 * hand-rolled scraper on the way back, and it corrupted a file in production
 * (`docs/RULINGS.md` §1 row 3). This block omits it, because tool calls are
 * meant to be the provider's own — schemas beside the paper rather than prose
 * inside it — and a paragraph telling the model to write calls into its answer
 * teaches it to defeat the mechanism that replaced it.
 *
 * THE PROTOCOL IS NOW RETIRED FROM THE BUILD, and it took a second lane to do
 * it. A duplicate wording of this block lived in `packages/agent/src/paper.js`
 * with a `HOW_TO_CALL` paragraph teaching the text protocol verbatim, and the
 * loop imported that file rather than this one — so the comment above was true
 * about this block and false about the prompt. The loop now imports this
 * vocabulary and that file is gone; `grep -rn 'separated by commas' packages`
 * returns nothing, and the golden matrix pins the bytes that are actually sent.
 *
 * The listing itself stays. A schema list on the wire says what a tool ACCEPTS;
 * this says what the agent HAS, in the order its toolbox resolved them, which
 * is the thing the model plans from.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * The stated absence (I15). An agent with no tools is told so, because
 * silence reads as "tools exist and were not listed" and a model plans from it.
 */
const NONE = 'No tools are installed; answer from what you know.'

/**
 * Slotted ahead of the transcript and declared `semi_static` for one reason:
 * an agent's toolbox changes far less often than its conversation, so it
 * belongs inside the cacheable head rather than behind the part of the prompt
 * that changes every single turn.
 * @param {string[]} [usages] one `name(args): description` line per tool, in toolbox order
 * @returns {Component}
 */
export function affordances(usages = []) {
  return {
    id: 'affordances',
    slot: SLOT.AFFORDANCES,
    intent: 'What exists and how to call it.',
    stability: 'semi_static',
    priority: 3,
    floor: 'pointer',
    render: () => text(usages.length === 0 ? NONE : `AVAILABLE TOOLS\n\n${usages.join('\n')}`),
  }
}
