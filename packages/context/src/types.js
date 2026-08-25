/**
 * The paper's value types: what a section is, what it may contain, what a
 * budget did to it (I13, I14).
 *
 * EVERY VALUE HERE IS JSON. A document is persisted, hashed, and handed across
 * a Worker boundary, so nothing in this file may be a class, a `Map`, a `Date`,
 * or an absent property: `JSON.parse(JSON.stringify(x))` must equal `x`. That
 * is why an absent summary is `null` and never `undefined` — `undefined`
 * disappears on the way out and the value that comes back is a different one.
 * @module
 */

import { HarnessError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').ModuleId} ModuleId */
/** @typedef {import('@harness/kernel').PhaseId} PhaseId */
/** @typedef {import('@harness/kernel').SectionId} SectionId */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('@harness/kernel/ids.js').Version} Version */

/**
 * Multimodal content, as BYTES rather than URLs: `render` has to be able to
 * hand the same part to any provider, and a provider that fetches a URL for us
 * is a provider that reads something we never saw.
 * @typedef {(
 *   | {type: 'text', text: string}
 *   | {type: 'image', mediaType: string, dataBase64: string}
 *   | {type: 'audio', mediaType: string, dataBase64: string}
 *   | {type: 'file', name: string, mediaType: string, dataBase64: string}
 * )} Part
 */

/**
 * How often a section's content changes — and NOTHING about where it goes,
 * which is `Slot`'s question. Slots are assigned so that the cacheable head
 * stays monotonic in this order, which is what makes a provider's prefix cache
 * hit; `validate` enforces that up to the pinned tail.
 * @typedef {'static'|'semi_static'|'dynamic'|'volatile'} Stability
 */

/** The stability classes, most cacheable first. The order IS the rule. */
export const STABILITIES = /** @type {readonly Stability[]} */ ([
  'static', 'semi_static', 'dynamic', 'volatile',
])

/**
 * How much of a section survives this assembly. `Fidelity` is the LEVEL;
 * compaction is the process that moves a section down the ladder and records
 * each step.
 * @typedef {'full'|'summarized'|'pointer'|'elided'} Fidelity
 */

/** The ladder, in the order degradation walks it. */
export const FIDELITIES = /** @type {readonly Fidelity[]} */ ([
  'full', 'summarized', 'pointer', 'elided',
])

/**
 * One step down the ladder, `null` at the end of it. One definition, so the
 * compaction loop and the tests that judge it cannot disagree about "next".
 *
 * A name that is not on the ladder THROWS rather than answering. Documents are
 * persisted and cross a Worker boundary, so an older build's or a renamed
 * fidelity arrives here as unchecked data; `indexOf` would say -1 and the step
 * after -1 is `'full'`, which walks a compacting section back UP the ladder and
 * never terminates (I16).
 * @param {Fidelity} fidelity
 * @returns {Fidelity|null}
 */
export function nextFidelity(fidelity) {
  const at = FIDELITIES.indexOf(fidelity)
  if (at < 0) {
    throw new HarnessError('unknown_fidelity', `no fidelity named "${String(fidelity)}"`, {
      detail: `the ladder is ${FIDELITIES.join(' -> ')}`,
    })
  }
  return FIDELITIES[at + 1] ?? null
}

/**
 * What produced a section, and from what. It exists so "why did it say that?"
 * is answerable with receipts rather than reconstruction.
 * @typedef {{
 *   module: ModuleId,
 *   version: Version,
 *   inputHash: string,
 *   producedAt: Timestamp,
 * }} Provenance
 */

/**
 * One declared unit of the paper.
 *
 * `intent` is mandatory and it is not decoration: it is the mechanism that
 * stops a prompt from accreting, because a section nobody can write one
 * sentence for is a section nobody can justify. `validate` rejects an empty
 * one as an error, not as a blank.
 *
 * `priority` is the DEGRADATION order (lower survives longer); `slot` is the
 * PROMPT order. They are different numbers answering different questions, and
 * assembly never ties one to the other.
 * @typedef {{
 *   id: SectionId,
 *   intent: string,
 *   slot: number,
 *   stability: Stability,
 *   priority: number,
 *   fidelity: Fidelity,
 *   floor: Fidelity,
 *   budgetHint: number,
 *   provenance: Provenance,
 *   parts: Part[],
 * }} Section
 */

/**
 * The token ceiling for one assembly. An object rather than a bare number so
 * the reserved-output-tokens field this will grow does not touch every caller.
 * @typedef {{maxTokens: number}} Budget
 */

/**
 * The budget that never bites, for goldens. `MAX_SAFE_INTEGER` and not
 * `Infinity`, because `Infinity` serializes to `null` and a golden document
 * must survive the round trip this whole file exists to guarantee.
 * @type {Budget}
 */
export const UNLIMITED_BUDGET = Object.freeze({ maxTokens: Number.MAX_SAFE_INTEGER })

/**
 * One recorded degradation. Degradation must be VISIBLE: an agent that does
 * not know it is missing history acts as though it has it.
 * @typedef {{section: SectionId, from: Fidelity, to: Fidelity}} CompactionStep
 */

/**
 * What the budget did to one assembly. Rendered into the paper as a volatile
 * tail section AND persisted per turn, so the same facts tell the model and
 * the engineer what was cut.
 *
 * `withheld` is a PART-level fact and is kept out of `steps` on purpose: a
 * section that lost a blob has not changed fidelity, and saying it had would
 * be a false receipt (I8).
 * @typedef {{
 *   budget: Budget,
 *   spent: number,
 *   steps: CompactionStep[],
 *   withheld: SectionId[],
 * }} CompactionReport
 */

/**
 * The assembled paper: sections in slot order plus what the budget did. This
 * is what `render` consumes, what the goldens snapshot, and what the event log
 * hashes into `model_called.documentHash`.
 * @typedef {{phase: PhaseId, sections: Section[], report: CompactionReport}} Document
 */
