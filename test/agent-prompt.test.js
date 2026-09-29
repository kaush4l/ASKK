import { expect, test } from 'bun:test'
import { buildAgentPrompt } from '../src/core/agent-prompt.js'
import { Engine } from '../src/core/engine.js'
import { inference, tokens } from '../src/core/inference.js'
import { CompactReAct, ReAct, responseModel } from '../src/core/responses.js'
import { tool, toolbox } from '../src/core/tools.js'

const read = tool({ name: 'read_fixture', description: 'Read the fixture.', parameters: {}, run: () => 'receipt' })
const base = { soul: 'Identity.', job: 'Use evidence.', tools: [read], response: responseModel(CompactReAct, 'json'), contextText: '__HARNESS_BUDGET__', history: [{ role: 'user', content: 'Read it.' }], window: 32768, outputReserve: 256, steps: 1, maxSteps: 4 }

test('prompt compiler is deterministic, accounts for actual messages and records layer inclusion without copying content', () => {
  const result = buildAgentPrompt(base)
  expect(result).toEqual(buildAgentPrompt(base))
  expect(result.responseMode).toBe('actions')
  expect(result.toolNames).toEqual(['read_fixture'])
  expect(result.budget.inputTokens).toBe(tokens(JSON.stringify(result.messages)) + 16)
  expect(result.budget.total).toBe(result.budget.inputTokens + 256)
  expect(result.sheet).not.toContain('__HARNESS_BUDGET__')
  expect(result.layers.find(row => row.name === 'tools')).toMatchObject({ included: true })
  expect(result.layers.every(row => Object.keys(row).sort().join(',') === 'chars,included,name')).toBe(true)
})

test('missing protocol slots are appended, repeated slots emit once, and authored values are not expanded again', () => {
  const template = { system: 'Before {{job}} after. {{tools}} {{tools}}', user: 'Literal layout {{conversation}} {{response}} {{response}}' }
  const result = buildAgentPrompt({ ...base, template, job: 'Keep {{response}} literal.', note: 'Repair this reply.' })
  expect(result.messages[0].content).toStartWith('Before Keep {{response}} literal. after.')
  expect(result.sheet.match(/## TOOLS/g)).toHaveLength(1)
  expect(result.sheet.match(/## RESPONSE FORMAT/g)).toHaveLength(1)
  expect(result.sheet.match(/Repair this reply\./g)).toHaveLength(1)
  const missing = buildAgentPrompt({ ...base, template: { system: 'Custom identity', user: '{{conversation}}' } })
  expect(missing.sheet).toContain('Custom identity')
  expect(missing.sheet).toContain('- read_fixture()')
  expect(missing.sheet).toContain('Contract version 2')
  expect(missing.layers.find(row => row.name === 'job').included).toBe(false)
})

test('zero tools and unavailable tools produce a final-only contract without invented calls in JSON and TOON', () => {
  const unavailable = tool({ name: 'secret_host', requires: ['host'], run() {} })
  const { tools } = toolbox([[unavailable]], { has: () => false })
  for (const response of [responseModel(CompactReAct, 'json'), responseModel(ReAct, 'toon')]) {
    const result = buildAgentPrompt({ ...base, tools, response })
    expect(result.responseMode).toBe('final-only')
    expect(result.toolNames).toEqual([])
    for (const absent of ['secret_host', 'tool_name', 'Tool example:', 'first(', '## TOOLS']) expect(result.sheet).not.toContain(absent)
    expect(result.sheet).toContain('no tools are available')
  }
  const legacy = buildAgentPrompt({ ...base, response: responseModel(ReAct, 'toon') })
  expect(legacy.sheet).toContain('act: [[read_fixture({})]]')
  expect(legacy.sheet).not.toContain('first(')
})

test('final step hides current tools even while preserving tool receipts in history', () => {
  const result = buildAgentPrompt({ ...base, final: true, history: [...base.history, { role: 'observation', content: 'read_fixture returned receipt' }], observationFormat: 'compact' })
  expect(result.responseMode).toBe('final-only')
  expect(result.toolNames).toEqual([])
  expect(result.sheet).not.toContain('- read_fixture()')
  expect(result.sheet).not.toContain('Tool example:')
  expect(result.sheet).toContain('read_fixture returned receipt')
  expect(result.sheet).toContain('not response envelopes')
})

function fixture(replies, options = {}) {
  const llm = inference({ provider: 'scripted', replies, maxOutputTokens: 256 })
  const engine = new Engine({ name: 'fixture', llm: async () => llm, contractVersion: 2, tools: [read], ...options })
  const events = []; engine.listen(event => events.push(event))
  return { engine, events }
}
const action = JSON.stringify({ do: 'tool', act: [[{ name: 'read_fixture', args: {} }]] })
const done = JSON.stringify({ do: 'done', act: 'The result.' })

test('engine repair retains one contract and frozen exact transmitted prompt with compilation metadata', async () => {
  const { engine, events } = fixture(['bad', done], { repairs: 1 })
  expect(await engine.invoke('Read it.')).toBe('The result.')
  const prompts = events.filter(event => event.kind === 'prompt')
  const repaired = prompts[1].requestSnapshot
  expect(prompts).toHaveLength(2)
  expect(repaired.messages.map(row => row.content).join('\n').match(/## RESPONSE FORMAT/g)).toHaveLength(1)
  expect(repaired.messages[1].content).toContain('YOUR LAST REPLY WAS REJECTED')
  expect(repaired).toMatchObject({ responseMode: 'actions', toolNames: ['read_fixture'] })
  expect(Object.isFrozen(repaired.layers[0])).toBe(true)
  const before = JSON.stringify(repaired)
  engine.systemPrompt = 'Changed later'; engine.tools = []
  await engine.render()
  expect(JSON.stringify(repaired)).toBe(before)
  expect(repaired.budget.inputTokens).toBe(tokens(JSON.stringify(repaired.messages)) + 16)
})

test('a final tool proposal is repaired with no dispatch and cannot turn budget exhaustion into success', async () => {
  let calls = 0
  const { engine, events } = fixture([action, action, done], { maxSteps: 1, repairs: 1, tools: [tool({ name: 'read_fixture', run: () => ++calls })] })
  expect(await engine.invoke('Work.')).toBe('The result.')
  expect(calls).toBe(1)
  expect(engine.progress()).toMatchObject({ status: 'incomplete', terminationReason: 'step_budget' })
  expect(events.filter(event => event.kind === 'repair')).toHaveLength(1)
  for (const prompt of events.filter(event => event.kind === 'prompt').slice(1)) {
    expect(prompt.requestSnapshot).toMatchObject({ responseMode: 'final-only', toolNames: [] })
    expect(prompt.value).not.toContain('Tool example:')
    expect(prompt.value).not.toContain('## TOOLS')
  }
})

test('exhausted final-tool repairs stay incomplete and zero-tool actions fail without dispatch', async () => {
  const final = fixture([action], { maxSteps: 1, repairs: 1 })
  await final.engine.invoke('Work.')
  expect(final.engine.progress()).toMatchObject({ status: 'incomplete', terminationReason: 'step_budget' })
  expect(final.events.filter(event => event.kind === 'call')).toHaveLength(1)
  const unavailable = fixture([action], { tools: [], repairs: 1 })
  await unavailable.engine.invoke('Work.')
  expect(unavailable.engine.progress()).toMatchObject({ status: 'failed', terminationReason: 'invalid_response' })
  expect(unavailable.events.filter(event => event.kind === 'call')).toHaveLength(0)
})
