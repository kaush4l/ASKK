import { expect, test } from 'bun:test'
import { Hub } from './helpers/trusted-fixture-hub.js'
import { assertModelRelay } from '../src/core/inference.js'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { createCompanion } from '../host/companion.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`
const reply = (text = 'Connected.') => new Response(event({ choices: [{ delta: { content: text }, finish_reason: null }] }) + event({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } }) + event('[DONE]'), { headers: { 'content-type': 'text/event-stream' } })
function fixture(fetcher, profile = {}) {
  const hub = new Hub({ base: 'https://owner.example/app/', fetch: fetcher })
  hub.fileCatalogue = { default: 'chosen', models: { chosen: { provider: 'openai', model: 'fixture-model', base_url: 'https://provider.example/v1', ...profile } } }
  const writes = []
  hub.store = { async put(table, row) { writes.push({ table, ...row }) }, async delete() {} }
  hub.mcpRefresh = async () => {}
  return { hub, writes }
}

test('listing selects the catalogue default, is optional metadata and creates no agent work', async () => {
  const seen = []
  const { hub, writes } = fixture(async (url, init) => { seen.push({ url, signal: init.signal }); return Response.json({ data: [{ id: 'fixture-model' }] }) })
  hub.specs.set('main', { inference: { model: 'unrelated' } })
  expect(await hub.models.refresh()).toMatchObject({ ids: ['fixture-model'] })
  expect(seen[0].url).toBe('https://provider.example/v1/models')
  expect(seen[0].signal).toBeInstanceOf(AbortSignal)
  expect(hub.runs.size).toBe(0); expect(hub.allThreads.size).toBe(0); expect(writes).toHaveLength(0)
  for (const status of [404, 405, 501]) {
    hub.fetch = async () => new Response('unsupported', { status })
    expect(await hub.models.refresh()).toMatchObject({ errorCode: 'listing_unsupported', httpStatus: status })
  }
  hub.fetch = async () => new Response('credentials refused', { status: 401 })
  expect(await hub.models.refresh()).toMatchObject({ errorCode: 'provider_auth', httpStatus: 401 })
  hub.fetch = async () => Response.json({ unexpected: [] })
  expect(await hub.models.refresh()).toMatchObject({ errorCode: 'provider_response' })
})

test('listing is bounded even if fetch ignores cancellation, and pre-abort sends nothing', async () => {
  let calls = 0; let signal
  const { hub } = fixture((_, init) => { calls++; signal = init.signal; return new Promise(() => {}) })
  expect(await hub.models.refresh('chosen', { timeoutMs: 15 })).toMatchObject({ errorCode: 'timeout' })
  expect(signal.aborted).toBe(true)
  const abort = new AbortController(); abort.abort()
  expect(await hub.models.refresh('chosen', { signal: abort.signal })).toMatchObject({ errorCode: 'aborted' })
  expect(calls).toBe(1)
  expect(await hub.models.refresh('chosen', { timeoutMs: NaN })).toMatchObject({ errorCode: 'configuration' })
})

test('probe sends one small tool-free request and persists only its terminal redacted receipt', async () => {
  let sent; let resolveFetch
  const { hub, writes } = fixture((url, init) => { sent = { url, init }; return new Promise(resolve => { resolveFetch = resolve }) }, { api_key: 'sensitive-provider-key', headers: { 'x-custom-auth': 'sensitive-header' }, request_params: { chat_template_kwargs: { enable_thinking: false }, tools: [{ name: 'must-not-run' }], tool_choice: 'auto' } })
  const pending = hub.models.probe('chosen')
  await delay(0)
  expect(writes).toHaveLength(0); expect(hub.runs.size).toBe(0); expect(hub.allThreads.size).toBe(0)
  const body = JSON.parse(sent.init.body)
  expect(body.max_tokens).toBe(128); expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined()
  expect(body.messages).toEqual([{ role: 'user', content: 'Reply with exactly: Connected.' }])
  expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  resolveFetch(reply())
  const result = await pending
  expect(result).toMatchObject({ text: 'Connected.', receipt: { status: 'completed', timeoutMs: 60000, maxOutputTokens: 128 } })
  expect(result.receipt.requests).toHaveLength(1)
  expect(result.receipt.completions[0]).toMatchObject({ finishReason: 'stop', usage: { total_tokens: 11 } })
  expect(result.receipt.requests[0].body).toEqual(body)
  expect(JSON.stringify(result)).not.toContain('sensitive-provider-key'); expect(JSON.stringify(result)).not.toContain('sensitive-header')
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ table: 'settings', key: 'model-probe:last', value: result.receipt })
  expect(Object.isFrozen(result.receipt.requests)).toBe(true)
})

