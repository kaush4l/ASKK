import { describe, expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { readSpec } from '../src/core/folder.js'
import { inference } from '../src/core/inference.js'
import { CompactReAct, ReAct, responseModel } from '../src/core/responses.js'
import { tool } from '../src/core/tools.js'

const setup = (replies, options = {}) => {
  const llm = inference({ provider: 'scripted', replies, maxOutputTokens: 256 })
  const engine = new Engine({ name: 'fixture', llm: async () => llm, maxSteps: 3, ...options })
  const events = []
  engine.listen((event) => events.push(event))
  return { engine, events }
}
const sse = (events) => new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))

describe('dispatch and termination boundaries', () => {
  test('malformed responses exhaust bounded repairs without becoming an answer', async () => {
    const { engine, events } = setup(['This is not the contract.'], { repairs: 1 })
    expect(await engine.invoke('read the fixture')).toContain('failed')
    expect(engine.progress()).toMatchObject({ status: 'failed', terminationReason: 'invalid_response', attempts: 2 })
    expect(events.some((event) => event.kind === 'answer')).toBe(false)
    const prompts = events.filter((event) => event.kind === 'prompt')
    expect(new Set(prompts.map((event) => event.attemptId)).size).toBe(2)
    expect(prompts[0].requestSnapshot.messages[1].content).not.toContain('REJECTED')
    expect(prompts[1].requestSnapshot.messages[1].content).toContain('REJECTED')
    expect(Object.isFrozen(prompts[0].requestSnapshot.messages[0])).toBe(true)
  })

  test('a final budget summary stays incomplete even when the model says done', async () => {
    let calls = 0
    const { engine } = setup(['do: tool\nact: ping({})', 'do: done\nact: All finished.'], {
      maxSteps: 1, tools: [tool({ name: 'ping', run: () => ++calls })],
    })
    expect(await engine.invoke('work')).toBe('All finished.')
    expect(calls).toBe(1)
    expect(engine.progress()).toMatchObject({ status: 'incomplete', terminationReason: 'step_budget' })
  })

  test('cancellation after the final model delta cannot become a completed answer', async () => {
    const controller = new AbortController()
    const llm = { model: 'fixture', settings: { maxOutputTokens: 256 }, context: async () => 32768, async *stream() {
      yield { kind: 'text', text: '{"do":"done","act":"Too late"}' }
      controller.abort()
    } }
    const engine = new Engine({ name: 'fixture', llm: async () => llm, contractVersion: 2 })
    expect(await engine.invoke('finish', { signal: controller.signal })).toContain('cancelled:')
    expect(engine.progress()).toMatchObject({ status: 'cancelled', terminationReason: 'cancelled' })
  })

  test('malformed legacy actions dispatch none of an otherwise valid prefix', async () => {
    const legacy = responseModel(ReAct, 'json')
    for (const act of ['[[ping({})', 'ping({}) followed by nonsense', '[[ping({}), missing]]', '[[ping({}),]]', '[[ping({})}]]', [[{ name: 'ping', args: {} }]], { name: 'ping', args: {} }]) {
      const parsed = legacy.parse(JSON.stringify({ do: 'tool', act }))
      expect(parsed.faults.length).toBeGreaterThan(0)
    }
    let calls = 0
    const { engine } = setup(['do: tool\nact: [[ping({}), missing]]'], { repairs: 0, tools: [tool({ name: 'ping', run: () => ++calls })] })
    await engine.invoke('go')
    expect(calls).toBe(0)
  })

  test('version 2 JSON normalizes stages and rejects legacy strings and unknown modes', async () => {
    const response = responseModel(CompactReAct, 'json')
    const parsed = response.parse('{"do":"tool","act":[[{"name":"ping","args":{"text":"a, [b)"}}]]}')
    expect(parsed.faults).toEqual([])
    expect(response.calls(parsed.value)[0][0]).toEqual({ name: 'ping', args: { text: 'a, [b)' }, text: 'ping({"text":"a, [b)"})' })
    for (const raw of ['{"do":"ping","act":"ping({})"}', '{"do":"tool","act":"ping({})"}', 'prefix {"do":"done","act":"ok"}', '{"do":"tool","act":[[]]}']) expect(response.parse(raw).faults.length).toBeGreaterThan(0)
    const { engine } = setup(['{"do":"tool","act":[[{"name":"ping","args":{}}]]}', '{"do":"done","act":"42"}'], {
      contractVersion: 2, tools: [tool({ name: 'ping', run: () => 42 })],
    })
    expect(await engine.invoke('read')).toBe('42')
    expect(engine.status).toBe('done')
  })

  test('version 2 history and repair prompts demonstrate the complete configured envelope', async () => {
    const call = { do: 'tool', act: [[{ name: 'read_fixture', args: {} }]] }
    const answer = { do: 'done', act: '42' }
    const { engine, events } = setup([
      JSON.stringify(call),
      (messages) => {
        expect(messages[1].content).toContain(`assistant: ${JSON.stringify(call)}`)
        expect(messages[1].content).not.toContain('assistant: [[{')
        return JSON.stringify(call.act) // Reproduce the rejected bare-array shape.
      },
      (messages) => {
        const repair = messages[1].content.split('YOUR LAST REPLY WAS REJECTED').at(-1)
        expect(repair).toContain(`Tool example: ${JSON.stringify({ do: 'tool', act: [[{ name: 'read_fixture', args: {} }]] })}`)
        expect(repair).toContain('Contract version 2. Reply with a single JSON object')
        return JSON.stringify(answer)
      },
    ], { contractVersion: 2, tools: [tool({ name: 'read_fixture', run: () => 42 })] })
    expect(await engine.invoke('Read the fixture')).toBe('42')
    const assistantTurns = engine.history.filter((turn) => turn.role === 'assistant')
    expect(assistantTurns.map((turn) => JSON.parse(turn.content))).toEqual([call, answer])
    for (const turn of assistantTurns) expect(engine.response.parse(turn.content).faults).toEqual([])
    expect(events.filter((event) => event.kind === 'call')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'repair')).toHaveLength(1)
  })

  test('persisted version 2 bare tool history migrates without changing live acceptance or historical prose', async () => {
    const act = [[{ name: 'read_fixture', args: { path: 'already-read.txt' } }]]
    const unchanged = ['A prior answer.', '[{"name":"read_fixture","args":{}}]', '[[{"name":"read_fixture","args":{},"unexpected":true}]]', '[[{"name":"read_fixture","args":null}]]', '[[]]']
    const stored = [{ role: 'assistant', content: JSON.stringify(act), at: 123 }, ...unchanged.map(content => ({ role: 'assistant', content })), { role: 'user', content: JSON.stringify(act) }]
    const { engine } = setup([(messages) => {
      expect(messages[1].content).toContain(`assistant: ${JSON.stringify({ do: 'tool', act })}`)
      return '{"do":"done","act":"Read the saved session"}'
    }], { contractVersion: 2, history: structuredClone(stored) })
    expect(await engine.invoke('Continue this saved session')).toBe('Read the saved session')
    expect(engine.history[0]).toEqual({ role: 'assistant', content: JSON.stringify({ do: 'tool', act }), at: 123 })
    expect(engine.history.slice(1, stored.length)).toEqual(stored.slice(1))
    expect(engine.response.parse(JSON.stringify(act)).faults.length).toBeGreaterThan(0)
    const legacy = setup([], { contractVersion: 1, history: structuredClone(stored) }).engine
    expect(legacy.history).toEqual(stored)
  })

  test('reads and writes execute again and repeated text has distinct call IDs', async () => {
    let state = 0
    let reads = 0
    const { engine, events } = setup(['do: tool\nact: [[read({})], [write({})], [read({})], [write({})]]', 'do: done\nact: checked'], {
      tools: [tool({ name: 'read', run: () => { reads += 1; return state } }), tool({ name: 'write', writes: true, run: () => ++state })],
    })
    await engine.invoke('change then read')
    expect(reads).toBe(2)
    expect(state).toBe(2)
    expect(engine.history[2].content).toContain('read({}) -> 1')
    const ids = events.filter((event) => event.kind === 'call').map((event) => event.callId)
    expect(new Set(ids).size).toBe(4)
    expect(events.filter((event) => event.kind === 'observation').map((event) => event.callId)).toEqual(ids)
  })

  test('failed cached tools remain retryable', async () => {
    let count = 0
    const { engine } = setup(['do: tool\nact: [[read({})], [read({})]]', 'do: done\nact: ok'], {
      tools: [tool({ name: 'read', cacheable: true, run: () => { if (++count === 1) throw new Error('temporarily missing'); return 42 } })],
    })
    await engine.invoke('retry')
    expect(count).toBe(2)
  })

  test('completion evidence can reject a claimed answer and later accept verified work', async () => {
    let checked = 0
    let written = false
    const { engine, events } = setup(['do: done\nact: Claimed.', 'do: tool\nact: write({})', 'do: done\nact: Verified.'], {
      tools: [tool({ name: 'write', run: () => { written = true; return 'ok' } })],
      verifyCompletion: async () => { checked += 1; return { ok: written, reason: written ? 'build checked' : 'missing build evidence' } },
    })
    expect(await engine.invoke('build')).toBe('Verified.')
    expect(checked).toBe(2)
    expect(events.filter((event) => event.kind === 'answer').map((event) => event.value)).toEqual(['Verified.'])
    expect(engine.history.some((turn) => turn.role === 'observation' && turn.content.includes('Completion was rejected'))).toBe(true)
  })
})

