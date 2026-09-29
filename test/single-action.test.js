import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { SingleReAct, CompactReAct, responseModel } from '../src/core/responses.js'
import { inference } from '../src/core/inference.js'
import { tool } from '../src/core/tools.js'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { assertPromptSnapshot } from '../src/workspace/contracts.js'
const call = { do: 'tool', act: { name: 'echo', args: { text: 'source "quoted"\nnext line' } } }
const done = { do: 'done', act: 'Checked.' }
const response = responseModel(SingleReAct, 'json')

test('single action validates the complete JSON and rejects staged or ambiguous calls', () => {
  expect(response.parse(JSON.stringify(call)).faults).toEqual([])
  expect(response.calls(call)[0][0].args).toEqual(call.act.args)
  for (const value of [{ ...call, act: [[call.act]] }, { ...call, act: [call.act] }, { ...call, extra: true }, { ...call, act: { ...call.act, extra: true } }, { ...call, act: { name: 'echo', args: [] } }, { ...call, act: { name: 'bad name', args: {} } }, { do: 'done', act: '' }]) expect(response.parse(JSON.stringify(value)).faults.length).toBeGreaterThan(0)
  for (const raw of [`prefix ${JSON.stringify(call)}`, `\`\`\`json\n${JSON.stringify(call)}\n\`\`\``, JSON.stringify(call).slice(0, -1), JSON.stringify(call) + JSON.stringify(done), 'null', '[]']) expect(response.parse(raw).faults.length).toBeGreaterThan(0)
  expect(responseModel(CompactReAct, 'json').parse(JSON.stringify(call)).faults.length).toBeGreaterThan(0)
})

test('single action preserves dispatched source, history, snapshots and trusted activity', async () => {
  let received
  const echo = tool({ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, run: args => { received = args; return 'acknowledged' } })
  const llm = inference({ provider: 'scripted', model: 'fixture', replies: [JSON.stringify(call), JSON.stringify(done)] })
  const engine = new Engine({ contractVersion: 3, tools: [echo], llm: async () => llm, observationFormat: 'compact' })
  const events = []; engine.listen(e => events.push(e))
  expect(await engine.invoke('write')).toBe('Checked.')
  expect(received).toEqual(call.act.args)
  expect(engine.history.filter(r => r.role === 'assistant').map(r => JSON.parse(r.content))).toEqual([call, done])
  const prompts = events.filter(e => e.kind === 'prompt')
  for (const event of prompts) expect(assertPromptSnapshot(event.requestSnapshot).contractVersion).toBe(3)
  expect(prompts[1].requestSnapshot.messages.map(m => m.content).join('\n')).toContain(JSON.stringify(call))
  expect(events.filter(e => e.kind === 'call')).toHaveLength(1)
  expect(events.filter(e => e.kind === 'observation')[0]).toMatchObject({ ok: true, activity: {} })
  expect(events.find(e => e.kind === 'field' && e.name === 'act').value).not.toBe('[object Object]')
})

test('single action cannot bypass argument validation or final-only budgets', async () => {
  let calls = 0
  const echo = tool({ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, run: () => ++calls })
  for (const act of [{ name: 'echo', args: {} }, { name: 'missing', args: {} }]) {
    const llm = inference({ provider: 'scripted', model: 'fixture', replies: [JSON.stringify({ do: 'tool', act }), JSON.stringify(done)] })
    await new Engine({ contractVersion: 3, tools: [echo], llm: async () => llm }).invoke('work')
  }
  expect(calls).toBe(0)
  const llm = inference({ provider: 'scripted', model: 'fixture', replies: [JSON.stringify(call)] })
  const engine = new Engine({ contractVersion: 3, tools: [echo], llm: async () => llm, maxSteps: 1, repairs: 0 })
  await engine.invoke('work')
  expect(calls).toBe(1)
  expect(engine.progress()).toMatchObject({ status: 'incomplete', terminationReason: 'step_budget' })
})

test('folder version selects single action explicitly; omitted version remains staged', async () => {
  const files = version => [{ path: 'agent.md', content: `---\npackage_id: tests.single\npackage_version: 1.0.0\nid: main\n${version}---\nUse the tools.\n` }]
  const pkg = await importAgentPackage(files('contract_version: 3\n'))
  expect(pkg.data.agents[0]).toMatchObject({ contractVersion: 3, responseFormat: 'json' })
  expect((await restoreAgentPackage(pkg.data)).data).toEqual(pkg.data)
  expect((await importAgentPackage(files(''))).data.agents[0].contractVersion).toBe(2)
  await expect(importAgentPackage(files('contract_version: 3\nresponse_format: toon\n'))).rejects.toMatchObject({ code: 'PACKAGE_SCHEMA' })
  const text = response.instructions({ tools: [tool({ name: 'echo', parameters: { text: 'string' }, run: () => '' })] })
  const example = JSON.parse(text.split('Tool example: ')[1].split('\n')[0])
  expect(response.parse(JSON.stringify(example)).faults).toEqual([])
  expect(Array.isArray(example.act)).toBe(false)
  expect(response.instructions({ tools: [], finalOnly: true })).not.toContain('Tool example:')
})
