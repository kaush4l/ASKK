/** Node guest supervisor. The mailbox is a 9p directory, never a terminal. */
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value)
const maximumFileBytes = 8 * 1024 * 1024
const tooLarge = () => Object.assign(new Error('File exceeds the 8 MiB workspace transfer limit'), { code: 'FILE_TOO_LARGE' })
async function fileDigest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }

export class GuestSupervisor {
  constructor({ workspace = '/workspace', mailbox = '/harness-control', pollMs = 20, ptyFactory } = {}) {
    this.workspace = path.resolve(workspace)
    this.mailbox = path.resolve(mailbox)
    this.pollMs = pollMs
    this.idlePollMs = pollMs
    this.pollCount = 0
    this.ptyFactory = ptyFactory
    this.jobs = new Map()
    this.terminals = new Map()
    this.terminalClosures = new Map()
    this.sequence = 0
    this.stopped = false
    this.emitQueue = Promise.resolve()
    this.instanceId = randomUUID()
  }

  async start() {
    for (const dir of [this.workspace, this.mailbox, ...['inbox', 'outbox', 'events'].map((p) => path.join(this.mailbox, p))]) await fs.mkdir(dir, { recursive: true })
    await this.atomic(path.join(this.mailbox, 'ready.json'), {
      version: 1, instanceId: this.instanceId, node: process.versions.node,
      platform: process.platform, architecture: process.arch, workspace: this.workspace,
      capabilities: { jobs: true, terminal: true, filesystem: true, packageManager: 'npm' },
    })
    while (!this.stopped) {
      const entries = await fs.readdir(path.join(this.mailbox, 'inbox'))
      this.pollCount++
      const requests = entries.filter((name) => name.endsWith('.json')).sort()
      this.idlePollMs = requests.length ? this.pollMs : Math.min(1000, this.idlePollMs * 2)
      for (const name of requests) {
        const file = path.join(this.mailbox, 'inbox', name)
        let request
        try {
          request = JSON.parse(await fs.readFile(file, 'utf8'))
          await fs.unlink(file)
          if (!plain(request) || request.version !== 1 || !identifier(request.id) || typeof request.method !== 'string' || !plain(request.params ?? {})) throw new Error('Invalid mailbox request')
          // Await admission/short FS work; running commands continue independently.
          const result = await this.dispatch(request.method, request.params ?? {})
          await this.reply(request.id, { ok: true, result })
        } catch (error) {
          if (identifier(request?.id)) await this.reply(request.id, { ok: false, error: { code: error.code ?? 'GUEST_ERROR', message: error.message } })
          else await fs.rename(file, `${file}.invalid`).catch(() => {})
        }
      }
      // 9p operations are emulated guest work. Idle scanning must not compete
      // continuously with child processes; their output callbacks do not wait here.
      await pause(this.idlePollMs)
    }
  }

