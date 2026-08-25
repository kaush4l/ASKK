/**
 * The paper's laws, as a judge `assemble` runs on its own output.
 *
 * NOT EXPORTED FROM THE PACKAGE, and that is the whole point of this file's
 * shape. In the Rust build `validate` was public and `grep -rn 'context::
 * validate' crates` returned only tests — a law with no runtime call site is a
 * claim about the test suite, not about the product. Here the only way to
 * obtain a `Document` is `assemble`, and the only thing that calls this is
 * `assemble`, so an invalid document is unconstructible rather than merely
 * discouraged.
 *
 * Every rule throws a NAMED kind, so a failure says which law broke instead of
 * "invalid document".
 * @module
 */

import { HarnessError } from '@harness/kernel'
import { FIDELITIES, STABILITIES } from './types.js'
import { isHead, isTail, isSystemSlot } from './slot.js'

/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./types.js').Section} Section */

/** @param {string} kind @param {string} message @param {string} [detail] */
function reject(kind, message, detail = '') {
  throw new HarnessError(kind, message, { detail })
}

/**
 * @param {Document} doc
 * @throws {HarnessError} one kind per law
 */
export function validate(doc) {
  // The structural ends first: with two response contracts, "the paper carries
  // 2 response contracts" is the sentence that names the mistake, and the
  // per-section rule would report the earlier one as merely misplaced.
  ends(doc)
  /** @type {Set<string>} */
  const seen = new Set()
  doc.sections.forEach((s, i) => {
    shape(s)
    if (seen.has(s.id)) reject('duplicate_section', `two sections both call themselves "${s.id}"`)
    seen.add(s.id)
    order(doc, i, s)
  })
  named(doc)
}

/** What must be true of one section on its own. @param {Section} s */
function shape(s) {
  if (s.intent.trim() === '') {
    reject('empty_intent', `section "${s.id}" states no intent`, 'a block nobody can write one sentence for is a block nobody can justify')
  }
  if (s.parts.length === 0 && s.fidelity !== 'elided') {
    reject('empty_section', `section "${s.id}" is empty at fidelity "${s.fidelity}"`, 'elided is the level at which empty IS the content')
  }
  if (FIDELITIES.indexOf(s.fidelity) > FIDELITIES.indexOf(s.floor)) {
    reject('below_floor', `section "${s.id}" was degraded to "${s.fidelity}", past its floor of "${s.floor}"`)
  }
  if (s.trust === 'untrusted' && isSystemSlot(s.slot)) {
    reject('untrusted_in_system', `section "${s.id}" carries untrusted content at slot ${s.slot}`, 'content from outside this agent never becomes part of its own instructions')
  }
}

/** What must be true of a section given where it landed. @param {Document} doc @param {number} i @param {Section} s */
function order(doc, i, s) {
  if (isTail(s.slot) && i + 1 !== doc.sections.length) {
    reject('tail_not_last', `section "${s.id}" claims the pinned tail but ${doc.sections.length - i - 1} section(s) follow it`)
  }
  const previous = doc.sections[i - 1]
  if (previous === undefined || isTail(s.slot) || isTail(previous.slot)) return
  if (STABILITIES.indexOf(previous.stability) > STABILITIES.indexOf(s.stability)) {
    reject('interleaved_stability', `"${s.id}" (${s.stability}) follows "${previous.id}" (${previous.stability})`, 'one misplaced dynamic section invalidates the provider prefix cache for everything after it')
  }
}

/** The two structural laws the slot order exists to guarantee. @param {Document} doc */
function ends(doc) {
  const tails = doc.sections.filter((s) => isTail(s.slot)).length
  if (tails !== 1) {
    reject('tail_count', `the paper carries ${tails} response contracts`, 'none leaves the model with no reply shape; two leave it with a contradiction')
  }
  if (!doc.sections.some((s) => isHead(s.slot))) {
    reject('no_head', 'the paper has no soul and no identity', 'an agent must be someone before it is told anything')
  }
}

/**
 * THE DEFECT THIS RULE IS NAMED AFTER. A work turn assembled 4174 tokens
 * against a 4096 ceiling, `## observations` fell off the bottom, and the
 * agent's own operating rules — still in the prompt — told the model to read
 * it. The model was instructed to consult a block that was not there, every
 * single turn, and 586 green tests said nothing.
 *
 * `assemble` makes this hold by raising a referenced section's floor to
 * `pointer` before the budget runs; this is the check that the raising worked.
 * @param {Document} doc
 */
function named(doc) {
  const present = doc.sections.filter((s) => s.fidelity !== 'elided')
  for (const gone of doc.sections.filter((s) => s.fidelity === 'elided')) {
    const by = present.find((s) => mentions(s, gone.id))
    if (by) {
      reject('elided_but_named', `"${gone.id}" was elided, and "${by.id}" tells the model to read it`)
    }
  }
}

/**
 * Whether one section names another as a block of the paper. Two spellings and
 * no more: the heading the frame writes, and the backticked id prose uses when
 * it refers to one. A bare word would match "history" in any sentence about
 * the past and make every section unelidable.
 * @param {Section} s @param {string} id
 */
export function mentions(s, id) {
  return mentionsIn(s.intent, s.parts, id)
}

/**
 * The same question asked of parts a section MIGHT render — its summary as
 * well as its body. One definition, because a summary that names a block is
 * as much an instruction to read it as the body would be, and two spellings
 * of "names" is how `assemble` came to protect one and then judge the other.
 * @param {string} intent @param {import('./types.js').Part[]} parts @param {string} id
 */
export function mentionsIn(intent, parts, id) {
  const body = [intent, ...parts.map((p) => (p.type === 'text' ? p.text : ''))].join('\n')
  return body.includes(`## ${id}`) || body.includes(`\`${id}\``)
}
