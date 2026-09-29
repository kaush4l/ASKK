import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { instructions, runToolResult, tool } from '../src/core/tools.js'
import { validateToolInput } from '../src/core/tool-input.js'
import { workspace_write } from '../src/builtin/workspace.js'

const inputSchema = { type: 'object', properties: { path: { type: 'string', minLength: 1 }, revision: { type: ['string', 'integer'] } }, required: ['path'], additionalProperties: false }

test('version 2 malformed tool arguments never reach the side-effect handler and can be repaired', async () => {
  const calls = [], events = []
  const argsList = [{}, { path: 4 }, { path: '' }, { path: 'app.js', unexpected: true }, { path: 'app.js', revision: 0 }]
  const replies = [...argsList.map(args => JSON.stringify({ do: 'tool', act: [[{ name: 'commit', args }]] })), JSON.stringify({ do: 'done', act: 'Recorded.' })]
  const llm = inference({ provider: 'scripted', replies, maxOutputTokens: 256 })
  const engine = new Engine({ name: 'schema-fixture', llm: async () => llm, contractVersion: 2, maxSteps: 8, tools: [tool({ name: 'commit', inputSchema, run: args => { calls.push(args); return 'saved' } })] })
  engine.listen(event => events.push(event))
  expect(await engine.invoke('Commit the fixture')).toBe('Recorded.')
  expect(calls).toEqual([{ path: 'app.js', revision: 0 }])
  const outcomes = events.filter(event => event.kind === 'observation')
  expect(outcomes.map(event => event.ok)).toEqual([false, false, false, false, true])
  expect(outcomes.slice(0, 4).every(event => event.value.includes('Invalid tool arguments'))).toBe(true)
  expect(outcomes.slice(0, 4).every(event => event.failureKind === 'invalid_input')).toBe(true)
  expect(outcomes[4].failureKind).toBeUndefined()
})

test('schema defines advertised parameters and is isolated from later caller mutation', () => {
  const schema = structuredClone(inputSchema)
  const item = tool({ name: 'commit', parameters: { unrelated: 'boolean' }, inputSchema: schema, run() {} })
  expect(item.parameters).toEqual({ path: 'string [minLength: 1]', revision: 'string or integer (optional)' })
  expect(instructions(item)).toContain('revision')
  expect(instructions(item)).not.toContain('unrelated')
  schema.properties.path.type = 'number'
  schema.required.length = 0
  expect(validateToolInput(item.inputSchema, {})).toEqual(['args.path is required'])
  expect(validateToolInput(item.inputSchema, { path: 'app.js', revision: 0 })).toEqual([])
})

test('advertised schema explains nested inputs and the constraints dispatch enforces', async () => {
  const schema = {
    type: 'object', required: ['jobs'], additionalProperties: false,
    properties: {
      jobs: {
        type: 'array', minItems: 1, maxItems: 2, description: 'Jobs to process',
        items: {
          type: 'object', required: ['mode', 'label'], additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['fast', 'careful'], description: 'Execution mode' },
            label: { type: 'string', minLength: 2, maxLength: 8 },
            retry: { type: ['integer', 'null'] },
          },
        },
      },
    },
  }
  let calls = 0
  const item = tool({ name: 'process', inputSchema: schema, run: () => { calls++; return 'processed' } })
  const prompt = instructions(item)
  for (const text of ['array<object {', '"mode": string [one of "fast" | "careful"] — Execution mode', '"label": string [minLength: 2, maxLength: 8]', '"retry": integer or null (optional)', 'no other keys', 'minItems: 1, maxItems: 2', 'Jobs to process']) expect(prompt).toContain(text)
  const valid = { mode: 'fast', label: 'demo' }
  for (const args of [
    { jobs: [] }, { jobs: [valid, valid, valid] },
    { jobs: [{ ...valid, mode: 'unknown' }] },
    { jobs: [{ ...valid, label: 'x' }] }, { jobs: [{ ...valid, label: 'too long label' }] },
    { jobs: [{ label: 'demo' }] }, { jobs: [{ ...valid, unexpected: true }] },
  ]) expect((await runToolResult(item, args, {})).ok).toBe(false)
  expect(calls).toBe(0)
  expect((await runToolResult(item, { jobs: [valid, { ...valid, retry: null }] }, {})).ok).toBe(true)
  expect(calls).toBe(1)
})

test('unconstrained schema parameters retain concise signatures', () => {
  const item = tool({ name: 'simple', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, count: { type: 'integer' } } }, run() {} })
  expect(item.parameters).toEqual({ text: 'string', count: 'integer (optional)' })
})

test('legacy tools retain adapter-level inputs without gaining a schema', async () => {
  let received
  const item = tool({ name: 'legacy', parameters: { custom: 'legacy description' }, run: args => { received = args; return 'accepted' } })
  const args = { custom: 42, extra: { retained: true } }
  expect(item.inputSchema).toBeNull()
  expect(item.parameters).toEqual({ custom: 'legacy description' })
  expect(await runToolResult(item, args, {})).toEqual({ text: 'accepted', ok: true })
  expect(received).toEqual(args)
})

test('workspace schema rejects unknown inputs before invoking its external operation', async () => {
  let requests = 0
  const result = await runToolResult(tool(workspace_write, { name: 'renamed_write' }), { path: 'app.js', content: 'text', force: true }, { request: () => { requests++; return { ok: true, rev: 'r1' } } })
  expect(result.ok).toBe(false)
  expect(result.text).toContain('args.force is not an accepted parameter')
  expect(requests).toBe(0)
})

test('workspace writes require a revision before invoking the external operation', async () => {
  const received = []
  const item = tool(workspace_write, { name: 'write' })
  const ctx = { request: (_, args) => { received.push(args); return { ok: true, rev: 'r1' } } }
  for (const revision of [{}, { expect: null }, { expect: undefined }, { expect: {} }, { expect: 1.5 }]) {
    expect((await runToolResult(item, { path: 'app.js', content: 'text', ...revision }, ctx)).ok).toBe(false)
  }
  expect(received).toHaveLength(0)
  for (const expectRevision of [0, 'r1']) {
    expect((await runToolResult(item, { path: 'app.js', content: 'text', expect: expectRevision }, ctx)).ok).toBe(true)
  }
  expect(received.map(args => args.expect)).toEqual([0, 'r1'])
  expect(item.parameters.expect).not.toContain('optional')
})

test('only local schema rejection carries invalid_input; adapter errors cannot impersonate it', async () => {
  let calls = 0, projections = 0
  const item = tool({ name: 'commit', inputSchema, run() { calls++; throw new TypeError('Invalid tool arguments: args.path is required') }, projectActivity() { projections++; return { commandId: 'not-a-command' } } })
  const events = []
  const engine = new Engine({ name: 'rejection-fixture', tools: [item], contractVersion: 2 })
  engine.listen(event => events.push(event))
  await engine.call({ name: 'commit', args: {}, text: 'commit({})' })
  expect(calls).toBe(0)
  expect(projections).toBe(0)
  expect(events.at(-1)).toMatchObject({ ok: false, failureKind: 'invalid_input', activity: {} })
  await engine.call({ name: 'commit', args: { path: 'app.js' }, text: 'commit({"path":"app.js"})' })
  expect(calls).toBe(1)
  expect(events.at(-1).ok).toBe(false)
  expect(events.at(-1).failureKind).toBeUndefined()
  expect(events.at(-1).value).toBe(events.find(event => event.kind === 'observation').value)
})
