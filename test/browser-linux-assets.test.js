import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { verifiedAsset } from '../public/browser-linux/assets.js'
import { BrowserLinuxExecution } from '../src/execution/browser-linux.js'
import { acquireWorkspace } from '../public/browser-linux/ownership.js'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('runtime chunks reassemble in manifest order and verify both parts and final identity', async () => {
  const parts = [Buffer.from('binary\0'), Buffer.from([255, 128, 0]), Buffer.from('🦊')]
  const entry = { name: 'qemu.data', bytes: Buffer.concat(parts).length, sha256: hash(Buffer.concat(parts)), parts: parts.map((bytes, i) => ({ name: `qemu.data.part-${i}`, bytes: bytes.length, sha256: hash(bytes) })) }
  const fetcher = (url) => Promise.resolve(new Response(parts[Number(String(url).split('-').at(-1))]))
  const actual = await verifiedAsset(entry, 'https://runtime.invalid/', { fetch: fetcher })
  expect(Buffer.from(actual)).toEqual(Buffer.concat(parts))
  await expect(verifiedAsset({ ...entry, sha256: hash('different image') }, 'https://runtime.invalid/', { fetch: fetcher })).rejects.toThrow('Reassembled runtime asset failed integrity')
  await expect(verifiedAsset(entry, 'https://runtime.invalid/', { fetch: async () => new Response('tampered') })).rejects.toThrow()
})

test('runtime assets reject traversal, truncated downloads and extra bytes', async () => {
  const bytes = Buffer.from('verified bytes')
  const entry = { name: 'runtime.wasm', bytes: bytes.length, sha256: hash(bytes) }
  await expect(verifiedAsset({ ...entry, name: '../runtime.wasm' }, 'https://runtime.invalid/')).rejects.toThrow('Invalid runtime asset descriptor')
  await expect(verifiedAsset(entry, 'https://runtime.invalid/', { fetch: async () => new Response(bytes.subarray(1)) })).rejects.toThrow('size mismatch')
  await expect(verifiedAsset(entry, 'https://runtime.invalid/', { fetch: async () => new Response(Buffer.concat([bytes, bytes])) })).rejects.toThrow('size exceeded')
})

test('guest networking requires explicit relay configuration and never exposes its token in capabilities', async () => {
  const browser = new BrowserLinuxExecution({ projectId: 'network-test' })
  expect(browser.networkRelay).toBeNull()
  await expect(browser.setNetworkRelay({ url: 'http://example.com', token: 'private-test-token' })).rejects.toMatchObject({ code: 'INVALID_NETWORK_RELAY' })
  await browser.setNetworkRelay({ url: 'https://127.0.0.1:3333/', token: 'private-test-token' })
  expect(browser.describeCapabilities().network).toBe('companion-network-relay')
  expect(JSON.stringify(browser.describeCapabilities())).not.toContain('private-test-token')
  await browser.setNetworkRelay(null)
  expect(browser.networkRelay).toBeNull()
  browser.state = 'ready'; browser.info = { network: 'companion-network-relay' }
  expect(browser.describeCapabilities().network).toBe('browser-fetch-cors')
})

test('cancellation during admission waits for the real job to start before cancelling it', async () => {
  const browser = new BrowserLinuxExecution({ projectId: 'admission-test' })
  browser.prepare = async () => {}
  const calls = []
  let admit
  browser.request = async (method) => { calls.push(method); if (method === 'job.start') await new Promise((resolve) => { admit = resolve }); return {} }
  const controller = new AbortController()
  const running = browser.startJob({ id: 'job', program: 'node', signal: controller.signal })
  await Promise.resolve(); await Promise.resolve()
  controller.abort()
  expect(calls).toEqual(['job.start'])
  admit()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(calls).toEqual(['job.start', 'job.cancel'])
  browser.message({ event: { type: 'job.exit', jobId: 'job', code: null, signal: 'SIGTERM', cancelled: true } })
  expect((await running).cancelled).toBe(true)
})

test('a browser project rejects a second owner until its first guest releases the lock', async () => {
  const active = new Set()
  const locks = { async request(name, options, callback) {
    expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
    if (active.has(name)) return callback(null)
    active.add(name)
    try { return await callback({ name }) } finally { active.delete(name) }
  } }
  const release = await acquireWorkspace(locks, 'same-project')
  await expect(acquireWorkspace(locks, 'same-project')).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' })
  const releaseOther = await acquireWorkspace(locks, 'different-project')
  release(); await Promise.resolve()
  const reacquired = await acquireWorkspace(locks, 'same-project')
  reacquired(); releaseOther()
  await expect(acquireWorkspace(null, 'same-project')).rejects.toMatchObject({ code: 'LOCKS_REQUIRED' })
})
