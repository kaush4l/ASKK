/** Browser Linux execution adapter. Trusted runtime frame, one persistent guest per project. */
const uid = () => globalThis.crypto.randomUUID()
const failure = (message, code = 'BROWSER_RUNTIME_ERROR') => Object.assign(new Error(message), { code })

export class BrowserLinuxExecution {
  constructor({ onEvent, projectId = 'default', assetBase, assetsURL, document: documentOverride } = {}) {
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(projectId)) throw new Error('Invalid browser project id')
    this.projectId = projectId
    this.runtimeId = `browser-linux:${projectId}`
    this.document = documentOverride ?? globalThis.document
    this.assetBase = assetBase ?? assetsURL
    this.listeners = new Set(onEvent ? [onEvent] : [])
    this.pending = new Map()
    this.jobs = new Map()
    this.state = 'idle'
    this.networkRelay = null
  }

  describeCapabilities() {
    return { runtimeId: this.runtimeId, root: this.info?.workspace ?? `/workspaces/${this.projectId}`, imageId: this.info?.imageId ?? null, bootId: this.info?.instanceId ?? null, kind: 'browser-linux', state: this.state, ready: this.state === 'ready',
      toolchain: { kind: 'node', version: this.info?.node ?? null, packageManager: 'npm', preparedTemplate: this.info?.preparedTemplate ?? null },
      filesystem: true, shell: true, pty: true, persistentProcesses: true, persistence: 'idbfs',
      capabilities: ['files', 'shell', 'pty', 'node', 'npm', 'static-export', 'browser-network', ...(this.info?.preparedTemplate ? ['prepared-template'] : [])],
      network: this.networkRelay ? 'companion-network-relay' : this.state === 'ready' ? 'browser-fetch-cors' : 'unavailable', preview: ['next-static-export'], requiresCrossOriginIsolation: true }
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(event) { for (const listener of this.listeners) { try { listener({ runtimeId: this.runtimeId, projectId: this.projectId, ...event }) } catch {} } }

  async prepare({ signal } = {}) {
    if (this.state === 'ready') return this.describeCapabilities()
    if (this.preparing) return this.preparing
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (!this.document || !globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw failure('Browser Linux requires cross-origin isolation. Reload the isolated application to enable this runtime.', 'ISOLATION_REQUIRED')
    this.state = 'preparing'
    this.emit({ type: 'runtime.state', state: this.state })
    this.preparing = this.boot(signal).catch((error) => { this.state = 'failed'; this.emit({ type: 'runtime.state', state: 'failed' }); this.emit({ type: 'runtime.error', error: error.message }); this.release(error); throw error }).finally(() => { this.preparing = null })
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
      await this.request('runtime.networkRelay', this.networkRelay)
      // Includes the first image download; cancellation still tears the frame down immediately.
      this.info = await this.request('runtime.prepare', {}, 900000)
      this.runtimeId = `browser-linux:${this.projectId}:${this.info.imageId}:${this.info.instanceId}`
      this.state = 'ready'
      this.emit({ type: 'runtime.state', state: 'ready', info: this.info })
      return this.describeCapabilities()
    } finally { signal?.removeEventListener('abort', abort) }
  }

  request(method, params = {}, timeout = 60000) {
    if (!this.port) return Promise.reject(failure('Browser Linux is not prepared', 'RUNTIME_NOT_READY'))
    const id = uid()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(failure(`${method} timed out`, 'RPC_TIMEOUT')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.port.postMessage({ id, method, params })
    })
  }

  message(data) {
    if (!data || typeof data !== 'object') return
    if (data.id && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id)
      this.pending.delete(data.id); clearTimeout(pending.timer)
      data.ok ? pending.resolve(data.result) : pending.reject(failure(data.error?.message ?? 'Guest request failed', data.error?.code))
      return
    }
    if (!data.event) return
    const event = data.event
    const job = this.jobs.get(event.jobId)
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
    const abort = () => { cancellationRequested = true; if (admitted) this.cancelJob(id).catch(reject) }
    signal?.addEventListener('abort', abort, { once: true })
    this.jobs.set(id, { resolve, reject, onOutput, stdout: '', stderr: '', decoders: { stdout: new TextDecoder(), stderr: new TextDecoder() }, cleanup: () => signal?.removeEventListener('abort', abort) })
    try {
      await this.request('job.start', { id, program, args, cwd })
      admitted = true
      if (cancellationRequested || signal?.aborted) await this.cancelJob(id)
    } catch (error) { this.cancelJob(id).catch(() => {}); this.jobs.delete(id); signal?.removeEventListener('abort', abort); throw error }
    return completed
  }

  cancelJob(id) { return this.request('job.cancel', { id }) }
  async setNetworkRelay(config) {
    if (config !== null) {
      const url = new URL(config?.url)
      if (url.username || url.password || !config?.token || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw failure('Network relay requires HTTPS or loopback HTTP and an access token', 'INVALID_NETWORK_RELAY')
      config = { url: url.href.replace(/\/$/, ''), token: String(config.token) }
    }
    this.networkRelay = config
    if (this.port) await this.request('runtime.networkRelay', config)
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
  openTerminal({ cols = 80, rows = 24 } = {}) { return this.request('terminal.open', { id: uid(), cols, rows }) }
  terminalInput(id, data) { return this.request('terminal.input', { id, data }) }
  resizeTerminal(id, cols, rows) { return this.request('terminal.resize', { id, cols, rows }) }
  closeTerminal(id) { return this.request('terminal.close', { id }) }
  subscribeTerminal(id, listener) { return this.subscribe((event) => { if (event.terminalId === id) listener(event) }) }

  release(error = failure('Browser Linux was disposed', 'RUNTIME_DISPOSED')) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    for (const job of this.jobs.values()) { job.cleanup(); job.reject(error) }
    this.pending.clear(); this.jobs.clear()
    this.port?.close(); this.port = null
    this.frame?.remove(); this.frame = null
  }
  async dispose() {
    let checkpointError
    if (this.port && this.state === 'ready') {
      try { await this.request('runtime.shutdown', {}, 120000) }
      catch (error) { checkpointError = error; this.emit({ type: 'runtime.persistenceError', error: error.message }) }
    }
    this.release(); this.state = 'disposed'
    this.emit({ type: 'runtime.state', state: this.state })
    if (checkpointError) throw checkpointError
  }
}
