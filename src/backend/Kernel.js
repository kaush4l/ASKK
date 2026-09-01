import { Outcome } from '../core/Outcome.js'
import { CANCEL, ErrorCode, Response } from '../protocol/Envelope.js'

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
 *
 * It is also the only thing in either realm that knows what is RUNNING: the
 * signals live here, one per call, and the page reaches them by sending a
 * second request that names the first — see `CANCEL` in the envelope for why
 * the handle is an id and not a signal.
 */
export class Kernel {
  // `#`, not the `_` this tree usually writes, because these two are the whole
  // of the front door's state and nothing outside may hold either. A test
  // reached into the route table once, to call a handler without dispatching to
  // it, and certified a route that `handle` might never have found; `#` is what
  // makes that unwritable rather than discouraged.
  #routes = new Map()
  /** @type {Map<string, AbortController>} request id -> the call's stop. */
  #running = new Map()

  constructor() {
    // Registered directly rather than through `register`, because there is no
    // service to register: cancelling is the front door's own business and the
    // front door is the only thing holding the state it needs.
    this.#routes.set(CANCEL, (params) => this.cancel(params))
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
      this.#routes.set(`${namespace}.${name}`, value.bind(service))
    }
    return this
  }

  get methods() {
    return [...this.#routes.keys()].sort()
  }

  /**
   * Stop a call that is still running.
   *
   * Not finding one is an ordinary result, not a failure: the usual way to miss
   * is to press stop as the answer arrives, and reporting that as an error would
   * put a red message on screen for a run that finished correctly. The boolean
   * says whether anything was actually interrupted.
   *
   * It said so in a NOTE too, and the note is gone. `BackendClient.stop` drops
   * this promise on purpose — the call being stopped answers on its own request
   * — so the one sentence distinguishing "I stopped it" from "it had already
   * finished" reached the wire and was read by nobody but its own test. A
   * sentence written for a user who cannot receive it is not a message.
   */
  cancel({ id } = {}) {
    const controller = this.#running.get(String(id ?? ''))
    if (!controller) return Outcome.ok(false)
    controller.abort()
    return Outcome.ok(true)
  }

  /**
   * Always resolves. A rejected promise here would cross the postMessage
   * boundary as an unhandled rejection and the caller's request would hang
   * forever instead of failing.
   */
  async handle(request, emit = null) {
    const handler = this.#routes.get(request.method)
    if (!handler) {
      return Response.fail(request.id, ErrorCode.NO_HANDLER, `no method ${request.method}`, {
        hint: `Known methods: ${this.methods.join(', ')}`,
      })
    }

    // Every call gets one, whether or not its handler reads it. A signal costs
    // nothing to create and making it unconditional means a handler becomes
    // stoppable by declaring a third parameter — there is no list of
    // cancellable methods to keep in step with the services.
    const controller = new AbortController()
    this.#running.set(request.id, controller)

    // `emit` is a second argument, not a wrapper or a context object: a
    // handler that has nothing to say mid-call simply does not declare it, and
    // reads exactly as it did before events existed. `signal` is a third for
    // the same reason.
    const result = await Outcome.attempt(() => handler(request.params, emit, controller.signal))
    this.#running.delete(request.id)

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
