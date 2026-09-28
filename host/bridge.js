#!/usr/bin/env node
/**
 * The host bridge — the plug-in that lets agents running in a browser tab use this machine.
 *
 *     node host/bridge.js --root ~/work
 *     bun  host/bridge.js --root ~/work --allow-origin https://you.github.io
 *
 * One file, no dependencies, Node 18+ or Bun. It listens on 127.0.0.1 only and prints a pairing
 * token; paste the address and the token into the page's Settings → Bridge once.
 *
 *   GET  /health     name, version, capabilities (root only for an allowed origin). No token.
 *   POST /whoami     200 if the token is right. The page's pairing check.
 *   POST /exec       {command, cwd?, timeout?, stdin?} → {code, stdout, stderr, timedOut}
 *   POST /fs/list    {path} → {entries}             directories end with /
 *   POST /fs/read    {path, start?, lines?} → {content, truncated}
 *   POST /fs/write   {path, content} → {bytes}
 *   POST /fetch      {url, method?, headers?, body?, stream?} → {status, text} or the raw stream
 *   POST /run        {program, args?, stdin?, cwd?, timeout?} → NDJSON lines {out} {err} … {code, timedOut}
 *                    a model CLI (claude, codex, gemini …) run without a shell, streamed as it prints
 *   POST /mcp/NAME   one JSON-RPC message → its response: a stdio MCP server named by --mcp,
 *                    spoken as Streamable HTTP so the page's MCP client reaches it
 *   GET  /app/...    the built page, with --serve dist (for Safari, or fully local use)
 *
 * What this file enforces, whatever the page asks:
 *   - loopback only; never 0.0.0.0
 *   - the token on every call but /health, compared in constant time
 *   - an origin allowlist: localhost origins plus each --allow-origin
 *   - every path resolved with realpath and refused if it leaves the root
 *   - a timeout and an output cap on every command and fetch
 *   - /run starts only programs named by --cli (default: claude codex gemini llm ollama), no shell
 *   - /mcp runs only servers named on this command line (--mcp 'fs=npx -y …'), never the page's
 *   - --no-exec, --no-fs, --no-fetch, --no-cli switch whole capabilities off
 *
 * SECURITY: a paired page can run commands as your user inside the root. Pair only a page you
 * trust, and choose a root that holds nothing you would not let an agent change.
 */

import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'

const VERSION = '1.0.0'
const OUTPUT_CAP = 64 * 1024
const READ_CAP = 256 * 1024
const FETCH_CAP = 512 * 1024

const options = parse(process.argv.slice(2))
if (options.help) {
  console.log('usage: node host/bridge.js [--root DIR] [--port 7717] [--token T] [--allow-origin URL]... [--cli NAME]... [--mcp "NAME=COMMAND ARGS"]... [--serve DIR] [--no-exec] [--no-fs] [--no-fetch] [--no-cli]')
  process.exit(0)
}
const ROOT = await realpath(resolve(expandHome(options.root ?? process.cwd())))
const PORT = Number(options.port ?? 7717)
const TOKEN = options.token ?? randomBytes(18).toString('base64url')
const ORIGINS = (options['allow-origin'] ?? []).map((origin) => origin.replace(/\/+$/, ''))
const SERVE = options.serve ? resolve(options.serve) : null
const CAPABILITIES = ['exec', 'fs', 'fetch', 'cli'].filter((capability) => !options[`no-${capability}`])
const CLIS = options.cli ?? ['claude', 'codex', 'gemini', 'llm', 'ollama']
const MCP = Object.fromEntries(
  (options.mcp ?? []).map((spec) => {
    const cut = spec.indexOf('=')
    if (cut < 1) throw new Error(`--mcp needs NAME=COMMAND, got "${spec}"`)
    return [spec.slice(0, cut).trim(), words(spec.slice(cut + 1))]
  }),
)

/** Split a command line on spaces, keeping 'single' and "double" quoted parts whole. */
function words(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? expandHome(match[3]))
}

function parse(args) {
  const out = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key === 'help' || key.startsWith('no-')) {
      out[key] = true
      continue
    }
    const value = args[index + 1]
    index += 1
    if (key === 'allow-origin' || key === 'cli' || key === 'mcp') (out[key] ??= []).push(value)
    else out[key] = value
  }
  return out
}

function expandHome(path) {
  return path.startsWith('~') ? join(process.env.HOME ?? process.env.USERPROFILE ?? '', path.slice(1)) : path
}

function allowed(origin) {
  if (!origin) return true // no browser is asking: curl, or a same-origin page on /app
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true
  return ORIGINS.includes(origin)
}

