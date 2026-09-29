import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanion } from '../host/companion.js'
import { LocalExecution } from '../src/execution/local.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await sleep(15) } throw new Error('Fixture condition did not become true') }
async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'askk-companion-'))
  const companion = await createCompanion({ root, port: 0, origins: ['https://owner.example'], shell: '/bin/sh', shellArgs: [], ...options })
  const local = new LocalExecution({ url: companion.url, token: companion.token })
  const call = (path, body, extra = {}) => fetch(`${companion.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body ?? {}) })
  try { await run({ root, companion, local, call }) }
  finally { await local.dispose(); await companion.close(); await rm(root, { recursive: true, force: true }) }
}

describe('Bun companion contracts', () => {
  test('omitted grants advertise no authority and refuse every capability without side effects', async () => {
    let upstreamRequests = 0
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { upstreamRequests++; return new Response('must not reach') } })
    try { await fixture(async ({ root, companion, call }) => {
      await writeFile(join(root, 'existing.txt'), 'unchanged')
      expect((await (await fetch(`${companion.url}/health`)).json()).capabilities).toEqual([])
      expect((await (await call('/whoami')).json()).capabilities).toEqual([])
      const url = `${upstream.url.origin}/v1/models`
      const requests = [
        ['/workspace/list', {}], ['/workspace/read', { path: 'existing.txt' }],
        ['/workspace/snapshot', {}], ['/workspace/write', { path: 'created.txt', content: 'no' }],
        ['/workspace/remove', { path: 'existing.txt' }], ['/workspace/rename', { path: 'existing.txt', destination: 'renamed.txt' }],
        ['/jobs/run', { program: '/bin/sh', args: ['-c', 'echo no > executed.txt'] }], ['/jobs/cancel', { id: 'absent' }],
        ['/terminals/open', {}], ['/terminals/close', { id: 'absent' }],
        ['/fetch', { url }], ['/model/fetch', { url }], ['/network/fetch', { url }],
      ]
      for (const [path, body] of requests) {
        const response = await call(path, body)
        expect(response.status).toBe(403)
        expect((await response.json()).code).toBe('capability.unavailable')
      }
      expect(upstreamRequests).toBe(0)
      expect(await readFile(join(root, 'existing.txt'), 'utf8')).toBe('unchanged')
      for (const path of ['created.txt', 'renamed.txt', 'executed.txt']) expect(await stat(join(root, path)).catch(() => null)).toBeNull()
    }, { modelEndpoints: [`${upstream.url.origin}/v1`] }) } finally { upstream.stop(true) }
  })

  test('capability grants reject malformed input and cannot be expanded by mutating the caller array', async () => {
    for (const capabilities of [null, 'exec', {}, ['unknown'], ['exec', 'exec'], [''], [undefined]]) {
      await expect(createCompanion({ port: 0, capabilities })).rejects.toThrow('Capabilities must be an array of unique names')
    }
    const capabilities = []
    await fixture(async ({ call }) => {
      capabilities.push('exec', 'fs', 'fetch')
      expect((await (await call('/whoami')).json()).capabilities).toEqual([])
      expect((await call('/jobs/run', { program: '/bin/echo', args: ['no'] })).status).toBe(403)
    }, { capabilities })
  })

  test('direct CLI refuses to start without explicit grants and explains inference-only setup', async () => {
    const child = Bun.spawn([process.execPath, 'host/companion.js', '--port', '0'], { cwd: new URL('..', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code).not.toBe(0)
    expect(stdout).not.toContain('Pairing token:')
    expect(stderr).toContain('Explicit --capabilities is required')
    expect(stderr).toContain('--capabilities model-relay --model-endpoint BASE')
  })

  test('an explicit child environment is shared by commands and non-login PTYs without inheriting caller variables', async () => {
    const previous = process.env.ASKK_PACKAGE_PARENT_ONLY
    process.env.ASKK_PACKAGE_PARENT_ONLY = 'must-not-inherit'
    try { await fixture(async ({ root, local }) => {
    let output = ''
    const command = await local.startJob({ program: '/bin/sh', args: ['-c', 'printf "%s\\n%s\\n%s" "$PATH" "$ASKK_ENV_FIXTURE" "${ASKK_PACKAGE_PARENT_ONLY-unset}"'], onOutput: event => { if (event.stream === 'stdout') output += event.data } })
    expect(command.code).toBe(0)
    expect(output).toBe('/usr/bin:/bin\nselected-only\nunset')
    const terminal = await local.openTerminal()
    local.terminalInput(terminal.id, 'printf "%s\\n%s\\n%s" "$PATH" "$ASKK_ENV_FIXTURE" "${ASKK_PACKAGE_PARENT_ONLY-unset}" > environment.txt\n')
    await until(async () => await readFile(join(root, 'environment.txt'), 'utf8').catch(() => '') === '/usr/bin:/bin\nselected-only\nunset')
    expect(await readFile(join(root, 'environment.txt'), 'utf8')).toBe('/usr/bin:/bin\nselected-only\nunset')
    await local.closeTerminal(terminal.id)
    }, { capabilities: ['exec', 'terminal'], childEnv: { PATH: '/usr/bin:/bin', ASKK_ENV_FIXTURE: 'selected-only' } }) }
    finally { if (previous === undefined) delete process.env.ASKK_PACKAGE_PARENT_ONLY; else process.env.ASKK_PACKAGE_PARENT_ONLY = previous }
  })

  test('a paired client cannot execute against a replacement runtime identity', async () => fixture(async ({ local, call }) => {
    const health = await local.prepare()
    expect(health.runtimeId).toMatch(/^local-bun:/)
    local.health = { ...health, runtimeId: 'local-bun:replaced-instance' }
    await expect(local.startJob({ program: '/bin/sh', args: ['-c', 'echo must-not-run'] })).rejects.toMatchObject({ status: 409 })
    await expect(local.write({ path: 'must-not-exist.txt', content: 'no', expectedRevision: 0 })).rejects.toMatchObject({ status: 409 })
    expect((await call('/fs/read', { path: 'must-not-exist.txt' })).status).toBe(404)
    local.health = health
    expect((await local.startJob({ program: '/bin/sh', args: ['-c', 'exit 0'] })).code).toBe(0)
  }, { capabilities: ['fs', 'exec'] }))

  test('empty pairing POST, origin checks and streaming model relay match the hub protocol', async () => fixture(async ({ companion, local, call }) => {
    const response = await fetch(`${companion.url}/whoami`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}` } })
    expect((await response.json()).runtime).toBe('bun')
    expect((await local.prepare()).capabilities).toEqual(['fetch'])
    expect((await call('/whoami', {}, { origin: 'https://refused.example' })).status).toBe(403)
    expect((await fetch(`${companion.url}/whoami`, { method: 'POST' })).status).toBe(401)
    const preflight = await fetch(`${companion.url}/fetch`, { method: 'OPTIONS', headers: { origin: 'https://owner.example', 'access-control-request-private-network': 'true' } })
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
    let end
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); end = () => { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close() } } }), { headers: { 'content-type': 'text/event-stream' } }) })
    try {
      const relayed = await call('/fetch', { url: `http://127.0.0.1:${upstream.port}/v1/fixture`, stream: true })
      expect(relayed.headers.get('content-type')).toBe('text/event-stream')
      const reader = relayed.body.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
      end()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: [DONE]\n\n')
      expect((await reader.read()).done).toBe(true)
    } finally { upstream.stop(true) }
  }, { capabilities: ['fetch'] }))

  test('concurrent CAS writes return one conflict, including aliases and explicit create-only null', async () => fixture(async ({ root, local }) => {
    const first = await local.write({ path: 'value.txt', content: 'initial', expectedRevision: null })
    await symlink('value.txt', join(root, 'alias.txt'))
    const results = await Promise.all([
      local.write({ path: 'value.txt', content: 'one', expectedRevision: first.rev }),
      local.write({ path: 'alias.txt', content: 'two', expectedRevision: first.rev }),
    ])
    expect(results.filter(result => result.conflict)).toHaveLength(1)
    const current = await local.read('value.txt')
    expect(results.find(result => result.conflict)).toMatchObject({ rev: current.rev, current: { content: current.content } })
    expect((await local.write({ path: 'value.txt', content: 'overwrite', expectedRevision: null })).conflict).toBe(true)
    await expect(local.remove({ path: 'value.txt', expectedRevision: first.rev })).rejects.toMatchObject({ status: 409, conflict: true })
    expect((await local.read('value.txt')).content).toBe(current.content)
  }, { capabilities: ['fs'] }))

  test('concurrent renames cannot overwrite an existing destination', async () => fixture(async ({ local }) => {
    const a = await local.write({ path: 'a.txt', content: 'a' }); const b = await local.write({ path: 'b.txt', content: 'b' })
    const results = await Promise.allSettled([
      local.rename({ path: 'a.txt', destination: 'shared.txt', expectedRevision: a.rev }),
      local.rename({ path: 'b.txt', destination: 'shared.txt', expectedRevision: b.rev }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason.status).toBe(409)
    expect((await local.list()).map(file => file.path)).toHaveLength(2)
  }, { capabilities: ['fs'] }))

  test('paths and symlinks cannot escape, and oversized writes fail before changing a file', async () => fixture(async ({ root, local }) => {
    const outside = await mkdtemp(join(tmpdir(), 'askk-outside-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'private fixture')
      await symlink(outside, join(root, 'escape'))
      for (const path of ['../outside.txt', 'escape/secret.txt']) await expect(local.read(path)).rejects.toMatchObject({ status: 403 })
      await expect(local.write({ path: 'escape/new.txt', content: 'no' })).rejects.toMatchObject({ status: 403 })
      const original = await local.write({ path: 'safe.txt', content: 'safe' })
      await expect(local.rename({ path: 'safe.txt', destination: 'escape/renamed.txt', expectedRevision: original.rev })).rejects.toMatchObject({ status: 403 })
      await expect(local.write({ path: 'safe.txt', content: 'x'.repeat(8 * 1024 * 1024 + 1), expectedRevision: original.rev })).rejects.toMatchObject({ status: 400 })
      expect((await local.read('safe.txt')).content).toBe('safe')
      expect(await stat(join(outside, 'new.txt')).catch(() => null)).toBeNull()
      await expect(local.startJob({ program: '/bin/pwd', cwd: 'escape' })).rejects.toMatchObject({ status: 403 })
    } finally { await rm(outside, { recursive: true, force: true }) }
  }, { capabilities: ['fs', 'exec'] }))

  test('streaming preserves split UTF-8, stderr, fake prompt markers and the actual exit code', async () => fixture(async ({ local }) => {
    const output = []; const events = []; local.onEvent = event => events.push(event)
    const source = 'const bytes=Buffer.from("🦊 / # __askk_rc0");let i=0;const timer=setInterval(()=>{process.stdout.write(bytes.subarray(i,i+1));if(++i===bytes.length){clearInterval(timer);console.error("warning");process.exitCode=7}},5)'
    const result = await local.startJob({ id: 'unicode', program: process.execPath, args: ['-e', source], onOutput: event => output.push(event) })
    expect(output.filter(event => event.stream === 'stdout').map(event => event.data).join('')).toBe('🦊 / # __askk_rc0')
    expect(output.some(event => event.stream === 'stderr' && event.data.includes('warning'))).toBe(true)
    expect(result).toMatchObject({ code: 7, jobId: 'unicode', cancelled: false })
    expect(events.at(-1).type).toBe('exit')
    expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1))
  }, { capabilities: ['exec'] }))

  test('cancelling kills the process group and a thrown output callback also cancels work', async () => fixture(async ({ root, local }) => {
    let started = false
    const pending = local.startJob({ id: 'group', program: '/bin/sh', args: ['-c', '(sleep 0.7; echo leaked > group-leak.txt) & echo started; wait'], onOutput: () => { started = true } })
    await until(() => started)
    expect((await local.cancelJob('group')).ok).toBe(true)
    expect((await pending).cancelled).toBe(true)
    await expect(local.startJob({ id: 'callback', program: '/bin/sh', args: ['-c', 'echo started; sleep 0.7; echo leaked > callback-leak.txt'], onOutput: () => { throw new Error('renderer disconnected') } })).rejects.toThrow('renderer disconnected')
    await sleep(850)
    expect(await stat(join(root, 'group-leak.txt')).catch(() => null)).toBeNull()
    expect(await stat(join(root, 'callback-leak.txt')).catch(() => null)).toBeNull()
    expect((await local.startJob({ program: '/bin/sh', args: ['-c', 'exit 0'] })).code).toBe(0)
  }, { capabilities: ['exec'] }))

  test('a rejected duplicate command identity never cancels the original command', async () => fixture(async ({ companion, local }) => {
    let started = false
    const pending = local.startJob({ id: 'owned-job', program: '/bin/sh', args: ['-c', 'echo started; sleep 0.15; exit 0'], onOutput: () => { started = true } })
    await until(() => started)
    const other = new LocalExecution({ url: companion.url, token: companion.token })
    await expect(other.startJob({ id: 'owned-job', program: '/bin/sh', args: ['-c', 'exit 3'] })).rejects.toMatchObject({ status: 409 })
    expect(await pending).toMatchObject({ code: 0, cancelled: false })
    await other.dispose()
  }, { capabilities: ['exec'] }))

  test('Bun PTY accepts input, changes dimensions, reports shell exit and closes on dispose', async () => fixture(async ({ root, local }) => {
    const terminal = await local.openTerminal({ cols: 82, rows: 25 }); const events = []
    local.subscribeTerminal(terminal.id, event => events.push(event))
    local.resizeTerminal(terminal.id, 101, 33)
    local.terminalInput(terminal.id, 'stty size > dimensions.txt\nprintf "pty-ready\\n"\n')
    await until(async () => (await readFile(join(root, 'dimensions.txt'), 'utf8').catch(() => '')).trim() === '33 101')
    await until(() => events.some(event => event.type === 'output' && event.data.includes('pty-ready')))
    local.terminalInput(terminal.id, 'exit 4\n')
    await until(() => events.some(event => event.type === 'exit' && event.code === 4))
    await local.closeTerminal(terminal.id)
    expect(local.terminals.size).toBe(0)
    const next = await local.openTerminal(); const socket = local.terminals.get(next.id).socket
    await local.dispose()
    await until(() => socket.readyState === WebSocket.CLOSED)
    expect(local.terminals.size).toBe(0)
  }, { capabilities: ['terminal'] }), 15000)
})

