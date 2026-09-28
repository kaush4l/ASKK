import { describe, test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { GuestSupervisor } from '../guest/supervisor.js'

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
