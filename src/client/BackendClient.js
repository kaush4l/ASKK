import { CANCEL, ErrorCode, Request } from '../protocol/Envelope.js'

/**
 * The page's handle on the backend.
 *
 * Turns the broadcast nature of postMessage into ordinary awaitable calls by
 * correlating each reply to its request id. Components use this and never touch
 * the worker, so the transport can change without touching a component.
 *
 * `call` never rejects. Every result — success, failure, or a worker that died
 * — arrives as the same shape, so a component reads one thing rather than
 * holding a try/catch around every interaction.
 *
 * A call may also be watched: pass `onEvent` and the backend's progress
 * reports for that call — the prompt it assembled, the text as it streams —
 * arrive there. The awaited result is unchanged either way.
 *
 * And it may be stopped. `begin` hands back the id it generated so a caller can
 * name the call again later; `stop` is that name sent back as a second request.
 * The id has to be the handle because an AbortSignal cannot be postMessaged —
 * see `CANCEL` in the envelope for why that is the shape rather than a wart.
 */
export class BackendClient {
  constructor(worker) {
    this._worker = worker
    this._pending = new Map()
    this._listeners = new Map()
    this._seq = 0
    const { promise, resolve } = Promise.withResolvers()
    this._ready = promise
    this._resolveReady = resolve
    this._dead = null

    this._worker.addEventListener('message', (event) => this._receive(event.data))
    this._worker.addEventListener('error', (event) =>
      this._die(event.message || 'the backend worker stopped'),
    )
    // A worker whose script fails to load fires this instead of `error`, and
    // without it every call would wait for a reply that can never come.
    this._worker.addEventListener('messageerror', () =>
      this._die('the backend sent an unreadable message'),
    )
  }

  /**
   * Constructed here rather than by the caller so the URL stays statically
   * analysable — a bundler can only find the worker chunk if it can see this
   * literal.
   */
  static spawn() {
    return new BackendClient(
      new Worker(new URL('../backend/worker.js', import.meta.url), { type: 'module' }),
    )
  }

  /** Resolves once the backend has booted, with its notes and whether it persists. */
  ready() {
    return this._ready
  }

  _receive(data) {
    // An event names the call it belongs to but does not settle it — the same
    // call goes on to answer normally — so it is dispatched and returned from
    // before the pending map is touched.
    if (data?.type === 'event') {
      this._listeners.get(data.id)?.(data.name, data.data)
      return
    }
    if (data?.type === 'ready') {
      this._resolveReady({
        ok: true,
        notes: data.notes ?? [],
        persistent: data.persistent !== false,
      })
      return
    }
    const pending = this._pending.get(data?.id)
    if (!pending) return
    this._pending.delete(data.id)
    this._listeners.delete(data.id)
    pending({
      ok: Boolean(data.ok),
      value: data.value ?? null,
      error: data.error ?? null,
      notes: data.notes ?? [],
    })
  }

  /**
   * A dead worker must not leave callers awaiting forever, and must not leave
   * later calls hanging either — so the cause is remembered and every
   * subsequent call is answered with it immediately.
   */
  _die(message) {
    this._dead = { code: ErrorCode.UNAVAILABLE, message, hint: 'Reload the page.' }
    for (const [, settle] of this._pending) {
      settle({ ok: false, value: null, error: this._dead, notes: [] })
    }
    this._pending.clear()
    this._listeners.clear()
    this._resolveReady({ ok: false, notes: [message], persistent: false })
  }

  /** @returns {Promise<{ok: boolean, value: any, error: object|null, notes: string[]}>} */
  call(method, params = {}, onEvent = null) {
    return this.begin(method, params, onEvent).done
  }

  /**
   * Ask the backend to stop a call that is still running.
   *
   * Fire and forget, deliberately: the call being stopped answers on its own
   * request, with whatever it had produced, and awaiting this one as well would
   * only tell the caller a second time that something it already saw happened.
   */
  stop(id) {
    if (id) this.call(CANCEL, { id })
  }

  /**
   * Start a call and keep hold of its id.
   *
   * `call` is this with the id dropped, which is every use but one. A run that
   * takes minutes has to be stoppable, and the only address a call has is the
   * id generated here — the same id an Event uses to say which call it belongs
   * to.
   *
   * @returns {{id: string, done: Promise<object>}}
   */
  begin(method, params = {}, onEvent = null) {
    const id = `r${++this._seq}`
    if (this._dead) {
      return { id, done: Promise.resolve({ ok: false, value: null, error: this._dead, notes: [] }) }
    }
    // Flat, not inside a `new Promise` executor. `call` promises never to
    // reject, and everything below — the map writes, the Request, the post —
    // ran inside that executor, so anything that threw outside the inner catch
    // rejected the very promise `call` hands back.
    const { promise: done, resolve } = Promise.withResolvers()
    this._pending.set(id, resolve)
    // Registered per call and dropped when it settles, so a listener cannot
    // outlive the thing it was watching.
    if (onEvent) this._listeners.set(id, onEvent)
    try {
      this._worker.postMessage(new Request(id, method, params).toJSON())
    } catch (err) {
      // Params that cannot be structured-cloned fail here, synchronously.
      this._pending.delete(id)
      this._listeners.delete(id)
      resolve({
        ok: false,
        value: null,
        error: {
          code: ErrorCode.BAD_REQUEST,
          message: `could not send ${method}: ${err?.message ?? err}`,
          hint: '',
        },
        notes: [],
      })
    }
    return { id, done }
  }

  terminate() {
    this._worker.terminate()
    this._die('the backend was shut down')
  }
}