function cors(request, response) {
  const origin = request.headers.origin
  if (!origin || !allowed(origin)) return
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('vary', 'origin')
  response.setHeader('access-control-allow-headers', 'authorization, content-type')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-max-age', '600')
  if (request.headers['access-control-request-private-network']) response.setHeader('access-control-allow-private-network', 'true')
}

function send(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}

function authorised(request) {
  const given = Buffer.from(String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw Object.assign(new Error('request body over 8 MB'), { status: 413 })
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

const refused = (path) => Object.assign(new Error(`${path} is outside the root`), { status: 403 })
const escapes = (from) => from === '..' || from.startsWith('../') || from.startsWith('..\\') || isAbsolute(from)

/**
 * A path under the root, or a refusal. The nearest existing ancestor is resolved with realpath,
 * so a symlink inside the root that points outside it is refused too.
 */
async function inside(path = '.') {
  const wanted = resolve(ROOT, String(path))
  if (escapes(relative(ROOT, wanted))) throw refused(path)
  let existing = wanted
  while (true) {
    try {
      const real = await realpath(existing)
      if (escapes(relative(ROOT, real))) throw refused(path)
      return join(real, relative(existing, wanted))
    } catch (error) {
      if (error.status) throw error
      const parent = dirname(existing)
      if (parent === existing) throw refused(path)
      existing = parent
    }
  }
}

function capped(text, cap = OUTPUT_CAP) {
  return text.length > cap ? `${text.slice(0, cap)}\n… (${text.length - cap} more characters cut)` : text
}

async function exec({ command, cwd, timeout = 120, stdin }) {
  if (!command) throw Object.assign(new Error('no command given'), { status: 400 })
  const directory = await inside(cwd ?? '.')
  return new Promise((done, fail) => {
    const [program, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : ['/bin/sh', ['-c', command]]
    const child = spawn(program, args, { cwd: directory, env: process.env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const limit = Math.min(Math.max(Number(timeout) || 120, 1), 600) * 1000
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, limit)
    child.stdout.on('data', (chunk) => (stdout = (stdout + chunk).slice(-OUTPUT_CAP * 2)))
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-OUTPUT_CAP * 2)))
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? -1, stdout: capped(stdout), stderr: capped(stderr), timedOut })
    })
    child.stdin.end(stdin ? String(stdin) : undefined)
  })
}

/**
 * A model CLI as a streaming endpoint. The program must be one --cli names (by its bare name,
 * found on PATH) and it runs without a shell, so arguments are never interpreted. Lines of
 * NDJSON go back as the program prints: {out} for stdout, {err} for stderr, then {code}.
 */
async function run(request, response, { program, args = [], stdin, cwd, timeout = 600 }) {
  if (!program || !CLIS.includes(program)) throw Object.assign(new Error(`"${program}" is not a CLI this bridge runs; start it with --cli ${program || 'NAME'}`), { status: 403 })
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw Object.assign(new Error('args must be a list of strings'), { status: 400 })
  const directory = await inside(cwd ?? '.')
  const child = spawn(program, args, { cwd: directory, env: process.env, shell: false })
  const limit = Math.min(Math.max(Number(timeout) || 600, 1), 1800) * 1000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, limit)
  response.statusCode = 200
  response.setHeader('content-type', 'application/x-ndjson')
  const line = (value) => response.write(`${JSON.stringify(value)}\n`)
  response.on('close', () => child.exitCode == null && child.kill('SIGTERM'))
  child.stdout.on('data', (chunk) => line({ out: String(chunk) }))
  child.stderr.on('data', (chunk) => line({ err: String(chunk).slice(-OUTPUT_CAP) }))
  await new Promise((done) => {
    child.on('error', (error) => {
      line({ error: error.code === 'ENOENT' ? `${program} is not installed or not on PATH` : error.message })
      done()
    })
    child.on('close', (code) => {
      line({ code: code ?? -1, timedOut })
      done()
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin ? String(stdin) : undefined)
  })
  clearTimeout(timer)
  response.end()
}

/**
 * A stdio MCP server, kept running and spoken to as Streamable HTTP. Requests are renumbered
 * so a page that reloads can never collide with ids in flight. A second `initialize` (the page
 * reloaded, the server did not) is answered from the first, since a stdio server takes one.
 */
const servers = new Map()

