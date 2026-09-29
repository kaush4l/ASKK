import { expect, test } from 'bun:test'
import { inference } from '../src/core/inference.js'

const descriptors = () => [{ type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }]
const event = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const fragment = (args = '{"path":"a.txt"}', overrides = {}) => ({ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: args }, ...overrides })
const response = (events, done = true) => new Response(events.map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''))
const collect = async iterator => { const out = []; for await (const delta of iterator) out.push(delta); return out }
function fixture(events, { done = true, settings = {} } = {}) {
  const requests = []
  const llm = inference({ provider: 'openai', model: 'fixture', baseUrl: 'http://localhost:8080/v1', retries: 3, retryDelay: 0, ...settings }, { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return response(events, done) } })
  return { llm, requests }
}

test('native tools clone before iteration, assemble indexed fragments and preserve provider call ID and raw arguments', async () => {
  const tools = descriptors()
  const first = fragment('{"path":', { function: { name: 'read_', arguments: '{"path":' } })
  const second = { index: 0, function: { name: 'file', arguments: '"a.txt"}' } }
  const { llm, requests } = fixture([event({ tool_calls: [first], reasoning_content: 'thinking' }), event({ tool_calls: [second] }, 'tool_calls'), { choices: [], usage: { completion_tokens: 10 } }])
  let completion
  const iterator = llm.stream([], { nativeTools: tools, onFinish: value => { completion = value } })
  tools[0].function.name = 'changed'
  tools[0].function.parameters.properties.path.type = 'number'
  const out = await collect(iterator)
  expect(requests[0]).toMatchObject({ tools: descriptors(), tool_choice: 'auto', parallel_tool_calls: false })
  expect(out.filter(x => x.kind === 'tool_fragment')).toEqual([{ kind: 'tool_fragment', fragment: first }, { kind: 'tool_fragment', fragment: second }])
  expect(out.at(-1)).toEqual({ kind: 'tool_call', call: { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } } })
  expect(completion).toMatchObject({ finishReason: 'tool_calls', usage: { completion_tokens: 10 }, diagnostics: { reasoningChars: 8, contentChars: 0 } })
})

test('native final-only omits tool definitions; default JSON transport remains unchanged', async () => {
  for (const nativeTools of [undefined, []]) {
    const { llm, requests } = fixture([event({ content: 'final answer' }, 'stop')])
    expect(await llm.invoke([], { nativeTools })).toBe('final answer')
    expect(requests[0].tools).toBeUndefined()
    expect(requests[0].tool_choice).toBeUndefined()
    expect(requests[0].parallel_tool_calls).toBeUndefined()
  }
  const { llm } = fixture([event({ tool_calls: [fragment()] }, 'tool_calls')])
  await expect(collect(llm.stream([], { nativeTools: [] }))).rejects.toThrow('final-only')
})

