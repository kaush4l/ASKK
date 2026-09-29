#!/usr/bin/env bun
/** Local capability provider. The browser, never this server, owns agent decisions. */
import { createHash, randomBytes, timingSafeEqual, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname, join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

const digest = value => createHash('sha256').update(value).digest('hex')
const failure = (message, status = 400, code = 'request.invalid') => Object.assign(new Error(message), { status, code })
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers })
const ignored = new Set(['node_modules', '.git', '.next', '.cache', 'out', 'dist'])
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

export async function createCompanion(options = {}) {
  const root = await realpath(options.root ?? process.cwd())
  const token = options.token ?? randomBytes(32).toString('base64url')
  const origins = new Set(options.origins ?? ['https://kaush4l.github.io', 'http://localhost:5187', 'http://127.0.0.1:5187'])
  const capabilities = options.capabilities ?? ['fs', 'exec', 'terminal', 'fetch', 'model-relay', 'network-relay']
  const childEnv = options.childEnv === undefined ? process.env : { ...options.childEnv }
  const runtimeId = `local-bun:${crypto.randomUUID()}`
  const jobs = new Map(); const terminals = new Map(); const tickets = new Map(); const locks = new Map()
  let closing = false
  async function inside(path = '.') {
    if (typeof path !== 'string' || path.includes('\0')) throw failure('Path must be a string without NUL bytes')
    const wanted = resolve(root, path)
    const escaped = p => { const rel = relative(root, p); return rel === '..' || rel.startsWith('../') || rel.startsWith('/') }
    if (escaped(wanted)) throw failure('Path leaves the project root', 403, 'workspace.path')
    let ancestor = wanted
    for (;;) { try { const actual = await realpath(ancestor); if (escaped(actual)) throw failure('Symlink leaves the project root', 403, 'workspace.path'); return join(actual, relative(ancestor, wanted)) } catch (error) { if (error.status) throw error; if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor) } }
  }
  const serial = async (key, callback) => {
    const before = locks.get(key) ?? Promise.resolve(); let release
    const lock = new Promise(resolve => { release = resolve }); locks.set(key, lock)
    await before
    try { return await callback() } finally { release(); if (locks.get(key) === lock) locks.delete(key) }
  }
  async function read(path) {
    try { const data = await readFile(await inside(path)); if (data.length > 8 * 1024 * 1024) throw failure('File exceeds the 8 MiB editor limit'); return { path, content: data.toString('utf8'), revision: digest(data), rev: digest(data), size: data.length } }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function list(path = '', includeBuild = false) {
    const files = []
    async function walk(dir) {
      for (const entry of await readdir(await inside(dir || '.'), { withFileTypes: true })) {
        if (entry.isSymbolicLink() || (!includeBuild && ignored.has(entry.name))) continue
        const name = dir ? `${dir}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(name)
        else if (entry.isFile()) { const info = await stat(await inside(name)); const revision = info.size <= 64 * 1024 * 1024 ? digest(await readFile(await inside(name))) : `oversized:${info.size}:${info.mtimeMs}`; files.push({ path: name, rev: revision, revision, size: info.size, editable: info.size <= 8 * 1024 * 1024 }) }
        if (files.length > 10000) throw failure('Workspace exceeds the 10,000-file listing limit')
      }
    }
    await walk(path); return files.sort((a, b) => a.path.localeCompare(b.path))
  }
  function requireCapability(capability) { if (!capabilities.includes(capability)) throw failure(`${capability} is disabled on this companion`, 403, 'capability.unavailable') }
  function kill(job) {
    if (job.exited || job.cancelled) return
    job.cancelled = true
    try { process.kill(-job.pid, 'SIGTERM') } catch { try { job.child.kill('SIGTERM') } catch {} }
    const timer = setTimeout(() => { try { process.kill(-job.pid, 'SIGKILL') } catch {} }, 1500); timer.unref?.()
  }
  function command(body, request) {
    requireCapability('exec')
    if (typeof body.program !== 'string' || !Array.isArray(body.args ?? []) || (body.args ?? []).some(arg => typeof arg !== 'string')) throw failure('A command needs a program and string arguments')
    const seconds = Number(body.timeout ?? 600)
    if (!Number.isFinite(seconds) || seconds <= 0) throw failure('Command timeout must be a positive number of seconds')
    return inside(body.cwd ?? '.').then(cwd => {
      const id = String(body.id ?? crypto.randomUUID()); if (jobs.has(id)) throw failure('Command identity is already in use', 409)
      const child = spawn(body.program, body.args ?? [], { cwd, detached: true, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      const job = { id, child, pid: child.pid, exited: false, cancelled: false }; jobs.set(id, job)
      let settle; job.closed = new Promise(resolve => { settle = resolve })
      let sequence = 0; let bytes = 0; let closed = false; let sink
      const encoder = new TextEncoder(); const emit = event => { if (!closed) { try { sink.enqueue(encoder.encode(`${JSON.stringify({ ...event, jobId: id, runtimeId, sequence: ++sequence })}\n`)) } catch { closed = true; kill(job) } } }
      const abort = () => kill(job); request.signal.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => { job.timedOut = true; abort() }, Math.min(seconds, 1800) * 1000)
      const stream = new ReadableStream({ start(controller) {
        sink = controller; emit({ type: 'started', pid: child.pid })
        const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }; let capped = false
        const output = (stream, data) => { bytes += data.length; if (bytes > 16 * 1024 * 1024) { if (!capped) emit({ type: 'output', stream: 'stderr', data: '\nOutput limit reached; command stopped.\n' }); capped = true; kill(job); return } const text = decoders[stream].write(data); if (text) emit({ type: 'output', stream, data: text }) }
        child.stdout.on('data', data => output('stdout', data)); child.stderr.on('data', data => output('stderr', data))
        child.on('error', error => emit({ type: 'output', stream: 'stderr', data: error.message }))
        child.on('close', (code, signal) => { job.exited = true; clearTimeout(timeout); request.signal.removeEventListener('abort', abort); for (const [stream, decoder] of Object.entries(decoders)) { const data = decoder.end(); if (data && !capped) emit({ type: 'output', stream, data }) } emit({ type: 'exit', code: code ?? -1, signal, cancelled: job.cancelled, timedOut: Boolean(job.timedOut) }); if (!closed) { closed = true; controller.close() } jobs.delete(id); settle() })
        if (request.signal.aborted) abort()
      }, cancel() { closed = true; kill(job) } })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
    })
  }
  async function route(request, server) {
    const url = new URL(request.url); const path = url.pathname; const origin = request.headers.get('origin')
    const allowed = !origin || origins.has(origin)
    const headers = { 'cache-control': 'no-store', ...(origin && allowed ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' } : {}) }
    const respond = (data, status = 200) => json(data, status, headers)
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers })
      if (!allowed) throw failure('This page origin is not allowed', 403, 'bridge.origin')
      if (path === '/health') return respond({ name: 'askk-companion', version: '2.0.0', runtimeId, capabilities, root, originAllowed: true })
      if (path === '/terminals/socket') {
        const ticket = tickets.get(url.searchParams.get('ticket')); tickets.delete(url.searchParams.get('ticket'))
        if (!ticket || ticket.expires < Date.now() || ticket.origin !== origin || !terminals.has(ticket.id)) throw failure('Terminal ticket expired or invalid', 401, 'bridge.auth')
        if (server.upgrade(request, { data: { id: ticket.id } })) return
        throw failure('WebSocket upgrade failed')
      }
      const given = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''); const expected = Buffer.from(token)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw failure('Wrong or missing pairing token', 401, 'bridge.auth')
      if (request.method !== 'POST') throw failure('Use POST', 405)
      const rawBody = await request.text()
      let body
      try { body = rawBody ? JSON.parse(rawBody) : {} } catch { throw failure('Invalid JSON body') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('Request body must be a JSON object')
      if (body.runtimeId && body.runtimeId !== runtimeId) throw failure('The execution environment restarted or changed. Reconnect and explicitly bind this workspace before continuing.', 409, 'RUNTIME_CHANGED')
      if (path === '/whoami') return respond({ ok: true, root, runtimeId, capabilities, runtime: 'bun', version: Bun.version })
      if (path === '/jobs/run') { server.timeout(request, 0); const response = await command(body, request); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response }
      if (path === '/jobs/cancel') { requireCapability('exec'); const job = jobs.get(body.id); if (job) kill(job); return respond({ ok: Boolean(job) }) }
      if (path.startsWith('/workspace/')) {
        requireCapability('fs')
        if (path === '/workspace/list') return respond({ files: await list(body.path ?? '') })
        if (path === '/workspace/read') return respond(await read(body.path))
        if (path === '/workspace/snapshot') {
          const files = await list(body.directory ?? '', Boolean(body.directory)); let total = 0; const entries = []
          for (const file of files) { total += file.size; if (total > 64 * 1024 * 1024) throw failure('Snapshot exceeds 64 MiB'); const bytes = await readFile(await inside(file.path)); if (digest(bytes) !== file.rev) throw failure('Files changed while capturing the snapshot; retry after writes finish', 409, 'SNAPSHOT_CONFLICT'); entries.push({ path: body.directory ? relative(body.directory, file.path) : file.path, base64: bytes.toString('base64'), mime: mime[extname(file.path)] ?? 'application/octet-stream', revision: file.rev }) }
          if (JSON.stringify(await list(body.directory ?? '', Boolean(body.directory))) !== JSON.stringify(files)) throw failure('Files changed while capturing the snapshot; retry after writes finish', 409, 'SNAPSHOT_CONFLICT')
          return respond({ files: entries, revision: digest(JSON.stringify(files)) })
        }
        if (!['/workspace/write', '/workspace/remove', '/workspace/rename'].includes(path)) throw failure('Unknown workspace operation', 404)
        if (typeof body.path !== 'string' || !body.path || body.path === '.') throw failure('A file path is required')
        // A rename touches two names; aliases and renames must participate in the same CAS order.
        return await serial('workspace', async () => {
          const current = await read(body.path); const revision = current?.revision ?? 0
          if (body.expectedRevision !== undefined && String(body.expectedRevision ?? 0) !== String(revision)) return respond({ conflict: true, code: 'REVISION_CONFLICT', rev: revision, current }, 409)
          const file = await inside(body.path)
          if (path === '/workspace/write') {
            let bytes
            if (body.base64 !== undefined) {
              if (typeof body.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) throw failure('Binary content must use canonical base64')
              bytes = Buffer.from(body.base64, 'base64')
            } else { if (typeof body.content !== 'string') throw failure('File content must be UTF-8 text'); bytes = Buffer.from(body.content) }
            if (bytes.length > 8 * 1024 * 1024) throw failure('File content exceeds the 8 MiB commit limit')
            await mkdir(dirname(file), { recursive: true }); const temporary = `${file}.askk-${randomBytes(8).toString('hex')}`
            try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, file) } finally { await rm(temporary, { force: true }) }
            // A later filesystem writer must not donate its revision to this save.
            // The receipt describes exactly the bytes this operation committed.
            const committedRevision = digest(bytes)
            return respond({ path: body.path, rev: committedRevision, revision: committedRevision, size: bytes.length, ...(body.content !== undefined ? { content: body.content } : {}) })
          }
          if (path === '/workspace/remove') { await rm(file); return respond({ ok: true }) }
          if (path === '/workspace/rename') { const target = await inside(body.destination); if (await read(body.destination)) throw failure('Destination already exists', 409); await mkdir(dirname(target), { recursive: true }); await rename(file, target); return respond(await read(body.destination)) }
          throw failure('Unknown workspace operation', 404)
        })
      }
      if (path === '/terminals/open') {
        requireCapability('terminal'); const id = crypto.randomUUID(); const backlog = []; let socket = null
        const decoder = new TextDecoder()
        const terminal = { backlog, emit(event) { const data = JSON.stringify(event); backlog.push(data); while (backlog.length > 1000) backlog.shift(); if (socket) socket.send(data) }, attach(ws) { socket = ws; for (const line of backlog) ws.send(line); clearTimeout(terminal.expiry) }, detach() { socket = null; terminal.expiry = setTimeout(() => closeTerminal(id), 10 * 60 * 1000); terminal.expiry.unref?.() }, closeSocket() { socket?.close(1000, 'Terminal closed'); socket = null } }
        const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh'
        terminal.process = Bun.spawn([shell, ...(options.shellArgs ?? ['-l'])], { cwd: root, env: { ...childEnv, TERM: 'xterm-256color' }, terminal: { cols: Math.max(20, Math.min(Number(body.cols) || 80, 400)), rows: Math.max(5, Math.min(Number(body.rows) || 24, 200)), data(_, bytes) { const data = decoder.decode(bytes, { stream: true }); if (data) terminal.emit({ type: 'output', data }) } } })
        terminals.set(id, terminal); terminal.process.exited.then(code => { const data = decoder.decode(); if (data) terminal.emit({ type: 'output', data }); terminal.emit({ type: 'exit', code }); closeTerminal(id, false) })
        terminal.expiry = setTimeout(() => closeTerminal(id), 30000); terminal.expiry.unref?.()
        const ticket = randomBytes(24).toString('base64url'); tickets.set(ticket, { id, expires: Date.now() + 30000, origin })
        return respond({ id, ticket })
      }
      if (path === '/terminals/close') { requireCapability('terminal'); closeTerminal(body.id); return respond({ ok: true }) }
      if (path === '/fetch' || path === '/network/fetch') {
        if (path === '/network/fetch') requireCapability('network-relay')
        else if (!capabilities.includes('fetch')) requireCapability('model-relay')
        const target = new URL(body.url); if (!['https:', 'http:'].includes(target.protocol)) throw failure('Only HTTP(S) model and network endpoints are supported')
        const controller = new AbortController(); const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 600000)
        server.timeout(request, 0)
        try {
          const payload = path === '/network/fetch' && typeof body.bodyBase64 === 'string' ? Buffer.from(body.bodyBase64, 'base64') : body.body ?? undefined
          const upstream = await fetch(target, { method: body.method ?? 'GET', headers: body.headers ?? {}, body: payload, signal: controller.signal })
          if (!body.stream) { const text = await upstream.text(); clearTimeout(timer); request.signal.removeEventListener('abort', abort); return respond({ status: upstream.status, text, type: upstream.headers.get('content-type') }) }
          const reader = upstream.body?.getReader(); const finish = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort) }
          const stream = new ReadableStream({ async pull(sink) { try { if (!reader) { finish(); sink.close(); return } const part = await reader.read(); if (part.done) { finish(); sink.close() } else sink.enqueue(part.value) } catch (error) { finish(); sink.error(error) } }, cancel() { abort(); finish(); return reader?.cancel() } })
          const forwarded = Object.fromEntries(['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'].flatMap(name => upstream.headers.has(name) ? [[name, upstream.headers.get(name)]] : []))
          return new Response([204, 205, 304].includes(upstream.status) || body.method === 'HEAD' ? null : stream, { status: upstream.status, headers: { ...forwarded, ...headers, 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' } })
        } catch (error) { clearTimeout(timer); request.signal.removeEventListener('abort', abort); throw error }
      }
      throw failure('Endpoint not found', 404)
    } catch (error) { return respond({ error: error.message, code: error.code ?? 'companion.error' }, error.status ?? 500) }
  }
  function closeTerminal(id, kill = true) { const terminal = terminals.get(id); if (!terminal) return; terminals.delete(id); clearTimeout(terminal.expiry); for (const [ticket, value] of tickets) if (value.id === id) tickets.delete(ticket); if (kill) terminal.process.kill(); terminal.process.terminal?.close(); terminal.closeSocket(); return terminal.process.exited }
  let tls
  if (options.cert || options.key) {
    if (!options.cert || !options.key) throw new Error('Both --tls-cert and --tls-key are required')
    const cert = await readFile(options.cert); const key = await readFile(options.key); const parsed = new X509Certificate(cert)
    if (Date.parse(parsed.validTo) <= Date.now() || Date.parse(parsed.validFrom) > Date.now()) throw new Error('TLS certificate is expired or not yet valid')
    if (!parsed.checkIP('127.0.0.1')) throw new Error('TLS certificate must include 127.0.0.1 in its subject alternative names')
    if (!parsed.publicKey.equals(createPublicKey(createPrivateKey(key)))) throw new Error('TLS key does not match the certificate')
    tls = { cert, key }
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? 7717, tls, maxRequestBodySize: 16 * 1024 * 1024, fetch: route,
    websocket: { open(ws) { terminals.get(ws.data.id)?.attach(ws) }, message(ws, raw) { const terminal = terminals.get(ws.data.id); if (!terminal) return; try { const event = JSON.parse(String(raw)); if (event.type === 'input') terminal.process.terminal.write(String(event.data).slice(0, 65536)); if (event.type === 'resize') terminal.process.terminal.resize(Math.max(20, Math.min(Number(event.cols) || 80, 400)), Math.max(5, Math.min(Number(event.rows) || 24, 200))) } catch { ws.close(1008, 'Invalid terminal message') } }, close(ws) { terminals.get(ws.data.id)?.detach() } } })
  return { server, token, root, url: `${tls ? 'https' : 'http'}://127.0.0.1:${server.port}`, async close() { if (closing) return; closing = true; const pending = [...jobs.values()].map(job => { kill(job); return job.closed }); for (const id of [...terminals.keys()]) pending.push(closeTerminal(id)); server.stop(true); await Promise.allSettled(pending) } }
}

if (import.meta.main) {
  const args = {}; for (let i = 2; i < process.argv.length; i++) { const name = process.argv[i].replace(/^--/, ''); if (name === 'allow-origin') (args[name] ??= []).push(process.argv[++i]); else args[name] = process.argv[++i] }
  const companion = await createCompanion({ root: args.root, port: Number(args.port ?? 7717), cert: args['tls-cert'], key: args['tls-key'], token: process.env.ASKK_PAIRING_TOKEN, origins: args['allow-origin'], capabilities: args.capabilities?.split(',') })
  console.log(`ASKK companion · ${companion.url}\nProject: ${companion.root}\nPairing token: ${companion.token}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await companion.close(); process.exit(0) })
}
