import { Outcome } from '../core/Outcome.js'
import { ErrorCode, Response } from '../protocol/Envelope.js'

/**
 * The backend's front door.
 *
 * One place decides how a method name becomes a call and how a result becomes a
 * Response. Handlers therefore never touch the envelope — they take params and
 * return an `Outcome`, exactly like any other core call.
 *
 * Nothing throws by design, so the try/catch here is a backstop rather than the
 * mechanism: it exists because a defect is still possible and must not take the
 * worker down with it, leaving every future call unanswered.
 */
export class Kernel {
  constructor() {
    this._routes = new Map()
  }

  /**
   * Bind `namespace.method` to every public method of a service instance.
   * Registering the object rather than each function keeps `this` intact and
   * means adding a use case is one method, not a method plus a wiring line.
   */
  register(namespace, service) {
    const proto = Object.getPrototypeOf(service)
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name.startsWith('_')) continue
      const value = service[name]
      if (typeof value !== 'function') continue
      this._routes.set(`${namespace}.${name}`, value.bind(service))
    }
    return this
  }

  get methods() {
    return [...this._routes.keys()].sort()
  }

  /**
   * Always resolves. A rejected promise here would cross the postMessage
   * boundary as an unhandled rejection and the caller's request would hang
   * forever instead of failing.
   */
  async handle(request, emit = null) {
    const handler = this._routes.get(request.method)
    if (!handler) {
      return Response.fail(request.id, ErrorCode.NO_HANDLER, `no method ${request.method}`, {
        hint: `Known methods: ${this.methods.join(', ')}`,
      })
    }

    // `emit` is a second argument, not a wrapper or a context object: a
    // handler that has nothing to say mid-call simply does not declare it, and
    // reads exactly as it did before events existed.
    const result = await Outcome.attempt(() => handler(request.params, emit))
    if (!result.ok) {
      // Only a defect reaches here — every intended failure arrived as a value.
      return Response.from(request.id, result.withNote('this is a bug: a handler threw'))
    }

    // A handler that returned a bare value rather than an Outcome is still
    // answerable; wrapping it keeps one shape on the wire.
    const outcome = result.value instanceof Outcome ? result.value : Outcome.ok(result.value)
    return Response.from(request.id, outcome)
  }
}
