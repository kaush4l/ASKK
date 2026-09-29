import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { readSpec } from '../src/core/folder.js'
import { tool } from '../src/core/tools.js'
import { workspace_check, workspace_read, workspace_write, workspace_run } from '../src/builtin/workspace.js'

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

test('workspace model observations decode receipts once and retain exact read content and raw write evidence', async () => {
  const content = 'export const data = "line\\nquoted";\n'.repeat(60)
  const read = { path: 'data.js', content, rev: 'r1' }
  const written = { path: 'data.js', content, rev: 'r2', ok: true }
  const { engine, events } = setup({ observationFormat: 'compact', tools: [tool(workspace_read, { name: 'read' }), tool(workspace_write, { name: 'write' })], ctx: { request: async op => op === 'workspace.read' ? read : written } })
  const output = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'read', args: { path: 'data.js' } }], [{ name: 'write', args: { path: 'data.js', content, expect: 'r1' } }]] }))
  expect(output.stages[0][0].result).toEqual(read)
  expect(output.stages[1][0].result).toEqual({ path: 'data.js', rev: 'r2', ok: true, contentOmitted: true })
  expect(JSON.parse(events.filter(row => row.kind === 'observation')[1].value)).toEqual(written)
  expect(written.content).toBe(content)
})

test('failed commands and conflicts remain structured failures with their complete diagnostics', async () => {
  for (const [spec, args, receipt] of [
    [workspace_run, { command: 'bun test' }, { id: 'c1', code: 1, output: 'Expected 5; received 0\n' }],
    [workspace_write, { path: 'a', content: 'new', expect: 'old' }, { conflict: true, content: 'owner draft', rev: 'current' }],
  ]) {
    const { engine } = setup({ observationFormat: 'compact', tools: [tool(spec, { name: 'task' })], ctx: { request: async () => receipt } })
    const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'task', args }]] })).stages[0][0]
    expect(row.ok).toBe(false)
    expect(row.result).toMatchObject(receipt)
    if (receipt.conflict) { expect(row.result.outcome).toBe('write_not_applied'); expect(row.result.recovery).toContain('observed:true') }
  }
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

test('command projection bounds model output while preserving failure identity and complete raw evidence', async () => {
  const output = 'H'.repeat(2000) + 'MIDDLE-ONLY'.repeat(900) + 'T'.repeat(4000)
  for (const status of [{ code: 0 }, { code: 1 }, { code: 143, cancelled: true, timedOut: true }]) {
    const receipt = { id: 'command-1', runtimeId: 'runtime-1', revision: 8, signal: null, outputLength: output.length, outputTruncated: false, output, ...status }
    const original = structuredClone(receipt)
    const { engine, events } = setup({ observationFormat: 'compact', tools: [tool(workspace_run, { name: 'command' })], ctx: { request: async () => receipt } })
    const row = JSON.parse(await engine.act({ do: 'tool', act: [[{ name: 'command', args: { command: 'bun test' } }]] })).stages[0][0]
    expect(row.ok).toBe(status.code === 0)
    expect(row.result.output.startsWith('H'.repeat(2000))).toBe(true)
    expect(row.result.output.endsWith('T'.repeat(4000))).toBe(true)
    expect(row.result.output).not.toContain('MIDDLE-ONLY')
    expect(row.result.modelOutputProjection.output).toEqual({ originalLength: output.length, omitted: output.length - 6000, retainedLength: 6000 })
    const { output: projectedOutput, modelOutputProjection, ...fields } = row.result
    const { output: originalOutput, ...originalFields } = original
    expect(fields).toEqual(originalFields)
    expect(receipt).toEqual(original)
    const event = events.find(event => event.kind === 'observation')
    expect(event.activity.commandId).toBe('command-1')
    expect(JSON.parse(row.ok ? event.value : event.value.slice('command failed: '.length))).toEqual(original)
  }
})