test('native configuration conflicts reject before network access', async () => {
  const settingsCases = [
    { provider: 'anthropic' }, { provider: 'scripted' }, { provider: 'cli' }, { structuredOutput: 'json_schema' },
    ...['tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'functions', 'function_call'].map(key => ({ requestParams: { [key]: null } })),
  ]
  for (const settings of settingsCases) {
    const { llm, requests } = fixture([], { settings })
    for (const nativeTools of [descriptors(), []]) await expect(collect(llm.stream([], { nativeTools }))).rejects.toMatchObject({ code: 'configuration' })
    expect(requests).toHaveLength(0)
  }
  for (const nativeTools of [null, {}, [descriptors()[0], descriptors()[0]], [{ type: 'function', function: { name: 'bad name', parameters: { type: 'object' } } }]]) {
    const { llm, requests } = fixture([])
    await expect(collect(llm.stream([], { nativeTools }))).rejects.toMatchObject({ code: 'configuration' })
    expect(requests).toHaveLength(0)
  }
})

test('malformed native calls never yield completed calls and never retry', async () => {
  const cases = [
    [fragment('[')], [fragment('[]')], [fragment('null')], [fragment('1')],
    [fragment('{}', { function: { name: 'unknown', arguments: '{}' } })],
    [fragment('{}', { type: 'custom' })], [fragment('{}', { id: '' })], [fragment('{}', { id: 'invalid id' })],
    [fragment('{}', { index: -1 })], [fragment('{}', { index: '0' })],
    [fragment('{}'), { index: 0, id: 'call_1' }],
    [fragment('{}'), fragment('{}', { index: 1, id: 'call_2' })],
    [fragment('{}', { function: { name: 'read_file', arguments: {} } })],
  ]
  for (const fragments of cases) {
    const { llm, requests } = fixture([event({ tool_calls: fragments }, 'tool_calls')])
    const out = []
    let error
    try { for await (const delta of llm.stream([], { nativeTools: descriptors() })) out.push(delta) } catch (value) { error = value }
    expect(error?.code).toBe('provider_response')
    expect(out.some(x => x.kind === 'tool_call')).toBe(false)
    expect(requests).toHaveLength(1)
  }
})

test('native calls require DONE and tool_calls finish; native final requires DONE and stop', async () => {
  for (const [calls, finish, done] of [[true, 'stop', true], [true, 'length', true], [true, 'tool_calls', false], [true, null, true], [false, 'tool_calls', true], [false, 'stop', false], [false, null, true]]) {
    const { llm, requests } = fixture([event(calls ? { tool_calls: [fragment()] } : { content: 'answer' }, finish)], { done })
    const out = []
    let failure
    try { for await (const delta of llm.stream([], { nativeTools: descriptors() })) out.push(delta) } catch (error) { failure = error }
    expect(failure).toBeTruthy()
    expect(out.some(x => x.kind === 'tool_call')).toBe(false)
    expect(requests).toHaveLength(1)
    expect(failure.metadata?.diagnostics).toBeTruthy()
  }
})

test('network failure after a tool fragment is not retried and records diagnostics', async () => {
  let requests = 0
  const encoder = new TextEncoder()
  const llm = inference({ provider: 'openai', model: 'fixture', retries: 3, retryDelay: 0 }, { fetch: async () => {
    requests++
    let sent = false
    return new Response(new ReadableStream({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(encoder.encode(`data: ${JSON.stringify(event({ tool_calls: [fragment()] }))}\n\n`)) }
      else controller.error(new Error('connection lost'))
    } }))
  } })
  const out = []
  let failure
  try { for await (const delta of llm.stream([], { nativeTools: descriptors() })) out.push(delta) } catch (error) { failure = error }
  expect(requests).toBe(1)
  expect(out.map(x => x.kind)).toEqual(['tool_fragment'])
  expect(failure).toMatchObject({ code: 'truncated', metadata: { finishReason: 'missing', diagnostics: { reasoningChars: 0, contentChars: 0 } } })
})

test('cancellation after a buffered fragment never emits a completed native proposal', async () => {
  const controller = new AbortController()
  const { llm, requests } = fixture([event({ tool_calls: [fragment()] }, 'tool_calls')])
  const out = []
  let failure
  try {
    for await (const delta of llm.stream([], { nativeTools: descriptors(), signal: controller.signal })) {
      out.push(delta)
      if (delta.kind === 'tool_fragment') controller.abort()
    }
  } catch (error) { failure = error }
  expect(failure?.code).toBe('aborted')
  expect(out.map(delta => delta.kind)).toEqual(['tool_fragment'])
  expect(requests).toHaveLength(1)
})

test('only fully completed invalid candidates expose repair metadata', async () => {
  for (const [fragments, finish, done, repairable] of [
    [[fragment('[')], 'tool_calls', true, true],
    [[fragment('[]')], 'tool_calls', true, true],
    [[fragment('{}', { function: { name: 'unknown', arguments: '{}' } })], 'tool_calls', true, true],
    [[fragment('[')], 'tool_calls', false, false],
    [[fragment('[')], 'length', true, false],
    [[fragment('[')], 'stop', true, false],
    [[fragment('[')], null, true, false],
    [[fragment('['), fragment('{}', { index: 1, id: 'call_2' })], 'tool_calls', true, false],
    [[fragment('{}', { function: { name: 'read_file', arguments: {} } })], 'tool_calls', true, false],
    [[fragment('{}', { id: '' })], 'tool_calls', true, false],
  ]) {
    const { llm, requests } = fixture([event({ content: 'Raw accompanying text', tool_calls: fragments }, finish)], { done })
    let failure
    try { await collect(llm.stream([], { nativeTools: descriptors() })) } catch (error) { failure = error }
    expect(Boolean(failure.metadata?.rejectedNativeReply)).toBe(repairable)
    if (repairable) {
      expect(failure.metadata).toMatchObject({ transportComplete: true, finishReason: 'tool_calls', rejectedNativeReply: { text: 'Raw accompanying text', call: { function: fragments[0].function } } })
    }
    expect(requests).toHaveLength(1)
  }
})