describe('provider receipts and budgets', () => {
  test('a valid tool-shaped response cut off by the provider never dispatches', async () => {
    let calls = 0
    const llm = inference({ provider: 'openai', model: 'qwen', maxOutputTokens: 128, retries: 1 }, {
      fetch: async () => sse([{ choices: [{ delta: { content: 'do: tool\nact: ping({})' } }] }, { choices: [{ finish_reason: 'length', delta: {} }], usage: { prompt_tokens: 32, completion_tokens: 128 } }, '[DONE]']),
    })
    const { engine, events } = setup([], { llm: async () => llm, tools: [tool({ name: 'ping', run: () => ++calls })] })
    await engine.invoke('read')
    expect(calls).toBe(0)
    expect(engine.progress()).toMatchObject({ status: 'failed', terminationReason: 'truncated' })
    expect(events.find((event) => event.kind === 'completion')).toMatchObject({ finishReason: 'length', usage: { prompt_tokens: 32, completion_tokens: 128 } })
    expect(events.find((event) => event.kind === 'completion').diagnostics).toEqual({ reasoningChars: 0, contentChars: 'do: tool\nact: ping({})'.length, contentSuffix: 'do: tool\nact: ping({})' })
  })

  test('unexpected SSE EOF is not a valid completed response', async () => {
    const llm = inference({ provider: 'openai', retries: 1 }, { fetch: async () => sse([{ choices: [{ delta: { content: 'do: done\nact: success' } }] }]) })
    await expect(llm.invoke([{ role: 'user', content: 'go' }])).rejects.toThrow('missing')
  })

  test('completion diagnostics count each stream separately and retain only truncated content suffixes', async () => {
    const reasoning = 'private reasoning '.repeat(180)
    const content = `${'start '.repeat(120)}final response fragment`
    const usage = { prompt_tokens: 71, completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 7168 } }
    const receipts = []
    let attempt = 0
    const llm = inference({ provider: 'openai', model: 'fixture', retries: 1 }, { fetch: async () => ++attempt === 1 ? sse([
      { choices: [{ delta: { reasoning_content: reasoning } }] },
      { choices: [{ delta: { content: content.slice(0, 380) } }] },
      { choices: [{ delta: { reasoning: 'last thought', content: content.slice(380) } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }], usage }, '[DONE]',
    ]) : sse([
      { choices: [{ delta: { reasoning_content: 'short', content: 'ok' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]',
    ]) })
    let failure
    try { await llm.invoke([{ role: 'user', content: 'go' }], { onFinish: (receipt) => receipts.push(receipt) }) }
    catch (error) { failure = error }
    expect(failure.code).toBe('truncated')
    expect(failure.metadata).toBe(receipts[0])
    expect(receipts[0].usage).toEqual(usage)
    expect(receipts[0].diagnostics).toEqual({ reasoningChars: reasoning.length + 'last thought'.length, contentChars: content.length, contentSuffix: content.slice(-512) })
    expect(receipts[0].diagnostics.contentSuffix).toHaveLength(512)
    expect(Object.isFrozen(receipts[0].diagnostics)).toBe(true)
    expect(JSON.stringify(receipts[0])).not.toContain('private reasoning')
    expect(await llm.invoke([{ role: 'user', content: 'next' }], { onFinish: (receipt) => receipts.push(receipt) })).toBe('ok')
    expect(receipts[1].usage).toBeNull()
    expect(receipts[1].diagnostics).toEqual({ reasoningChars: 5, contentChars: 2 })
    expect(receipts[1].diagnostics).not.toHaveProperty('contentSuffix')
  })

  test('a CLI process failure after valid-looking stdout cannot complete', async () => {
    const llm = inference({ provider: 'cli', command: 'fixture', retries: 1 }, {
      run: async () => new Response('{"out":"do: done\\nact: finished"}\n{"code":1}\n'),
    })
    await expect(llm.invoke([{ role: 'user', content: 'go' }])).rejects.toThrow('exited 1')
  })

  test('a CLI stream missing its exit receipt records truncation with unknown usage', async () => {
    const receipts = []
    const llm = inference({ provider: 'cli', command: 'fixture', retries: 1 }, {
      run: async () => new Response('{"out":"partial response"}\n'),
    })
    await expect(llm.invoke([{ role: 'user', content: 'go' }], { onFinish: (receipt) => receipts.push(receipt) })).rejects.toThrow('without an exit status')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toEqual({ finishReason: 'missing', usage: null, diagnostics: { reasoningChars: 0, contentChars: 16, contentSuffix: 'partial response' } })
  })

  test('Anthropic max_tokens rejects otherwise valid text and preserves usage', async () => {
    const receipts = []
    const llm = inference({ provider: 'anthropic', retries: 1 }, { fetch: async () => sse([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'consider' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'do: done\nact: ok' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 200 } },
      { type: 'message_stop' },
    ]) })
    await expect(llm.invoke([{ role: 'user', content: 'go' }], { onFinish: (receipt) => receipts.push(receipt) })).rejects.toThrow('max_tokens')
    expect(receipts[0].usage).toEqual({ input_tokens: 100, output_tokens: 200 })
    expect(receipts[0].diagnostics).toEqual({ reasoningChars: 8, contentChars: 16, contentSuffix: 'do: done\nact: ok' })
  })

  test('transport retries retain the exact request and redact authentication', async () => {
    const settings = { provider: 'openai', model: 'before', apiKey: 'secret-bearer', headers: { 'x-custom-secret': 'secret-header' }, retries: 2, retryDelay: 1 }
    const requests = []
    const sent = []
    const messages = [{ role: 'user', content: 'original' }]
    const llm = inference(settings, { fetch: async (_, init) => {
      sent.push(JSON.parse(init.body))
      settings.model = 'after'
      settings.headers['x-custom-secret'] = 'changed'
      messages[0].content = 'edited'
      return sent.length === 1 ? new Response('busy', { status: 503 }) : sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]'])
    } })
    expect(await llm.invoke(messages, { onRequest: (request) => requests.push(request) })).toBe('ok')
    expect(sent[0]).toEqual(sent[1])
    expect(sent[0]).toMatchObject({ model: 'before', messages: [{ role: 'user', content: 'original' }] })
    expect(JSON.stringify(requests)).not.toContain('secret-bearer')
    expect(JSON.stringify(requests)).not.toContain('secret-header')
    expect(requests.map((request) => request.transportAttempt)).toEqual([1, 2])
    expect(Object.isFrozen(requests[0].body.messages[0])).toBe(true)
  })

  test('system prompt, tools, context and reserved output all count before inference', async () => {
    let sent = 0
    const llm = { model: 'limited', settings: { maxOutputTokens: 128 }, context: async () => 600, async *stream() { sent += 1; yield { kind: 'text', text: 'do: done\nact: ok' } } }
    const { engine, events } = setup([], { llm: async () => llm, systemPrompt: 'long system '.repeat(200), tools: [tool({ name: 'read', description: 'description '.repeat(100), run: () => 0 })] })
    await engine.invoke('tiny goal')
    expect(sent).toBe(0)
    expect(engine.progress().terminationReason).toBe('context_budget')
    const budget = events.find((event) => event.kind === 'prompt').requestSnapshot.budget
    expect(budget.inputTokens).toBeGreaterThan(600)
    expect(budget.outputReserve).toBe(128)
  })

  test('failed or empty compression leaves the original history untouched', async () => {
    for (const summarise of [async () => { throw new Error('offline') }, async () => '', async () => '(failed: unavailable)', async () => '(cancelled: stopped by the owner)', async () => '(interrupted: the tab closed)']) {
      const history = Array.from({ length: 8 }, (_, index) => ({ role: 'user', content: `${index} ${'history '.repeat(200)}` }))
      const { engine, events } = setup([], { history, keep: 2, compactAt: 0.001, summarise })
      await engine.compress()
      expect(engine.history).toBe(history)
      expect(engine.history).toHaveLength(8)
      expect(events.some((event) => event.kind === 'compaction_failed')).toBe(true)
    }
  })
})

