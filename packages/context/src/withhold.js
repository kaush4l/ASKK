/**
 * The one reduction that happens BEFORE the ladder runs: a binary part too
 * large for the budget in hand.
 *
 * Charged honestly a 200 KB screenshot still outweighs the conversation, and
 * a ladder left to close the arithmetic would shred the transcript to make
 * room for an image nobody asked to keep. So the part is swapped one-for-one
 * for a text placeholder naming what it was and what it cost — never dropped,
 * because a downgrade the model cannot see is a downgrade it acts as though
 * did not happen (I15).
 *
 * The section is named in the report's `withheld` and NOT in its `steps`: the
 * section's own fidelity did not move, and saying it had would be a false
 * receipt (I8).
 * @module
 */

import { estimatePart } from './estimate.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./state.js').SectionSource} SectionSource */

/**
 * The largest share of the budget one binary part may claim: a quarter, so
 * three quarters always remain for the words. A divisor and not a fixed size,
 * because "too big" is only ever a claim about the budget in hand — under
 * `UNLIMITED_BUDGET` nothing is.
 */
export const BINARY_SHARE = 4

/**
 * @param {SectionSource} src
 * @param {number} ceiling
 * @returns {{source: SectionSource, withheld: boolean}} the same source, unchanged, when nothing was over the ceiling
 */
export function withholdOversized(src, ceiling) {
  const parts = src.section.parts.map((p) => swap(p, ceiling))
  const summary = src.summary === null ? null : src.summary.map((p) => swap(p, ceiling))
  const hit = parts.some((p, i) => p !== src.section.parts[i]) ||
    (summary !== null && summary.some((p, i) => p !== (src.summary ?? [])[i]))
  if (!hit) return { source: src, withheld: false }
  return { source: { section: { ...src.section, parts }, summary }, withheld: true }
}

/**
 * The part, or its placeholder. Text is returned untouched: a long paragraph
 * is what the ladder is for, and swapping it here would be head truncation
 * under another name.
 * @param {Part} part @param {number} ceiling
 * @returns {Part}
 */
function swap(part, ceiling) {
  if (part.type === 'text') return part
  const { tokens } = estimatePart(part)
  if (tokens <= ceiling) return part
  const what = part.type === 'file' ? `file '${part.name}' (${part.mediaType})` : `${part.type} (${part.mediaType})`
  return { type: 'text', text: `[${what} withheld: ~${tokens} tokens over the ${ceiling}-token part ceiling]` }
}
