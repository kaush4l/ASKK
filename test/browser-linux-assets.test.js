import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { verifiedAsset, createDownloadProgress } from '../public/browser-linux/assets.js'
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

test('a single explicit part must agree with the complete asset identity before downloading', async () => {
  const bytes = Buffer.from('single verified part')
  const part = { name: 'image.part-0', bytes: bytes.length, sha256: hash(bytes) }
  let calls = 0
  const fetcher = async () => { calls++; return new Response(bytes) }
  await expect(verifiedAsset({ name: 'image.data', bytes: bytes.length, sha256: hash('different asset'), parts: [part] }, 'https://runtime.invalid/', { fetch: fetcher })).rejects.toThrow('part identity')
  expect(calls).toBe(0)
  expect(Buffer.from(await verifiedAsset({ name: 'image.data', bytes: bytes.length, sha256: part.sha256, parts: [part] }, 'https://runtime.invalid/', { fetch: fetcher }))).toEqual(bytes)
})

test('small assets and multipart verification retain cumulative byte progress without resetting', async () => {
  const chunks = [Buffer.from('first'), Buffer.from('second'), Buffer.from('third')]
  const progress = createDownloadProgress(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  const seen = [progress.snapshot()]
  await verifiedAsset({ name: 'script.js', bytes: chunks[0].length, sha256: hash(chunks[0]) }, 'https://runtime.invalid/', {
    fetch: async () => new Response(chunks[0]), onProgress: (bytes) => progress.add(bytes), onVerifying: () => seen.push(progress.snapshot()),
  })
  const bytes = Buffer.concat(chunks.slice(1))
  await verifiedAsset({ name: 'qemu.data', bytes: bytes.length, sha256: hash(bytes), parts: chunks.slice(1).map((chunk, index) => ({ name: `part-${index}`, bytes: chunk.length, sha256: hash(chunk) })) }, 'https://runtime.invalid/', {
    fetch: async (url) => new Response(chunks[1 + Number(String(url).split('-').at(-1))]), onProgress: (count) => progress.add(count), onVerifying: () => seen.push(progress.snapshot()),
  })
  expect(seen).toEqual([{ received: 0, total: 16 }, { received: 5, total: 16 }, { received: 11, total: 16 }, { received: 16, total: 16 }])
  expect(() => progress.add(1)).toThrow('Invalid runtime download progress')
  expect(() => createDownloadProgress(NaN)).toThrow('Invalid runtime download total')
})

test('a corrupt cached part retries only that URL with cache bypass and no duplicate byte credit', async () => {
  const chunks = [Buffer.from('first'), Buffer.from('second')]
  const bytes = Buffer.concat(chunks)
  const entry = { name: 'image.data', bytes: bytes.length, sha256: hash(bytes), parts: chunks.map((chunk, index) => ({ name: `part-${index}`, bytes: chunk.length, sha256: hash(chunk) })) }
  const requests = [], retries = [], seen = []
  const progress = createDownloadProgress(bytes.length)
  const actual = await verifiedAsset(entry, 'https://runtime.invalid/', {
    fetch: async (url, options) => {
      requests.push({ url: String(url), cache: options?.cache })
      const index = Number(String(url).split('-').at(-1))
      return new Response(index === 1 && !options?.cache ? Buffer.from('broken') : chunks[index])
    },
    onRetry: (name) => retries.push(name),
    onProgress: (count) => { progress.add(count); seen.push(progress.snapshot().received) },
  })
  expect(Buffer.from(actual)).toEqual(bytes)
  expect(requests).toEqual([
    { url: 'https://runtime.invalid/part-0', cache: undefined },
    { url: 'https://runtime.invalid/part-1', cache: undefined },
    { url: 'https://runtime.invalid/part-1', cache: 'reload' },
  ])
  expect(retries).toEqual(['part-1'])
  expect(seen).toEqual([5, 11])
})

test('truncated cached streams recover without exceeding the known asset byte total', async () => {
  const bytes = Buffer.from('whole asset')
  const progress = createDownloadProgress(bytes.length)
  const attempts = []
  const actual = await verifiedAsset({ name: 'image.wasm', bytes: bytes.length, sha256: hash(bytes) }, 'https://runtime.invalid/', {
    fetch: async (_url, options) => { attempts.push(options?.cache); return new Response(options?.cache ? bytes : bytes.subarray(0, 3)) },
    onProgress: (count) => progress.add(count),
  })
  expect(Buffer.from(actual)).toEqual(bytes)
  expect(attempts).toEqual([undefined, 'reload'])
  expect(progress.snapshot()).toEqual({ received: bytes.length, total: bytes.length })
})

test('fresh corrupt payloads stay rejected and HTTP or network errors do not trigger cache recovery', async () => {
  const bytes = Buffer.from('good')
  const entry = { name: 'image.wasm', bytes: bytes.length, sha256: hash(bytes) }
  for (const [response, expectedCalls, error] of [
    [() => new Response('evil'), 2, 'integrity verification'],
    [() => new Response('missing', { status: 404 }), 1, 'unavailable: 404'],
    [() => { throw new Error('network unavailable') }, 1, 'network unavailable'],
  ]) {
    let calls = 0
    await expect(verifiedAsset(entry, 'https://runtime.invalid/', { fetch: async () => { calls++; return response() } })).rejects.toThrow(error)
    expect(calls).toBe(expectedCalls)
  }
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

test('a guest crash invalidates readiness and rejects admitted jobs, admission and filesystem RPCs immediately', async () => {
  const events = [], sent = []
  let closed = 0, removed = 0
  const browser = new BrowserLinuxExecution({ projectId: 'crash-test', onEvent: (event) => events.push(event) })
  browser.state = 'ready'
  browser.info = { imageId: 'test-image', instanceId: 'test-boot', node: '24.21.0' }
  browser.port = { postMessage: (message) => sent.push(message), close: () => closed++ }
  browser.frame = { remove: () => removed++ }
  const admitted = browser.startJob({ id: 'running', program: 'node' })
  const admittedFailure = admitted.catch((error) => error)
  await Promise.resolve(); await Promise.resolve()
  const admission = sent.find((message) => message.method === 'job.start')
  browser.message({ id: admission.id, ok: true, result: { pid: 21 } })
  await Promise.resolve(); await Promise.resolve()
  const waiting = browser.startJob({ id: 'waiting', program: 'node' })
  const waitingFailure = waiting.catch((error) => error)
  const reading = browser.read('index.js')
  const readingFailure = reading.catch((error) => error)
  await Promise.resolve(); await Promise.resolve()
  browser.message({ event: { type: 'runtime.error', error: 'Guest worker terminated' } })
  for (const error of await Promise.all([admittedFailure, waitingFailure, readingFailure])) expect(error.message).toBe('Guest worker terminated')
  expect(browser.describeCapabilities()).toMatchObject({ state: 'failed', ready: false })
  expect(browser.jobs.size).toBe(0)
  expect(browser.pending.size).toBe(0)
  expect(closed).toBe(1); expect(removed).toBe(1)
  expect(events.some((event) => event.type === 'runtime.state' && event.state === 'failed')).toBe(true)
  expect(events.some((event) => event.type === 'runtime.error')).toBe(true)
})