function stdioServer(name) {
  if (servers.has(name)) return servers.get(name)
  const [program, ...args] = MCP[name]
  const child = spawn(program, args, { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  const server = { child, waiting: new Map(), next: 1, initialized: null, buffer: '', stderr: '' }
  const fail = (why) => {
    for (const { reject } of server.waiting.values()) reject(new Error(why))
    server.waiting.clear()
    servers.delete(name)
  }
  child.stdout.on('data', (chunk) => {
    server.buffer += chunk
    let cut = server.buffer.indexOf('\n')
    while (cut !== -1) {
      const line = server.buffer.slice(0, cut).trim()
      server.buffer = server.buffer.slice(cut + 1)
      cut = server.buffer.indexOf('\n')
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.method && message.id != null) {
        // The server asks the client something (sampling, roots): this bridge offers nothing.
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not offered by the harness bridge' } })}\n`)
        continue
      }
      const waiter = message.id != null ? server.waiting.get(message.id) : null
      if (!waiter) continue
      server.waiting.delete(message.id)
      waiter.resolve({ ...message, id: waiter.id })
    }
  })
  child.stderr.on('data', (chunk) => (server.stderr = (server.stderr + chunk).slice(-2000)))
  child.on('error', (error) => fail(error.code === 'ENOENT' ? `${program} is not installed or not on PATH` : error.message))
  child.on('close', (code) => fail(`MCP server ${name} exited ${code}: ${server.stderr.trim().slice(-300)}`))
  child.stdin.on('error', () => {})
  servers.set(name, server)
  return server
}

async function mcpMessage(name, message) {
  if (!MCP[name]) throw Object.assign(new Error(`no MCP server "${name}" on this bridge; start it with --mcp '${name}=COMMAND'`), { status: 404 })
  const server = stdioServer(name)
  if (message.id == null) {
    if (message.method === 'notifications/initialized' && server.initialized?.notified) return null
    if (message.method === 'notifications/initialized' && server.initialized) server.initialized.notified = true
    server.child.stdin.write(`${JSON.stringify(message)}\n`)
    return null
  }
  if (message.method === 'initialize' && server.initialized) return { jsonrpc: '2.0', id: message.id, result: await server.initialized.result }
  const inner = server.next++
  const reply = new Promise((resolveReply, rejectReply) => {
    server.waiting.set(inner, { id: message.id, resolve: resolveReply, reject: rejectReply })
    setTimeout(() => server.waiting.delete(inner) && rejectReply(new Error(`MCP server ${name} did not answer ${message.method} in 120 s`)), 120000)
  })
  server.child.stdin.write(`${JSON.stringify({ ...message, id: inner })}\n`)
  if (message.method === 'initialize') {
    server.initialized = { result: reply.then((answer) => answer.result) }
    reply.catch(() => (server.initialized = null))
  }
  return reply
}

async function list({ path = '.' }) {
  const entries = await readdir(await inside(path), { withFileTypes: true })
  return { entries: entries.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).sort() }
}

async function readText({ path, start, lines }) {
  const file = await inside(path)
  if ((await stat(file)).isDirectory()) throw Object.assign(new Error(`${path} is a directory`), { status: 400 })
  let content = await readFile(file, 'utf8')
  if (start != null || lines != null) {
    const from = Math.max(Number(start ?? 1), 1) - 1
    content = content
      .split('\n')
      .slice(from, from + Number(lines ?? 200))
      .join('\n')
  }
  return { content: content.slice(0, READ_CAP), truncated: content.length > READ_CAP }
}

async function writeText({ path, content = '' }) {
  if (!path) throw Object.assign(new Error('no path given'), { status: 400 })
  const file = await inside(path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, String(content), 'utf8')
  return { bytes: Buffer.byteLength(String(content)) }
}

