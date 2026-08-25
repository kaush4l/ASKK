/**
 * THE BLOCK VOCABULARY: every part of the prompt, as a value that knows where
 * it belongs.
 *
 * They live in `packages/context` and not in the loop because a component is a
 * VALUE — it renders its own body and nothing else, and the loop only fills it
 * in. Putting the wording next to the machine that assembles it is what keeps
 * one fact worded in one place; the Rust had the vocabulary a crate away from
 * the paper, and that is how `## affordances` came to be named by a contract
 * that pointed at a heading the prompt did not emit.
 *
 * ONE FILE PER BLOCK. Each is small, each carries the reason it exists, and a
 * block nobody can write a one-sentence intent for is a block nobody can
 * justify.
 *
 * THE GENERIC BLOCK DID NOT COME ACROSS. The Rust had `Sensed` — a `Block`
 * declaration plus parts a host wrote — because a trait object was the only
 * way to render many differently-shaped blocks through one type. In JavaScript
 * a component is already a plain object with a `render` function, so `memory`,
 * `space` and `user` are ordinary blocks that take their content as an
 * argument, and the generic wrapper has nothing left to do. `artifacts` has no
 * filler in this build at all and is therefore not here.
 * @module
 */

import { sectionOf } from '../component.js'

export { soul, DEFAULT_SOUL } from './soul.js'
export { identity } from './identity.js'
export { operatingRules } from './operating-rules.js'
export { goal } from './goal.js'
export { affordances } from './affordances.js'
export { user } from './user.js'
export { memory } from './memory.js'
export { space } from './space.js'
export { environment } from './environment.js'
export { task } from './task.js'
export { history, SESSION_STARTED } from './history.js'
export { observations } from './observations.js'
export { directive } from './directive.js'
export { prose, toolEnvelope, shaped, saying } from './contract.js'

/** @typedef {import('../component.js').Component} Component */
/** @typedef {import('../state.js').State} State */
/** @typedef {import('@harness/kernel').StageId} StageId */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */

/**
 * A list of blocks as the state one assembly reads.
 *
 * Order here is documentation and not mechanism — `assemble` sorts by slot —
 * so a caller listing them in the wrong order changes nothing about the
 * prompt. Summaries are `null` because nothing has precomputed one yet;
 * whoever holds a curated summary attaches it to the source it belongs to.
 * @param {StageId} stage
 * @param {Component[]} components
 * @param {Timestamp} at
 * @returns {State}
 */
export function paperOf(stage, components, at) {
  return { stage, sources: components.map((c) => ({ section: sectionOf(c, at), summary: null })) }
}
