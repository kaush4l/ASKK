import { expect, test } from 'bun:test'
import { Hub } from './helpers/trusted-fixture-hub.js'

const spec = { path: 'agent', name: 'agent', inference: { model: 'selected', api_key: 'folder-secret' }, peers: [], owned: [], grants: [], services: {} }
function fixture() {
  const requests = []
  const hub = new Hub({ base: 'https://desk.example/', fetch: async (url, init) => {
    requests.push({ url, init })
    return new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  hub.fileCatalogue = { default: 'selected', models: { selected: { provider: 'openai', model: 'fixture', api_key: 'profile-secret', base_url: 'https://model.example/v1', context_length: 32000 } } }
  hub.store = { get: async () => null }
  const sent = []
  const thread = { spec, run: 'run-one', worker: { postMessage: message => sent.push(message) } }
  const run = { id: 'run-one', modelController: new AbortController() }
  hub.allThreads.add(thread)
  const call = (op, args = {}, runId = run.id) => hub.modelRequest(thread, run, { op, args, runId })
  return { hub, thread, run, requests, sent, call }
}

test('worker initialization and settings omit connection catalogues and inference credentials', async () => {
  const { hub, sent } = fixture()
  hub.bridgeState = { status: 'answering', url: 'https://relay.example', token: 'bridge-secret', health: { root: '/project', capabilities: ['model-relay'] } }
  const message = await hub.initMessage(spec)
  expect(message.spec.inference).toEqual({})
  expect(message.catalogue).toBeUndefined()
  expect(message.host).toEqual({ name: undefined, root: '/project', capabilities: ['model-relay'] })
  hub.broadcastSettings()
  expect(sent[0].catalogue).toBeUndefined()
  for (const secret of ['folder-secret', 'profile-secret', 'bridge-secret']) expect(JSON.stringify([message, sent])).not.toContain(secret)
  hub.modelBroker.closeAll()
})

test('desk resolves trusted bindings, streams receipts, rejects stale runs and aborts handles', async () => {
  const { hub, run, requests, call } = fixture()
  const descriptor = await call('model.open', { settings: { apiKey: 'worker-injection', baseUrl: 'https://wrong.example' } })
  expect(descriptor.contextLength).toBe(32000)
  expect(JSON.stringify(descriptor)).not.toContain('secret')
  await expect(call('model.next', { handle: descriptor.handle }, 'stale-run')).rejects.toThrow('active run')
  await call('model.start', { handle: descriptor.handle, messages: [{ role: 'user', content: 'A goal' }] })
  const events = []
  for (;;) {
    const batch = await call('model.next', { handle: descriptor.handle })
    events.push(...batch.events)
    if (batch.done) break
  }
  expect(requests[0].url).toBe('https://model.example/v1/chat/completions')
  expect(requests[0].init.headers.authorization).toBe('Bearer folder-secret')
  expect(events.map(event => event.type)).toEqual(['request', 'delta', 'finish'])
  expect(JSON.stringify(events)).not.toContain('folder-secret')
  run.modelController.abort()
  await expect(call('model.next', { handle: descriptor.handle })).rejects.toThrow('does not belong')
  expect(hub.modelBroker.sessions.size).toBe(0)
})

test('companion changes revoke relayed sessions without cancelling independent direct inference', async () => {
  for (const via of ['direct', 'bridge']) {
    const { hub, thread, run, call } = fixture()
    hub.fileCatalogue.models.selected.via = via
    hub.bridgeState = { status: 'answering', generation: 1, url: 'https://relay.example', token: 'relay-secret', health: { capabilities: ['model-relay'] } }
    hub.mcpRefresh = async () => {}
    hub.runs.set(run.id, run)
    thread.busy = true
    await call('model.open')
    hub.bridgeState = { ...hub.bridgeState, generation: 2 }
    hub.bridgeToolsChanged('changed')
    expect(run.modelController.signal.aborted).toBe(via === 'bridge')
    hub.modelBroker.closeAll()
  }
})