test('command projection shares one budget across streams and preserves Unicode slice boundaries', () => {
  const project = receipt => workspace_run.projectObservation({ text: JSON.stringify(receipt), ok: true, name: 'run' })
  for (const length of [0, 5999, 6000]) {
    const receipt = { id: 'c', code: 0, output: 'x'.repeat(length) }
    expect(project(receipt)).toEqual(receipt)
  }
  const unicode = 'a'.repeat(1999) + '😀' + 'middle'.repeat(1000) + '😀' + 'b'.repeat(3999)
  const result = project({ code: 1, output: unicode })
  expect(result.output.isWellFormed()).toBe(true)
  expect(result.modelOutputProjection.output).toEqual({ originalLength: unicode.length, omitted: unicode.length - 5998, retainedLength: 5998 })
  const streams = project({ code: 0, output: 'o'.repeat(8000), stdout: 's'.repeat(8000), stderr: 'short diagnostic' })
  expect(streams.stderr).toBe('short diagnostic')
  expect(Object.values(streams.modelOutputProjection).reduce((sum, item) => sum + item.retainedLength, streams.stderr.length)).toBeLessThanOrEqual(6000)
  expect(streams.modelOutputProjection.output.originalLength).toBe(8000)
  expect(streams.modelOutputProjection.stdout.originalLength).toBe(8000)
})

test('command projection leaves raw errors and malformed receipt wrappers unchanged', () => {
  const raw = 'transport error '.repeat(1000)
  expect(workspace_run.projectObservation({ text: raw, ok: false, name: 'run' })).toBe(raw)
  for (const receipt of [{ ok: false, error: 'Invalid exit receipt', received: { output: raw } }, { code: '0', output: raw }, { code: 0, received: {}, output: raw }]) {
    expect(workspace_run.projectObservation({ text: `run failed: ${JSON.stringify(receipt)}`, ok: false, name: 'run' })).toEqual(receipt)
  }
})

test('native provider history receives bounded command output paired with its actual failure', async () => {
  const requests = [], events = [], output = 'start\n' + 'middle'.repeat(3000) + '\nterminal error'
  const receipt = { id: 'native-command', code: 1, output }
  const llm = inference({ provider: 'openai', model: 'fixture', contextLength: 32768, maxOutputTokens: 512, retries: 1 }, { fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const first = requests.length === 1
    const delta = first ? { tool_calls: [{ index: 0, id: 'provider-call', type: 'function', function: { name: 'workspace_run', arguments: '{"command":"bun test"}' } }] } : { content: 'The command failed.' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
  } })
  const engine = new Engine({ name: 'projection', contractVersion: 3, responseProtocol: 'native', historyFormat: 'messages', observationFormat: 'compact', tools: [tool(workspace_run, { name: 'workspace_run' })], ctx: { request: async () => receipt }, llm: async () => llm })
  engine.listen(event => events.push(event))
  expect(await engine.invoke('Run the check.')).toBe('The command failed.')
  const message = requests[1].messages.find(message => message.role === 'tool')
  expect(message.tool_call_id).toBe('provider-call')
  expect(message.content).not.toContain(output)
  expect(message.content).toContain('UTF-16 units omitted')
  expect(message.content).toContain('terminal error')
  expect(events.find(event => event.kind === 'observation')).toMatchObject({ ok: false, providerCallId: 'provider-call', activity: { commandId: 'native-command' } })
  expect(events.find(event => event.kind === 'observation').value).toContain(output.replaceAll('\n', '\\n'))
})


test('post-write conflict feedback does not claim the write was never applied', () => {
  const receipt = { conflict: true, committed: true, writtenRevision: 'r1', rev: 'r2' }
  const projected = workspace_write.projectObservation({ text: 'workspace_write failed: ' + JSON.stringify(receipt), ok: false, name: 'workspace_write' })
  expect(projected.outcome).toBe('committed_then_changed')
  expect(projected).toMatchObject(receipt)
  expect(receipt.outcome).toBeUndefined()
})
