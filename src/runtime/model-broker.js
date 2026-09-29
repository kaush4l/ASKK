import { inference, InferenceError } from '../core/inference.js'

const cancelled = () => new InferenceError('Model request cancelled.', 'aborted')

function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled())
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// Configuration remains on the desk. Only these redacted events cross to a worker.
function redactor(settings, secrets) {
  const hidden = [settings.apiKey, ...Object.entries(settings.headers ?? {}).filter(([key]) => !['accept', 'content-type'].includes(key.toLowerCase())).map(([, value]) => value), ...secrets].filter(value => typeof value === 'string' && value.length)
  const clean = value => {
    if (typeof value === 'string') return hidden.reduce((text, secret) => text.split(secret).join('[redacted]'), value)
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(authorization|api[-_]?key|token|password|secret)$/i.test(key) ? '[redacted]' : clean(item)]))
    return value
  }
  return clean
}

/** Desk-owned model sessions. Callers supply trusted resolved settings, never worker settings. */
export class ModelBroker {
  constructor() {
    this.sessions = new Map()
    this.scripts = new Map()
    this.contexts = new Map()
    this.calibrationKeys = new Map()
  }

  async open({ owner, binding, settings, transport = {}, signal, validate = () => {}, secrets = [], redact = value => value, cacheKey = null }) {
    validate()
    if (signal?.aborted) throw cancelled()
    // The caller's authority generation and original configuration define discovery reuse.
    // Never key on the mutable scripted cursor or a previously discovered context length.
    const contextKey = JSON.stringify([cacheKey, settings])
    let frozen = structuredClone(settings)
    // Scripted providers keep their cursor per worker, including across repair/step sessions.
    if (settings.provider === 'scripted') {
      const key = JSON.stringify(settings)
      const entries = this.scripts.get(owner) ?? new Map()
      this.scripts.set(owner, entries)
      if (!entries.has(key)) entries.set(key, frozen)
      frozen = entries.get(key)
    }
    const controller = new AbortController()
    const handle = crypto.randomUUID()
    const clean = redactor(frozen, secrets)
    const session = { handle, owner, binding, controller, validate, clean: value => redact(clean(value)), stream: null, closed: false }
    const abort = () => this.drop(session)
    signal?.addEventListener('abort', abort, { once: true })
    session.detach = () => signal?.removeEventListener('abort', abort)
    this.sessions.set(handle, session)
    const guarded = { ...transport }
    for (const name of ['fetch', 'bridge', 'run']) {
      if (typeof transport[name] !== 'function') continue
      guarded[name] = (...args) => {
        this.check(session)
        return transport[name](...args)
      }
    }
    session.settings = frozen
    session.transport = guarded
    try {
      session.llm = inference(frozen, guarded)
      const cached = this.contexts.get(owner)
      const contextLength = cached?.has(contextKey) ? cached.get(contextKey) : await abortable(session.llm.context({ signal: controller.signal }), controller.signal)
      this.check(session)
      const contexts = this.contexts.get(owner) ?? new Map()
      contexts.set(contextKey, contextLength)
      this.contexts.set(owner, contexts)
      // Stable across fresh stream handles; opaque so no connection secrets reach workers.
      const identities = this.calibrationKeys.get(owner) ?? new Map()
      if (!identities.has(contextKey)) identities.set(contextKey, crypto.randomUUID())
      this.calibrationKeys.set(owner, identities)
      return { handle, calibrationKey: identities.get(contextKey), model: session.clean(session.llm.model), settings: { provider: frozen.provider ?? 'openai', maxOutputTokens: frozen.maxOutputTokens, ...(frozen.structuredOutput !== undefined ? { structuredOutput: frozen.structuredOutput } : {}) }, contextLength }
    } catch (error) {
      this.drop(session)
      const safe = this.error(session, error)
      throw new InferenceError(safe.message, safe.code, safe.metadata)
    }
  }

  check(session) {
    if (session.closed || session.controller.signal.aborted) throw cancelled()
    session.validate()
  }

