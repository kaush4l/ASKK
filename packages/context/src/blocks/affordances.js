/**
 * The toolbox, as the model is told about it.
 *
 * This block carries pre-rendered usage lines rather than tool values: tools
 * hold behaviour, a component is a value, and the only thing the prompt ever
 * needed from a tool was the one line describing what it is for.
 *
 * WHAT DID NOT COME ACROSS, AND IT IS THE BIGGEST DELETION IN THIS FOLDER.
 * The Rust block ended with a paragraph teaching a hand-rolled call protocol —
 * write the calls as text, comma-separated for parallel, one per line for
 * sequential, results come back labelled. That protocol had a matching
 * hand-rolled scraper on the way back, and it corrupted a file in production
 * (`docs/RULINGS.md` §1 row 3). Tool calls are now the provider's own, carried
 * as schemas beside the paper rather than as prose inside it, so a paragraph
 * telling the model to write calls into its answer would teach it to defeat
 * the mechanism that replaced it.
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
