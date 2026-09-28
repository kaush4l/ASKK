/** Browser Linux execution adapter. Trusted runtime frame, one persistent guest per project. */
const uid = () => globalThis.crypto.randomUUID()
const failure = (message, code = 'BROWSER_RUNTIME_ERROR') => Object.assign(new Error(message), { code })
const readOnlyRequests = new Set(['fs.list', 'fs.read', 'fs.snapshot', 'runtime.metrics'])
const summaryText = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1024) : undefined

export class BrowserLinuxExecution {
  constructor({ onEvent, projectId = 'default', assetBase, assetsURL, document: documentOverride, requestTimeout = 60000 } = {}) {
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(projectId)) throw new Error('Invalid browser project id')
    if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) throw new Error('Invalid browser request timeout')
    this.projectId = projectId
    this.runtimeId = `browser-linux:${projectId}`
    this.document = documentOverride ?? globalThis.document
    this.assetBase = assetBase ?? assetsURL
    this.listeners = new Set(onEvent ? [onEvent] : [])
    this.pending = new Map()
    this.jobs = new Map()
    this.terminals = new Map()
    this.controls = new Map()
    this.requestTimeout = requestTimeout
    this.health = 'responsive'
    this.reconciledRequests = []
    this.state = 'idle'
    this.networkRelay = null
  }

  describeCapabilities() {
    return { runtimeId: this.runtimeId, root: this.info?.workspace ?? `/workspaces/${this.projectId}`, imageId: this.info?.imageId ?? null, bootId: this.info?.instanceId ?? null, kind: 'browser-linux', state: this.state, health: this.health, unresolvedRequests: this.unresolvedRequests(), ready: this.state === 'ready' && this.health === 'responsive',
      toolchain: { kind: 'node', version: this.info?.node ?? null, packageManager: 'npm', preparedTemplate: this.info?.preparedTemplate ?? null },
      filesystem: true, shell: true, pty: true, persistentProcesses: true, persistence: 'idbfs',
      capabilities: ['files', 'shell', 'pty', 'node', 'npm', 'static-export', 'browser-network', ...(this.info?.preparedTemplate ? ['prepared-template'] : [])],
      network: this.networkRelay ? 'companion-network-relay' : this.state === 'ready' ? 'browser-fetch-cors' : 'unavailable', preview: ['next-static-export'], requiresCrossOriginIsolation: true }
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(event) { for (const listener of this.listeners) { try { listener({ runtimeId: this.runtimeId, projectId: this.projectId, ...event }) } catch {} } }

  async prepare({ signal } = {}) {
    if (this.health === 'unresponsive') throw failure('Browser Linux is waiting for outstanding guest receipts. The existing guest has been retained.', 'RUNTIME_UNRESPONSIVE')
    if (this.state === 'ready') return this.describeCapabilities()
    if (this.preparing) return this.preparing
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (!this.document || !globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw failure('Browser Linux requires cross-origin isolation. Reload the isolated application to enable this runtime.', 'ISOLATION_REQUIRED')
    this.state = 'preparing'
    this.emit({ type: 'runtime.state', state: this.state })
    this.preparing = this.boot(signal).catch((error) => { if (this.state !== 'disposed') { this.state = 'failed'; this.emit({ type: 'runtime.state', state: 'failed' }); this.emit({ type: 'runtime.error', error: error.message }); this.release(error) } throw error }).finally(() => { this.preparing = null })
    return this.preparing
  }

  async boot(signal) {
    const base = new URL(this.assetBase ?? './browser-linux/', this.document.baseURI)
    const frame = this.document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('aria-hidden', 'true')
    frame.src = new URL('runtime.html', base).href
    this.frame = frame
    const channel = new MessageChannel()
    this.port = channel.port1
    this.port.onmessage = ({ data }) => this.message(data)
    this.port.start()
    let rejectLoading
    const abort = () => { const error = signal.reason ?? new DOMException('Aborted', 'AbortError'); rejectLoading?.(error); this.release(error) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      await new Promise((resolve, reject) => {
        rejectLoading = reject
        const timer = setTimeout(() => reject(failure('Runtime frame did not load', 'BOOT_TIMEOUT')), 30000)
        rejectLoading = (error) => { clearTimeout(timer); reject(error) }
        frame.onload = () => { clearTimeout(timer); resolve() }
        frame.onerror = () => { clearTimeout(timer); reject(failure('Runtime frame failed to load')) }
        this.document.body.appendChild(frame)
      }).finally(() => { rejectLoading = null })
      frame.contentWindow.postMessage({ type: 'askk-browser-linux', projectId: this.projectId, base: base.href }, base.origin, [channel.port2])
      await this.request('runtime.networkRelay', this.networkRelay, this.requestTimeout, { startup: true })
      // Includes the first image download; cancellation still tears the frame down immediately.
      this.info = await this.request('runtime.prepare', {}, 900000, { startup: true })
      this.runtimeId = `browser-linux:${this.projectId}:${this.info.imageId}:${this.info.instanceId}`
      this.state = 'ready'
      this.emit({ type: 'runtime.state', state: 'ready', info: this.info })
      return this.describeCapabilities()
    } finally { signal?.removeEventListener('abort', abort) }
  }

  unresolvedRequests() { return [...this.pending.values()].filter((request) => request.timedOut).map((request) => ({ ...request.summary })) }

  controlKey(method, params) {
    if (['job.cancel', 'terminal.close', 'terminal.resize'].includes(method) || method === 'terminal.input' && params?.data === '\u0003') return `${method}:${params?.id}`
    if (method === 'runtime.shutdown') return method
    return null
  }

  allowedWhileUnresponsive(method, params) {
    if (method === 'runtime.shutdown') return true
    if (method === 'job.cancel') return this.jobs.has(params?.id)
    return this.terminals.has(params?.id) && (['terminal.close', 'terminal.resize'].includes(method) || method === 'terminal.input' && params?.data === '\u0003')
  }

  request(method, params = {}, timeout = this.requestTimeout, { startup = false } = {}) {
    if (!this.port) return Promise.reject(failure('Browser Linux is not prepared', 'RUNTIME_NOT_READY'))
    if (this.health === 'unresponsive' && !this.allowedWhileUnresponsive(method, params)) return Promise.reject(failure('Browser Linux is waiting for outstanding guest receipts; new operations are paused.', 'RUNTIME_UNRESPONSIVE'))
    const controlKey = this.controlKey(method, params)
    const previous = controlKey && this.controls.get(controlKey)
    if (previous) {
      if (method === 'terminal.resize' && (previous.cols !== params.cols || previous.rows !== params.rows)) return Promise.reject(failure('A terminal resize is already awaiting its receipt.', 'CONTROL_PENDING'))
      return previous.promise
    }
    const id = uid()
    const summary = { id, method: summaryText(method), ...(typeof params?.path === 'string' ? { path: summaryText(params.path) } : {}), ...(method.startsWith('job.') && typeof params?.id === 'string' ? { jobId: summaryText(params.id) } : {}), ...(method.startsWith('terminal.') && typeof params?.id === 'string' ? { terminalId: summaryText(params.id) } : {}) }
    const promise = new Promise((resolve, reject) => {
      const pending = { resolve, reject, summary, timedOut: false, posted: false }
      this.pending.set(id, pending)
      try { this.port.postMessage({ id, method, params }); pending.posted = true }
      catch (error) { this.pending.delete(id); reject(error); return }
      pending.timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        // An initial boot has its own explicit finite startup bound. It has no
        // previously admitted workspace session to preserve.
        if (startup) { this.pending.delete(id); reject(failure(`${method} exceeded the startup deadline`, 'BOOT_TIMEOUT')); return }
        pending.timedOut = true
        this.health = 'unresponsive'
        const outcome = readOnlyRequests.has(method) ? 'no-receipt' : 'unknown'
        this.emit({ type: 'runtime.health', health: this.health, code: outcome === 'unknown' ? 'RPC_OUTCOME_UNKNOWN' : 'RPC_TIMEOUT', outcome, request: { ...summary }, unresolvedRequests: this.unresolvedRequests() })
        if (readOnlyRequests.has(method)) reject(failure(`${method} timed out; its late receipt is still being tracked`, 'RPC_TIMEOUT'))
      }, timeout)
    })
    if (controlKey) {
      const control = { promise, cols: params?.cols, rows: params?.rows }
      this.controls.set(controlKey, control)
      const clear = () => { if (this.controls.get(controlKey) === control) this.controls.delete(controlKey) }
      promise.then(clear, clear)
    }
    return promise
  }

  message(data) {
    if (!data || typeof data !== 'object') return
    if (data.id && typeof data.ok === 'boolean' && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id)
      this.pending.delete(data.id); clearTimeout(pending.timer)
      if (pending.timedOut) {
        this.reconciledRequests.push({ ...pending.summary, ok: data.ok, outcome: data.ok ? 'acknowledged' : 'rejected', ...(!data.ok && typeof data.error?.code === 'string' ? { code: summaryText(data.error.code) } : {}) })
        if (!this.unresolvedRequests().length) {
          this.health = 'responsive'
          const settled = this.reconciledRequests.splice(0)
          this.emit({ type: 'runtime.reconciled', health: this.health, settled, unresolvedRequests: [] })
          this.emit({ type: 'runtime.health', health: this.health, unresolvedRequests: [] })
        }
      }
      data.ok ? pending.resolve(data.result) : pending.reject(failure(data.error?.message ?? 'Guest request failed', data.error?.code))
      return
    }
    if (!data.event) return
    const event = data.event
    const job = this.jobs.get(event.jobId)
    if (event.type === 'job.started' && job) job.started = true
    if (event.type === 'job.error' && job) {
      const message = `${event.error}\n`
      job.stderr += message
      try { job.onOutput?.({ stream: 'stderr', data: message, id: event.jobId }) } catch {}
    }
    if (event.type === 'job.output' && job) {
      const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0))
      const stream = event.stream === 'stderr' ? 'stderr' : 'stdout'
      const text = job.decoders[stream].decode(bytes, { stream: true })
      job[stream] += text
      if (job[stream].length > 1000000) { job[stream] = job[stream].slice(-1000000); job.outputTruncated = true }
      try { job.onOutput?.({ stream, data: text, id: event.jobId }) } catch {}
      this.emit({ ...event, data: text, encoding: 'utf8' })
      return
    }
    if (event.type === 'job.exit' && job) {
      this.jobs.delete(event.jobId)
      job.cleanup()
      job.stdout += job.decoders.stdout.decode()
      job.stderr += job.decoders.stderr.decode()
      job.resolve({ id: event.jobId, runtimeId: this.runtimeId, code: event.code, signal: event.signal, cancelled: Boolean(event.cancelled), stdout: job.stdout, stderr: job.stderr, outputTruncated: Boolean(job.outputTruncated) })
    }
    if (event.type === 'runtime.error') { this.state = 'failed'; this.release(failure(event.error)); this.emit({ type: 'runtime.state', state: this.state }) }
    if (event.type === 'terminal.exit') { const terminal = this.terminals.get(event.terminalId); if (terminal) terminal.exited = true }
    this.emit(event.type === 'terminal.output' ? { ...event, type: 'output', kind: 'terminal.output', encoding: 'utf8' } : event)
  }

  async startJob({ id = uid(), program, args = [], cwd = '.', signal, onOutput } = {}) {
    await this.prepare({ signal })
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (this.jobs.has(id)) throw failure('Job id is already active')
    let resolve, reject
    const completed = new Promise((yes, no) => { resolve = yes; reject = no })
    // A crashed frame can reject completion while admission is still pending.
    // Keep that rejection observed until the caller receives the returned job promise.
    completed.catch(() => {})
    let admitted = false, cancellationRequested = false
    const cancel = () => { if (this.jobs.has(id)) this.cancelJob(id).catch((error) => this.emit({ type: 'job.cancelError', jobId: id, code: error.code, error: error.message })) }
    const abort = () => { cancellationRequested = true; if (admitted) cancel() }
    signal?.addEventListener('abort', abort, { once: true })
    this.jobs.set(id, { resolve, reject, onOutput, stdout: '', stderr: '', decoders: { stdout: new TextDecoder(), stderr: new TextDecoder() }, cleanup: () => signal?.removeEventListener('abort', abort) })
    try {
      await this.request('job.start', { id, program, args, cwd })
      admitted = true
      if (cancellationRequested || signal?.aborted) cancel()
    } catch (error) {
      if (this.jobs.get(id)?.started) {
        admitted = true
        this.emit({ type: 'job.admissionError', jobId: id, code: error.code, error: error.message })
        if (cancellationRequested || signal?.aborted) cancel()
      } else { this.jobs.delete(id); signal?.removeEventListener('abort', abort); throw error }
    }
    return completed
  }

  cancelJob(id) { return this.request('job.cancel', { id }) }
  async setNetworkRelay(config) {
    if (config !== null) {
      const url = new URL(config?.url)
      if (url.username || url.password || !config?.token || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw failure('Network relay requires HTTPS or loopback HTTP and an access token', 'INVALID_NETWORK_RELAY')
      config = { url: url.href.replace(/\/$/, ''), token: String(config.token) }
    }
    if (this.port) await this.request('runtime.networkRelay', config)
    this.networkRelay = config
    this.emit({ type: 'runtime.network', network: config ? 'companion-network-relay' : 'browser-fetch-cors' })
  }
  list(path = '.') { return this.request('fs.list', { path }) }
  async read(path) { try { const file = await this.request('fs.read', { path }); return { ...file, rev: file.revision } } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
  async write({ path, content, base64, expectedRevision }) {
    try { const file = await this.request('fs.write', { path, content, base64, expectedRevision }); return { ...file, rev: file.revision, conflict: false } }
    catch (error) { if (error.code !== 'REVISION_CONFLICT') throw error; const current = await this.read(path); return { conflict: true, rev: current?.revision ?? 0, current } }
  }
  remove({ path, expectedRevision }) { return this.request('fs.remove', { path, expectedRevision }) }
  rename({ path, destination, expectedRevision }) { return this.request('fs.rename', { path, destination, expectedRevision }) }
  snapshot(path = '') { return this.request('fs.snapshot', { path }, 120000) }
  async openTerminal({ cols = 80, rows = 24 } = {}) {
    const id = uid(); const terminal = { state: 'opening' }; this.terminals.set(id, terminal)
    try { const result = await this.request('terminal.open', { id, cols, rows }); terminal.state = terminal.exited ? 'exited' : 'open'; return result }
    catch (error) { this.terminals.delete(id); throw error }
  }
  terminalInput(id, data) { return this.request('terminal.input', { id, data }) }
  resizeTerminal(id, cols, rows) { return this.request('terminal.resize', { id, cols, rows }) }
  async closeTerminal(id) { const result = await this.request('terminal.close', { id }); this.terminals.delete(id); return result }
  subscribeTerminal(id, listener) { return this.subscribe((event) => { if (event.terminalId === id) listener(event) }) }

  release(error = failure('Browser Linux was disposed', 'RUNTIME_DISPOSED')) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    for (const job of this.jobs.values()) { job.cleanup(); job.reject(error) }
    this.pending.clear(); this.jobs.clear(); this.terminals.clear(); this.controls.clear(); this.reconciledRequests = []
    this.port?.close(); this.port = null
    this.frame?.remove(); this.frame = null
    // This session has deliberately ended. Its missing receipts must not block
    // a later explicit prepare; lifecycle state still prevents a ready claim.
    this.health = 'responsive'
  }
  async dispose({ timeout = 120000 } = {}) {
    let checkpointError
    if (this.port && this.state === 'ready') {
      let timer
      try { await Promise.race([this.request('runtime.shutdown', {}, timeout), new Promise((_, reject) => { timer = setTimeout(() => reject(failure('Shutdown checkpoint was not acknowledged before disposal; persistence is unknown.', 'PERSISTENCE_UNKNOWN')), timeout) })]) }
      catch (error) { checkpointError = error; this.emit({ type: 'runtime.persistenceError', error: error.message, code: error.code }) }
      finally { clearTimeout(timer) }
    }
    this.release(); this.state = 'disposed'
    this.emit({ type: 'runtime.state', state: this.state })
    if (checkpointError) throw checkpointError
  }
}
