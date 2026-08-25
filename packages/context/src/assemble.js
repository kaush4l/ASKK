/**
 * The paper, assembled: sections in slot order, the pinned ends enforced, the
 * budget applied, and a receipt for everything it took (I13, I14).
 *
 * DETERMINISTIC. The same state and the same budget produce a byte-identical
 * document — no clock, no randomness, no model call, and the untrusted
 * envelope's nonce is derived from the payload for exactly that reason. A
 * golden test asserts it rather than the doc comment claiming it.
 *
 * There is no second constructor. `validate` is not exported from this
 * package and runs here, on the way out, so an invalid document cannot be
 * obtained at all.
 * @module
 */

import { estimateParts } from './estimate.js'
import { effectiveParts } from './fit.js'
import { nonceFor, wrapUntrusted } from './envelope.js'
import { nextFidelity, FIDELITIES } from './types.js'
import { validate, mentions } from './law.js'
import { withholdOversized, BINARY_SHARE } from './withhold.js'

/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').CompactionStep} CompactionStep */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('./state.js').SectionSource} SectionSource */
/**
 * One section, mid-assembly. `parts` is carried rather than recomputed at the
 * end because the budget was spent against THESE bytes: recomputing them
 * later, when the allowance has moved, would let `budgetHint` describe a
 * document nobody assembled.
 * @typedef {{source: SectionSource, fidelity: Fidelity, tokens: number, parts: Part[]}} Fitted
 */
/** @typedef {import('./types.js').Part} Part */

/**
 * Build the paper for one call.
 * @param {State} state
 * @param {Budget} budget
 * @returns {Document}
 * @throws {HarnessError} by law name — `no_head`, `elided_but_named`, …
 */
export function assemble(state, budget) {
  /** @type {import('@harness/kernel').SectionId[]} */
  const withheld = []
  const work = gather(state, budget, withheld)
  const steps = degrade(work, budget)
  const doc = {
    stage: state.stage,
    sections: work.map(({ source, fidelity, tokens, parts }) => ({
      ...source.section,
      fidelity,
      budgetHint: tokens,
      parts,
    })),
    report: { budget, spent: total(work), steps, withheld },
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
 * @param {State} state @param {Budget} budget
 * @param {import('@harness/kernel').SectionId[]} withheld
 * @returns {Fitted[]}
 */
function gather(state, budget, withheld) {
  const ceiling = Math.floor(budget.maxTokens / BINARY_SHARE)
  const nonce = nonceFor(state.sources.map((s) => s.section.id).join('|'))
  const ordered = [...state.sources].sort((a, b) => a.section.slot - b.section.slot)
  const referenced = referencedIn(ordered)
  return ordered.map((raw) => {
    const source = envelop(withholdOversized(raw, ceiling, withheld), nonce)
    const empty = source.section.parts.length === 0
    const named = referenced.has(source.section.id)
    const floor = startingFloor(source.section.floor, empty, named)
    const fidelity = empty ? (named ? 'pointer' : 'elided') : 'full'
    const parts = effectiveParts(source, fidelity, budget.maxTokens)
    const scoped = { ...source, section: { ...source.section, floor } }
    return { source: scoped, fidelity, parts, tokens: estimateParts(parts).tokens }
  })
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

/** Sections some other section's prose sends the model to read. @param {SectionSource[]} sources */
function referencedIn(sources) {
  /** @type {Set<string>} */
  const named = new Set()
  for (const target of sources) {
    if (sources.some((s) => s.section.id !== target.section.id && mentions(s.section, target.section.id))) {
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

/**
 * While the paper is over budget, step the highest priority number not yet at
 * its floor down ONE level and recompute its cost against what is left for it
 * — the allowance is continuous, so a transcript drops the turns it has to
 * rather than collapsing to a fixed number of characters.
 *
 * Stops when everything sits at its floor. The honest overshoot is then in
 * the report rather than forced away by a cut nobody recorded.
 * @param {Fitted[]} work @param {Budget} budget
 * @returns {CompactionStep[]}
 */
function degrade(work, budget) {
  /** @type {CompactionStep[]} */
  const steps = []
  while (total(work) > budget.maxTokens) {
    const at = nextVictim(work)
    if (at === null) return steps
    const w = /** @type {Fitted} */ (work[at])
    const from = w.fidelity
    const to = nextFidelity(from)
    if (to === null) return steps
    w.fidelity = to
    w.parts = effectiveParts(w.source, to, allowanceFor(work, budget, w.tokens))
    w.tokens = estimateParts(w.parts).tokens
    steps.push({ section: w.source.section.id, from, to })
  }
  return steps
}

/**
 * What is left for one section once every other section has been paid for.
 * Never negative: at zero the primitives keep their minimum — the newest turn,
 * two characters — which is what makes an impossible budget produce a small
 * document rather than an empty one.
 * @param {Fitted[]} work @param {Budget} budget @param {number} mine
 */
function allowanceFor(work, budget, mine) {
  return Math.max(0, budget.maxTokens - (total(work) - mine))
}

/** The lowest-ranked section still above its floor; ties go to the later one. @param {Fitted[]} work */
function nextVictim(work) {
  let at = null
  for (let i = 0; i < work.length; i += 1) {
    const w = /** @type {Fitted} */ (work[i])
    if (FIDELITIES.indexOf(w.fidelity) >= FIDELITIES.indexOf(w.source.section.floor)) continue
    const best = at === null ? null : /** @type {Fitted} */ (work[at])
    if (best === null || w.source.section.priority >= best.source.section.priority) at = i
  }
  return at
}

/** @param {Fitted[]} work */
function total(work) {
  return work.reduce((sum, w) => sum + w.tokens, 0)
}