async function relay(request, response, { url, method = 'GET', headers = {}, body = null, stream = false }) {
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)) throw Object.assign(new Error('only http and https URLs'), { status: 400 })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), stream ? 600000 : 60000)
  response.on('close', () => controller.abort())
  try {
    const upstream = await fetch(target, { method, headers, body: body ?? undefined, signal: controller.signal, redirect: 'follow' })
    if (!stream) {
      const text = await upstream.text()
      return { status: upstream.status, text: capped(text, FETCH_CAP), type: upstream.headers.get('content-type') ?? '' }
    }
    response.statusCode = upstream.status
    response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream')
    if (!upstream.body) {
      response.end()
      return null
    }
    await new Promise((done, fail) => Readable.fromWeb(upstream.body).on('error', fail).pipe(response).on('finish', done).on('error', fail))
    return null
  } finally {
    clearTimeout(timer)
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

async function serveApp(response, pathname) {
  const inner = decodeURIComponent(pathname.slice('/app'.length)) || '/'
  const file = resolve(SERVE, `.${inner.endsWith('/') ? `${inner}index.html` : inner}`)
  if (escapes(relative(SERVE, file))) return send(response, 403, { error: 'outside the app' })
  try {
    const data = await readFile(file)
    response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    response.setHeader('cache-control', 'no-cache')
    response.end(data)
  } catch {
    send(response, 404, { error: 'not found' })
  }
}

const ROUTES = {
  '/exec': ['exec', exec],
  '/fs/list': ['fs', list],
  '/fs/read': ['fs', readText],
  '/fs/write': ['fs', writeText],
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://127.0.0.1')
  const origin = request.headers.origin
  cors(request, response)
  if (request.method === 'OPTIONS') {
    response.statusCode = allowed(origin) ? 204 : 403
    return response.end()
  }
  if (SERVE && request.method === 'GET' && (pathname === '/app' || pathname.startsWith('/app/'))) return serveApp(response, pathname === '/app' ? '/app/' : pathname)
  if (pathname === '/health' && request.method === 'GET') {
    const open = allowed(origin)
    return send(response, 200, { name: 'harness-bridge', version: VERSION, capabilities: CAPABILITIES, originAllowed: open, ...(open ? { root: ROOT, clis: CLIS, mcp: Object.keys(MCP) } : {}) })
  }
  if (!allowed(origin)) return send(response, 403, { error: `origin ${origin} is not allowed; restart the bridge with --allow-origin ${origin}` })
  if (!authorised(request)) return send(response, 401, { error: 'wrong or missing token' })
  const started = Date.now()
  try {
    if (pathname === '/whoami') return send(response, 200, { ok: true, root: ROOT, capabilities: CAPABILITIES, clis: CLIS })
    if (pathname === '/fetch') {
      if (!CAPABILITIES.includes('fetch')) return send(response, 403, { error: 'fetch is switched off on this bridge' })
      const args = await readBody(request)
      const result = await relay(request, response, args)
      log(pathname, started, args.url)
      if (result) send(response, 200, result)
      return
    }
    if (pathname.startsWith('/mcp/')) {
      const name = decodeURIComponent(pathname.slice(5))
      const message = await readBody(request)
      log('/mcp', started, `${name} ${message.method ?? ''}`)
      const reply = await mcpMessage(name, message)
      if (!reply) {
        response.statusCode = 202
        return response.end()
      }
      response.setHeader('mcp-session-id', name)
      return send(response, 200, reply)
    }
    if (pathname === '/run') {
      if (!CAPABILITIES.includes('cli')) return send(response, 403, { error: 'cli is switched off on this bridge' })
      const args = await readBody(request)
      log(pathname, started, `${args.program} ${[].concat(args.args ?? []).filter((arg) => String(arg).length < 40).join(' ')}`)
      return await run(request, response, args)
    }
    const route = ROUTES[pathname]
    if (!route) return send(response, 404, { error: `no endpoint ${pathname}` })
    const [capability, handler] = route
    if (!CAPABILITIES.includes(capability)) return send(response, 403, { error: `${capability} is switched off on this bridge` })
    const args = await readBody(request)
    const result = await handler(args)
    log(pathname, started, args.command ?? args.path ?? '')
    send(response, 200, result)
  } catch (error) {
    log(pathname, started, `error: ${error.message}`)
    if (!response.headersSent) send(response, error.status ?? 500, { error: error.message })
    else response.end()
  }
})

function log(pathname, started, detail) {
  const shown = String(detail ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  console.log(`${new Date().toISOString().slice(11, 19)}  ${pathname.padEnd(9)} ${String(Date.now() - started).padStart(5)}ms  ${shown}`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const running of servers.values()) running.child.kill()
    process.exit(0)
  })
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`harness bridge ${VERSION}`)
  console.log(`  address  http://127.0.0.1:${PORT}`)
  console.log(`  token    ${TOKEN}`)
  console.log(`  root     ${ROOT}`)
  console.log(`  can      ${CAPABILITIES.join(', ') || 'nothing (every capability is switched off)'}`)
  if (CAPABILITIES.includes('cli')) console.log(`  clis     ${CLIS.join(', ')}`)
  for (const [name, command] of Object.entries(MCP)) console.log(`  mcp      ${name}: ${command.join(' ')}`)
  console.log(`  origins  localhost${ORIGINS.length ? `, ${ORIGINS.join(', ')}` : ' only (add --allow-origin https://your.site for a hosted page)'}`)
  if (SERVE) console.log(`  app      http://127.0.0.1:${PORT}/app/`)
  console.log('A paired page can run commands as you inside the root. Pair only a page you trust.')
})