test('binary source snapshots preserve exact bytes and exclude generated output', async () => fixture(async ({ root, local }) => {
  const bytes = Buffer.from([0, 255, 128, 10, 13, 0, 23, 244])
  await local.write({ path: 'public/image.bin', base64: bytes.toString('base64'), expectedRevision: 0 })
  await local.write({ path: 'out/old.html', content: 'generated', expectedRevision: 0 })
  const snapshot = await local.snapshot('')
  expect(snapshot.files.map(file => file.path)).toEqual(['public/image.bin'])
  expect(Buffer.from(snapshot.files[0].base64, 'base64')).toEqual(bytes)
  await expect(local.write({ path: 'invalid.bin', base64: 'a=wrong' })).rejects.toThrow('canonical base64')
}, { capabilities: ['fs'] }))

test('model-only pairing never authorizes guest relay or native commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-model-only-'))
  const companion = await createCompanion({ root, port: 0, capabilities: ['model-relay'] })
  const call = (path, body) => fetch(`${companion.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await call('/network/fetch', { url: 'http://127.0.0.1/', stream: true })).status).toBe(403)
    expect((await call('/jobs/run', { program: '/bin/echo', args: ['no'] })).status).toBe(403)
    expect((await call('/workspace/list', {})).status).toBe(403)
  } finally { await companion.close(); await rm(root, { recursive: true, force: true }) }
})

test('model scope is authenticated, immutable and supports only current provider routes', async () => {
  const received = []
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { received.push({ method: request.method, path: new URL(request.url).pathname, text: await request.text(), auth: request.headers.get('authorization') }); return new Response('data: model-result\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) } })
  const base = `http://127.0.0.1:${upstream.port}/v1`, endpoints = [`${base}/`]
  try { await fixture(async ({ companion, call }) => {
    endpoints.push('https://must-not-be-added.example/v1')
    const descriptor = { version: 1, endpoint: '/model/fetch', endpoints: [base], status: 'configured' }
    expect((await (await call('/whoami')).json()).modelRelay).toEqual(descriptor)
    expect((await (await fetch(`${companion.url}/health`)).json()).modelRelay).toEqual(descriptor)
    for (const [path, method, endpoint] of [['/models', 'GET', '/model/fetch'], ['/chat/completions', 'POST', '/model/fetch'], ['/messages', 'POST', '/fetch']]) {
      const response = await call(endpoint, { url: `${base}${path}`, method, stream: true, headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{"model":"fixture","messages":[]}' } : {}) })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      expect(await response.text()).toBe('data: model-result\n\ndata: [DONE]\n\n')
    }
    expect(received.map(row => [row.method, row.path])).toEqual([['GET', '/v1/models'], ['POST', '/v1/chat/completions'], ['POST', '/v1/messages']])
    expect(received.every(row => row.auth === 'Bearer fixture-only')).toBe(true)
    expect(received[1].text).toBe('{"model":"fixture","messages":[]}')
  }, { capabilities: ['model-relay'], modelEndpoints: endpoints }) } finally { upstream.stop(true) }
})

test('missing model scope fails closed with recovery instructions for new and legacy routes', async () => fixture(async ({ call }) => {
  expect((await (await call('/whoami')).json()).modelRelay).toEqual({ version: 1, endpoint: '/model/fetch', endpoints: [], status: 'scope-required' })
  for (const path of ['/fetch', '/model/fetch']) {
    const response = await call(path, { url: 'http://127.0.0.1:8873/v1/models' })
    expect(response.status).toBe(403)
    const error = await response.json()
    expect(error.code).toBe('relay.model_scope_required')
    expect(error.error).toContain('--model-endpoint')
    expect(error.error).toContain('reconnect')
  }
}, { capabilities: ['model-relay'] }))

test('scoped inference streams incrementally and cancellation reaches its upstream', async () => {
  let second, cancelled = false
  const encoder = new TextEncoder()
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    request.signal.addEventListener('abort', () => { cancelled = true }, { once: true })
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: first\n\n')); second = () => controller.enqueue(encoder.encode('data: second\n\n')) }, cancel() { cancelled = true } }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const base = `http://127.0.0.1:${upstream.port}/v1`
  try { await fixture(async ({ call }) => {
    const response = await call('/model/fetch', { url: `${base}/chat/completions`, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"model":"fixture","messages":[]}', stream: true })
    expect(response.status).toBe(200)
    const reader = response.body.getReader(), decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('data: first\n\n')
    second()
    expect(decoder.decode((await reader.read()).value)).toBe('data: second\n\n')
    await reader.cancel()
    await until(() => cancelled, 2000)
    expect(cancelled).toBe(true)
  }, { capabilities: ['model-relay'], modelEndpoints: [base] }) } finally { upstream.stop(true) }
})

test('model scope refuses destination, method, path and header bypasses before contacting upstream', async () => {
  let requests = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { requests++; return new Response('must not be requested') } })
  const origin = `http://127.0.0.1:${upstream.port}`, base = `${origin}/v1`
  const denied = [
    { url: `${origin}/v10/models` }, { url: `${base}/admin` }, { url: `${base}/models/delete`, method: 'POST' },
    { url: `${base}/models`, method: 'POST' }, { url: `${base}/chat/completions`, method: 'GET' },
    { url: `${base}/models`, method: 'DELETE' }, { url: `${base}/models`, method: 'HEAD' }, { url: `${base}/models`, method: false },
    { url: `${base}/models?method=DELETE` }, { url: `${base}/models#ignored` },
    { url: `${base}/../v1/models` }, { url: `${base}/%2e%2e/v1/models` }, { url: `${base}/%252e%252e/v1/models` },
    { url: `${base}/%6dodels` }, { url: `${base}%2fmodels` }, { url: `${base}/models%3fignored` }, { url: `${base}//models` },
    { url: `${base}\\models` }, { url: `${base}/models;other=admin` },
    { url: `http://fixture:secret@127.0.0.1:${upstream.port}/v1/models` }, { url: `http://localhost:${upstream.port}/v1/models` },
    { url: `${base}/models`, headers: { Host: 'other.example' } },
    { url: `${base}/models`, headers: { 'X-HTTP-Method-Override': 'DELETE' } },
    { url: `${base}/models`, headers: { 'X-Original-URL': '/admin' } },
    { url: `${base}/models`, headers: { 'X-Forwarded-Host': 'other.example' } },
    { url: `${base}/models`, headers: { authorization: 'fixture\r\nX-Method: DELETE' } },
    { url: `${base}/models`, headers: [['authorization', 'fixture']] },
    { url: `${base}/models`, body: '{}' }, { url: `${base}/models`, bodyBase64: 'e30=' },
    { url: `${base}/chat/completions`, method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } },
  ]
  try { await fixture(async ({ call }) => {
    for (const endpoint of ['/model/fetch', '/fetch']) for (const body of denied) {
      const response = await call(endpoint, body)
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('relay.model_scope_denied')
    }
    expect(requests).toBe(0)
  }, { capabilities: ['model-relay'], modelEndpoints: [base] }) } finally { upstream.stop(true) }
})

