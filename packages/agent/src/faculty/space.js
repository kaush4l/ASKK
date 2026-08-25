/**
 * THE SPACE FACULTY — the folder a group shares, what it has settled, and what
 * it has posted. It is the proof the seam is a GENERALISATION rather than a new
 * thing beside the old one: `space:` in an agent file used to attach these
 * three tools and this one block directly, and now it declares a faculty that
 * does it, so a second faculty is a row in a table rather than a mechanism.
 *
 * The workspace tools the Rust attached alongside are NOT here. They are B30's
 * eleven descriptors and this build has none of them; attaching a name to a
 * tool that does not exist would put `write_file` in a prompt and a refusal at
 * the end of the round.
 * @module
 */

import { SLOT } from '@harness/context'
import { arg, tool } from '../tools.js'

/** The faculty's name, its block's id, and the key a host writes its rendered parts under. */
export const SPACE = 'space'

/** @type {import('./index.js').Faculty} */
export const spaceFaculty = {
  name: SPACE,
  // `semi_static`, and slotted ahead of the clock: a group's facts change on
  // the scale of a session, not of a turn.
  block: {
    id: SPACE,
    slot: SLOT.SPACE,
    intent: 'The folder this group shares, what it has settled, what it has posted.',
    stability: 'semi_static',
  },
  tools: [
    tool({
      name: 'remember',
      description: 'Record a fact in the shared space, for every agent working here to see.',
      args: [arg('key', 'string', 'what the fact is about'), arg('value', 'string', 'the fact itself, in one line')],
      mutates: true,
      needs: 'space',
    }),
    tool({
      name: 'forget',
      description: 'Remove a fact from the shared space once it is no longer true.',
      args: [arg('key', 'string', 'the key of the fact to remove')],
      mutates: true,
      needs: 'space',
    }),
    tool({
      name: 'post_note',
      description: 'Leave a note for the other agents working in this space.',
      args: [arg('note', 'string', 'the note, in one line')],
      mutates: true,
      needs: 'space',
    }),
  ],
}
