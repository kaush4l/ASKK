/**
 * MEMORY: one agent's OWN durable lines — what it chose to keep, read back to
 * it before every model call, surviving this conversation being compacted and
 * surviving a reload.
 *
 * It is not a private corner of the shared space, and the three differences are
 * the whole reason it is a faculty of its own rather than two more tools on
 * `space`. It needs no space, so an agent that names no folder can still keep
 * something. It is PRIVATE to one agent, where a space's board is read inside
 * the prompt of everyone who names it. And it brings no workspace with it — two
 * tools and one block, and nothing arrives alongside (I6, default deny).
 *
 * What is here is the GRANT: the tools and the block. `keep`/`discard`'s
 * decisions — the collapse to one line, the two spoken refusals, the trim to a
 * limit — are B28 and are not written yet; nothing in this build calls them,
 * and a half-ported decision table would be a rule nobody enforces.
 * @module
 */

import { SLOT } from '@harness/context'
import { arg, tool } from '../tools.js'

/** The faculty's name, its block's id, and the key a host writes its rendered parts under in `AgentState.senses`. One string, three jobs, so they cannot drift apart. */
export const MEMORY = 'memory'

/** @type {import('./index.js').Faculty} */
export const memoryFaculty = {
  name: MEMORY,
  // `semi_static`, and above the clock for that reason: a line an agent chose
  // to keep changes on the scale of a decision, not of a turn, so it belongs
  // inside the cacheable head.
  block: {
    id: MEMORY,
    slot: SLOT.MEMORY,
    intent: 'What you chose to keep, across every conversation you have had.',
    stability: 'semi_static',
  },
  // Written for a 12B model: what the capability IS, what it is FOR, and no
  // claim beyond what the store actually delivers.
  tools: [
    tool({
      name: 'keep',
      description: 'Keep one line in your own memory. It is yours alone, it survives this '
        + 'conversation being shortened and it survives a reload, and it is read back to you '
        + 'before every reply. Use it for something about this person or this work you would '
        + 'otherwise have to be told again.',
      args: [arg('note', 'string', 'the one line to keep, in your own words')],
      mutates: true,
      needs: 'kv',
    }),
    tool({
      name: 'discard',
      description: 'Remove one line from your own memory, word for word as it appears in your '
        + '## memory block. Use it when what you kept stopped being true.',
      args: [arg('note', 'string', 'the line to remove, exactly as it appears')],
      mutates: true,
      needs: 'kv',
    }),
  ],
}
