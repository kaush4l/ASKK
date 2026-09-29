import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanion } from '../host/companion.js'
import { cleanupProcessGroup } from '../host/process-group.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  const deadline = Date.now() + 3000
  while (!await check()) { if (Date.now() > deadline) throw new Error('Fixture did not become ready'); await sleep(10) }
}
const records = response => response.text().then(value => value.trim().split('\n').filter(Boolean).map(JSON.parse))
async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'askk-group-'))
  const companion = await createCompanion({ root, port: 0, capabilities: ['exec'] })
  const call = (path, body) => fetch(`${companion.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try { await work({ root, companion, call }) } finally { await companion.close(); await rm(root, { recursive: true, force: true }) }
}

test('group cleanup escalates once and does not mistake a live or unreadable group for success', async () => {
  let time = 0; const calls = []
  const options = { signal: (pid, name) => calls.push([pid, name]), inspectStopped: async () => false, termGraceMs: 5, killGraceMs: 5, pollMs: 5, now: () => time, sleep: async ms => { time += ms } }
  expect(await cleanupProcessGroup(123, options)).toMatchObject({ ok: false, scope: 'original-process-group' })
  expect(calls.filter(([, name]) => name !== 0)).toEqual([[-123, 'SIGTERM'], [-123, 'SIGKILL']])
  const denied = { ...options, signal() { throw Object.assign(new Error('denied'), { code: 'EPERM' }) } }
  expect(await cleanupProcessGroup(123, denied)).toMatchObject({ ok: false })
  expect(await cleanupProcessGroup(123, { ...denied, inspectStopped() { throw new Error('inspection failed') } })).toMatchObject({ ok: false, error: expect.stringContaining('inspection failed') })
  expect(await cleanupProcessGroup(undefined, options)).toMatchObject({ ok: false })
  expect(await cleanupProcessGroup(123, { ...denied, inspectStopped: async () => true })).toMatchObject({ ok: true, verification: 'no-live-members' })
})

for (const cancel of [false, true]) test(`${cancel ? 'cancellation acknowledgment' : 'normal leader exit'} waits for a TERM-ignoring descendant with closed stdio`, async () => fixture(async ({ root, call }) => {
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync('descendant',String(process.pid));setInterval(()=>{},1000)`
  const leader = `const fs=require('node:fs');const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});c.unref();const ready=setInterval(()=>{if(fs.existsSync('descendant')){clearInterval(ready);${cancel ? "fs.writeFileSync('ready','yes');setInterval(()=>{},1000)" : 'process.exit(7)'}}},5)`
  let pid
  try {
    const response = await call('/jobs/run', { id: 'group', program: process.execPath, args: ['-e', leader] })
    const outcome = records(response)
    await until(async () => { pid = Number(await readFile(join(root, 'descendant'), 'utf8').catch(() => '')); return pid > 1 })
    if (cancel) {
      await until(async () => await readFile(join(root, 'ready'), 'utf8').catch(() => '') === 'yes')
      const acknowledgement = await call('/jobs/cancel', { id: 'group' })
      expect(acknowledgement.status).toBe(200)
      expect(await acknowledgement.json()).toEqual({ ok: true })
      expect(() => process.kill(pid, 0)).toThrow()
    }
    const events = await outcome
    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'exit', cancelled: cancel, cleanup: { ok: true, scope: 'original-process-group' } })
    if (!cancel) expect(events.at(-1).code).toBe(7)
    expect(() => process.kill(pid, 0)).toThrow()
  } finally { if (pid) { try { process.kill(pid, 'SIGKILL') } catch {} } }
}), 10000)

test('spawn failure never signals an unknown group and still reports nonzero exit', async () => fixture(async ({ call }) => {
  const events = await records(await call('/jobs/run', { id: 'missing', program: '/askk-fixture-program-does-not-exist', args: [] }))
  expect(events.at(-1)).toMatchObject({ type: 'exit', cleanup: { ok: true, notStarted: true } })
  expect(events.at(-1).code).not.toBe(0)
  expect((await call('/jobs/cancel', { id: 'missing' })).status).toBe(200)
}))

test('unknown group cleanup has no exit receipt, rejects cancellation and retains shutdown rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-group-failure-'))
  const companion = await createCompanion({ root, port: 0, capabilities: ['exec'] })
  const call = (path, body) => fetch(`${companion.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}` }, body: JSON.stringify(body) })
  const originalKill = process.kill.bind(process)
  let pid; let mock
  try {
    const response = await call('/jobs/run', { id: 'uncertain', program: process.execPath, args: ['-e', "require('node:fs').writeFileSync('leader',String(process.pid));setInterval(()=>{},1000)"] })
    const outcome = records(response)
    await until(async () => { pid = Number(await readFile(join(root, 'leader'), 'utf8').catch(() => '')); return pid > 1 })
    mock = spyOn(process, 'kill').mockImplementation((target, signal) => {
      if (target === -pid) throw Object.assign(new Error('fixture permission failure'), { code: 'EPERM' })
      return originalKill(target, signal)
    })
    const cancelled = await call('/jobs/cancel', { id: 'uncertain' })
    expect(cancelled.status).toBe(500)
    expect(await cancelled.json()).toMatchObject({ code: 'command.cleanup_unconfirmed' })
    const events = await outcome
    expect(events.some(event => event.type === 'exit')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'command.cleanup_unconfirmed', cleanup: { ok: false } })
    expect((await call('/jobs/cancel', { id: 'uncertain' })).status).toBe(500)
    const closing = companion.close()
    expect(companion.close()).toBe(closing)
    await expect(closing).rejects.toThrow('could not confirm cleanup')
    await expect(companion.close()).rejects.toThrow('could not confirm cleanup')
  } finally {
    mock?.mockRestore()
    if (pid) { try { originalKill(-pid, 'SIGKILL') } catch {} }
    await companion.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})
