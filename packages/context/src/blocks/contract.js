/**
 * The shape of the expected reply — the pinned last word of every prompt.
 *
 * Last on purpose. Everything above is what the model knows; this is what it
 * must now produce, and it is the instruction most worth holding at the moment
 * generation begins. Its content is static, but prefix caching only ever
 * caches a PREFIX: once the transcript above it has changed, nothing after
 * that was going to be cached wherever it sat, so the position costs no cache
 * that was reachable.
 *
 * NEVER DEGRADES. A model that has lost the shape of its own reply does not
 * produce a shorter answer, it produces an unusable one, so there is no
 * version of this block worth having less of — `floor: 'full'`.
 *
 * THE JSON NOTATION DID NOT COME ACROSS. The Rust could write a shaped
 * contract as named lines or as a JSON example, chosen by a `Form` on the
 * paper; `grep` finds no site in that tree that ever set the JSON one. A
 * notation with no caller is a second wording of every contract to keep in
 * agreement for nothing, so `shaped` writes lines — which is also the notation
 * that survives a 12B local model, where a stray fence or a trailing comma
 * turns a parse into a silent fallback and a missing `ROUTE:` line does not.
 * @module
 */

import { text } from '../component.js'
import { SLOT } from '../slot.js'

/** @typedef {import('../component.js').Component} Component */

/** One field a parsed reply must carry: the word that opens its line, and what belongs after it. */
/** @typedef {{name: string, about: string}} Field */

/** The reply shape a stage demands, when prose will not do. */
/** @typedef {{about: string, fields: Field[]}} ResponseObject */

/**
 * @param {string} instructions
 * @returns {Component}
 */
function contract(instructions) {
  return {
    id: 'response_contract',
    slot: SLOT.RESPONSE,
    intent: 'The exact shape of the expected reply.',
    stability: 'static',
    priority: 0,
    floor: 'full',
    render: () => text(instructions.trim()),
  }
}

/** Answer the person, in words. The cheap exit, and the common case. */
export function prose() {
  return contract("Reply in plain prose to the user's message. Be concise.")
}

/**
 * Answer, or call tools. Written as an ordered choice rather than a
 * description of two options, because a model given a menu picks and a model
 * given a rule follows it.
 *
 * IT NO LONGER TEACHES A SYNTAX. The Rust wording told the model to write
 * calls as text "exactly as the `## affordances` block shows them" and to read
 * results back off lines beginning `Result:`. Both halves of that protocol are
 * retired: calls go out as the provider's own tool schemas and results come
 * back correlated by id, so prose describing a text protocol would teach the
 * model to bypass the one that works.
 */
export function toolEnvelope() {
  return contract(
    'Either answer the user in plain prose, or call one or more of the tools you have ' +
      'been given. Do not do both in one reply, and do not describe a call instead of ' +
      'making one. Results come back before your next turn; read them, then answer.',
  )
}

/**
 * A reply the machine will parse, stated as the fields it must carry.
 *
 * "These lines and nothing else" rather than "include these lines", because a
 * model told to include something includes it inside a paragraph.
 * @param {ResponseObject} object
 */
export function shaped(object) {
  const body = object.fields.map((f) => `${f.name}: ${f.about}`).join('\n')
  return contract(
    `${object.about}\n\nReply with exactly these lines, each starting with its word, and ` +
      `write nothing else — no preamble, no explanation after them:\n\n${body}`,
  )
}

/**
 * Whatever a caller needs to say instead. The compaction sheet uses it: its
 * output is notes rather than a reply to anyone.
 * @param {string} instructions
 */
export function saying(instructions) {
  return contract(instructions)
}
