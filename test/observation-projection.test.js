import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { readSpec } from '../src/core/folder.js'
import { tool } from '../src/core/tools.js'
import { workspace_check } from '../src/builtin/workspace.js'

const plan = [{ action: 'click', selector: '#add' }, { action: 'assertText', selector: '#title', value: 'Expected task' }]
const receipt = (ok = true) => ({ ok, artifactId: 'artifact-1', buildId: 'build-1', revision: 7, checkedAt: 123, interactionMode: 'programmatic-dom', assertions: structuredClone(plan), results: plan.slice(0, ok ? 2 : 1).map((step, index) => ({ index, action: step.action, ok: true, frame: 0 })), errors: ok ? [] : ['Expected text "Expected task" at #title; actual text "Other task"'], timing: { budgetMs: 12000, elapsedMs: 180 } })
const setup = (options = {}) => {
  const llm = inference({ provider: 'scripted', replies: [], maxOutputTokens: 256 })
  const engine = new Engine({ name: 'projection', contractVersion: 2, llm: async () => llm, ...options })
  const events = []; engine.listen(event => events.push(event))
  return { engine, events }
}

test('compact history preserves ordered stage/call identities despite same-name concurrent completion', async () => {
  const marker = 'ARGUMENT-ONLY-'.repeat(300); let release; let calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const task = tool({ name: 'fixture', parameters: { order: 'number', marker: 'string' }, async run({ order }) { calls++; if (order === 1) await gate; if (order === 2) release(); return `result-${order}` } })
  const value = { do: 'tool', act: [[{ name: 'fixture', args: { order: 1, marker } }, { name: 'fixture', args: { order: 2, marker } }], [{ name: 'fixture', args: { order: 3, marker } }]] }
  const { engine, events } = setup({ tools: [task], observationFormat: 'compact' })
  const model = JSON.parse(await engine.act(value))
  expect(model.format).toBe('staged-v1')
  expect(model.stages.map(stage => stage.map(row => row.result))).toEqual([['result-1', 'result-2'], ['result-3']])
  expect(calls).toBe(3)
  expect(JSON.stringify(model)).not.toContain(marker)
  const rawCalls = events.filter(event => event.kind === 'call'); const rawResults = events.filter(event => event.kind === 'observation')
  expect(rawCalls.map(event => event.args)).toEqual(value.act.flat().map(call => call.args))
  expect(rawCalls.every(event => event.value.includes(marker))).toBe(true)
  expect(rawResults.map(event => event.value)).toEqual(['result-2', 'result-1', 'result-3'])
  expect(model.stages.flat().map(row => row.callId)).toEqual(rawCalls.map(event => event.callId))
  for (const row of model.stages.flat()) expect(rawResults.find(event => event.callId === row.callId)?.value).toBe(row.result)
})

test('legacy history remains the default and never invokes a model projector', async () => {
  let projections = 0
  const { engine } = setup({ tools: [tool({ name: 'echo', run: () => 'actual', projectObservation() { projections++; return 'projected' } })] })
  expect(await engine.act({ do: 'tool', act: [[{ name: 'echo', args: { note: 'full args' } }]] })).toBe('echo({"note":"full args"}) -> actual')
  expect(projections).toBe(0)
})

test('compact check success keeps complete raw proof and omits duplicated plans/results only from model input', async () => {
  const full = receipt(); const original = structuredClone(full)
  const { engine, events } = setup({ observationFormat: 'compact', tools: [tool(workspace_check, { name: 'workspace_check' })], ctx: { request: async () => full } })
  const output = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'workspace_check', args: { assertions: plan } }]] })).stages[0][0]
  expect(output.ok).toBe(true)
  expect(output.result).toMatchObject({ ok: true, artifactId: full.artifactId, buildId: full.buildId, revision: 7, completedSteps: 2, totalSteps: 2, outcomeAssertionsPassed: 1 })
  expect(output.result.assertions).toBeUndefined(); expect(output.result.results).toBeUndefined()
  expect(JSON.parse(events.find(event => event.kind === 'observation').value)).toEqual(original)
  expect(full).toEqual(original)
})

test('failed checks retain concrete expected/actual diagnostics without pretending incomplete actions never ran', async () => {
  const full = receipt(false)
  const { engine, events } = setup({ observationFormat: 'compact', tools: [tool(workspace_check, { name: 'workspace_check' })], ctx: { request: async () => full } })
  const value = { do: 'tool', act: [[{ name: 'workspace_check', args: { assertions: plan } }]] }
  for (let retry = 0; retry < 2; retry++) {
    const row = JSON.parse(await engine.act(value)).stages[0][0]
    expect(row.ok).toBe(false)
    expect(row.result.firstIncompleteStep).toEqual({ index: 1, action: 'assertText', selector: '#title', expected: 'Expected task', diagnostic: full.errors[0] })
    expect(row.result.completedSteps).toBe(1)
  }
  expect(events.filter(event => event.kind === 'observation')).toHaveLength(2)
  expect(JSON.parse(events.find(event => event.kind === 'observation').value.slice('workspace_check failed: '.length))).toEqual(full)
})

