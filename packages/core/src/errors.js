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
 *
 * And `LogError`, which is a build-assembly failure and never a data failure.
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

/** @typedef {'unknown_projection'|'unserialisable_projection'|'empty_segment'} LogErrorKind */

/**
 * What the log refuses — and it is never the DATA. An unreadable record is
 * quarantined and boot completes (I20); a failed write leaves the queue intact
 * and is recorded as a `store_failed` fact. Every kind here is a build
 * assembled wrong: a view asking for a projection nobody registered, a reducer
 * whose state cannot be written as JSON, and a record packed from no facts.
 */
export class LogError extends HarnessError {}
