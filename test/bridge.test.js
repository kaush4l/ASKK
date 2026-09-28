/**
 * The host bridge as a real process: token, origin allowlist, private-network preflight,
 * confinement to the root, exec, files, fetch. Runs against a temporary root.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 17717
const TOKEN = 'test-token-123'
const BASE = `http://127.0.0.1:${PORT}`
let root
let outside
let bridge

const call = (path, body, { token = TOKEN, origin } = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body ?? {}),
  })

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'harness-root-')))
  outside = await mkdtemp(join(tmpdir(), 'harness-outside-'))
  await writeFile(join(outside, 'secret.txt'), 'do not read')
  await symlink(outside, join(root, 'escape'))
  bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', String(PORT), '--token', TOKEN, '--allow-origin', 'https://owner.example', '--cli', 'node'], { stdio: 'pipe' })
  await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
})

afterAll(async () => {
  bridge?.kill()
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('bridge', () => {
  test('health needs no token and hides the root from a refused origin', async () => {
    const open = await (await fetch(`${BASE}/health`)).json()
    expect(open).toMatchObject({ name: 'harness-bridge', capabilities: ['exec', 'fs', 'fetch', 'cli'], originAllowed: true, root, clis: ['node'] })
    const refused = await (await fetch(`${BASE}/health`, { headers: { origin: 'https://evil.example' } })).json()
    expect(refused.originAllowed).toBe(false)
    expect(refused.root).toBeUndefined()
  })

  test('the token is required, and a refused origin is refused before it', async () => {
    expect((await call('/whoami', {}, { token: 'wrong' })).status).toBe(401)
    expect((await call('/whoami', {})).status).toBe(200)
    expect((await call('/whoami', {}, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/whoami', {}, { origin: 'https://owner.example' })).status).toBe(200)
  })

  test('an allowed origin gets CORS and the private-network preflight answer', async () => {
    const response = await fetch(`${BASE}/exec`, {
      method: 'OPTIONS',
      headers: { origin: 'https://owner.example', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://owner.example')
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
  })

  test('exec runs in the root and reports the exit code', async () => {
    const result = await (await call('/exec', { command: 'pwd; echo hi >&2; exit 3' })).json()
    expect(result.code).toBe(3)
    expect(result.stderr.trim()).toBe('hi')
    expect(result.stdout.trim()).toBe(root)
  })

  test('files round-trip under the root; escapes by .. or symlink are refused', async () => {
    expect((await (await call('/fs/write', { path: 'a/b.txt', content: 'hello' })).json()).bytes).toBe(5)
    expect((await (await call('/fs/read', { path: 'a/b.txt' })).json()).content).toBe('hello')
    expect((await (await call('/fs/list', { path: '.' })).json()).entries).toContain('a/')
    expect((await call('/fs/read', { path: '../x' })).status).toBe(403)
    expect((await call('/fs/read', { path: 'escape/secret.txt' })).status).toBe(403)
    expect((await call('/fs/write', { path: 'escape/new.txt', content: 'x' })).status).toBe(403)
    expect((await call('/exec', { command: 'ls', cwd: '../' })).status).toBe(403)
  })

  test('fetch relays from the machine', async () => {
    const result = await (await call('/fetch', { url: `${BASE}/health` })).json()
    expect(result.status).toBe(200)
    expect(result.text).toContain('harness-bridge')
  })

  test('run starts only a listed CLI, with no shell, and streams NDJSON ending in the exit code', async () => {
    const refused = await call('/run', { program: 'sh', args: ['-c', 'echo hi'] })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toContain('--cli sh')
    const script = "process.stdin.on('data', (d) => process.stdout.write('got ' + d)); process.stdin.on('end', () => { console.error('warn'); process.exit(2) })"
    const response = await call('/run', { program: 'node', args: ['-e', script], stdin: 'hello; rm -rf /' })
    expect(response.headers.get('content-type')).toBe('application/x-ndjson')
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(events.filter((event) => event.out).map((event) => event.out).join('')).toBe('got hello; rm -rf /')
    expect(events.some((event) => event.err?.includes('warn'))).toBe(true)
    expect(events.at(-1)).toEqual({ code: 2, timedOut: false })
    expect((await call('/run', { program: 'node', args: 'not a list' })).status).toBe(400)
  })
})