test('malformed positive receipts cannot become passing tool status or projected proof', async () => {
  const broken = [
    { ok: true }, { ...receipt(), errors: ['error despite success'] },
    { ...receipt(), results: receipt().results.slice(0, 1) },
    { ...receipt(), results: receipt().results.toReversed() },
    { ...receipt(), artifactId: '' },
    { ...receipt(), timing: { budgetMs: 12000, elapsedMs: -1 } },
    { ...receipt(), timing: null }, { ...receipt(), timing: 0 },
    { ...receipt(), assertions: [{ action: 'assertText', selector: '#other', value: 'wrong plan' }] },
  ]
  for (const full of broken) {
    const { engine, events } = setup({ observationFormat: 'compact', tools: [tool(workspace_check, { name: 'workspace_check' })], ctx: { request: async () => full } })
    const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'workspace_check', args: { assertions: plan } }]] })).stages[0][0]
    expect(row.ok).toBe(false); expect(row.result).toEqual({ ok: false, error: 'Invalid check receipt' })
    expect(JSON.parse(events.find(event => event.kind === 'observation').value.slice('workspace_check failed: '.length)).received).toEqual(full)
  }
})

test('check projection preserves reload frame boundaries and refuses action-only claimed verification', async () => {
  const reloaded = [...plan, { action: 'reload' }, { action: 'assertText', selector: '#title', value: 'Expected task' }]
  const full = { ...receipt(), assertions: reloaded, results: reloaded.map((step, index) => ({ index, action: step.action, ok: true, frame: index >= 2 ? 1 : 0 })) }
  const { engine } = setup({ observationFormat: 'compact', tools: [tool(workspace_check, { name: 'workspace_check' })], ctx: { request: async () => full } })
  const invoke = assertions => engine.act({ do: 'tool', act: [[{ name: 'workspace_check', args: { assertions } }]] }).then(value => JSON.parse(value).stages[0][0])
  expect((await invoke(reloaded)).result).toMatchObject({ ok: true, completedSteps: 4, outcomeAssertionsPassed: 2 })
  full.results[2].frame = 0
  expect((await invoke(reloaded)).ok).toBe(false)
  full.assertions = [plan[0]]; full.results = [{ index: 0, action: 'click', ok: true, frame: 0 }]
  expect((await invoke(full.assertions)).ok).toBe(false)
})

test('precondition failure has no invented completed-step or artifact proof', async () => {
  const { engine } = setup({ observationFormat: 'compact', tools: [tool(workspace_check, { name: 'workspace_check' })], ctx: { request: async () => ({ ok: false, reason: 'Build the current revision first' }) } })
  const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'workspace_check', args: { assertions: plan } }]] })).stages[0][0]
  expect(row.result).toEqual({ ok: false, reason: 'Build the current revision first' })
})

test('check receipts match canonical action fields rather than discarded optional input fields', async () => {
  const submitted = [{ ...plan[0], value: 'discarded' }, plan[1], { action: 'reload', selector: null }, plan[1]]
  const canonical = [plan[0], plan[1], { action: 'reload' }, plan[1]]
  const full = { ...receipt(), assertions: canonical, results: canonical.map((step, index) => ({ index, action: step.action, ok: true, frame: index >= 2 ? 1 : 0 })) }
  expect(JSON.parse(await workspace_check.run({ assertions: submitted }, { request: async () => full }))).toEqual(full)
})

test('projection exceptions preserve exact raw text and successful execution status', async () => {
  const { engine, events } = setup({ observationFormat: 'compact', tools: [tool({ name: 'raw', run: () => 'exact result', projectObservation: () => { throw new Error('bad projection') } })] })
  const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'raw', args: {} }]] })).stages[0][0]
  expect(row).toMatchObject({ ok: true, result: 'exact result' })
  expect(events.find(event => event.kind === 'projection_failed').value).toBe('bad projection')
})

test('an asynchronous projector cannot silently erase a successful raw result', async () => {
  const { engine, events } = setup({ observationFormat: 'compact', tools: [tool({ name: 'raw', run: () => 'exact result', projectObservation: async () => ({ hidden: true }) })] })
  const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'raw', args: {} }]] })).stages[0][0]
  expect(row).toMatchObject({ ok: true, result: 'exact result' })
  expect(events.find(event => event.kind === 'projection_failed').value).toContain('synchronous JSON data')
})

test('observation format is explicit validated agent configuration', async () => {
  const spec = async value => readSpec('fixture', { index: { files: { 'agents/fixture/agent.md': 'hash' } }, load: async () => `---\nobservation_format: ${value}\n---\nDo work.` })
  expect((await spec('compact')).engine.observationFormat).toBe('compact')
  expect((await spec('legacy')).engine.observationFormat).toBe('legacy')
  await expect(spec('silent')).rejects.toThrow('unsupported observation_format')
  expect(() => setup({ observationFormat: 'silent' })).toThrow('unsupported observation format')
})
