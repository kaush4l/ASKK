/** Authenticated client for the owner's optional Bun companion. */
export class LocalExecution {
  constructor({ url = 'https://127.0.0.1:7717', token = '', onEvent = () => {} } = {}) {
    this.url = url.replace(/\/$/, ''); this.token = token; this.onEvent = onEvent; this.terminals = new Map(); this.jobs = new Map()
  }
  async request(path, body, { signal } = {}) {
    const response = await fetch(`${this.url}${path}`, { method: 'POST', credentials: 'omit', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...(body ?? {}), ...(this.health?.runtimeId ? { runtimeId: this.health.runtimeId } : {}) }), signal })
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw Object.assign(new Error(data.error ?? `Companion answered ${response.status}`), { ...data, code: data.code, status: response.status }) }
    return response
  }
  async prepare() { const health = await (await this.request('/whoami')).json(); this.health = health; return health }
  describeCapabilities() { return { runtimeId: this.health?.runtimeId ?? 'local:unpaired', root: this.health?.root, toolchain: { kind: 'bun', version: this.health?.version }, capabilities: this.health?.capabilities ?? [] } }
  async list(path = '') { return (await (await this.request('/workspace/list', { path })).json()).files }
  async read(path) { return (await this.request('/workspace/read', { path })).json() }
  async write(args) {
    try { return await (await this.request('/workspace/write', args)).json() }
    catch (error) { if (error.status === 409 && error.conflict) return { conflict: true, rev: error.rev, current: error.current }; throw error }
  }
  async rename(args) { return (await this.request('/workspace/rename', args)).json() }
  async remove(args) { return (await this.request('/workspace/remove', args)).json() }
  async snapshot(directory = '') { return (await this.request('/workspace/snapshot', { directory })).json() }
  async startJob({ id = crypto.randomUUID(), program, args = [], cwd = '.', timeout, signal, onOutput = () => {} }) {
    if (this.jobs.has(id)) throw new Error('Command identity is already in use')
    const abort = new AbortController(); this.jobs.set(id, abort)
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
    let reader; let accepted = false
    try {
      const response = await this.request('/jobs/run', { id, program, args, cwd, timeout }, { signal: combined })
      accepted = true
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result
      const accept = line => { if (!line.trim()) return; const event = JSON.parse(line); if (event.jobId !== id) throw new Error('Command receipt has the wrong identity'); this.onEvent(event); if (event.type === 'output') onOutput(event); if (event.type === 'exit') { if (!Number.isInteger(event.code)) throw new Error('Command exit receipt has no exit code'); result = event } }
      while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let cut; while ((cut = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1) } }
      buffer += decoder.decode(); if (buffer) accept(buffer)
      if (!result) throw new Error('Command stream ended without an exit receipt')
      return result
    } catch (error) {
      abort.abort(); await reader?.cancel().catch(() => {}); if (accepted) await this.cancelJob(id).catch(() => {}); throw error
    } finally { reader?.releaseLock(); this.jobs.delete(id) }
  }
  async cancelJob(id) { return (await this.request('/jobs/cancel', { id })).json() }
  async openTerminal({ cols = 80, rows = 24 } = {}) {
    const { id, ticket } = await (await this.request('/terminals/open', { cols, rows })).json()
    const address = new URL(`${this.url}/terminals/socket`); address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'; address.searchParams.set('ticket', ticket)
    const socket = new WebSocket(address); const listeners = new Set(); const session = { socket, listeners, backlog: [] }; this.terminals.set(id, session)
    socket.onmessage = event => { const message = JSON.parse(event.data); session.backlog.push(message); if (session.backlog.length > 200) session.backlog.shift(); for (const listener of listeners) listener(message) }
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The terminal connection timed out')), 10000)
        const fail = () => { clearTimeout(timer); reject(new Error('The terminal connection could not be established')) }
        socket.onopen = () => { clearTimeout(timer); resolve() }; socket.onerror = fail; socket.onclose = fail
      })
    } catch (error) { socket.close(); this.terminals.delete(id); await this.request('/terminals/close', { id }).catch(() => {}); throw error }
    return { id }
  }
  subscribeTerminal(id, listener) { const session = this.terminals.get(id); if (!session) throw new Error('Terminal is not open'); for (const event of session.backlog) listener(event); session.listeners.add(listener); return () => session.listeners.delete(listener) }
  terminalInput(id, data) { this.terminals.get(id)?.socket.send(JSON.stringify({ type: 'input', data })) }
  resizeTerminal(id, cols, rows) { this.terminals.get(id)?.socket.send(JSON.stringify({ type: 'resize', cols, rows })) }
  async closeTerminal(id) { this.terminals.get(id)?.socket.close(); this.terminals.delete(id); await this.request('/terminals/close', { id }) }
  async dispose() { const work = []; for (const [id, abort] of this.jobs) { abort.abort(); work.push(this.cancelJob(id)) } for (const id of [...this.terminals.keys()]) work.push(this.closeTerminal(id)); await Promise.allSettled(work) }
}
