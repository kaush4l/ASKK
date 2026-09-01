import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * The persistence port.
 *
 * Services depend on this class, never on IndexedDB. That is what keeps the
 * domain testable without a browser and lets the datastore be replaced — an
 * in-memory store, OPFS, a remote sync target — without a service changing.
 *
 * Every method returns an `Outcome` and none of them throw. Storage is the
 * other thing in this app that genuinely fails on a user's machine — a private
 * window, a full disk, a browser that blocks site data — and a caller must be
 * able to carry on knowing that rather than be unwound by it.
 */
export class Repository {
  constructor(entityName) {
    this.entityName = entityName
  }

  _unimplemented(method) {
    return Outcome.failed(
      Reason.NOT_IMPLEMENTED,
      `${this.entityName}: ${method}() is not implemented on this repository`,
    )
  }

  /** @returns {Promise<Outcome>} value is the record, or null when absent. */
  async get(_id) {
    return this._unimplemented('get')
  }

  /** @returns {Promise<Outcome>} value is an array of records. */
  async list() {
    return this._unimplemented('list')
  }

  /** @returns {Promise<Outcome>} */
  async put(_record) {
    return this._unimplemented('put')
  }

  /** @returns {Promise<Outcome>} value is true when something was removed. */
  async remove(_id) {
    return this._unimplemented('remove')
  }
}
