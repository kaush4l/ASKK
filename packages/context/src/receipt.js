/**
 * THE RECEIPT FOR ONE CALL: what the budget took away, and what was decided
 * about caching — in the words a person reads.
 *
 * IT IS HERE BECAUSE THE FACTS WERE ALREADY TRUE AND NOTHING COULD SAY THEM.
 * `cacheOffer` decided, per call, whether the stable head was worth offering to
 * the provider; the decision was correct, exported, tested — and had NO READER,
 * so nobody could be told "the stable head was 275 tokens, below this
 * provider's 4096-token minimum, so nothing was cached". `CompactionReport` was
 * in the same position from the other side: it reached the model in the
 * compaction notice and reached no person at all. A truth the system holds and
 * does not state is a defect whether or not anything is wrong underneath it
 * (I16).
 *
 * THE WORDING IS THE CORE'S AND NOT THE INTERFACE'S (I5). Two panes wording a
 * ratio, a plural or a fidelity step for themselves word them differently, and
 * a person who reads both learns that the system does not know what it thinks.
 * The machine fields travel beside the strings so a view can sort, count and
 * key on them without composing prose from them.
 * @module
 */

import { budgetSentence } from './budget.js'
import { cacheSentence } from './cache.js'

/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./types.js').CompactionReport} CompactionReport */
/** @typedef {import('./budget.js').DerivedBudget} DerivedBudget */
/** @typedef {import('./cache.js').CacheOffer} CacheOffer */

/**
 * What one call decided, machine field and worded string side by side.
 * @typedef {{
 *   cache: CacheOffer,
 *   cacheLabel: string,
 *   budgetLabel: string,
 *   spentLabel: string,
 *   compactionLines: string[],
 *   compactionLabel: string,
 * }} Receipt
 */

/**
 * `cacheLabel` is `cacheSentence` with no usage, because the receipt is written
 * BEFORE the call: what is knowable now is what was offered, and what came back
 * is the same sentence again with the provider's own accounting in it.
 * `paper` and not `document`: the identifier is a browser global, and the gate
 * that keeps the pure packages off the DOM reads the name and not the scope —
 * correctly, since a local shadowing `document` is how a real reach for it hides.
 * @param {Document} paper @param {DerivedBudget} budget @param {CacheOffer} cache
 * @returns {Receipt}
 */
export function receiptOf(paper, budget, cache) {
  const report = paper.report
  return {
    cache,
    cacheLabel: cacheSentence(null, cache),
    budgetLabel: budgetSentence(budget),
    spentLabel: `The paper spent ${report.spent} of ${budget.maxTokens} tokens, counted under the ${report.imageRule} image rule.`,
    compactionLines: compactionLines(report),
    compactionLabel: compactionLabel(report),
  }
}

/**
 * One line per thing the budget took, in the report's own vocabulary. A
 * withheld part is NOT a fidelity step and is worded as its own kind of loss:
 * the section did not degrade, it lost a blob, and calling that a degradation
 * is the false receipt `CompactionReport` splits the two fields to avoid.
 * @param {CompactionReport} report
 */
function compactionLines(report) {
  return [
    ...report.steps.map((s) => `${s.section} was reduced from ${s.from} to ${s.to}.`),
    ...report.withheld.map((id) => `${id} lost a part too large to charge against this budget.`),
  ]
}

/** @param {CompactionReport} report */
function compactionLabel(report) {
  const cut = report.steps.length
  const held = report.withheld.length
  if (cut === 0 && held === 0) return 'Nothing was compacted: the whole paper fit.'
  /** @type {string[]} */
  const parts = []
  if (cut > 0) parts.push(`${cut} ${cut === 1 ? 'section was' : 'sections were'} shortened`)
  if (held > 0) parts.push(`${held} oversized ${held === 1 ? 'part was' : 'parts were'} withheld`)
  return `${parts.join(' and ')} to fit ${report.budget.maxTokens} tokens.`
}
