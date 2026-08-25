/**
 * A FACULTY: a named bundle that arrives in ONE PIECE — the tools it offers and
 * the block it writes into the prompt. Naming it in an agent file is the whole
 * grant, and an agent that does not name it has neither half. The absence is
 * structural: no row here means no tools to call and no block to render, rather
 * than a branch somewhere deciding to skip it.
 *
 * **This is a table, not a plugin loader.** [`TABLE`] is a literal list and
 * [`facultyOf`] is a lookup in it. Nothing is fetched and nothing registers
 * itself at runtime; a name with no row does not exist. Anything else would be
 * a module system, and this build already has one.
 *
 * ONE TABLE, and everything else is derived from it — [`FACULTIES`],
 * [`facultyTools`], [`facultyBlocks`]. In Rust the list existed twice, as a
 * `match` and as a `const ALL`, and a faculty added to the first but not the
 * second got zero structural coverage while every gate stayed green.
 * @module
 */

import { artifactsFaculty, ARTIFACTS } from './artifacts.js'
import { memoryFaculty, MEMORY } from './memory.js'
import { spaceFaculty, SPACE } from './space.js'

/** @typedef {import('@harness/context').Stability} Stability */
/** @typedef {import('@harness/kernel').SectionId} SectionId */
/** @typedef {import('../tools.js').Tool} Tool */

/** The block a faculty contributes: where it sits, what it is called, and the one sentence saying why it is in the prompt. Its PARTS are not here — a host writes those into `AgentState.senses` under `id`, and `ask.js` renders whatever it last left. @typedef {{id: SectionId, slot: number, intent: string, stability: Stability}} Block */

/** @typedef {{name: string, block: Block, tools: Tool[]}} Faculty */

export { ARTIFACTS, MEMORY, SPACE }

/** Every faculty this build ships. Registering IS adding a row; there is nowhere left to forget. @type {readonly Faculty[]} */
const TABLE = Object.freeze([spaceFaculty, memoryFaculty, artifactsFaculty])

/** Every faculty this build ships, by name, in table order. @type {readonly string[]} */
export const FACULTIES = Object.freeze(TABLE.map((f) => f.name))

/**
 * The faculty of this name, or `null`.
 *
 * `null` is not an error anywhere: an unknown name offers no tools and
 * contributes no block, and the agent still runs (I15). Refusing here would
 * make a name a LOAD-ORDER rule rather than a capability one — the same reason
 * an unresolved tool name is reported and not refused.
 * @param {string} name @returns {Faculty | null}
 */
export function facultyOf(name) {
  return TABLE.find((f) => f.name === name) ?? null
}

/**
 * Every tool every declared faculty offers, in declaration order.
 *
 * AVAILABLE TO NAME, never granted: this widens what a `tools:` allowlist may
 * pick FROM, and a file with a non-empty list still picks. No faculty, no
 * tools (I6).
 * @param {readonly string[]} declared @returns {Tool[]}
 */
export function facultyTools(declared) {
  return declared.flatMap((name) => facultyOf(name)?.tools ?? [])
}

/**
 * Every block every declared faculty contributes, in declaration order.
 * Deduplicated by NAME upstream (`adopt.js`), because two names for one faculty
 * would be two sections with one id, which `assemble` refuses as a duplicate —
 * the whole paper, not just the block.
 * @param {readonly string[]} declared @returns {Block[]}
 */
export function facultyBlocks(declared) {
  return declared.flatMap((name) => {
    const held = facultyOf(name)
    return held ? [held.block] : []
  })
}
