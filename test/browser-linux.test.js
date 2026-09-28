import { describe, test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { GuestSupervisor } from '../guest/supervisor.js'
import { BrowserLinuxExecution } from '../src/execution/browser-linux.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await wait(10) } throw new Error('Test deadline exceeded') }
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'askk-guest-test-'))
  const guest = new GuestSupervisor({ workspace: path.join(root, 'workspace'), mailbox: path.join(root, 'mailbox'), pollMs: 5 })
  const running = guest.start()
  try {
    await until(async () => fs.readFile(path.join(root, 'mailbox/ready.json')).catch(() => false))
    await run(guest, root)
  } finally { await guest.dispose(); await running; await fs.rm(root, { recursive: true, force: true }) }
}
async function events(root) {
  const dir = path.join(root, 'mailbox/events')
  return Promise.all((await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort().map(async (name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))))
}

describe('persistent browser Linux guest protocol', () => {
  test('idle mailbox scanning backs off while queued requests retain order and wake within the cap', async () => fixture(async (guest, root) => {
    await wait(1150)
    const before = guest.pollCount
    await wait(1050)
    expect(guest.pollCount - before).toBeLessThanOrEqual(3)
    const requests = [
      { version: 1, id: 'ordered-001', method: 'fs.write', params: { path: 'ordered.txt', content: 'first', expectedRevision: null } },
      { version: 1, id: 'ordered-002', method: 'fs.read', params: { path: 'ordered.txt' } },
    ]
    const began = Date.now()
    for (const request of requests) await guest.atomic(path.join(root, 'mailbox/inbox', `${request.id}.json`), request)
    const response = await until(async () => {
      try { return JSON.parse(await fs.readFile(path.join(root, 'mailbox/outbox/ordered-002.json'), 'utf8')) } catch { return false }
    }, 2000)
    expect(response).toMatchObject({ ok: true, result: { content: 'first' } })
    expect(Date.now() - began).toBeLessThan(1500)
    expect((await guest.dispatch('runtime.metrics', {})).idlePollMs).toBeLessThan(1000)
  }), 7000)

  test('large Unicode files survive independent operations, conflicts reject, and escaping symlinks fail', async () => fixture(async (guest, root) => {
    const content = '🦊 backtick ` and quotes "\n'.repeat(50000)
    const first = await guest.dispatch('fs.write', { path: 'src/a.js', content, expectedRevision: null })
    expect((await guest.dispatch('fs.read', { path: 'src/a.js' })).content).toBe(content)
    await expect(guest.dispatch('fs.write', { path: 'src/a.js', content: 'lost update', expectedRevision: null })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect((await guest.dispatch('fs.list', {}))[0].revision).toBe(first.revision)
    await fs.symlink(root, path.join(root, 'workspace/escape'))
    await expect(guest.dispatch('fs.read', { path: 'escape/mailbox/ready.json' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
  }), 15000)

  test('real process exit and output are independent of terminal prompts and markers', async () => fixture(async (guest, root) => {
    await guest.dispatch('job.start', { id: 'job-one', program: process.execPath, args: ['-e', 'process.stdout.write("/ # __askk_rc0 🦊");process.stderr.write("bad");process.exit(7)'] })
    const ended = await until(async () => (await events(root)).find((e) => e.type === 'job.exit'))
    expect(ended.code).toBe(7)
    const output = (await events(root)).filter((e) => e.type === 'job.output')
    expect(output.map((e) => Buffer.from(e.data, 'base64').toString()).join('')).toContain('__askk_rc0')
    expect(output.some((e) => e.stream === 'stderr')).toBe(true)
  }))

  test('cancellation terminates a live process group while the workspace remains usable', async () => fixture(async (guest, root) => {
    await guest.dispatch('job.start', { id: 'cancel-me', program: '/bin/sh', args: ['-c', 'sleep 1; echo leaked > leaked.txt'] })
    await wait(60)
    expect(guest.cancelJob('cancel-me').cancelled).toBe(true)
    const ended = await until(async () => (await events(root)).find((e) => e.type === 'job.exit'))
    expect(ended.cancelled).toBe(true)
    await wait(1100)
    expect(await fs.stat(path.join(root, 'workspace/leaked.txt')).catch(() => null)).toBeNull()
    await guest.dispatch('fs.write', { path: 'still-alive.txt', content: 'yes' })
    expect((await guest.read('still-alive.txt')).content).toBe('yes')
  }))

  test('artifact snapshots preserve binary bytes and paths relative to export root', async () => fixture(async (guest, root) => {
    await guest.dispatch('fs.write', { path: 'source.js', content: 'export const value = 42', expectedRevision: 0 })
    const sourcesBefore = await guest.dispatch('fs.list', {})
    await fs.mkdir(path.join(root, 'workspace/out/assets'), { recursive: true })
    const bytes = Buffer.from([0, 255, 17, 0, 128])
    await fs.writeFile(path.join(root, 'workspace/out/assets/image.png'), bytes)
    const snapshot = await guest.dispatch('fs.snapshot', { path: 'out' })
    expect(snapshot.files[0].path).toBe('assets/image.png')
    expect(snapshot.files[0].mime).toBe('image/png')
    expect(Buffer.from(snapshot.files[0].base64, 'base64')).toEqual(bytes)
    expect(snapshot.revision).toHaveLength(64)
    expect(await guest.dispatch('fs.list', {})).toEqual(sourcesBefore)
    await guest.dispatch('fs.rename', { path: 'source.js', destination: 'src/value.js', expectedRevision: sourcesBefore[0].revision })
    await expect(guest.dispatch('fs.remove', { path: 'src/value.js', expectedRevision: 'old' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await guest.dispatch('fs.remove', { path: 'src/value.js', expectedRevision: sourcesBefore[0].revision })
    expect(await guest.dispatch('fs.list', {})).toEqual([])
  }))

  test('shutdown waits for real process exit and its final filesystem writes', async () => fixture(async (guest, root) => {
    await guest.startJob({ id: 'flush-on-stop', program: process.execPath, args: ['-e', 'process.on("SIGTERM",()=>setTimeout(()=>{require("node:fs").writeFileSync("final.txt","flushed");process.exit(0)},100));console.log("ready");setInterval(()=>{},1000)'] })
    await until(async () => (await events(root)).some((event) => event.type === 'job.output'))
    await guest.dispose()
    expect(await fs.readFile(path.join(root, 'workspace/final.txt'), 'utf8')).toBe('flushed')
    expect((await events(root)).find((event) => event.type === 'job.exit')?.cancelled).toBe(true)
    expect(guest.jobs.size).toBe(0)
    await expect(guest.dispatch('fs.write', { path: 'too-late.txt', content: 'lost' })).rejects.toMatchObject({ code: 'RUNTIME_STOPPED' })
  }))

  test('binary workspace transfers preserve bytes and oversized files remain visible but reject snapshots', async () => fixture(async (guest, root) => {
    const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 128, 17])
    const saved = await guest.dispatch('fs.write', { path: 'assets/logo.png', base64: bytes.toString('base64'), expectedRevision: 0 })
    const snapshot = await guest.dispatch('fs.snapshot', {})
    expect(Buffer.from(snapshot.files[0].base64, 'base64')).toEqual(bytes)
    expect(saved.revision).toBe(snapshot.files[0].revision)
    await expect(guest.dispatch('fs.write', { path: 'invalid.bin', base64: 'aGVsbG8', expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_BASE64' })
    await fs.writeFile(path.join(root, 'workspace/large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1))
    const rows = await guest.dispatch('fs.list', {})
    expect(rows.find((row) => row.path === 'large.bin')).toMatchObject({ size: 8 * 1024 * 1024 + 1, editable: false })
    await expect(guest.dispatch('fs.snapshot', {})).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  }))

  test('a command edit during snapshot capture cannot produce a successful mixed snapshot', async () => fixture(async (guest, root) => {
    await guest.dispatch('fs.write', { path: 'a.txt', content: 'before' })
    await guest.dispatch('fs.write', { path: 'b.txt', content: 'stable' })
    const resolve = guest.resolve.bind(guest)
    let visits = 0
    guest.resolve = async (relative, options) => {
      const file = await resolve(relative, options)
      if (relative === 'a.txt' && ++visits === 2) await fs.writeFile(path.join(root, 'workspace/a.txt'), 'after')
      return file
    }
    await expect(guest.dispatch('fs.snapshot', {})).rejects.toMatchObject({ code: 'SNAPSHOT_CONFLICT' })
  }))
})

// A real MessageChannel exercises adapter admission and late receipts without a VM.
async function adapterFixture(run, { acknowledgeBoot = true } = {}) {
  const priorIsolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated')
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true })
  const requests = [], events = []; let guestPort; let created = 0; let removed = 0
  const document = {
    baseURI: 'https://harness.test/ASKK/',
    body: { appendChild(frame) { queueMicrotask(() => frame.onload()) } },
    createElement() {
      created++
      return { setAttribute() {}, remove() { removed++ }, contentWindow: { postMessage(_, __, ports) {
        guestPort = ports[0]
        guestPort.onmessage = ({ data }) => {
          requests.push(data)
          if (acknowledgeBoot && data.method === 'runtime.networkRelay') guestPort.postMessage({ id: data.id, ok: true, result: true })
          if (acknowledgeBoot && data.method === 'runtime.prepare') guestPort.postMessage({ id: data.id, ok: true, result: { workspace: '/workspaces/test', imageId: 'image-one', instanceId: 'boot-one', node: '24.21.0' } })
        }
        guestPort.start()
      } } }
    },
  }
  const adapter = new BrowserLinuxExecution({ projectId: 'test', document, requestTimeout: 25, onEvent: event => events.push(event) })
  const reply = (request, result, error) => guestPort.postMessage({ id: request.id, ok: !error, ...(error ? { error } : { result }) })
  const request = async (method, count = 1) => { await until(() => requests.filter(row => row.method === method).length >= count); return requests.filter(row => row.method === method)[count - 1] }
  try { await run({ adapter, requests, events, reply, request, send: event => guestPort.postMessage({ event }), frames: () => ({ created, removed }) }) }
  finally {
    adapter.release(); guestPort?.close()
    if (priorIsolation) Object.defineProperty(globalThis, 'crossOriginIsolated', priorIsolation)
    else delete globalThis.crossOriginIsolated
  }
}

describe('browser adapter receipt deadlines', () => {
  test('a read deadline retains the guest, blocks admission, and reconciles its late receipt without replay', () => adapterFixture(async ({ adapter, requests, events, reply, request, frames }) => {
    const original = await adapter.prepare()
    const opening = adapter.openTerminal()
    const openRequest = await request('terminal.open'); reply(openRequest, { id: openRequest.params.id })
    await opening
    const read = adapter.request('fs.list', { path: '.', content: 'PRIVATE_CONTENT', token: 'PRIVATE_TOKEN' }).catch(error => error)
    const readRequest = await request('fs.list')
    expect((await read).code).toBe('RPC_TIMEOUT')
    expect(adapter.describeCapabilities()).toMatchObject({ runtimeId: original.runtimeId, bootId: 'boot-one', state: 'ready', ready: false, health: 'unresponsive' })
    expect(adapter.describeCapabilities().unresolvedRequests).toEqual([{ id: readRequest.id, method: 'fs.list', path: '.' }])
    expect(JSON.stringify(events)).not.toContain('PRIVATE_')
    await expect(adapter.prepare()).rejects.toMatchObject({ code: 'RUNTIME_UNRESPONSIVE' })
    await expect(adapter.read('new.txt')).rejects.toMatchObject({ code: 'RUNTIME_UNRESPONSIVE' })
    expect(adapter.terminals.has(openRequest.params.id)).toBe(true)
    expect(frames()).toEqual({ created: 1, removed: 0 })
    reply(readRequest, [{ path: 'late.txt', content: 'PRIVATE_RESPONSE' }])
    await until(() => adapter.health === 'responsive')
    expect((await adapter.prepare()).runtimeId).toBe(original.runtimeId)
    expect(requests.filter(row => row.method === 'fs.list')).toHaveLength(1)
    expect(events.find(row => row.type === 'runtime.reconciled')).toMatchObject({ settled: [{ method: 'fs.list', ok: true, outcome: 'acknowledged' }] })
    expect(JSON.stringify(events)).not.toContain('PRIVATE_RESPONSE')
    expect(frames()).toEqual({ created: 1, removed: 0 })
  }))

  test('late durable writes settle only on receipt and health needs every timed-out operation', () => adapterFixture(async ({ adapter, events, reply, request }) => {
    await adapter.prepare()
    let writeSettled = false
    const write = adapter.write({ path: 'saved.txt', content: 'submitted', expectedRevision: 0 }).then(result => { writeSettled = true; return result })
    const read = adapter.list('.').catch(error => error)
    const writeRequest = await request('fs.write'); const readRequest = await request('fs.list')
    await until(() => adapter.unresolvedRequests().length === 2)
    expect((await read).code).toBe('RPC_TIMEOUT')
    expect(writeSettled).toBe(false)
    expect(events.some(event => event.outcome === 'unknown' && event.request?.method === 'fs.write')).toBe(true)
    reply(writeRequest, { path: 'saved.txt', content: 'submitted', revision: 'durable-revision' })
    expect(await write).toMatchObject({ rev: 'durable-revision', conflict: false })
    expect(adapter.health).toBe('unresponsive')
    expect(events.filter(event => event.type === 'runtime.reconciled')).toHaveLength(0)
    reply(readRequest, undefined, { code: 'EIO', message: 'private response detail' })
    await until(() => adapter.health === 'responsive')
    expect(events.find(event => event.type === 'runtime.reconciled').settled).toMatchObject([
      { method: 'fs.write', ok: true, outcome: 'acknowledged' },
      { method: 'fs.list', ok: false, outcome: 'rejected', code: 'EIO' },
    ])
    expect(JSON.stringify(events)).not.toContain('private response detail')
    expect(adapter.unresolvedRequests()).toEqual([])
  }))

  test('late job admission keeps abort handling, deduplicates cancellation, and awaits the real exit after cancellation failure', () => adapterFixture(async ({ adapter, requests, events, reply, request, send, frames }) => {
    await adapter.prepare()
    const abort = new AbortController(); let completed = false
    const running = adapter.startJob({ id: 'late-job', program: 'node', args: ['secret-argument'], signal: abort.signal }).then(result => { completed = true; return result })
    const start = await request('job.start')
    await until(() => adapter.health === 'unresponsive')
    abort.abort()
    expect(completed).toBe(false)
    expect(adapter.jobs.has('late-job')).toBe(true)
    expect(requests.some(row => row.method === 'job.cancel')).toBe(false)
    reply(start, { id: 'late-job', pid: 7 })
    const cancelRequest = await request('job.cancel')
    const sameCancel = adapter.cancelJob('late-job').catch(error => error)
    expect(requests.filter(row => row.method === 'job.cancel')).toHaveLength(1)
    reply(cancelRequest, null, { code: 'CANCEL_FAILED', message: 'kill could not be delivered' })
    expect((await sameCancel).code).toBe('CANCEL_FAILED')
    await until(() => events.some(event => event.type === 'job.cancelError'))
    expect(adapter.jobs.has('late-job')).toBe(true)
    expect(completed).toBe(false)
    send({ type: 'job.exit', jobId: 'late-job', code: 3, signal: null, cancelled: false })
    expect(await running).toMatchObject({ code: 3, cancelled: false })
    expect(adapter.jobs.size).toBe(0)
    expect(frames()).toEqual({ created: 1, removed: 0 })
    expect(JSON.stringify(events.filter(event => event.type === 'runtime.health'))).not.toContain('secret-argument')
  }))

  test('late PTY admission preserves sessions and permits only bounded recovery controls while unhealthy', () => adapterFixture(async ({ adapter, requests, reply, request }) => {
    await adapter.prepare()
    const firstOpening = adapter.openTerminal()
    const first = await request('terminal.open'); reply(first, { id: first.params.id }); await firstOpening
    let opened = false
    const secondOpening = adapter.openTerminal().then(value => { opened = true; return value })
    const second = await request('terminal.open', 2)
    await until(() => adapter.health === 'unresponsive')
    expect(opened).toBe(false)
    expect(adapter.terminals.size).toBe(2)
    await expect(adapter.terminalInput(first.params.id, 'echo unsafe\n')).rejects.toMatchObject({ code: 'RUNTIME_UNRESPONSIVE' })
    const interrupt = adapter.terminalInput(first.params.id, '\u0003')
    expect(adapter.terminalInput(first.params.id, '\u0003')).toBe(interrupt)
    const interruptRequest = await request('terminal.input'); reply(interruptRequest, true); await interrupt
    const resize = adapter.resizeTerminal(first.params.id, 103, 37)
    expect(adapter.resizeTerminal(first.params.id, 103, 37)).toBe(resize)
    await expect(adapter.resizeTerminal(first.params.id, 120, 40)).rejects.toMatchObject({ code: 'CONTROL_PENDING' })
    const resizeRequest = await request('terminal.resize'); reply(resizeRequest, true); await resize
    expect(adapter.health).toBe('unresponsive')
    reply(second, { id: second.params.id }); expect(await secondOpening).toEqual({ id: second.params.id })
    expect(adapter.health).toBe('responsive')
    expect(adapter.terminals.get(second.params.id).state).toBe('open')
    expect(adapter.terminals.has(first.params.id)).toBe(true)
    expect(requests.filter(row => row.method === 'terminal.open')).toHaveLength(2)
    expect(requests.filter(row => row.method === 'terminal.input')).toHaveLength(1)
  }))

  test('an acknowledged cancellation still waits for exit and does not disturb a sibling job', () => adapterFixture(async ({ adapter, request, reply, send }) => {
    await adapter.prepare()
    let finished = false
    const first = adapter.startJob({ id: 'first', program: 'node' }).then(result => { finished = true; return result })
    const firstStart = await request('job.start'); reply(firstStart, { id: 'first', pid: 1 })
    const sibling = adapter.startJob({ id: 'sibling', program: 'node' })
    const siblingStart = await request('job.start', 2); reply(siblingStart, { id: 'sibling', pid: 2 })
    const listing = adapter.list('.').catch(error => error)
    const listRequest = await request('fs.list'); await listing
    const cancel = adapter.cancelJob('first')
    const cancelRequest = await request('job.cancel'); reply(cancelRequest, { cancelled: true }); await cancel
    expect(finished).toBe(false)
    expect(adapter.jobs.size).toBe(2)
    send({ type: 'job.exit', jobId: 'first', code: null, signal: 'SIGTERM', cancelled: true })
    expect(await first).toMatchObject({ signal: 'SIGTERM', cancelled: true })
    expect(adapter.jobs.has('sibling')).toBe(true)
    expect(adapter.health).toBe('unresponsive')
    reply(listRequest, [])
    await until(() => adapter.health === 'responsive')
    send({ type: 'job.exit', jobId: 'sibling', code: 0, signal: null, cancelled: false })
    expect(await sibling).toMatchObject({ code: 0, cancelled: false })
  }))

  test('final reconciliation updates the descriptor before events and the effectful continuation', () => adapterFixture(async ({ adapter, reply, request }) => {
    await adapter.prepare()
    const order = []
    adapter.subscribe(event => { if (event.type === 'runtime.reconciled' || event.type === 'runtime.health' && event.health === 'responsive') order.push([event.type, adapter.describeCapabilities().ready]) })
    const write = adapter.write({ path: 'ordered.txt', content: 'actual' }).then(() => order.push(['continuation', adapter.describeCapabilities().ready]))
    const writing = await request('fs.write')
    await until(() => adapter.health === 'unresponsive')
    reply(writing, { path: 'ordered.txt', content: 'actual', revision: 'acknowledged' })
    await write
    expect(order).toEqual([['runtime.reconciled', true], ['runtime.health', true], ['continuation', true]])
  }))

  test('unposted cloning errors clean up immediately without unknown outcomes', () => adapterFixture(async ({ adapter, requests }) => {
    await adapter.prepare()
    await expect(adapter.request('fs.write', { path: 'bad.txt', content: () => 'cannot clone' })).rejects.toThrow()
    expect(adapter.pending.size).toBe(0)
    expect(adapter.health).toBe('responsive')
    await wait(35)
    expect(requests.some(row => row.method === 'fs.write')).toBe(false)
    expect(adapter.unresolvedRequests()).toEqual([])
  }))

  test('an actual failure after a deadline permits only an explicit fresh boot', () => adapterFixture(async ({ adapter, send, frames }) => {
    await adapter.prepare()
    await expect(adapter.list('.')).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })
    expect(adapter.health).toBe('unresponsive')
    send({ type: 'runtime.error', error: 'The guest stopped' })
    await until(() => adapter.state === 'failed')
    expect(adapter.describeCapabilities()).toMatchObject({ state: 'failed', health: 'responsive', ready: false, unresolvedRequests: [] })
    expect(frames()).toEqual({ created: 1, removed: 1 })
    await wait(35)
    expect(frames()).toEqual({ created: 1, removed: 1 })
    await adapter.prepare()
    expect(adapter.describeCapabilities()).toMatchObject({ state: 'ready', health: 'responsive', ready: true })
    expect(frames()).toEqual({ created: 2, removed: 1 })
  }))

  test('initial startup remains bounded and explicit disposal reports unknown durability before releasing', async () => {
    await adapterFixture(async ({ adapter, frames }) => {
      await expect(adapter.prepare()).rejects.toMatchObject({ code: 'BOOT_TIMEOUT' })
      expect(adapter.state).toBe('failed')
      expect(frames()).toEqual({ created: 1, removed: 1 })
    }, { acknowledgeBoot: false })
    await adapterFixture(async ({ adapter, events, frames }) => {
      await adapter.prepare()
      const write = adapter.write({ path: 'unknown.txt', content: 'unacknowledged' }).catch(error => error)
      await until(() => adapter.health === 'unresponsive')
      await expect(adapter.dispose({ timeout: 20 })).rejects.toMatchObject({ code: 'PERSISTENCE_UNKNOWN' })
      expect((await write).code).toBe('RUNTIME_DISPOSED')
      expect(adapter.state).toBe('disposed')
      expect(frames()).toEqual({ created: 1, removed: 1 })
      expect(events.some(event => event.type === 'runtime.persistenceError' && event.code === 'PERSISTENCE_UNKNOWN')).toBe(true)
      expect(adapter.pending.size).toBe(0)
      expect(adapter.describeCapabilities()).toMatchObject({ state: 'disposed', health: 'responsive', ready: false })
      await adapter.prepare()
      expect(frames()).toEqual({ created: 2, removed: 1 })
    })
  })
})
