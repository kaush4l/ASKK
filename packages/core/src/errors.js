/**
 * Core's own typed failures. The pure packages' errors (`StoreError`,
 * `ModelError`, …) cross this layer unchanged: Rust wrapped each one in a
 * `CoreError` variant so a caller could match a single enum, and `instanceof`
 * over a thrown value does that here without the wrapper.
 *
 * Three kinds, all of them install-path:
 *   `route_conflict`    another live module already answers this method+path
 *   `already_installed` that id is already live — a version replaces, never joins
 *   `invalid_manifest`  the manifest breaks its own contract, caught before
 *                       the module can exist so nothing downstream re-checks
 * @module
 */

import { HarnessError } from '@harness/kernel'

/** @typedef {'route_conflict'|'already_installed'|'invalid_manifest'} ModuleErrorKind */

/**
 * What the install path can reject. THROWN and not returned, because a refused
 * install must leave nothing behind: every caller is a boot or an authoring
 * gesture, and both stop.
 */
export class ModuleError extends HarnessError {}
