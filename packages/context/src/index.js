/**
 * The paper. Nothing reaches a model except as an assembled `Document` (I13),
 * and assembly is pure and golden-tested (I14). Two stages, deliberately not
 * one: assembling decides WHAT is said, rendering decides how a given provider
 * hears it — collapsing them is the known failure mode, because provider
 * quirks then leak into the decision about what the model is told.
 *
 * `validate` is deliberately ABSENT from this barrel: `assemble` is the only
 * constructor of a `Document`, and it judges what it built on the way out, so
 * an invalid one is unconstructible rather than merely discouraged.
 * @module
 */

export { STABILITIES, FIDELITIES, TRUSTS, nextFidelity, UNLIMITED_BUDGET } from './types.js'
export { SLOT, isHead, isTail, isSystemSlot } from './slot.js'
export { text, keyOf, sectionOf } from './component.js'
export { assemble } from './assemble.js'
export { dropOldest, headAndTail, usePrecomputedSummary, TURN_ROLES, turnRoleOf } from './fit.js'
export { escape as escapeUntrusted, nonceFor } from './envelope.js'
export { modelCard, modelCards } from './card.js'
export { budgetFor, budgetSentence } from './budget.js'
export { estimatePart, estimateParts } from './estimate.js'
export { imageSize, imageTokens, UNKNOWN_IMAGE_TOKENS } from './image.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Stability} Stability */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').Trust} Trust */
/** @typedef {import('./component.js').Component} Component */
/** @typedef {import('./types.js').Provenance} Provenance */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').CompactionStep} CompactionStep */
/** @typedef {import('./types.js').CompactionReport} CompactionReport */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./state.js').SectionSource} SectionSource */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./card.js').CatalogueEntry} CatalogueEntry */
/** @typedef {import('./budget.js').DerivedBudget} DerivedBudget */
/** @typedef {import('./budget.js').Turn} Turn */
/** @typedef {import('./estimate.js').Estimate} Estimate */
