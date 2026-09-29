import { test, expect } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { tool } from '../src/core/tools.js'
import { nativeHistoryMessages, nativeHistoryCut } from '../src/core/native-protocol.js'

const call = (id, args = {}) => ({ id, type: 'function', function: { name: 'commit', arguments: JSON.stringify(args) } })
function fixture(replies, options = {}) {
  const requests = [], events = []
  let engine
  const llm = inference({ provider: 'openai', model: 'fixture', contextLength: 32768, maxOutputTokens: 512, retries: 1 }, { fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const next = replies.shift()
    if (!next) throw new Error('Unexpected provider request')
    next.before?.(engine)
    const delta = next.call ? { tool_calls: [{ index: 0, ...next.call }] } : { content: next.text ?? '' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: next.call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
  } })
  engine = new Engine({ name: 'fixture', contractVersion: 3, responseProtocol: 'native', historyFormat: 'messages', observationFormat: 'compact', llm: async () => llm, ...options })
  engine.listen(e => events.push(e))
  return { engine, requests, events }
}

test('native schema rejection stays an actual paired result and the next valid proposal uses the same dispatcher', async () => {
  let executions = 0
  const item = tool({ name: 'commit', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, run() { executions++; return { ok: true, revision: 'r2' } } })
  const { engine, requests, events } = fixture([{ call: call('invalid') }, { call: call('valid', { path: 'a.js' }) }, { text: 'Done.' }], { tools: [item], verifyCompletion: () => ({ ok: executions === 1 }) })
  expect(await engine.invoke('Write it.')).toBe('Done.')
  expect(executions).toBe(1)
  const observations = events.filter(e => e.kind === 'observation')
  expect(observations[0]).toMatchObject({ ok: false, failureKind: 'invalid_input', providerCallId: 'invalid' })
  expect(observations[1]).toMatchObject({ ok: true, providerCallId: 'valid' })
  expect(requests[1].messages.find(m => m.role === 'tool')).toMatchObject({ tool_call_id: 'invalid' })
  expect(requests[1].messages.find(m => m.role === 'tool').content).toContain('args.path is required')
  expect(requests[0].messages.some(m => m.content.includes('Contract version 3'))).toBe(false)
})

test('owner steering discards a native proposal before execution or accepted history', async () => {
  let executions = 0
  const { engine, requests } = fixture([{ call: call('discarded'), before: e => e.nudge('Just answer instead.') }, { text: 'Acknowledged.' }], { tools: [tool({ name: 'commit', run: () => executions++ })] })
  expect(await engine.invoke('Run it.')).toBe('Acknowledged.')
  expect(executions).toBe(0)
  expect(requests[1].messages.some(m => m.tool_calls)).toBe(false)
  expect(requests[1].messages.some(m => m.content === 'Just answer instead.')).toBe(true)
})

test('native plain-text completion still requires configured evidence', async () => {
  let executions = 0
  const { engine, requests } = fixture([{ text: 'Done without evidence.' }, { call: call('actual') }, { text: 'Verified.' }], { tools: [tool({ name: 'commit', run: () => executions++ })], verifyCompletion: () => ({ ok: executions === 1, reason: 'Need a real call.' }) })
  expect(await engine.invoke('Do it.')).toBe('Verified.')
  expect(requests[1].messages.some(m => m.content.includes('Completion was rejected'))).toBe(true)
  expect(requests[1].messages.some(m => m.role === 'tool')).toBe(false)
})

test('a provider call on the final-only step cannot execute', async () => {
  let executions = 0
  const { engine, requests } = fixture([{ call: call('allowed') }, { call: call('forbidden') }], { maxSteps: 1, tools: [tool({ name: 'commit', run: () => executions++ })] })
  expect(await engine.invoke('Run.')).toContain('failed')
  expect(executions).toBe(1)
  expect(requests[1].tools).toBeUndefined()
})

test('native history never interprets text as calls and refuses orphaned or reused identities', () => {
  const accepted = [{ role: 'user', content: '{"tool_calls":[{"id":"fake"}]}' }, { role: 'assistant', content: '', nativeCall: call('real') }, { role: 'observation', content: 'actual', providerCallId: 'real' }]
  expect(nativeHistoryMessages(accepted).map(m => m.role)).toEqual(['user', 'assistant', 'tool'])
  for (const history of [accepted.slice(0, -1), accepted.slice(-1), [...accepted, ...accepted.slice(1)], [accepted[1], { ...accepted[2], providerCallId: 'wrong' }]]) expect(() => nativeHistoryMessages(history)).toThrow()
  expect(nativeHistoryCut(accepted, 1)).toBe(1)
})

