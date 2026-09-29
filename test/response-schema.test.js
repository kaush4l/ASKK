import { expect, test } from 'bun:test'
import { CompactReAct, SingleReAct, ReAct, responseModel } from '../src/core/responses.js'
import { buildAgentPrompt } from '../src/core/agent-prompt.js'
import { inference } from '../src/core/inference.js'
import { resolve } from '../src/core/models.js'
import { Engine } from '../src/core/engine.js'
import { tool } from '../src/core/tools.js'

const tools = [tool({ name: 'echo', parameters: { text: 'string' }, run: args => args.text })]
const done = { do: 'done', act: 'Checked.' }
const stream = value => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })

test('schema follows contract and available tools, including final-only decisions', () => {
  for (const shape of [CompactReAct, SingleReAct]) {
    const response = responseModel(shape, 'json'), schema = response.schema({ tools })
    const act = schema.anyOf[0].properties.act
    const call = shape.version === 3 ? act : act.items.items
    expect(call.properties.name.enum).toEqual(['echo'])
    expect(call.properties.args).toEqual({ type: 'object' }) // Argument validation remains local.
    expect(call.additionalProperties).toBe(false)
    expect(response.schema({ tools, finalOnly: true })).toEqual(schema.anyOf[1])
    expect(response.schema()).toEqual(schema.anyOf[1])
  }
  expect(() => responseModel(ReAct, 'json').schema()).toThrow('version 2 or 3')
  expect(() => responseModel(ReAct, 'toon').schema()).toThrow('JSON')
})

test('schema contributes to prompt budget and remains explicit in resolved model configuration', () => {
  const options = { tools, response: responseModel(SingleReAct, 'json'), window: 4096, outputReserve: 512 }
  const plain = buildAgentPrompt(options), constrained = buildAgentPrompt({ ...options, structuredOutput: 'json_schema' })
  expect(plain.responseSchema).toBeUndefined()
  expect(constrained.budget.inputTokens).toBeGreaterThan(plain.budget.inputTokens)
  expect(constrained.budget.baseInputTokens).toBeGreaterThan(plain.budget.baseInputTokens)
  expect(resolve({}, { default: 'local', models: { local: { structured_output: 'json_schema' } } }).structuredOutput).toBe('json_schema')
  expect(() => buildAgentPrompt({ ...options, structuredOutput: 'guess' })).toThrow('Unsupported')
})

test('wire schema and prompt snapshot match, and final step removes action alternatives', async () => {
  const bodies = [], events = []
  const llm = inference({ provider: 'openai', structuredOutput: 'json_schema', contextLength: 8192, maxOutputTokens: 512 }, { fetch: async (_, init) => {
    bodies.push(JSON.parse(init.body))
    return stream(bodies.length === 1 ? { do: 'tool', act: { name: 'echo', args: { text: 'observed' } } } : done)
  } })
  const engine = new Engine({ name: 'fixture', contractVersion: 3, responseFormat: 'json', tools, llm: async () => llm, maxSteps: 1 })
  engine.listen(event => events.push(event))
  await engine.invoke('work')
  expect(bodies).toHaveLength(2)
  const prompts = events.filter(event => event.kind === 'prompt')
  for (let i = 0; i < bodies.length; i++) {
    expect(bodies[i].response_format.json_schema.schema).toEqual(prompts[i].requestSnapshot.responseSchema)
    expect(bodies[i].response_format.json_schema.strict).toBe(false)
  }
  expect(bodies[1].response_format.json_schema.schema.properties.do.const).toBe('done')
  expect(bodies[1].response_format.json_schema.schema.anyOf).toBeUndefined()
})

test('unsupported configurations fail without transport and schema requests never silently fall back', async () => {
  let sent = 0
  const fetch = async () => { sent++; return stream(done) }
  const responseSchema = responseModel(SingleReAct, 'json').schema()
  for (const settings of [
    { provider: 'openai', structuredOutput: 'json_schema', requestParams: [] },
    { provider: 'openai', structuredOutput: 'json_schema', requestParams: 'bad' },
    { provider: 'anthropic', structuredOutput: 'json_schema' },
    { provider: 'openai', structuredOutput: 'guess' },
    { provider: 'openai', structuredOutput: 'json_schema', requestParams: { response_format: { type: 'json_object' } } },
  ]) await expect(inference(settings, { fetch }).invoke([], { responseSchema })).rejects.toThrow()
  await expect(inference({ structuredOutput: 'json_schema' }, { fetch }).invoke([])).rejects.toThrow('did not supply')
  expect(sent).toBe(0)
  let body
  await inference({}, { fetch: async (_, init) => { body = JSON.parse(init.body); return stream(done) } }).invoke([], { responseSchema })
  expect(body.response_format).toBeUndefined()
})
