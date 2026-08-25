import { expect, test } from 'bun:test'

import { CAPABILITIES, MODEL_ENDPOINT, post } from '@harness/kernel'
import { fakeClock, fakeRng, memoryKv, memoryStore, fakeAgents, fakeWorkspace, fakeNet } from '@harness/adapters-test'
import { bootFresh, drive, handle } from '@harness/core'
import { newAgentState } from '@harness/agent'
import { fetchModel, makeEndpoint } from '@harness/adapters-web'

import { memorySegments, scriptedFetch } from './doubles.js'

const FILE = JSON.stringify({
  default: 'local',
  // `context_tokens` IS REQUIRED, here as on disk: `endpoint.card` refuses an
  // entry without one by name, and a fixture that left it out would be testing
  // a catalogue the product will not accept.
  models: {
    local: { model: 'gemma-4', base_url: 'http://127.0.0.1:8873/v1', context_tokens: 128000 },
    openrouter: { model: 'openai/gpt-4o-mini', base_url: 'https://openrouter.ai/api/v1', context_tokens: 128000 },
  },
})

/** @param {Parameters<typeof scriptedFetch>[0]} script */
function broker(script) {
  const endpoint = makeEndpoint()
  endpoint.setCatalogue(FILE)
  const wire = scriptedFetch(script)
  return { endpoint, wire, port: fetchModel(endpoint, { fetch: wire.fetch }) }
}

const frame = (/** @type {Record<string, unknown>} */ delta, /** @type {string|null} */ finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`

test('the catalogue entry\'s model id is stamped over the symbolic name the core asked for', async () => {
  const { wire, port } = broker([{ json: { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] } }])
  await port.call(MODEL_ENDPOINT, { model: 'local', temperature: 0 })
  expect(wire.sent[0]?.url).toBe('http://127.0.0.1:8873/v1/chat/completions')
  expect(wire.sent[0]?.body['model']).toBe('gemma-4')
})

test('the credential is attached HERE, and only the credential saved for THAT entry', async () => {
  const { endpoint, wire, port } = broker([{ json: {} }, { json: {} }])
  endpoint.selectAndSave('openrouter', { apiKey: 'sk-router' })
  endpoint.select('')
  await port.call(MODEL_ENDPOINT, { model: 'local' })
  expect(wire.sent[0]?.headers['authorization']).toBeUndefined()
  await port.call(MODEL_ENDPOINT, { model: 'openrouter' })
  expect(wire.sent[1]?.headers['authorization']).toBe('Bearer sk-router')
})

test('a streamed reply reaches onDelta BEFORE the call resolves', async () => {
  const { port } = broker([{ sse: [frame({ content: 'he' }), frame({ content: 'llo' }, 'stop')] }])
  /** @type {string[]} */
  const order = []
  const reply = await port.call(MODEL_ENDPOINT, { model: 'local' }, {
    onDelta: (delta) => order.push(`delta:${delta.text ?? ''}`),
  })
  order.push('resolved')
  expect(order).toEqual(['delta:he', 'delta:llo', 'resolved'])
  expect(reply.text).toBe('hello')
  expect(reply.finish).toBe('stop')
})

test('streaming is only asked for when somebody is listening', async () => {
  const { wire, port } = broker([{ json: {} }, { sse: [frame({ content: 'x' }, 'stop')] }])
  await port.call(MODEL_ENDPOINT, { model: 'local' })
  expect(wire.sent[0]?.body['stream']).toBeUndefined()
  await port.call(MODEL_ENDPOINT, { model: 'local' }, { onDelta: () => {} })
  expect(wire.sent[1]?.body['stream']).toBe(true)
})

test('a non-2xx is the provider\'s own words, typed — never smoothed into a reply', async () => {
  const { port } = broker([{ status: 401, body: JSON.stringify({ error: { message: 'no key' } }) }])
  expect(port.call(MODEL_ENDPOINT, { model: 'openrouter' })).rejects.toThrow(/wants an API key/)
})

test('a second endpoint name is refused: this build brokers one', async () => {
  const { port } = broker([{ json: {} }])
  expect(port.call('somewhere-else', { model: 'local' })).rejects.toThrow(/Nothing here answers/)
})

test('resolves answers honestly, and null where no catalogue was read', () => {
  const { port } = broker([])
  expect(port.resolves('openrouter')).toEqual({ endpoint: 'openrouter', model: 'openai/gpt-4o-mini' })
  expect(fetchModel(makeEndpoint()).resolves('local')).toBe(null)
})

test('the card is read from the catalogue, and an entry with no window is refused BY NAME', () => {
  const { endpoint } = broker([])
  expect(endpoint.card('local')?.contextTokens).toBe(128000)
  expect(endpoint.card('nothing-configured')?.name).toBe('local') // the default entry serves an unlisted model id
  expect(makeEndpoint().card('local')).toBe(null) // no catalogue read: null, never a hopeful default

  const windowless = makeEndpoint()
  windowless.setCatalogue(JSON.stringify({ default: 'bare', models: { bare: { base_url: 'http://x/v1' } } }))
  expect(() => windowless.card('bare')).toThrow(/"bare"/)
})

test('a key is set, used, and appears in no fact the log ever persisted', async () => {
  const SECRET = 'sk-must-never-be-written-down'
  const { endpoint, wire, port } = broker([{ json: { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] } }])
  endpoint.selectAndSave('local', { apiKey: SECRET })
  const segments = memorySegments()
  const clock = fakeClock()
  const app = bootFresh({
    ports: {
      clock,
      rng: fakeRng(),
      store: memoryStore(),
      model: port,
      net: fakeNet(),
      agents: fakeAgents(),
      workspace: fakeWorkspace(),
      spaces: memoryKv(),
    },
    available: [...CAPABILITIES],
    segments,
    agent: { ...newAgentState(), model: 'local', card: endpoint.card('local') },
  })
  handle(app, post('/chat', { message: 'say hello' }))
  await drive(app, { timer: { wait: async () => {} } })
  await app.log.persist()

  expect(wire.sent[0]?.headers['authorization']).toBe(`Bearer ${SECRET}`)
  expect(segments.all()).toContain('say hello')
  expect(segments.all()).not.toContain(SECRET)
  expect(JSON.stringify(handle(app, { method: 'GET', path: '/chat', headers: {}, body: {} }))).not.toContain(SECRET)
})
