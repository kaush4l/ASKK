import { expect, test } from 'bun:test'
import { Hub } from './helpers/trusted-fixture-hub.js'
import { assertModelRelay, modelRelayPath } from '../src/core/inference.js'
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

test('connection probe remains transport-only for a schema-enabled model profile', async () => {
  let body
  const { hub } = fixture(async (_, init) => { body = JSON.parse(init.body); return reply() }, { structured_output: 'json_schema' })
  const result = await hub.models.probe('chosen')
  expect(result.receipt.status).toBe('completed')
  expect(body.response_format).toBeUndefined()
  expect(hub.fileCatalogue.models.chosen.structured_output).toBe('json_schema')
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
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('provider auth refused', { status: 401 }) })
  const companion = await createCompanion({ root, port: 0, capabilities: ['model-relay'], modelEndpoints: [`${provider.url.origin}/v1`] })
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

test('scoped model routing uses authenticated metadata, invalidates proof and refuses legacy downgrade until disconnect', async () => {
  const scope = endpoints => ({ version: 1, endpoint: '/model/fetch', status: endpoints.length ? 'configured' : 'scope-required', endpoints })
  let authenticated = { capabilities: ['model-relay', 'fetch'], modelRelay: scope(['https://provider.example/v1']) }
  const seen = []
  const { hub, writes } = fixture(async (url, init) => {
    if (url.endsWith('/health')) return Response.json({ name: 'askk-companion', capabilities: ['model-relay'], modelRelay: { ...scope(['https://untrusted.invalid']), endpoint: '/untrusted' } })
    if (url.endsWith('/whoami')) return Response.json(authenticated)
    seen.push({ url, body: JSON.parse(init.body) }); return Response.json({ data: [] })
  }, { via: 'bridge' })
  expect(await hub.bridgeCheck('https://companion.example', 'fixture-token', { requireModelRelay: true })).toMatchObject({ status: 'answering', generation: 1, modelRelay: authenticated.modelRelay })
  expect(writes).toContainEqual({ table: 'settings', key: 'bridge', value: { url: 'https://companion.example', token: 'fixture-token', minimumModelRelayVersion: 1 } })
  expect(hub.hostInfo().modelRelay).toEqual(authenticated.modelRelay)
  await hub.models.refresh()
  expect(seen).toHaveLength(1)
  expect(seen[0]).toMatchObject({ url: 'https://companion.example/model/fetch', body: { url: 'https://provider.example/v1/models', method: 'GET' } })
  authenticated = { ...authenticated, modelRelay: scope(['https://other.example/v1']) }
  expect(await hub.bridgeCheck('https://companion.example', 'fixture-token')).toMatchObject({ generation: 2 })
  authenticated = { capabilities: ['model-relay'] }
  expect(await hub.bridgeCheck('https://companion.example', 'fixture-token')).toMatchObject({ generation: 3, status: 'down', errorCode: 'relay_capability', minimumModelRelayVersion: 1 })
  expect(hub.hostInfo()).toBeNull()
  expect(await hub.bridge.pair('https://legacy.example', 'another-token')).toMatchObject({ status: 'down', errorCode: 'relay_capability' })
  await hub.bridge.disconnect()
  expect(await hub.bridge.pair('https://legacy.example', 'another-token')).toMatchObject({ status: 'answering' })
  expect(modelRelayPath(hub.hostInfo())).toBe('/fetch')
})

test('saved scoped contract rejects absent or null descriptors during restoration', async () => {
  for (const modelRelay of [undefined, null]) {
    const { hub, writes } = fixture(async () => Response.json({ capabilities: ['model-relay', 'fetch'], ...(modelRelay === null ? { modelRelay: null } : {}) }))
    expect(await hub.bridgeCheck('https://companion.example', 'saved-token', { minimumModelRelayVersion: 1, restored: true })).toMatchObject({ status: 'down', errorCode: 'relay_capability', minimumModelRelayVersion: 1 })
    expect(await hub.bridge.check()).toMatchObject({ status: 'down', errorCode: 'relay_capability' })
    expect(hub.hostInfo()).toBeNull()
    expect(writes).toHaveLength(0)
  }
})

test('legacy pairing upgrades durably before scoped authority is published, including scope-required', async () => {
  const modelRelay = { version: 1, endpoint: '/model/fetch', status: 'scope-required', endpoints: [] }
  let authenticated = { capabilities: ['model-relay'] }, saved, release, writing
  const { hub } = fixture(async () => Response.json(authenticated))
  await hub.bridgeCheck('https://companion.example', 'saved-token')
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { writing = resolve })
  hub.store = { async put(_, row) { writing(); await gate; saved = row.value }, async delete() { saved = undefined } }
  const events = []; hub.subscribe(event => { if (event.type === 'bridge') events.push(event.state) })
  authenticated = { ...authenticated, modelRelay }
  const upgrading = hub.bridge.check()
  await started
  expect(hub.bridge.state().modelRelay).toBeUndefined()
  expect(events).toHaveLength(0)
  release()
  expect(await upgrading).toMatchObject({ status: 'answering', minimumModelRelayVersion: 1, modelRelay })
  expect(saved).toEqual({ url: 'https://companion.example', token: 'saved-token', minimumModelRelayVersion: 1 })
  authenticated = { capabilities: ['model-relay'] }
  expect(await hub.bridge.check()).toMatchObject({ status: 'down', errorCode: 'relay_capability' })
})

