/**
 * The folder a group shares, the facts it has settled, the notes it has left.
 *
 * TWO SENTENCES OF THE RUST'S WORDING DID NOT SURVIVE, and both were wrong
 * rather than merely old.
 *
 * The first said "that Linux runs in memory, so nothing written there survives
 * a reload". The emulator is gone (`docs/RULINGS.md` Attack 6) and OPFS
 * answers `durable()` truthfully, so the sentence is now false for the shipping
 * build — and it is not a constant in either direction: whether a folder
 * survives a reload is a fact only the store knows, so it arrives as `durable`
 * and this block words it. What the model is told here must be what the person
 * is told in the Files pane, which is why the wording lives in one place.
 *
 * The second was the reader clauses, which named `observe` and `find_files`
 * unconditionally. A capability named to a model that was never granted it is
 * the one failure I15 forbids, so the clauses are derived from the tool names
 * this agent actually holds. The table stays here because the clause cannot be
 * spelled out of the name.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/**
 * The shared space as this agent last read it. `null` is an agent that works
 * alone, and it renders nothing at all.
 * @typedef {{
 *   name: string,
 *   path: string,
 *   durable: boolean,
 *   facts?: Array<[string, string]>,
 *   notes?: string[],
 * }} SharedSpace
 */

/** The tools that let an agent LOOK at the folder, each with the clause that says so. */
const READERS = /** @type {const} */ ([
  ['observe', 'observe says what the machine is'],
  ['find_files', 'find_files searches it'],
])

/**
 * @param {SharedSpace|null} [shared] the space as this agent last read it
 * @param {string[]} [toolNames] the tools this agent actually holds, resolved
 * @returns {Component}
 */
export function space(shared = null, toolNames = []) {
  return {
    id: 'space',
    slot: SLOT.SPACE,
    intent: 'The folder this group shares, what it has settled, what it has posted.',
    stability: 'semi_static',
    priority: 6,
    floor: 'elided',
    render: () => text(shared === null ? '' : lines(shared, toolNames)),
  }
}

/**
 * Empty areas render nothing at all: a `shared facts:` heading over no facts
 * spends budget saying that nothing has been settled.
 * @param {SharedSpace} s @param {string[]} toolNames
 */
function lines(s, toolNames) {
  const out = [`space: ${s.name}`, `workspace: ${s.path} (${folder(s.durable, toolNames)})`]
  if (s.facts?.length) out.push('shared facts:', ...s.facts.map(([k, v]) => `  ${k}: ${v}`))
  if (s.notes?.length) out.push('recent notes:', ...s.notes.map((n) => `  ${n}`))
  return out.join('\n')
}

/**
 * The parenthesis after the path: what the folder IS, only the tools this
 * agent holds for it, and whether what is written there is still there after
 * a reload.
 * @param {boolean} durable @param {string[]} toolNames
 */
function folder(durable, toolNames) {
  const held = READERS.filter(([name]) => toolNames.includes(name)).map(([, clause]) => clause)
  const reading = held.length === 0 ? '' : `; ${held.join(' and ')}`
  const survives = durable
    ? 'and what is written there is still there after a reload'
    : 'and nothing written there survives a reload'
  return `a real folder this browser stores for you${reading}, ${survives}`
}