  get(handle, { owner, binding } = {}) {
    const session = this.sessions.get(handle)
    if (!session || session.owner !== owner || session.binding !== binding) throw new InferenceError('Model session does not belong to this run.', 'configuration')
    try { this.check(session) } catch (error) { this.drop(session); throw error }
    return session
  }

  error(session, error) {
    return session.clean({ message: String(error?.message ?? error), code: error?.code ?? (error?.name === 'AbortError' ? 'aborted' : 'provider_error'), metadata: error?.metadata ?? null })
  }

  start(handle, { owner, binding, messages, maxOutputTokens, strictCompletion = false, responseSchema, nativeTools }) {
    const session = this.get(handle, { owner, binding })
    if (session.stream && !session.stream.done) throw new InferenceError('A model stream is already active.', 'configuration')
    const controller = new AbortController()
    const stream = { controller, queue: [], done: false, pending: null, waiting: null, reading: false, error: null }
    session.stream = stream
    const llm = inference(session.settings, { ...session.transport, onRetry: (attempt, error) => this.push(stream, { type: 'retry', attempt, error: this.error(session, error) }) })
    stream.iterator = llm.stream(structuredClone(messages), {
      signal: controller.signal,
      maxOutputTokens,
      strictCompletion,
      responseSchema: responseSchema === undefined ? undefined : structuredClone(responseSchema),
      nativeTools: nativeTools === undefined ? undefined : structuredClone(nativeTools),
      onRequest: request => this.push(stream, { type: 'request', request: session.clean(request) }),
      onFinish: metadata => this.push(stream, { type: 'finish', metadata: session.clean(metadata) }),
    })
    return { started: true }
  }

  push(stream, event) {
    if (!stream || stream.controller.signal.aborted || stream.done) return
    stream.queue.push(event)
    stream.waiting?.()
  }

  async next(handle, identity) {
    const session = this.get(handle, identity)
    const stream = session.stream
    if (!stream) throw new InferenceError('No model stream is active.', 'configuration')
    if (stream.reading) throw new InferenceError('Only one model read may be pending.', 'configuration')
    stream.reading = true
    try {
      if (!stream.queue.length && !stream.done) {
        const available = new Promise(resolve => { stream.waiting = resolve })
        if (!stream.pending) {
          stream.pending = abortable(stream.iterator.next(), stream.controller.signal).then(result => {
            if (result.done) stream.done = true
            else this.push(stream, { type: 'delta', delta: session.clean(result.value) })
          }, error => {
            stream.error = this.error(session, error)
            stream.done = true
          }).finally(() => { stream.pending = null; stream.waiting?.() })
        }
        if (!stream.queue.length && !stream.done) await available
      }
      this.check(session)
      return { events: stream.queue.splice(0), done: stream.done, ...(stream.error ? { error: stream.error } : {}) }
    } finally {
      stream.waiting = null
      stream.reading = false
    }
  }

  closeStream(handle, identity) {
    const session = this.get(handle, identity)
    this.stopStream(session)
    return { closed: true }
  }

  stopStream(session) {
    const stream = session.stream
    if (!stream) return
    stream.controller.abort()
    stream.done = true
    stream.error = this.error(session, cancelled())
    stream.queue.length = 0
    stream.waiting?.()
    // Do not wait for a provider that ignores cancellation to release a queued next().
    Promise.resolve(stream.iterator.return?.()).catch(() => {})
  }

  close(handle, identity) {
    const session = this.sessions.get(handle)
    if (!session) return { closed: true }
    if (session.owner !== identity?.owner || session.binding !== identity?.binding) throw new InferenceError('Model session does not belong to this run.', 'configuration')
    this.drop(session)
    return { closed: true }
  }

  drop(session) {
    if (session.closed) return
    session.closed = true
    session.controller.abort()
    this.stopStream(session)
    session.detach?.()
    this.sessions.delete(session.handle)
  }

  closeOwner(owner) {
    for (const session of this.sessions.values()) if (session.owner === owner) this.drop(session)
    this.scripts.delete(owner)
    this.contexts.delete(owner)
    this.calibrationKeys.delete(owner)
  }

  closeAll() {
    for (const session of this.sessions.values()) this.drop(session)
    this.scripts.clear()
    this.contexts.clear()
    this.calibrationKeys.clear()
  }
}