test('failed or non-durable pin writes never activate scoped pairing', async () => {
  const modelRelay = { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.example/v1'] }
  for (const durable of [false, true]) {
    const { hub } = fixture(async () => Response.json({ capabilities: ['model-relay'], modelRelay }))
    let writes = 0
    hub.store = { durable, async put() { writes++; throw new Error('fixture storage refused') }, async delete() {} }
    expect(await hub.bridge.pair('https://companion.example', 'fixture-token', { requireModelRelay: true })).toMatchObject({ status: 'down', errorCode: 'evidence_persistence' })
    expect(hub.hostInfo()).toBeNull()
    expect(writes).toBe(durable ? 1 : 0)
  }
})

test('disconnect during a scoped pin write cleans up before a newer legacy pairing can persist', async () => {
  const modelRelay = { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.example/v1'] }
  const { hub } = fixture(async url => Response.json({ capabilities: ['model-relay'], ...(url.includes('scoped.example') ? { modelRelay } : {}) }))
  let release, writing, saved
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { writing = resolve })
  hub.store = { async put(_, row) { if (row.value.minimumModelRelayVersion) { writing(); await gate }; saved = row.value }, async delete() { saved = undefined } }
  const old = hub.bridge.pair('https://scoped.example', 'old-token', { requireModelRelay: true })
  await started
  const disconnected = hub.bridge.disconnect()
  const next = hub.bridge.pair('https://legacy.example', 'new-token')
  release()
  expect(await old).toMatchObject({ status: 'down', errorCode: 'configuration' })
  await disconnected
  expect(await next).toMatchObject({ status: 'answering' })
  expect(saved).toEqual({ url: 'https://legacy.example', token: 'new-token' })
})

test('shutdown on scoped publication removes the new durable candidate', async () => {
  const modelRelay = { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.example/v1'] }
  const { hub } = fixture(async () => Response.json({ capabilities: ['model-relay'], modelRelay }))
  let saved
  hub.store = { async put(_, row) { saved = row.value }, async delete() { saved = undefined } }
  hub.subscribe(event => { if (event.type === 'bridge') hub.stop() })
  expect(await hub.bridge.pair('https://scoped.example', 'fixture-token', { requireModelRelay: true })).toMatchObject({ status: 'down', errorCode: 'aborted' })
  expect(saved).toBeUndefined()
})

test('a newer check during scoped publication persists its own pin after stale cleanup', async () => {
  const modelRelay = { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.example/v1'] }
  const { hub } = fixture(async () => Response.json({ capabilities: ['model-relay'], modelRelay }))
  let saved, newer
  const operations = []
  hub.store = { async put(_, row) { operations.push('put'); saved = row.value }, async delete() { operations.push('delete'); saved = undefined } }
  hub.subscribe(event => { if (event.type === 'bridge' && !newer) newer = hub.bridge.check() })
  expect(await hub.bridgeCheck('https://scoped.example', 'fixture-token')).toMatchObject({ status: 'down', errorCode: 'configuration' })
  expect(await newer).toMatchObject({ status: 'answering', minimumModelRelayVersion: 1 })
  expect(saved).toEqual({ url: 'https://scoped.example', token: 'fixture-token', minimumModelRelayVersion: 1 })
  expect(operations).toEqual(['put', 'delete', 'put'])
})

test('a scoped companion never falls back to general fetch when model scope is missing or malformed', async () => {
  const scope = { version: 1, endpoint: '/model/fetch', status: 'scope-required', endpoints: [] }
  let calls = 0
  const { hub } = fixture(async () => { calls++; return reply() }, { via: 'bridge' })
  hub.bridgeState = { status: 'answering', generation: 1, url: 'https://companion.example', token: 'fixture-token', health: { capabilities: ['fetch', 'model-relay'], modelRelay: scope } }
  expect(await hub.models.refresh()).toMatchObject({ errorCode: 'relay_scope' })
  expect(await hub.models.probe()).toMatchObject({ errorCode: 'relay_scope' })
  expect(() => hub.bridgeFetch('https://provider.example/v1/models')).toThrow('--model-endpoint')
  expect(calls).toBe(0)
  for (const modelRelay of [{ ...scope, endpoint: 'https://elsewhere.example' }, { ...scope, version: 99 }, { ...scope, endpoints: ['allowed', {}] }]) expect(() => modelRelayPath({ capabilities: ['model-relay'], modelRelay })).toThrow('contract')
  expect(() => modelRelayPath({ capabilities: ['fetch'], modelRelay: { ...scope, status: 'configured', endpoints: ['https://provider.example/v1'] } })).toThrow('model-relay')
})

test('real worker uses the authenticated scoped route even when generic fetch is also granted', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-scoped-worker-')); let hub
  const requests = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push({ path: new URL(request.url).pathname, body: await request.json() })
    return Response.json({ error: 'fixture provider refused' }, { status: 401 })
  } })
  try {
    await mkdir(join(site, 'agents', 'assistant'), { recursive: true })
    await writeFile(join(site, 'agents', 'assistant', 'agent.md'), '---\nname: assistant\ntools: []\ncontext: []\nmax_steps: 1\n---\nReply briefly.')
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'chosen', models: { chosen: { provider: 'openai', model: 'fixture', base_url: 'https://provider.invalid/v1', via: 'bridge' } } }))
    await writeFile(join(site, 'agents', 'index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `scoped-worker-${crypto.randomUUID()}` })
    hub.bridgeState = { status: 'answering', generation: 1, url: server.url.origin, token: 'fixture-token', health: { name: 'askk-companion', capabilities: ['model-relay', 'fetch'], modelRelay: { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.invalid/v1'] } } }
    await hub.start()
    const run = hub.startRun('assistant', 'Fixture request.')
    await run.answer.catch(() => {})
    expect(run.slot.status).toBe('failed')
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(request => request.path === '/model/fetch')).toBe(true)
    const completions = requests.filter(request => request.body.url.endsWith('/chat/completions'))
    expect(completions).toHaveLength(1)
    expect(completions[0]).toMatchObject({ path: '/model/fetch', body: { url: 'https://provider.invalid/v1/chat/completions', method: 'POST', stream: true } })
  } finally { hub?.stop(); server.stop(true); await rm(site, { recursive: true, force: true }) }
})

test('capability manifest is authenticated, pinned durably, and invalidates identity without granting readiness', async () => {
  const { createCompanionManifest } = await import('../src/core/companion-manifest.js')
  const make = (root = '/project') => {
    const host = { root, runtimeId: 'fixture-instance', runtime: 'bun', version: '1.test', capabilities: ['model-relay'], modelRelay: { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.example/v1'] } }
    return { ...host, capabilityManifest: createCompanionManifest(host, { os: 'darwin', arch: 'arm64' }) }
  }
  let authenticated = make()
  const { hub, writes } = fixture(async url => Response.json(url.endsWith('/whoami') ? authenticated : { name: 'askk-companion', capabilities: ['exec'], capabilityManifest: { spoofed: true } }))
  const first = await hub.bridge.pair('https://companion.example', 'fixture-token')
  expect(first).toMatchObject({ status: 'answering', generation: 1, minimumCapabilityManifestVersion: 1, capabilities: ['model-relay'], capabilityManifest: authenticated.capabilityManifest })
  expect(first.capabilityManifest.capabilities.every(row => row.readiness === 'unverified')).toBe(true)
  expect(writes.at(-1).value).toMatchObject({ minimumModelRelayVersion: 1, minimumCapabilityManifestVersion: 1 })
  expect(hub.hostInfo().capabilityManifest.instanceId).toBe('fixture-instance')
  authenticated = make('/other-project')
  expect(await hub.bridgeCheck('https://companion.example', 'fixture-token')).toMatchObject({ status: 'answering', generation: 2 })
  delete authenticated.capabilityManifest
  expect(await hub.bridgeCheck('https://companion.example', 'fixture-token')).toMatchObject({ status: 'down', errorCode: 'companion_manifest', minimumCapabilityManifestVersion: 1 })
  expect(hub.hostInfo()).toBeNull()
  await hub.bridge.disconnect()
  expect(await hub.bridge.pair('https://companion.example', 'fixture-token')).toMatchObject({ status: 'answering' })
  expect(hub.bridge.state().capabilityManifest).toBeUndefined()
})

test('saved manifest pin rejects downgrade and malformed descriptors without public-health fallback', async () => {
  for (const descriptor of [undefined, null, { protocol: { name: 'askk-capabilities', version: 2 } }]) {
    const { hub } = fixture(async url => Response.json({ capabilities: [], ...(url.endsWith('/whoami') ? descriptor === undefined ? {} : { capabilityManifest: descriptor } : { capabilityManifest: { claimed: true } }) }))
    expect(await hub.bridgeCheck('https://companion.example', 'fixture-token', { minimumCapabilityManifestVersion: 1, restored: true })).toMatchObject({ status: 'down', errorCode: 'companion_manifest' })
  }
})

test('manifest contract storage failure prevents activation', async () => {
  const { createCompanionManifest } = await import('../src/core/companion-manifest.js')
  const authenticated = { root: '/project', runtimeId: 'fixture-manifest-only', runtime: 'bun', version: '1.test', capabilities: [], modelRelay: { version: 1, endpoint: '/model/fetch', status: 'scope-required', endpoints: [] } }
  authenticated.capabilityManifest = createCompanionManifest(authenticated, { os: 'darwin', arch: 'arm64' })
  const { hub } = fixture(async () => Response.json(authenticated))
  hub.store.put = async () => { throw new Error('quota') }
  expect(await hub.bridge.pair('https://companion.example', 'fixture-token')).toMatchObject({ status: 'down', errorCode: 'evidence_persistence' })
  expect(hub.hostInfo()).toBeNull()
})
