/**
 * Typed errors. One class per failure DOMAIN, each carrying a closed `kind`
 * so a caller matches on data rather than on a message string (PROMPT §13).
 * Classes and not plain objects for exactly one reason: `instanceof` survives
 * a `throw`, and these are thrown as well as returned.
 * @module
 */

/** Base: every harness failure carries a kind and an operator-readable line. */
export class HarnessError extends Error {
  /**
   * @param {string} kind closed within each subclass
   * @param {string} message one sentence, shown to a person
   * @param {{cause?: unknown, detail?: string}} [opts]
   */
  constructor(kind, message, opts = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = new.target.name
    this.kind = kind
    this.detail = opts.detail ?? ''
  }

  /** The shape that crosses the seam and lands in the log. */
  toJSON() {
    return { name: this.name, kind: this.kind, message: this.message, detail: this.detail }
  }
}

/** @typedef {'quota'|'unavailable'|'corrupt'|'conflict'|'io'} StoreErrorKind */
export class StoreError extends HarnessError {
  /** @param {StoreErrorKind} kind @param {string} message @param {{cause?: unknown, detail?: string, key?: string}} [opts] */
  constructor(kind, message, opts = {}) {
    super(kind, message, opts)
    this.key = opts.key ?? ''
  }
}

/** @typedef {'unauthorized'|'rate_limited'|'refused'|'timeout'|'offline'|'malformed'|'server'} ModelErrorKind */
export class ModelError extends HarnessError {
  /** @param {ModelErrorKind} kind @param {string} message @param {{cause?: unknown, detail?: string, status?: number}} [opts] */
  constructor(kind, message, opts = {}) {
    super(kind, message, opts)
    this.status = opts.status ?? 0
  }
}

/** @typedef {'not_allowed'|'timeout'|'offline'|'server'|'malformed'} NetErrorKind */
export class NetError extends HarnessError {
  /** @param {NetErrorKind} kind @param {string} message @param {{cause?: unknown, detail?: string, status?: number}} [opts] */
  constructor(kind, message, opts = {}) {
    super(kind, message, opts)
    this.status = opts.status ?? 0
  }
}

/** @typedef {'unknown_agent'|'refused'|'crashed'|'timeout'|'cycle'} DelegateErrorKind */
export class DelegateError extends HarnessError {}

/** @typedef {'unavailable'|'timeout'|'interrupted'|'not_found'|'refused'} WorkspaceErrorKind */
export class WorkspaceError extends HarnessError {}

/** @typedef {'denied'|'unknown'} CapabilityErrorKind */
export class CapabilityError extends HarnessError {}

/**
 * Whether an endpoint looks like LOOPBACK — the one distinction worth drawing,
 * because "your local model is not running" and "the internet is gone" have
 * different repairs and the person needs the right one. Pure string work, so it
 * tests on the host (I3).
 */
export function isLoopback(/** @type {string} */ url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url)
}
