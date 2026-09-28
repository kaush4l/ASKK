/**
 * Every provider against a real HTTP server speaking its wire format: OpenAI's SSE, Anthropic's
 * SSE, and a CLI's NDJSON as the host bridge sends it. The servers record what they were sent,
 * so the tests check the URL a base_url override produced and the headers that went with it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { anthropicBase, inference, openaiBase } from '../src/core/inference.js'
import { resolve } from '../src/core/models.js'

let server
let base
const seen = []

test('configured request parameters reach the provider and its exact request record without replacing owned fields', async () => {
  const config = resolve({}, { default: 'local', models: { local: { provider: 'openai', model: 'fixture', request_params: { chat_template_kwargs: { enable_thinking: false } } } } })
  const recorded = []
  const llm = inference(config, { fetch: async (_, init) => { recorded.push(JSON.parse(init.body)); return sse([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }, '[DONE]']) } })
  let receipt
  expect(await llm.invoke([{ role: 'user', content: 'fixture' }], { onRequest: value => { receipt = value } })).toBe('done')
  expect(recorded[0].chat_template_kwargs).toEqual({ enable_thinking: false })
  expect(receipt.body).toEqual(recorded[0])
  const blocked = inference({ ...config, requestParams: { messages: [] } }, { fetch: () => { throw new Error('must not dispatch') } })
  await expect(blocked.invoke([{ role: 'user', content: 'fixture' }])).rejects.toThrow('cannot override')
})

const sse = (events) =>
  new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
  })

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === 'POST' ? await request.json() : null
      seen.push({ path: url.pathname, headers: Object.fromEntries(request.headers), body })
      if (url.pathname.startsWith('/broken')) return new Response('{"error":"overloaded"}', { status: 529 })
      if (url.pathname.endsWith('/chat/completions')) {
        return sse([
          { choices: [{ delta: { reasoning_content: 'hm' } }] },
          { choices: [{ delta: { content: 'do: done\n\n' } }] },
          { choices: [{ delta: { content: `act: openai via ${url.pathname}` } }] },
          '[DONE]',
        ])
      }
      if (url.pathname.endsWith('/v1/messages')) {
        return sse([
          { type: 'message_start' },
          { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: `anthropic ${body.system}` } },
          { type: 'message_stop' },
        ])
      }
      if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'm-1', context_length: 4096 }] })
      return new Response('no', { status: 404 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(() => server?.stop(true))

const messages = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'hi' },
]
const last = () => seen.at(-1)
const collect = async (llm) => {
  const out = { text: '', reasoning: '' }
  for await (const delta of llm.stream(messages)) out[delta.kind] += delta.text
  return out
}

describe('base URL overrides', () => {
  test('openai: any base, with or without /v1 or the endpoint, reaches /…/chat/completions', async () => {
    for (const [given, path] of [
      [`${base}/v1`, '/v1/chat/completions'],
      [base, '/v1/chat/completions'],
      [`${base}/api/v1/`, '/api/v1/chat/completions'],
      [`${base}/openai/v1/chat/completions`, '/openai/v1/chat/completions'],
    ]) {
      const out = await collect(inference({ provider: 'openai', model: 'm', baseUrl: given, apiKey: 'sk-test', headers: { 'X-Title': 'HARNESS' } }))
      expect(out.text).toBe(`do: done\n\nact: openai via ${path}`)
      expect(out.reasoning).toBe('hm')
      expect(last().headers.authorization).toBe('Bearer sk-test')
      expect(last().headers['x-title']).toBe('HARNESS')
      expect(last().body).toMatchObject({ model: 'm', stream: true, messages })
    }
  })

  test('anthropic: base with or without /v1 reaches /v1/messages with the browser header', async () => {
    for (const given of [base, `${base}/v1`, `${base}/v1/`]) {
      const out = await collect(inference({ provider: 'anthropic', model: 'claude-x', baseUrl: given, apiKey: 'ak', headers: { 'x-gateway': 'g' } }))
      expect(out.text).toBe('anthropic SYS')
      expect(out.reasoning).toBe('hm')
      expect(last().path).toBe('/v1/messages')
      expect(last().headers).toMatchObject({ 'x-api-key': 'ak', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'x-gateway': 'g' })
      expect(last().body.messages).toEqual([{ role: 'user', content: 'hi' }])
    }
  })

  test('models are listed from the overridden base', async () => {
    expect(await inference({ provider: 'openai', baseUrl: base }).models()).toEqual([{ id: 'm-1', contextLength: 4096 }])
    expect(last().path).toBe('/v1/models')
    await inference({ provider: 'anthropic', baseUrl: base }).models()
    expect(last().path).toBe('/v1/models')
  })

  test('bases normalise without a server', () => {
    expect(openaiBase({ baseUrl: 'https://api.openai.com' })).toBe('https://api.openai.com/v1')
    expect(openaiBase({ baseUrl: 'https://x.openai.azure.com/openai/deployments/d' })).toBe('https://x.openai.azure.com/openai/deployments/d')
    expect(anthropicBase({})).toBe('https://api.anthropic.com/v1')
  })

  test('a server error is reported with its status, after retries', async () => {
    const llm = inference({ provider: 'openai', baseUrl: `${base}/broken/v1`, retries: 2, retryDelay: 1 })
    await expect(collect(llm)).rejects.toThrow(/HTTP 529.*overloaded/)
  })
})

/** A `run` that answers the way the bridge's /run does, printing `lines` from a fake program. */
const fakeRun = (lines, { code = 0, err = '' } = {}) => {
  const calls = []
  const run = async (body) => {
    calls.push(body)
    const events = [...lines.map((out) => ({ out })), ...(err ? [{ err }] : []), { code }]
    return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(''), { headers: { 'content-type': 'application/x-ndjson' } })
  }
  return { run, calls }
}

