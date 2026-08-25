/**
 * WHAT A HANDLER IS HANDED: its effective grant, and exactly what that grant
 * buys. Ungranted is ABSENT — `null`, not present-but-refused — so a handler
 * cannot reach a capability it was denied even by mistake (I6).
 *
 * Rust handed over twenty pre-computed projections here (the board, the
 * roster, the window, every resolved model) because a handler could not borrow
 * `App` while `App` was borrowed mutably to run it. That is a borrow-checker
 * shape, not a problem shape: it made every request clone the whole log, which
 * made each poll dearer than the last. The projections that survive are the
 * ones a view actually asks for.
 *
 * NO HANDLER RECEIVES THE EVENT ARRAY (RULINGS, attack 2). Handing over
 * `log.events` would have been a second authority on history — `push` and
 * `splice` are writes the append-only log itself refuses to offer, and a
 * `readonly` JSDoc annotation cannot stop either. History arrives here as a
 * memoised projection folded by a registered reducer, when the increment that
 * registers one lands.
 * @module
 */

import { effectiveGrant, grants } from '@harness/kernel'

/** @typedef {import('@harness/kernel').CapabilityGrant} CapabilityGrant */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./app.js').App} App */

/**
 * @typedef {{
 *   grant: CapabilityGrant,
 *   clock: Timestamp|null,
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
    // The module never sees the timestamp it is stamped with, granted `clock`
    // or not: the LOG stamps a fact, because a fact whose time its author
    // chose is a fact a person cannot trust.
    emit: grants(grant, 'emit') ? (fact) => void app.log.append(fact, app.ports.clock.now()) : null,
  }
}
