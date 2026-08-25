/**
 * The compaction ladder: which section gives ground next, and what that step
 * is allowed to cost. Split from `assemble` because it is a different
 * question — assembly decides what each section IS, the ladder decides what
 * the budget takes back from it — and the two together no longer fit in one
 * pass of a reader's eye.
 * @module
 */

import { estimateParts } from './estimate.js'
import { effectiveParts } from './fit.js'
import { nextFidelity, FIDELITIES } from './types.js'

/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./image.js').ImageRule} ImageRule */
/** @typedef {import('./types.js').CompactionStep} CompactionStep */
/** @typedef {import('./state.js').SectionSource} SectionSource */
/**
 * One section, mid-assembly. `parts` is carried rather than recomputed at the
 * end because the budget was spent against THESE bytes: recomputing them
 * later, when the allowance has moved, would let `budgetHint` describe a
 * document nobody assembled.
 * @typedef {{source: SectionSource, fidelity: Fidelity, tokens: number, parts: Part[]}} Fitted
 */

/**
 * While the paper is over budget, step the highest priority number not yet at
 * its floor down ONE level and recompute its cost against what is left for it
 * — the allowance is continuous, so a transcript drops the turns it has to
 * rather than collapsing to a fixed number of characters.
 *
 * Stops when everything sits at its floor. The honest overshoot is then in
 * the report rather than forced away by a cut nobody recorded.
 * @param {Fitted[]} work @param {Budget} budget @param {ImageRule} [images]
 * @returns {CompactionStep[]}
 */
export function degrade(work, budget, images) {
  /** @type {CompactionStep[]} */
  const steps = []
  /** @type {Set<number>} */
  const exhausted = new Set()
  while (total(work) > budget.maxTokens) {
    const at = nextVictim(work, exhausted)
    if (at === null) return steps
    const w = /** @type {Fitted} */ (work[at])
    const from = w.fidelity
    const to = nextFidelity(from)
    if (to === null) return steps
    const parts = effectiveParts(w.source, to, allowanceFor(work, budget, w.tokens), images)
    const next = estimateParts(parts, images).tokens
    // A ladder step that does not reduce is not a compaction, and recording it
    // as one tells the engineer the budget did work it did not do. A short body
    // costs more as a pointer than it did whole.
    if (next >= w.tokens) {
      exhausted.add(at)
      continue
    }
    w.fidelity = to
    w.parts = parts
    w.tokens = next
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

/**
 * The lowest-ranked section still above its floor; ties go to the later one.
 * A section whose next step costs more than it saves is `exhausted` and skipped
 * for good, so the loop moves on rather than spending the paper to shrink it.
 * @param {Fitted[]} work @param {Set<number>} exhausted
 */
function nextVictim(work, exhausted) {
  let at = null
  for (let i = 0; i < work.length; i += 1) {
    const w = /** @type {Fitted} */ (work[i])
    if (exhausted.has(i)) continue
    if (FIDELITIES.indexOf(w.fidelity) >= FIDELITIES.indexOf(w.source.section.floor)) continue
    const best = at === null ? null : /** @type {Fitted} */ (work[at])
    if (best === null || w.source.section.priority >= best.source.section.priority) at = i
  }
  return at
}

/** What the paper costs right now. @param {Fitted[]} work */
export function total(work) {
  return work.reduce((sum, w) => sum + w.tokens, 0)
}