test('probe never retries HTTP failures and redacts echoed credentials in failure evidence', async () => {
  let count = 0
  const { hub, writes } = fixture(async () => { count++; return new Response('sensitive-provider-key busy', { status: 503 }) }, { api_key: 'sensitive-provider-key' })
  const result = await hub.models.probe()
  expect(result).toMatchObject({ errorCode: 'provider_http', httpStatus: 503, receipt: { status: 'failed' } })
  expect(count).toBe(1); expect(writes).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('sensitive-provider-key')
})

test('strict completion rejects partial EOF, DONE without finish reason and length truncation', async () => {
  for (const ending of ['', event('[DONE]'), event({ choices: [{ delta: {}, finish_reason: 'stop' }] }), event({ choices: [{ delta: {}, finish_reason: 'length' }] }) + event('[DONE]')]) {
    const { hub, writes } = fixture(async () => new Response(event({ choices: [{ delta: { content: 'partial' } }] }) + ending))
    const result = await hub.models.probe()
    expect(result).toMatchObject({ errorCode: 'truncated', receipt: { status: 'failed', text: 'partial' } })
    expect(writes[0].value.status).toBe('failed')
  }
})

test('abort during a streamed reply cancels its reader and cannot report success', async () => {
  let cancelled = false; let began
  const started = new Promise(resolve => { began = resolve })
  const { hub, writes } = fixture(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: 'partial' } }] }))); began() }, cancel() { cancelled = true } })))
  const abort = new AbortController(); const pending = hub.models.probe('chosen', { signal: abort.signal })
  await started; await delay(0); abort.abort()
  const result = await pending
  expect(result.errorCode).toBe('aborted'); expect(result.receipt.status).toBe('aborted')
  await delay(0); expect(cancelled).toBe(true); expect(writes).toHaveLength(1)
})

test('timeout cannot be replaced by a late successful response or mutate saved evidence', async () => {
  let finish; let signal
  const { hub, writes } = fixture((_, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve }) })
  const result = await hub.models.probe('chosen', { timeoutMs: 10 })
  expect(result).toMatchObject({ errorCode: 'timeout', receipt: { status: 'timed_out' } }); expect(signal.aborted).toBe(true)
  const saved = JSON.stringify(writes)
  finish(reply('late'))
  await delay(10)
  expect(JSON.stringify(writes)).toBe(saved); expect(result.receipt.text).toBe('')
})

test('older overlapping probe cannot overwrite the newer terminal receipt', async () => {
  const pending = []
  const { hub, writes } = fixture(() => new Promise(resolve => pending.push(resolve)))
  const first = hub.models.probe(); await delay(0)
  const second = hub.models.probe(); await delay(0)
  pending[1](reply('new')); const current = await second
  pending[0](reply('old')); await first
  expect(writes).toHaveLength(1); expect(writes[0].value.id).toBe(current.receipt.id)
})

test('evidence storage failure is not reported as a verified reply', async () => {
  const { hub } = fixture(async () => reply())
  hub.store.put = async () => { throw new Error('quota') }
  expect(await hub.models.probe()).toMatchObject({ errorCode: 'evidence_persistence', receipt: { status: 'completed' } })
})