describe('cli provider', () => {
  test('claude: flags switch its tools off, the system goes by flag, stream-json deltas come through', async () => {
    const stream = [
      { type: 'system', subtype: 'init' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'think' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'do: done\n\n' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'act: pong' } } },
      { type: 'result', subtype: 'success', result: 'do: done\n\nact: pong' },
    ]
    // Split mid-line, the way a pipe delivers it.
    const text = stream.map((item) => JSON.stringify(item)).join('\n') + '\n'
    const { run, calls } = fakeRun([text.slice(0, 50), text.slice(50, 333), text.slice(333)])
    const out = await collect(inference({ provider: 'cli', cli: 'claude', model: 'haiku' }, { run }))
    expect(out).toEqual({ text: 'do: done\n\nact: pong', reasoning: 'think' })
    const [call] = calls
    expect(call.program).toBe('claude')
    expect(call.stdin).toBe('hi')
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--tools', '', '--system-prompt', 'SYS', '--model', 'haiku']))
  })

  test('claude: only a result line (no partials) is still the reply; is_error is a failure', async () => {
    const ok = fakeRun([`${JSON.stringify({ type: 'result', result: 'act: late' })}\n`])
    expect((await collect(inference({ provider: 'cli', cli: 'claude' }, { run: ok.run }))).text).toBe('act: late')
    const bad = fakeRun([`${JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' })}\n`])
    await expect(collect(inference({ provider: 'cli', cli: 'claude', retries: 1 }, { run: bad.run }))).rejects.toThrow('Not logged in')
  })

  test('a plain command gets system + conversation on stdin and its stdout is the reply', async () => {
    const { run, calls } = fakeRun(['do: done\n', '\nact: from llm'])
    const out = await collect(inference({ provider: 'cli', command: 'llm', args: ['-m', 'x'] }, { run }))
    expect(out.text).toBe('do: done\n\nact: from llm')
    expect(calls[0]).toMatchObject({ program: 'llm', args: ['-m', 'x'], stdin: 'SYS\n\nhi' })
  })

  test('a failing CLI says its exit code and stderr; no bridge says to pair it', async () => {
    const { run } = fakeRun([], { code: 1, err: 'please log in' })
    await expect(collect(inference({ provider: 'cli', cli: 'codex', retries: 1 }, { run }))).rejects.toThrow(/exited 1: please log in/)
    await expect(collect(inference({ provider: 'cli', retries: 1 }))).rejects.toThrow(/host bridge/)
  })

  test('an agent folder cannot name the program a CLI model runs', () => {
    const catalogue = { default: 'c', models: { c: { provider: 'cli', cli: 'claude', model: 'sonnet' } } }
    const settings = resolve({ model: 'c', command: 'sh', args: ['-c', 'rm -rf ~'], cli: 'codex' }, catalogue)
    expect(settings).toMatchObject({ provider: 'cli', cli: 'claude', model: 'sonnet', alias: 'c' })
    expect(settings.command).toBeUndefined()
    expect(resolve({ provider: 'cli', model: 'x' }, { models: {} }).provider).toBe('openai')
  })
})
