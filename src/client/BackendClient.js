import { ErrorCode, Request } from '../protocol/Envelope.js'

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
 */
export class BackendClient {
  constructor(worker) {
    this._worker = worker
    this._pending = new Map()
    this._listeners = new Map()
    this._seq = 0
    this._ready = null
    this._resolveReady = null
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

  /** Resolves once the backend has booted, with its methods and any notes. */
  ready() {
    if (!this._ready) {
      this._ready = new Promise((resolve) => {
        this._resolveReady = resolve
      })
    }
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
      this.ready()
      this._resolveReady?.({
        ok: true,
        methods: data.methods ?? [],
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
    this.ready()
    this._resolveReady?.({ ok: false, methods: [], notes: [message], persistent: false })
  }

  /** @returns {Promise<{ok: boolean, value: any, error: object|null, notes: string[]}>} */
  call(method, params = {}, onEvent = null) {
    if (this._dead) {
      return Promise.resolve({ ok: false, value: null, error: this._dead, notes: [] })
    }
    const id = `r${++this._seq}`
    return new Promise((resolve) => {
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
    })
  }

  terminate() {
    this._worker.terminate()
    this._die('the backend was shut down')
  }
}
