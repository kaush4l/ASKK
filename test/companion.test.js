import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanion } from '../host/companion.js'
import { LocalExecution } from '../src/execution/local.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await sleep(15) } throw new Error('Fixture condition did not become true') }
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'askk-companion-'))
  const companion = await createCompanion({ root, port: 0, origins: ['https://owner.example'], shell: '/bin/sh', shellArgs: [] })
  const local = new LocalExecution({ url: companion.url, token: companion.token })
  const call = (path, body, extra = {}) => fetch(`${companion.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body ?? {}) })
  try { await run({ root, companion, local, call }) }
  finally { await local.dispose(); await companion.close(); await rm(root, { recursive: true, force: true }) }
}

describe('Bun companion contracts', () => {
  test('a paired client cannot execute against a replacement runtime identity', async () => fixture(async ({ local, call }) => {
    const health = await local.prepare()
    expect(health.runtimeId).toMatch(/^local-bun:/)
    local.health = { ...health, runtimeId: 'local-bun:replaced-instance' }
    await expect(local.startJob({ program: '/bin/sh', args: ['-c', 'echo must-not-run'] })).rejects.toMatchObject({ status: 409 })
    await expect(local.write({ path: 'must-not-exist.txt', content: 'no', expectedRevision: 0 })).rejects.toMatchObject({ status: 409 })
    expect((await call('/fs/read', { path: 'must-not-exist.txt' })).status).toBe(404)
    local.health = health
    expect((await local.startJob({ program: '/bin/sh', args: ['-c', 'exit 0'] })).code).toBe(0)
  }))

  test('empty pairing POST, origin checks and streaming model relay match the hub protocol', async () => fixture(async ({ companion, local, call }) => {
    const response = await fetch(`${companion.url}/whoami`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}` } })
    expect((await response.json()).runtime).toBe('bun')
    expect((await local.prepare()).capabilities).toContain('terminal')
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
  }))

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
  }))

  test('concurrent renames cannot overwrite an existing destination', async () => fixture(async ({ local }) => {
    const a = await local.write({ path: 'a.txt', content: 'a' }); const b = await local.write({ path: 'b.txt', content: 'b' })
    const results = await Promise.allSettled([
      local.rename({ path: 'a.txt', destination: 'shared.txt', expectedRevision: a.rev }),
      local.rename({ path: 'b.txt', destination: 'shared.txt', expectedRevision: b.rev }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason.status).toBe(409)
    expect((await local.list()).map(file => file.path)).toHaveLength(2)
  }))

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
  }))

  test('streaming preserves split UTF-8, stderr, fake prompt markers and the actual exit code', async () => fixture(async ({ local }) => {
    const output = []; const events = []; local.onEvent = event => events.push(event)
    const source = 'const bytes=Buffer.from("🦊 / # __askk_rc0");let i=0;const timer=setInterval(()=>{process.stdout.write(bytes.subarray(i,i+1));if(++i===bytes.length){clearInterval(timer);console.error("warning");process.exitCode=7}},5)'
    const result = await local.startJob({ id: 'unicode', program: process.execPath, args: ['-e', source], onOutput: event => output.push(event) })
    expect(output.filter(event => event.stream === 'stdout').map(event => event.data).join('')).toBe('🦊 / # __askk_rc0')
    expect(output.some(event => event.stream === 'stderr' && event.data.includes('warning'))).toBe(true)
    expect(result).toMatchObject({ code: 7, jobId: 'unicode', cancelled: false })
    expect(events.at(-1).type).toBe('exit')
    expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1))
  }))

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
  }))

  test('a rejected duplicate command identity never cancels the original command', async () => fixture(async ({ companion, local }) => {
    let started = false
    const pending = local.startJob({ id: 'owned-job', program: '/bin/sh', args: ['-c', 'echo started; sleep 0.15; exit 0'], onOutput: () => { started = true } })
    await until(() => started)
    const other = new LocalExecution({ url: companion.url, token: companion.token })
    await expect(other.startJob({ id: 'owned-job', program: '/bin/sh', args: ['-c', 'exit 3'] })).rejects.toMatchObject({ status: 409 })
    expect(await pending).toMatchObject({ code: 0, cancelled: false })
    await other.dispose()
  }))

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
  }), 15000)
})

test('binary source snapshots preserve exact bytes and exclude generated output', async () => fixture(async ({ root, local }) => {
  const bytes = Buffer.from([0, 255, 128, 10, 13, 0, 23, 244])
  await local.write({ path: 'public/image.bin', base64: bytes.toString('base64'), expectedRevision: 0 })
  await local.write({ path: 'out/old.html', content: 'generated', expectedRevision: 0 })
  const snapshot = await local.snapshot('')
  expect(snapshot.files.map(file => file.path)).toEqual(['public/image.bin'])
  expect(Buffer.from(snapshot.files[0].base64, 'base64')).toEqual(bytes)
  await expect(local.write({ path: 'invalid.bin', base64: 'a=wrong' })).rejects.toThrow('canonical base64')
}))

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