test('model relay never follows redirects, including another otherwise allowed model route', async () => {
  let externalRequests = 0, modelRequests = 0, location, status = 307
  const outside = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { externalRequests++; return new Response('forbidden target') } })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { modelRequests++; return new Response(null, { status, headers: { location } }) } })
  const base = `http://127.0.0.1:${upstream.port}/v1`
  try { await fixture(async ({ call }) => {
    for (const target of [`http://127.0.0.1:${outside.port}/private`, '/admin', `${base}/chat/completions`]) {
      location = target
      for (const code of [301, 302, 303, 307, 308]) {
        status = code
        const response = await call('/model/fetch', { url: `${base}/models`, stream: true })
        expect(response.status).toBe(502)
        expect((await response.json()).code).toBe('relay.model_redirect')
      }
    }
    expect(modelRequests).toBe(15)
    expect(externalRequests).toBe(0)
  }, { capabilities: ['model-relay'], modelEndpoints: [base] }) } finally { upstream.stop(true); outside.stop(true) }
})

test('generic fetching and guest networking stay independent from scoped model inference', async () => {
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new Response(`${request.method} ${new URL(request.url).pathname}`) })
  const base = `http://127.0.0.1:${upstream.port}/v1`
  try {
    await fixture(async ({ call }) => {
      const general = await call('/fetch', { url: `${base}/admin`, method: 'DELETE' })
      expect((await general.json()).text).toBe('DELETE /v1/admin')
      expect((await call('/model/fetch', { url: `${base}/admin`, method: 'DELETE' })).status).toBe(403)
      expect((await call('/network/fetch', { url: `${base}/models` })).status).toBe(403)
    }, { capabilities: ['model-relay', 'fetch'], modelEndpoints: [base] })
    await fixture(async ({ call }) => {
      expect((await call('/fetch', { url: `${base}/models` })).status).toBe(200)
      expect((await (await call('/model/fetch', { url: `${base}/models` })).json()).code).toBe('relay.model_scope_required')
    }, { capabilities: ['model-relay', 'fetch'] })
    await fixture(async ({ call }) => {
      expect((await call('/fetch', { url: `${base}/models` })).status).toBe(200)
      expect((await (await call('/model/fetch', { url: `${base}/models` })).json()).code).toBe('capability.unavailable')
    }, { capabilities: ['fetch'], modelEndpoints: [base] })
    await fixture(async ({ call }) => {
      expect((await call('/network/fetch', { url: `${base}/unrelated` })).status).toBe(200)
      expect((await call('/fetch', { url: `${base}/models` })).status).toBe(403)
      expect((await call('/model/fetch', { url: `${base}/models` })).status).toBe(403)
    }, { capabilities: ['network-relay'], modelEndpoints: [base] })
  } finally { upstream.stop(true) }
})
