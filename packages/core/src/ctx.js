/**
 * WHAT A HANDLER IS HANDED: its effective grant, and exactly what that grant
 * buys. Ungranted is ABSENT — `null`, not present-but-refused — so a handler
 * cannot reach a capability it was denied even by mistake (I6).
 *
 * Rust handed over twenty pre-computed projections here (the board, the
 * roster, the window, every resolved model) because a handler could not borrow
 * `App` while `App` was borrowed mutably to run it. That is a borrow-checker
 * shape, not a problem shape: it made every request clone the whole log, which
 * made each poll dearer than the last. Here a handler reads `events` directly
 * and each view folds what it needs (I8) — the projections that survive are
 * the ones a view actually asks for, and they arrive in the view's own file.
 * @module
 */

import { effectiveGrant, grants } from '@harness/kernel'

/** @typedef {import('@harness/kernel').CapabilityGrant} CapabilityGrant */
/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./app.js').App} App */

/**
 * @typedef {{
 *   grant: CapabilityGrant,
 *   clock: Timestamp|null,
 *   events: readonly Event[],
 *   emit: ((fact: Fact) => void)|null,
 * }} Ctx
 */

/**
 * Build the context for ONE invocation. Never stored: a grant is a fact about
 * this request, and a handler that kept one would outlive the narrowing.
 * @param {App} app
 * @param {Manifest} manifest
 * @returns {Ctx}
 */
export function contextFor(app, manifest) {
  const grant = effectiveGrant(manifest.id, manifest.capabilities, app.available)
  return {
    grant,
    clock: grants(grant, 'clock') ? app.ports.clock.now() : null,
    // Every view is a projection of the log, so reading it is not a capability
    // — it is what a view IS. Read-only by type and not by copy: the
    // predecessor cloned the whole log into every context, and four panes
    // polling made each poll dearer than the one before it.
    events: app.log.events,
    // The module never sees the timestamp it is stamped with, granted `clock`
    // or not: the LOG stamps a fact, because a fact whose time its author
    // chose is a fact a person cannot trust.
    emit: grants(grant, 'emit') ? (fact) => void app.log.append(fact, app.ports.clock.now()) : null,
  }
}
