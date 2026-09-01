/**
 * The result of anything that can fail.
 *
 * Nothing in this application throws. Every part of the flow runs on the
 * client, where the code, the storage and the transport are all inspectable, so
 * a failure is a state we can name in advance rather than an exception that
 * unwinds the stack to somewhere that has lost the context to explain it.
 *
 * A throw also crosses realms badly: an Error does not survive structured-clone
 * with its type or stack, so a failure that travelled from the worker as an
 * exception would arrive as an unhelpful shape anyway. Returning a value makes
 * the boundary honest.
 *
 *     const outcome = await thing()
 *     if (!outcome.ok) return outcome.withNote('while doing X')
 *     use(outcome.value)
 *
 * `notes` records repairs and context as the outcome travels, so a corrected
 * flow can still say what it corrected instead of hiding it.
 */

/**
 * The failure vocabulary.
 *
 * Deliberately the same strings as the wire's `ErrorCode`. They are declared
 * twice rather than shared so that `core/` and `protocol/` stay independent of
 * each other — either may be imported without dragging the other in — and the
 * Kernel can pass a code straight through with no translation table.
 *
 * `OVERRUN` is the one word here the wire does not have, the mirror of the
 * wire's `NO_HANDLER`: each is read only on its own side of the boundary. A
 * reply that ran out of tokens inside the model's scratchpad is refused by the
 * transport, and it is not `UNAVAILABLE` — the endpoint answered, and the next
 * request need not be the same request — so `ReActEngine` reads this code to
 * take another turn and, if it must end a run on it, does so through
 * `unreadable` as `UNAVAILABLE`. Nothing carrying this code reaches the Kernel.
 */
export const Reason = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL',
  OVERRUN: 'OVERRUN',
})

export class Failure {
  constructor(code, message, hint = '') {
    this.code = code
    this.message = message
    /** What the user could do about it. Empty when there is nothing useful to say. */
    this.hint = hint
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint }
  }
}

export class Outcome {
  constructor(ok, value = null, failure = null, notes = []) {
    this.ok = ok
    this.value = value
    this.failure = failure
    this.notes = notes
  }

  static ok(value, notes = []) {
    return new Outcome(true, value, null, notes)
  }

  static failed(code, message, { hint = '', notes = [] } = {}) {
    return new Outcome(false, null, new Failure(code, message, hint), notes)
  }

  /**
   * Wrap a call that might throw — third-party code, a browser API, JSON.parse.
   * The boundary where foreign code becomes an outcome, so the rest of the tree
   * never has to hold a try/catch.
   */
  static async attempt(fn, { code = Reason.INTERNAL, hint = '' } = {}) {
    try {
      return Outcome.ok(await fn())
    } catch (err) {
      return Outcome.failed(code, err?.message ?? String(err), { hint })
    }
  }

  /** Carry context up without losing where it started. */
  withNote(note) {
    return note ? new Outcome(this.ok, this.value, this.failure, [...this.notes, note]) : this
  }

  /** Re-label a failure while keeping the notes. An ok outcome passes through. */
  asFailure(code, message, hint = '') {
    return this.ok ? this : new Outcome(false, null, new Failure(code, message, hint), this.notes)
  }

  unwrapOr(fallback) {
    return this.ok ? this.value : fallback
  }

  toJSON() {
    return {
      ok: this.ok,
      value: this.value,
      failure: this.failure ? this.failure.toJSON() : null,
      notes: this.notes,
    }
  }
}