test('model relay authority is enforced before metadata, probe and direct forwarding', async () => {
  let calls = 0
  const { hub } = fixture(async () => { calls++; return reply() }, { via: 'bridge' })
  expect(await hub.models.refresh()).toMatchObject({ errorCode: 'relay_unavailable' })
  hub.bridgeState = { status: 'answering', generation: 1, url: 'https://companion.example', token: 'sensitive-pairing-token', health: { capabilities: ['network-relay', 'exec'] } }
  expect(await hub.models.refresh()).toMatchObject({ errorCode: 'relay_capability' })
  expect(await hub.models.probe()).toMatchObject({ errorCode: 'relay_capability' })
  expect(() => hub.bridgeFetch('https://provider.example')).toThrow('model-relay')
  expect(calls).toBe(0)
  for (const capabilities of [['model-relay'], ['fetch']]) expect(() => assertModelRelay({ capabilities })).not.toThrow()
})

test('model-only pairing prevalidates capabilities, preserves an existing connection on failure and versions token changes', async () => {
  let grants = ['model-relay']; let refused = false
  const { hub, writes } = fixture(async url => url.endsWith('/health') ? Response.json({ name: 'askk-companion', version: '2', root: '/fixture', runtimeId: 'runtime-one', capabilities: grants }) : refused ? Response.json({ error: 'wrong token' }, { status: 401 }) : Response.json({ ok: true, root: '/fixture', runtimeId: 'runtime-one', capabilities: grants }))
  const first = await hub.bridge.pair('https://companion.example', 'first-token', { requireModelRelay: true })
  expect(first).toMatchObject({ status: 'answering', generation: 1, runtimeId: 'runtime-one' })
  expect(await hub.bridgeCheck('https://companion.example', 'first-token')).toMatchObject({ generation: 1 })
  expect(await hub.bridge.pair('https://companion.example', 'second-token', { requireModelRelay: true })).toMatchObject({ generation: 2 })
  const retained = hub.bridgeState
  grants = ['exec']; const failed = await hub.bridge.pair('https://other.example', 'candidate-token', { requireModelRelay: true })
  expect(failed).toMatchObject({ status: 'down', errorCode: 'relay_capability' }); expect(hub.bridgeState).toBe(retained)
  refused = true
  expect(await hub.bridge.pair('https://other.example', 'bad-token', { requireModelRelay: true })).toMatchObject({ errorCode: 'relay_auth' })
  expect(hub.bridgeState).toBe(retained); expect(writes).toHaveLength(2)
  hub.fetch = () => new Promise(() => {})
  expect(await hub.bridge.pair('https://other.example', 'candidate-token', { requireModelRelay: true, timeoutMs: 10 })).toMatchObject({ errorCode: 'timeout' })
  expect(hub.bridgeState).toBe(retained)
})

test('a real agent worker refuses relay inference without a model grant before any HTTP dispatch', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-model-worker-')); let hub; let requests = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { requests++; return reply() } })
  try {
    await mkdir(join(site, 'agents', 'assistant'), { recursive: true })
    await writeFile(join(site, 'agents', 'assistant', 'agent.md'), '---\nname: assistant\ntools: []\ncontext: []\nmax_steps: 1\n---\nReply briefly.')
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'chosen', models: { chosen: { provider: 'openai', model: 'fixture', base_url: 'https://provider.invalid/v1', via: 'bridge' } } }))
    await writeFile(join(site, 'agents', 'index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `model-worker-${crypto.randomUUID()}` })
    hub.bridgeState = { status: 'answering', generation: 1, url: server.url.origin, token: 'fixture-token', health: { name: 'askk-companion', capabilities: ['network-relay'] } }
    await hub.start()
    const run = hub.startRun('assistant', 'Fixture request.')
    await run.answer.catch(() => {})
    expect(run.slot.status).toBe('failed'); expect(requests).toBe(0)
  } finally { hub?.stop(); server.stop(true); await rm(site, { recursive: true, force: true }) }
})

