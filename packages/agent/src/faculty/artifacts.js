/**
 * THE ARTIFACT SHELF — what this group has PRODUCED, as opposed to what it has
 * said. It is not part of `space` for three reasons, and the third is why it
 * gets its own block rather than three more lines in the space's: a note falls
 * off the board at a limit and a deliverable may not; the shelf is declarable
 * on its own, so a read-only agent with a folder and no shelf is representable
 * (I6, default deny); and `## space` answers where the group works while this
 * answers what came out of the work and who it is for.
 *
 * Two calls and no more. `write_file` already writes the file and `list_files`
 * already lists the folder — what the group had no way to say was WHICH of
 * those files is a deliverable and what it is for. A lister or a deleter here
 * would be a second answer to a question the workspace tools have answered.
 * @module
 */

import { arg, tool } from '../tools.js'

/** The faculty's name, its block's id, and the key a host writes its rendered parts under. */
export const ARTIFACTS = 'artifacts'

/**
 * Slot 57, between the space it belongs to (55) and the clock (60). The gaps of
 * ten in `SLOT` exist for exactly this, so nothing is renumbered.
 */
const ARTIFACTS_SLOT = 57

/** @type {import('./index.js').Faculty} */
export const artifactsFaculty = {
  name: ARTIFACTS,
  block: {
    id: ARTIFACTS,
    slot: ARTIFACTS_SLOT,
    intent: 'What this group has produced that outlives a turn, and who each piece is for.',
    stability: 'semi_static',
  },
  // `record_artifact` does not promise the file was CHECKED — nothing here can
  // check it — so it claims only what it does: the record reaches everyone.
  tools: [
    tool({
      name: 'record_artifact',
      description: 'Put a file you have written on this space\'s shelf, so every agent working '
        + 'here sees it named and described in their prompt without reading it. Recording the '
        + 'same name again replaces the entry.',
      args: [
        arg('name', 'string', 'the file\'s path in the workspace folder'),
        arg('description', 'string', 'one line saying what it is'),
        arg('audience', 'string', 'who it is for', { required: false }),
      ],
      mutates: true,
      needs: 'space',
    }),
    tool({
      name: 'read_artifact',
      description: 'Read an artifact on this space\'s shelf by its name. For a big one, add '
        + '\'offset\' and \'limit\' — whole numbers of BYTES — to read one window of it; the '
        + 'answer states the whole file\'s size, so you can ask for the rest.',
      args: [
        arg('name', 'string', 'the artifact\'s name, as it appears on the shelf'),
        arg('offset', 'number', 'the byte to start at', { required: false }),
        arg('limit', 'number', 'how many bytes to read', { required: false }),
      ],
      needs: 'space',
    }),
  ],
}
