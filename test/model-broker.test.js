import { expect, test } from 'bun:test'
import { ModelBroker } from '../src/runtime/model-broker.js'

const messages = [{ role: 'user', content: 'hello' }]
const identity = () => ({ owner: {}, binding: 'run-1' })
const sse = (text, finish = 'stop') => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`)
async function drain(broker, handle, id) {
  const events = []
  for (let count = 0; count < 30; count++) {
    const result = await broker.next(handle, id)
    events.push(...result.events)
    if (result.done) return { events, error: result.error }
  }
  throw new Error('stream did not finish')
}

test('broker freezes credentials on desk and preserves ordered receipts, deltas and repair streams', async () => {
  const broker = new ModelBroker(), id = identity(), seen = []
  const settings = { provider: 'openai', model: 'local', contextLength: 4000, apiKey: 'secret-key', headers: { 'x-token': 'private-header' }, maxOutputTokens: 123 }
  const descriptor = await broker.open({ ...id, settings, transport: { fetch: async (url, init) => { seen.push(init); return sse('reply') } } })
  settings.apiKey = 'changed'
  expect(descriptor).toEqual({ handle: expect.any(String), calibrationKey: expect.any(String), model: 'local', contextLength: 4000, settings: { maxOutputTokens: 123 } })
  for (let index = 0; index < 2; index++) {
    broker.start(descriptor.handle, { ...id, messages })
    const result = await drain(broker, descriptor.handle, id)
    expect(result.events.map(event => event.type)).toEqual(['request', 'delta', 'finish'])
    expect(JSON.stringify(result)).not.toContain('secret-key')
    expect(JSON.stringify(result)).not.toContain('private-header')
    expect(result.events.at(-1).metadata.usage.completion_tokens).toBe(3)
  }
  expect(seen[0].headers.authorization).toBe('Bearer secret-key')
  broker.closeAll()
})

test('broker captures response schema at start before lazy stream consumption', async () => {
  const broker = new ModelBroker(), id = identity()
  let body
  const descriptor = await broker.open({ ...id, settings: { provider: 'openai', contextLength: 4000, structuredOutput: 'json_schema' }, transport: { fetch: async (_, init) => { body = JSON.parse(init.body); return sse('{}') } } })
  expect(descriptor.settings.structuredOutput).toBe('json_schema')
  const responseSchema = { type: 'object', properties: { value: { const: 'original' } } }
  broker.start(descriptor.handle, { ...id, messages, responseSchema })
  responseSchema.properties.value.const = 'mutated'
  const result = await drain(broker, descriptor.handle, id)
  expect(result.error).toBeFalsy()
  expect(body.response_format.json_schema.schema.properties.value.const).toBe('original')
  broker.closeAll()
})

test('broker retains retries and completion metadata before terminal truncation errors', async () => {
  const broker = new ModelBroker(), id = identity()
  let calls = 0
  const { handle } = await broker.open({ ...id, settings: { provider: 'openai', model: 'test', contextLength: 4000, retryDelay: 1 }, transport: { fetch: async () => { if (++calls === 1) throw new Error('network unavailable'); return sse('partial', 'length') } } })
  broker.start(handle, { ...id, messages })
  const result = await drain(broker, handle, id)
  expect(result.events.map(event => event.type)).toEqual(['request', 'retry', 'request', 'delta', 'finish'])
  expect(result.error.code).toBe('truncated')
  expect(result.error.metadata.finishReason).toBe('length')
  expect(calls).toBe(2)
  broker.closeAll()
})

test('scripted cursor survives sessions but remains isolated between workers', async () => {
  const broker = new ModelBroker(), id = identity()
  const settings = { provider: 'scripted', contextLength: 4000, replies: ['first', 'second'] }
  const read = async identity => {
    const { handle } = await broker.open({ ...identity, settings })
    broker.start(handle, { ...identity, messages })
    const result = await drain(broker, handle, identity)
    broker.close(handle, identity)
    return result.events.filter(event => event.type === 'delta').map(event => event.delta.text).join('')
  }
  expect(await read(id)).toBe('first')
  expect(await read(id)).toBe('second')
  expect(await read(identity())).toBe('first')
  broker.closeAll()
})

test('wrong bindings and revoked authority cannot consume or start model calls', async () => {
  const broker = new ModelBroker(), id = identity()
  let active = true, calls = 0
  const { handle } = await broker.open({ ...id, settings: { contextLength: 4000 }, validate: () => { if (!active) throw new Error('revoked') }, transport: { fetch: async () => { calls++; return sse('reply') } } })
  expect(() => broker.start(handle, { ...id, binding: 'other', messages })).toThrow('does not belong')
  broker.start(handle, { ...id, messages })
  active = false
  await expect(broker.next(handle, id)).rejects.toThrow('revoked')
  expect(calls).toBe(0)
  expect(broker.sessions.size).toBe(0)
})

test('cancellation settles pending context discovery even when fetch ignores its signal', async () => {
  const broker = new ModelBroker(), id = identity(), controller = new AbortController()
  const pending = broker.open({ ...id, settings: {}, signal: controller.signal, transport: { fetch: () => new Promise(() => {}) } })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  expect(broker.sessions.size).toBe(0)
})

test('close stream settles a hung next and allows a repair stream; owner teardown settles reads', async () => {
  const broker = new ModelBroker(), id = identity()
  const { handle } = await broker.open({ ...id, settings: { contextLength: 4000 }, transport: { fetch: () => new Promise(() => {}) } })
  broker.start(handle, { ...id, messages })
  await broker.next(handle, id) // request receipt
  const pending = broker.next(handle, id)
  broker.closeStream(handle, id)
  expect((await pending).error.code).toBe('aborted')
  broker.start(handle, { ...id, messages })
  await broker.next(handle, id)
  const next = broker.next(handle, id)
  broker.closeOwner(id.owner)
  await expect(next).rejects.toMatchObject({ code: 'aborted' })
  expect(broker.sessions.size).toBe(0)
})

test('broker forwards redacted terminal provider errors and receipts', async () => {
  const broker = new ModelBroker(), id = identity()
  const { handle } = await broker.open({ ...id, settings: { contextLength: 4000, apiKey: 'secret-key' }, redact: value => JSON.parse(JSON.stringify(value).replaceAll('companion-secret', '[redacted]')), transport: { fetch: async () => new Response('secret-key companion-secret', { status: 401 }) } })
  broker.start(handle, { ...id, messages })
  const result = await drain(broker, handle, id)
  expect(result.error.code).toBe('provider_auth')
  expect(JSON.stringify(result)).not.toContain('secret-key')
  expect(JSON.stringify(result)).not.toContain('companion-secret')
  broker.closeAll()
})

test('context discovery is cached by worker, original settings and authority generation', async () => {
  const broker = new ModelBroker(), id = identity()
  let lookups = 0
  const transport = { fetch: async () => { lookups++; return Response.json({ data: [{ id: 'local', context_length: 8192 }] }) } }
  const settings = { provider: 'openai', model: 'local' }
  const open = async (options = {}) => {
    const descriptor = await broker.open({ ...id, settings, transport, cacheKey: 1, ...options })
    broker.close(descriptor.handle, { owner: options.owner ?? id.owner, binding: id.binding })
    return descriptor.contextLength
  }
  for (let step = 0; step < 4; step++) expect(await open()).toBe(8192)
  expect(lookups).toBe(1)
  expect(settings.contextLength).toBeUndefined()
  await open({ settings: { ...settings, baseUrl: 'http://new-model/v1' } })
  expect(lookups).toBe(2)
  await open({ cacheKey: 2 })
  expect(lookups).toBe(3)
  await open({ owner: {} })
  expect(lookups).toBe(4)
  broker.closeOwner(id.owner)
  await open()
  expect(lookups).toBe(5)
  broker.closeAll()
  await open()
  expect(lookups).toBe(6)
  broker.closeAll()
})

test('context fallback is cached but an aborted discovery does not populate the cache', async () => {
  const broker = new ModelBroker(), id = identity()
  let lookups = 0
  const settings = { provider: 'openai', model: 'local' }
  const transport = { fetch: async () => { lookups++; throw new Error('listing unsupported') } }
  for (let step = 0; step < 2; step++) {
    const descriptor = await broker.open({ ...id, settings, transport })
    expect(descriptor.contextLength).toBe(32768)
    broker.close(descriptor.handle, id)
  }
  expect(lookups).toBe(1)
  broker.closeAll()
  const controller = new AbortController()
  const pending = broker.open({ ...id, settings, signal: controller.signal, transport: { fetch: () => new Promise(() => {}) } })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  expect(broker.contexts.size).toBe(0)
  broker.closeAll()
})