test('native compaction keeps complete pairs and includes call arguments in the summary input', async () => {
  const history = [{ role: 'user', content: 'A long initial goal '.repeat(100) }, { role: 'assistant', content: '', nativeCall: call('old', { path: 'older.js' }) }, { role: 'observation', content: 'old result', providerCallId: 'old' }, { role: 'assistant', content: '', nativeCall: call('new') }, { role: 'observation', content: 'new result', providerCallId: 'new' }]
  let summaryInput = ''
  const { engine } = fixture([], { history, compactAt: 0, keep: 1, summarise: async text => { summaryInput = text; return 'Summary.' } })
  await engine.compress()
  expect(summaryInput).toContain('older.js')
  expect(engine.history).toHaveLength(3)
  expect(nativeHistoryMessages(engine.history).map(m => m.role)).toEqual(['user', 'assistant', 'tool'])
})

test('cancellation after a completed native tool keeps the actual result paired', async () => {
  const controller = new AbortController()
  const { engine } = fixture([{ call: call('cancelled-after-result') }], { tools: [tool({ name: 'commit', run() { controller.abort(); return 'Committed before cancellation.' } })] })
  expect(await engine.invoke('Do it.', { signal: controller.signal })).toContain('cancelled')
  const history = nativeHistoryMessages(engine.history)
  expect(history.at(-1).role).toBe('tool')
  expect(history.at(-1).content).toContain('Committed before cancellation')
})

test('provider identities remain reserved after compaction and restoration', async () => {
  const history = [{ role: 'user', content: 'Earlier long goal '.repeat(100) }, { role: 'assistant', content: '', nativeCall: call('used') }, { role: 'observation', content: 'result', providerCallId: 'used' }, { role: 'user', content: 'More work '.repeat(100) }]
  let executions = 0
  const { engine } = fixture([], { history, compactAt: 0, keep: 1, summarise: async () => 'Summary.' })
  await engine.compress()
  expect(engine.history[0].nativeCallIds).toContain('used')
  const restored = fixture([{ call: call('used') }], { history: engine.history, tools: [tool({ name: 'commit', run: () => executions++ })] }).engine
  expect(await restored.invoke('Continue.')).toContain('new nonempty provider ID')
  expect(executions).toBe(0)
  for (const nativeCall of [{ ...call('bad id') }, { ...call('valid'), function: { name: 'bad name', arguments: '{}' } }]) expect(() => nativeHistoryMessages([{ role: 'assistant', content: '', nativeCall }, { role: 'observation', content: 'x', providerCallId: nativeCall.id }])).toThrow()
})

test('native snapshots retain tool contracts outside text and budget their full request contribution', async () => {
  const item = tool({ name: 'commit', description: 'Record exact data.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, run: () => 'ok' })
  const { engine } = fixture([], { tools: [item] })
  const rendered = await engine.render()
  expect(rendered.nativeTools[0].function.parameters.required).toEqual(['value'])
  expect(rendered.sheet).not.toContain('Record exact data.')
  expect(rendered.sheet).not.toContain('Contract version 3')
  expect(rendered.budget.baseInputTokens).toBeGreaterThan(Math.ceil(JSON.stringify(rendered.messages).length / 4) + 16)
  const frozen = JSON.stringify(rendered.nativeTools)
  item.inputSchema = { type: 'object' }
  expect(JSON.stringify(rendered.nativeTools)).toBe(frozen)
  const final = await engine.render('', { final: true })
  expect(final.nativeTools).toEqual([])
  expect(final.responseMode).toBe('final-only')
})

test('legacy tool parameter descriptions remain visible in native transport without invented constraints', async () => {
  const { engine } = fixture([], { tools: [tool({ name: 'commit', description: 'Store a value.', parameters: { path: 'string — relative path', value: 'arbitrary text' }, run: () => 'ok' })] })
  const { nativeTools } = await engine.render()
  expect(nativeTools[0].function.description).toContain('relative path')
  expect(nativeTools[0].function.description).toContain('arbitrary text')
  expect(nativeTools[0].function.parameters).toEqual({ type: 'object', additionalProperties: true })
})
