/**
 * The paper. Nothing reaches a model except as an assembled `Document` (I13),
 * and assembly is pure and golden-tested (I14). Two stages, deliberately not
 * one: assembling decides WHAT is said, rendering decides how a given provider
 * hears it — collapsing them is the known failure mode, because provider
 * quirks then leak into the decision about what the model is told.
 *
 * This barrel carries the SHAPES. The stages arrive behind them.
 * @module
 */

export { STABILITIES, FIDELITIES, nextFidelity, UNLIMITED_BUDGET } from './types.js'
export { SLOT, isHead, isTail } from './slot.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Stability} Stability */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').Provenance} Provenance */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').CompactionStep} CompactionStep */
/** @typedef {import('./types.js').CompactionReport} CompactionReport */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./state.js').SectionSource} SectionSource */
/** @typedef {import('./state.js').State} State */
