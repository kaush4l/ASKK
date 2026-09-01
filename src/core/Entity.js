import { newId } from './ids.js'

/**
 * Base class for anything with a persistent identity.
 *
 * Entities compare by id, never by field values: two loads of the same
 * conversation are the same conversation even after one of them is edited.
 *
 * There is no guard against constructing this directly. A base class being
 * instantiated is a mistake in code, not a state the running flow can reach —
 * and a throw here would turn a lint-visible slip into a crash on a user's
 * machine. The subclass-only contract is documented and checked by review.
 */
export class Entity {
  constructor(id = newId()) {
    this.id = id
  }

  equals(other) {
    return other instanceof Entity && other.constructor === this.constructor && other.id === this.id
  }

  /**
   * The plain, structured-cloneable form written to storage and sent over the
   * wire. The default copies own enumerable fields, which is right for a simple
   * entity; anything holding objects overrides it.
   */
  toJSON() {
    return { ...this }
  }
}