test('relay-only companion distinguishes upstream transport failure from provider HTTP without native grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-model-transport-'))
  const companion = await createCompanion({ root, port: 0, capabilities: ['model-relay'] })
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('provider auth refused', { status: 401 }) })
  const { hub } = fixture(fetch, { via: 'bridge', base_url: `${provider.url.origin}/v1` })
  hub.bridgeState = { status: 'answering', generation: 1, url: companion.url, token: companion.token, health: { capabilities: ['model-relay'] } }
  try {
    expect(await hub.models.refresh()).toMatchObject({ errorCode: 'provider_auth', httpStatus: 401 })
    provider.stop(true)
    expect(await hub.models.refresh()).toMatchObject({ errorCode: 'relay_upstream', httpStatus: 502 })
    const denied = await fetch(`${companion.url}/jobs/run`, { method: 'POST', headers: { authorization: `Bearer ${companion.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ program: 'must-not-run', args: [] }) })
    expect(denied.status).toBe(403)
  } finally { provider.stop(true); await companion.close(); await rm(root, { recursive: true, force: true }) }
})

test('cancel after receiving a finish event but before stream termination stays aborted', async () => {
  const abort = new AbortController(); let emitted = false
  const { hub } = fixture(async () => new Response(new ReadableStream({ pull(controller) {
    if (!emitted) { emitted = true; controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'stop' }] }))); return }
    abort.abort(); controller.close()
  } })))
  expect(await hub.models.probe(undefined, { signal: abort.signal })).toMatchObject({ errorCode: 'aborted', receipt: { status: 'aborted' } })
})

test('pairing completed after Hub shutdown cannot adopt or persist its candidate', async () => {
  let finish; let calls = 0
  const { hub, writes } = fixture(async url => {
    calls++
    if (url.endsWith('/health')) return Response.json({ name: 'askk-companion', capabilities: ['model-relay'] })
    return new Promise(resolve => { finish = resolve })
  })
  const previous = hub.bridgeState
  const pending = hub.bridge.pair('https://companion.example', 'fixture-token', { requireModelRelay: true })
  await delay(0)
  hub.stop()
  finish(Response.json({ ok: true, capabilities: ['model-relay'], runtimeId: 'late' }))
  expect(await pending).toMatchObject({ status: 'down', errorCode: 'aborted' })
  expect(hub.bridgeState).toBe(previous); expect(writes).toHaveLength(0)
  expect(await hub.bridge.pair('https://companion.example', 'fixture-token')).toMatchObject({ status: 'down', errorCode: 'aborted' })
  expect(calls).toBe(2)
})

test('shutdown after a bridge check publishes success still prevents the pairing save', async () => {
  const { hub, writes } = fixture(async () => Response.json({ name: 'askk-companion', capabilities: ['model-relay'] }))
  hub.subscribe(event => { if (event.type === 'bridge') hub.stop() })
  expect(await hub.bridge.pair('https://companion.example', 'fixture-token', { requireModelRelay: true })).toMatchObject({ status: 'down', errorCode: 'aborted' })
  expect(writes).toHaveLength(0)
})

test('revocation during a blocked pairing save cannot return success or retain its token', async () => {
  let release; let saved; let refused = false
  const barrier = new Promise(resolve => { release = resolve })
  const { hub } = fixture(async () => refused ? Response.json({}, { status: 401 }) : Response.json({ capabilities: ['model-relay'] }))
  let writing
  const started = new Promise(resolve => { writing = resolve })
  hub.store = {
    async put(_, row) { writing(); await barrier; saved = row.value },
    async delete() { saved = undefined },
  }
  const pairing = hub.bridge.pair('https://companion.example', 'revoked-token', { requireModelRelay: true })
  await started
  refused = true
  expect(await hub.bridge.check()).toMatchObject({ status: 'down' })
  release()
  expect(await pairing).toMatchObject({ status: 'down', errorCode: 'configuration', capabilities: [] })
  expect(saved).toBeUndefined()
})

test('disconnect invalidates a blocked save immediately and ordered cleanup preserves a newer pairing', async () => {
  let release; let saved; let writing
  const barrier = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { writing = resolve })
  const operations = []
  const { hub } = fixture(async () => Response.json({ capabilities: ['model-relay'] }))
  hub.store = {
    async put(_, row) { operations.push(`put:${row.value.token}`); if (row.value.token === 'old-token') { writing(); await barrier }; saved = row.value },
    async delete() { operations.push('delete'); saved = undefined },
  }
  const first = hub.bridge.pair('https://old.example', 'old-token', { requireModelRelay: true })
  await started
  const disconnect = hub.bridge.disconnect()
  expect(hub.bridge.state()).toMatchObject({ status: 'unpaired', capabilities: [] })
  const second = hub.bridge.pair('https://new.example', 'new-token', { requireModelRelay: true })
  await delay(0)
  expect(operations).toEqual(['put:old-token'])
  release()
  expect(await first).toMatchObject({ status: 'down', errorCode: 'configuration' })
  await disconnect
  expect(await second).toMatchObject({ status: 'answering', url: 'https://new.example' })
  expect(saved).toEqual({ url: 'https://new.example', token: 'new-token' })
  expect(operations).toEqual(['put:old-token', 'delete', 'delete', 'put:new-token'])
})

test('shutdown or cancellation during the pairing save removes its persisted candidate', async () => {
  for (const stop of [true, false]) {
    let release; let saved; let writing
    const barrier = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { writing = resolve })
    const abort = new AbortController()
    const { hub } = fixture(async () => Response.json({ capabilities: ['model-relay'] }))
    hub.store = { async put(_, row) { writing(); await barrier; saved = row.value }, async delete() { saved = undefined } }
    const pairing = hub.bridge.pair('https://companion.example', 'fixture-token', { requireModelRelay: true, signal: abort.signal })
    await started
    if (stop) hub.stop(); else abort.abort()
    release()
    expect(await pairing).toMatchObject({ status: 'down', errorCode: 'aborted' })
    expect(saved).toBeUndefined()
  }
})

test('a configured MCP server that never replies cannot delay model pairing or disconnect', async () => {
  let discoveryCalls = 0
  const { hub } = fixture(async url => {
    if (url === 'https://mcp.example') { discoveryCalls++; return new Promise(() => {}) }
    return Response.json({ capabilities: ['model-relay'] })
  })
  hub.saved.mcp = { slow: { url: 'https://mcp.example' } }
  hub.mcpRefresh = Hub.prototype.mcpRefresh
  const pairing = await Promise.race([
    hub.bridge.pair('https://companion.example', 'fixture-token', { requireModelRelay: true, timeoutMs: 10 }),
    delay(50).then(() => ({ status: 'blocked' })),
  ])
  expect(pairing).toMatchObject({ status: 'answering' })
  expect(discoveryCalls).toBe(1)
  expect(await Promise.race([hub.bridge.disconnect().then(() => 'disconnected'), delay(50).then(() => 'blocked')])).toBe('disconnected')
  expect(hub.bridge.state().status).toBe('unpaired')
  hub.stop()
})

test('late MCP discovery cannot replace newer tools or restore disconnected bridge clients', async () => {
  let release
  const { hub } = fixture(async (url, init) => {
    if (!url.includes('/mcp/')) return Response.json({ capabilities: ['model-relay'], mcp: ['fixture'] })
    const request = JSON.parse(init.body)
    if (url.startsWith('https://old.example') && request.method === 'initialize') return new Promise(resolve => { release = () => resolve(Response.json({ result: {} })) })
    return Response.json({ result: request.method === 'tools/list' ? { tools: [{ name: url.startsWith('https://old.example') ? 'old' : 'new', inputSchema: {} }] } : {} })
  })
  hub.mcpRefresh = Hub.prototype.mcpRefresh
  expect(await hub.bridge.pair('https://old.example', 'old-token', { requireModelRelay: true })).toMatchObject({ status: 'answering' })
  expect(await hub.bridge.pair('https://new.example', 'new-token', { requireModelRelay: true })).toMatchObject({ status: 'answering' })
  await delay(0)
  expect(hub.mcpTools()[0].tools[0].tool).toBe('new')
  await hub.bridge.disconnect()
  release(); await delay(0)
  expect(hub.mcpTools()).toEqual([])
  expect(hub.bridge.state().status).toBe('unpaired')
})
