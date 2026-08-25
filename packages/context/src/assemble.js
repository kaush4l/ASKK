/**
 * The paper, assembled: sections in slot order, the pinned ends enforced, the
 * budget applied, and a receipt for everything it took (I13, I14).
 *
 * DETERMINISTIC. The same state and the same budget produce a byte-identical
 * document — no clock, no randomness, no model call, and the untrusted
 * envelope's nonce is derived from the section ids for exactly that reason. A
 * golden test asserts it rather than the doc comment claiming it.
 *
 * There is no second constructor. `validate` is not exported from this
 * package and runs here, on the way out, so an invalid document cannot be
 * obtained at all.
 * @module
 */

import { estimateParts } from './estimate.js'
import { effectiveParts } from './fit.js'
import { degrade, total } from './ladder.js'
import { nonceFor, wrapUntrusted } from './envelope.js'
import { FIDELITIES } from './types.js'
import { validate, mentionsIn } from './law.js'
import { withholdOversized, BINARY_SHARE } from './withhold.js'

/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').CompactionStep} CompactionStep */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('./state.js').SectionSource} SectionSource */
/** @typedef {import('./ladder.js').Fitted} Fitted */
/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./image.js').ImageRule} ImageRule */

/**
 * Build the paper for one call.
 *
 * `images` is the PROVIDER's image arithmetic, and it is the one thing here
 * that a provider decides: a photograph billed by OpenAI's tiles costs about a
 * third of what the same photograph costs an Anthropic entry, so a paper
 * assembled under the wrong rule fits a window it will not fit. The adapter
 * for the target carries it (`adapterFor(card.kind).images`); omitted, the
 * estimator states its own default and says why.
 * @param {State} state
 * @param {Budget} budget
 * @param {ImageRule} [images]
 * @returns {Document}
 * @throws {HarnessError} by law name — `no_head`, `elided_but_named`, …
 */
export function assemble(state, budget, images) {
  const { work, withheld } = gather(state, budget, images)
  const steps = degrade(work, budget, images)
  const doc = {
    stage: state.stage,
    sections: work.map(({ source, fidelity, tokens, parts }) => ({
      ...source.section,
      fidelity,
      budgetHint: tokens,
      parts,
    })),
    report: { budget, spent: total(work), steps, withheld, imageRule: images?.provider ?? 'openai (default)' },
  }
  validate(doc)
  return doc
}

/**
 * Every section at the fidelity it starts from, in prompt order.
 *
 * The sort is by slot and NOTHING else, and it is stable, so two sections
 * sharing a slot keep the order they were supplied in. Deliberately not
 * tie-broken on `priority`: that is the budget rank, and letting a budget
 * number reorder the prompt is the category error the slot type ended.
 * @param {State} state @param {Budget} budget @param {ImageRule} [images]
 * @returns {{work: Fitted[], withheld: import('@harness/kernel').SectionId[]}}
 */
function gather(state, budget, images) {
  const ceiling = Math.floor(budget.maxTokens / BINARY_SHARE)
  const nonce = nonceFor(state.sources.map((s) => s.section.id).join('|'))
  const ordered = [...state.sources].sort((a, b) => a.section.slot - b.section.slot)
  const referenced = referencedIn(ordered)
  /** @type {import('@harness/kernel').SectionId[]} */
  const withheld = []
  /** @type {Fitted[]} */
  const work = ordered.map((raw) => {
    const held = withholdOversized(raw, ceiling, images)
    if (held.withheld) withheld.push(raw.section.id)
    const source = envelop(held.source, nonce)
    const empty = source.section.parts.length === 0
    const named = referenced.has(source.section.id)
    const floor = startingFloor(source.section.floor, empty, named)
    const fidelity = empty ? (named ? 'pointer' : 'elided') : 'full'
    const parts = effectiveParts(source, fidelity, budget.maxTokens, images)
    const scoped = { ...source, section: { ...source.section, floor } }
    return { source: scoped, fidelity, parts, tokens: estimateParts(parts, images).tokens }
  })
  return { work, withheld }
}

/**
 * How far a section may be degraded, once the paper knows two things about it.
 *
 * A section another section's prose NAMES may never reach `elided`: that is
 * the `## observations` defect, where the operating rules told the model to
 * read a block the budget had removed. It stops at `pointer`, which says the
 * block exists and is being held back.
 *
 * An EMPTY section's floor is `elided` whatever it declared. A floor is a
 * statement about how much may be taken away, and there is nothing here to
 * take; the alternative is a document that fails its own law for having
 * nothing to say.
 * @param {Fidelity} declared @param {boolean} empty @param {boolean} named
 * @returns {Fidelity}
 */
function startingFloor(declared, empty, named) {
  if (empty) return named ? 'pointer' : 'elided'
  if (!named) return declared
  return FIDELITIES.indexOf(declared) > FIDELITIES.indexOf('pointer') ? 'pointer' : declared
}

/**
 * Whether one source names a block ANYWHERE it can end up rendering. The
 * summary counts: at `summarized` fidelity it is what the model reads, so a
 * curated summary backticking another id protects that id exactly as the body
 * would. Scanning only the body is how a legitimate state reached the law as a
 * crash.
 * @param {SectionSource} s @param {string} id
 */
function names(s, id) {
  return mentionsIn(s.section.intent, [...s.section.parts, ...(s.summary ?? [])], id)
}

/** Sections some other section's prose sends the model to read. @param {SectionSource[]} sources */
function referencedIn(sources) {
  /** @type {Set<string>} */
  const named = new Set()
  for (const target of sources) {
    if (sources.some((s) => s.section.id !== target.section.id && names(s, target.section.id))) {
      named.add(target.section.id)
    }
  }
  return named
}

/** Untrusted content, wrapped so nothing in it can be read as an instruction. @param {SectionSource} src @param {string} nonce */
function envelop(src, nonce) {
  if (src.section.trust !== 'untrusted') return src
  return {
    section: { ...src.section, parts: wrapUntrusted(src.section.parts, nonce) },
    summary: src.summary === null ? null : wrapUntrusted(src.summary, nonce),
  }
}