test('folder prompt templates and version 2 are explicit, hashed configuration', async () => {
  const files = {
    'agents/main/agent.md': '---\ncontract_version: 2\nprompt_template: prompts/default.md\nrequire_verification: true\n---\nDo the task.',
    'prompts/default.md': '{{soul}}\n{{job}}\n{{tools}}\n<!-- user -->\n{{conversation}}\n{{response}}{{note}}',
  }
  const spec = await readSpec('main', { index: { files: Object.fromEntries(Object.keys(files).map((key) => [key, 'hash'])) }, load: async (file) => files[file] })
  expect(spec.engine).toMatchObject({ contractVersion: 2, responseFormat: 'json', requireVerification: true })
  const { engine } = setup([], { ...spec.engine, systemPrompt: spec.body })
  const { messages } = await engine.render()
  expect(messages[0].content).toContain('Do the task.')
  expect(messages[1].content).toContain('Contract version 2')
})

test('steering arriving during inference discards the pending tool proposal', async () => {
  let engine; let attempt = 0; let calls = 0
  const llm = {
    settings: { context_length: 32768 },
    context: () => 32768,
    async *stream() {
      if (attempt++ === 0) {
        engine.nudge('Do not modify files; answer with the new instruction')
        yield { kind: 'text', text: JSON.stringify({ do: 'tool', act: [[{ name: 'touch', args: {} }]] }) }
      } else {
        yield { kind: 'text', text: JSON.stringify({ do: 'done', act: 'I followed the updated instruction.' }) }
      }
    },
  }
  engine = new Engine({ name: 'steering', contractVersion: 2, llm: async () => llm, tools: [{ name: 'touch', description: 'write', parameters: {}, run: () => { calls++; return 'written' } }] })
  expect(await engine.invoke('Write a file')).toContain('updated instruction')
  expect(calls).toBe(0)
  expect(engine.history.some(row => row.role === 'user' && row.note && row.content.includes('Do not modify'))).toBe(true)
})