  async atomic(file, value) {
    const temp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify(value))
    await fs.rename(temp, file)
  }

  reply(id, value) { return this.atomic(path.join(this.mailbox, 'outbox', `${id}.json`), { version: 1, id, ...value }) }

  event(value) {
    const sequence = ++this.sequence
    this.emitQueue = this.emitQueue.then(async () => {
      while (!this.stopped && (await fs.readdir(path.join(this.mailbox, 'events'))).length >= 128) await pause(20)
      await this.atomic(path.join(this.mailbox, 'events', `${String(sequence).padStart(12, '0')}.json`), { version: 1, sequence, instanceId: this.instanceId, ...value })
    })
    return this.emitQueue
  }

  async resolve(relative = '.', { missing = false } = {}) {
    if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw Object.assign(new Error('Path must be relative to the workspace'), { code: 'INVALID_PATH' })
    const result = path.resolve(this.workspace, relative)
    if (result !== this.workspace && !result.startsWith(`${this.workspace}${path.sep}`)) throw Object.assign(new Error('Path escapes the workspace'), { code: 'INVALID_PATH' })
    let probe = result
    for (;;) {
      try {
        const real = await fs.realpath(probe)
        const root = await fs.realpath(this.workspace)
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('Symlink escapes the workspace'), { code: 'INVALID_PATH' })
        return result
      } catch (error) {
        if (!missing || error.code !== 'ENOENT' || probe === this.workspace) throw error
        probe = path.dirname(probe)
      }
    }
  }

  async read(relative) {
    const file = await this.resolve(relative)
    if ((await fs.stat(file)).size > maximumFileBytes) throw tooLarge()
    const bytes = await fs.readFile(file)
    return { path: relative, content: bytes.toString('utf8'), revision: digest(bytes), size: bytes.length }
  }

  async dispatch(method, params) {
    if (this.stopped && method !== 'runtime.shutdown') throw Object.assign(new Error('Guest has shut down'), { code: 'RUNTIME_STOPPED' })
    if (method === 'runtime.metrics') return { cpu: process.cpuUsage(), uptime: process.uptime(), pollCount: this.pollCount, idlePollMs: this.idlePollMs, jobs: [...this.jobs.keys()] }
    if (method === 'fs.list') {
      const rows = []
      const visit = async (prefix = '') => {
        for (const entry of await fs.readdir(await this.resolve(prefix || '.'), { withFileTypes: true })) {
          if (['node_modules', '.next', '.git', '.cache', 'dist', 'out'].includes(entry.name)) continue
          const relative = path.posix.join(prefix, entry.name)
          if (entry.isDirectory()) await visit(relative)
          else if (entry.isFile()) { const file = await this.resolve(relative); const { size } = await fs.stat(file); rows.push({ path: relative, kind: 'file', size, editable: size <= maximumFileBytes, revision: await fileDigest(file) }) }
        }
      }
      await visit(params.path === '.' ? '' : params.path ?? '')
      return rows.sort((a, b) => a.path.localeCompare(b.path))
    }
    if (method === 'fs.read') return this.read(params.path)
    if (method === 'fs.write') {
      const file = await this.resolve(params.path, { missing: true })
      let previous = null
      try { previous = await fileDigest(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const expected = params.expectedRevision === 0 || params.expectedRevision === '0' ? null : params.expectedRevision
      if (expected !== undefined && expected !== previous) throw Object.assign(new Error('File changed since it was read'), { code: 'REVISION_CONFLICT' })
      let bytes
      if (typeof params.base64 === 'string' && params.content === undefined) {
        if (params.base64.length > Math.ceil(maximumFileBytes / 3) * 4) throw tooLarge()
        bytes = Buffer.from(params.base64, 'base64')
        if (bytes.toString('base64') !== params.base64) throw Object.assign(new Error('File base64 must be canonical'), { code: 'INVALID_BASE64' })
      } else if (typeof params.content === 'string' && params.base64 === undefined) bytes = Buffer.from(params.content)
      else throw new Error('Supply exactly one of content or base64')
      if (bytes.length > maximumFileBytes) throw tooLarge()
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      await fs.writeFile(temp, bytes)
      await fs.rename(temp, file)
      const result = { path: params.path, revision: digest(bytes), size: bytes.length, ...(params.content !== undefined ? { content: params.content } : {}) }
      await this.event({ type: 'workspace.changed', path: params.path, revision: result.revision })
      return result
    }
    if (method === 'fs.remove' || method === 'fs.rename') {
      const file = await this.resolve(params.path)
      const revision = await fileDigest(file)
      if (params.expectedRevision != null && params.expectedRevision !== revision) throw Object.assign(new Error('File changed since it was read'), { code: 'REVISION_CONFLICT' })
      if (method === 'fs.remove') await fs.unlink(file)
      else {
        const destination = await this.resolve(params.destination, { missing: true })
        try { await fs.lstat(destination); throw Object.assign(new Error('Rename destination already exists'), { code: 'DESTINATION_EXISTS' }) } catch (error) { if (error.code !== 'ENOENT') throw error }
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.rename(file, destination)
      }
      await this.event({ type: 'workspace.changed', path: params.path, destination: params.destination, operation: method })
      return { ok: true, path: params.destination ?? params.path }
    }
    if (method === 'fs.snapshot') {
      const prefix = params.path && params.path !== '.' ? params.path : ''
      const mime = (name) => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' })[path.extname(name)] ?? 'application/octet-stream'
      const inventory = async () => {
        const rows = []
        const visit = async (relative = '') => {
          for (const entry of await fs.readdir(await this.resolve(path.posix.join(prefix, relative) || '.'), { withFileTypes: true })) {
            if (['node_modules', '.next', '.git', '.cache', 'dist'].includes(entry.name) || (!prefix && entry.name === 'out')) continue
            const child = path.posix.join(relative, entry.name)
            if (entry.isDirectory()) await visit(child)
            else if (entry.isFile()) {
              const file = await this.resolve(path.posix.join(prefix, child))
              const { size } = await fs.stat(file)
              if (size > maximumFileBytes) throw tooLarge()
              rows.push({ path: child, revision: await fileDigest(file), size })
            }
          }
        }
        await visit()
        return rows.sort((a, b) => a.path.localeCompare(b.path))
      }
      const conflict = () => Object.assign(new Error('Workspace changed during snapshot capture'), { code: 'SNAPSHOT_CONFLICT' })
      const before = await inventory()
      const files = []
      try {
        for (const entry of before) {
          const bytes = await fs.readFile(await this.resolve(path.posix.join(prefix, entry.path)))
          if (bytes.length !== entry.size || digest(bytes) !== entry.revision) throw conflict()
          files.push({ ...entry, base64: bytes.toString('base64'), mime: mime(entry.path) })
        }
        if (JSON.stringify(await inventory()) !== JSON.stringify(before)) throw conflict()
      } catch (error) { if (error.code === 'ENOENT') throw conflict(); throw error }
      return { revision: digest(JSON.stringify(files.map(({ path, revision }) => ({ path, revision })))), files }
    }
    if (method === 'job.start') return this.startJob(params)
    if (method === 'job.cancel') return this.cancelJob(params.id)
    if (method === 'terminal.open') return this.openTerminal(params)
    if (method === 'terminal.input') { this.terminal(params.id).write(String(params.data ?? '')); return true }
    if (method === 'terminal.resize') { this.terminal(params.id).resize(this.dimension(params.cols), this.dimension(params.rows)); return true }
    if (method === 'terminal.close') { await this.closeTerminal(params.id); return true }
    if (method === 'runtime.shutdown') { await this.dispose(); return true }
    throw Object.assign(new Error(`Unsupported guest method: ${method}`), { code: 'UNSUPPORTED_METHOD' })
  }

  async startJob({ id, program, args = [], cwd = '.', env = {} }) {
    if (this.stopped) throw Object.assign(new Error('Guest has shut down'), { code: 'RUNTIME_STOPPED' })
    if (!identifier(id) || this.jobs.has(id)) throw new Error('Job id is missing, invalid or already used')
    if (typeof program !== 'string' || !program || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string') || !plain(env)) throw new Error('Invalid job command')
    const directory = await this.resolve(cwd)
    const child = spawn(program, args, { cwd: directory, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const record = { child, cancelled: false, finished: false }
    record.done = new Promise((resolve) => { record.resolveDone = resolve })
    this.jobs.set(id, record)
    const output = (stream) => (chunk) => {
      child.stdout.pause(); child.stderr.pause()
      this.event({ type: 'job.output', jobId: id, stream, data: chunk.toString('base64'), encoding: 'base64' }).finally(() => { child.stdout.resume(); child.stderr.resume() })
    }
    child.stdout.on('data', output('stdout'))
    child.stderr.on('data', output('stderr'))
    child.on('error', (error) => this.event({ type: 'job.error', jobId: id, error: error.message }))
    child.on('close', async (code, signal) => {
      record.finished = true
      await record.killComplete
      await this.event({ type: 'job.exit', jobId: id, code, signal, cancelled: record.cancelled })
      this.jobs.delete(id)
      record.resolveDone()
    })
    await this.event({ type: 'job.started', jobId: id, pid: child.pid ?? null, program, args, cwd })
    return { id, pid: child.pid ?? null }
  }

  cancelJob(id) {
    const record = this.jobs.get(id)
    if (!record || record.finished) return { cancelled: false }
    if (record.cancelled) return { cancelled: true }
    if (!record.child.pid) return { cancelled: false }
    record.cancelled = true
    const kill = (signal) => { try { process.kill(-record.child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
    kill('SIGTERM')
    record.killComplete = new Promise((resolve) => { record.killTimer = setTimeout(() => { kill('SIGKILL'); resolve() }, 1500) })
    return { cancelled: true }
  }

  dimension(value) { if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('Invalid terminal dimension'); return value }
  terminal(id) { const terminal = this.terminals.get(id); if (!terminal) throw new Error('Unknown terminal'); return terminal }
  async openTerminal({ id = randomUUID(), cols = 80, rows = 24, cwd = '.' }) {
    if (!identifier(id) || this.terminals.has(id)) throw new Error('Invalid terminal id')
    const pty = this.ptyFactory ?? createRequire('/opt/harness/supervisor.js')('node-pty')
    const terminal = pty.spawn('/bin/sh', [], { name: 'xterm-256color', cols: this.dimension(cols), rows: this.dimension(rows), cwd: await this.resolve(cwd), env: { ...process.env, TERM: 'xterm-256color' } })
    this.terminals.set(id, terminal)
    let finish
    this.terminalClosures.set(id, new Promise((resolve) => { finish = resolve }))
    terminal.onData((data) => { terminal.pause(); this.event({ type: 'terminal.output', terminalId: id, data }).finally(() => { if (this.terminals.get(id) === terminal) terminal.resume() }) })
    terminal.onExit(async ({ exitCode, signal }) => { this.terminals.delete(id); await this.event({ type: 'terminal.exit', terminalId: id, code: exitCode, signal }); this.terminalClosures.delete(id); finish() })
    return { id, cols, rows }
  }

  async closeTerminal(id) {
    const terminal = this.terminals.get(id)
    if (!terminal) return
    const closed = this.terminalClosures.get(id)
    terminal.kill()
    const timer = setTimeout(() => { if (this.terminals.has(id)) terminal.kill('SIGKILL') }, 1500)
    try { await closed } finally { clearTimeout(timer) }
  }

  async dispose() {
    this.stopped = true
    const jobs = [...this.jobs.values()].map((record) => record.done)
    for (const id of this.jobs.keys()) this.cancelJob(id)
    await Promise.all([...jobs, ...[...this.terminals.keys()].map((id) => this.closeTerminal(id))])
    await this.emitQueue
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const supervisor = new GuestSupervisor({ workspace: process.env.HARNESS_WORKSPACE, mailbox: process.env.HARNESS_MAILBOX })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => supervisor.dispose())
  supervisor.start().catch(async (error) => {
    console.error(error)
    // Structured bootstrap failures use the same private channel as readiness.
    await supervisor.atomic(path.join(supervisor.mailbox, 'failed.json'), { version: 1, code: error.code ?? 'GUEST_BOOT_FAILED', error: error.message }).catch(() => {})
    process.exitCode = 1
  })
}
