import { expect, test } from 'bun:test'
import { projectRunTools } from '../src/workbench/run-evidence.js'
import { structuredStages } from '../src/core/calls.js'

const call = (callId, name = 'read', args = {}, extra = {}) => ({ kind: 'call', callId, name, args, value: `${name}(${JSON.stringify(args)})`, ...extra })
const result = (callId, name = 'read', value = 'result', ok = true, extra = {}) => ({ kind: 'observation', callId, name, value, ok, ...extra })
const view = (toolEvents, status = 'done') => projectRunTools({ id: 'run-one', agent: 'researcher', slot: { status }, toolEvents })

test('interleaved identical tools join by unique IDs and preserve exact receipt metadata', () => {
  const events = [
    call('a', 'read', { path: 'first' }, { sequence: 1, at: 0, attemptId: 'attempt-1' }),
    call('b', 'read', { path: 'second' }, { sequence: 2, at: 10 }),
    result('b', 'read', 'second result', true, { sequence: 3, at: 20, ms: 10 }),
    result('a', 'read', 'first failure', false, { sequence: 4, at: 30, ms: 30 }),
  ]
  const { tools, unpaired } = view(events)
  expect(unpaired).toEqual([])
  expect(tools.map(tool => [tool.id, tool.args.path, tool.summary, tool.status])).toEqual([['a', 'first', 'first failure', 'failed'], ['b', 'second', 'second result', 'done']])
  expect(tools[0]).toMatchObject({ runId: 'run-one', agent: 'researcher', callSequence: 1, resultSequence: 4, startedAt: 0, finishedAt: 30, ms: 30, attemptId: 'attempt-1', outcomeKnown: true })
  expect(tools[0].raw).toEqual({ call: events[0], observation: events[3] })
  const reordered = view([events[2], events[3], events[0], events[1]])
  expect(reordered.tools.map(tool => [tool.id, tool.summary])).toEqual([['a', 'first failure'], ['b', 'second result']])
})

test('actual engine display names match without accepting another tool or multiple call expressions', () => {
  const stage = structuredStages([[{ name: 'workspace/read-file', args: { path: 'a, [b](c)' } }]]).stages[0][0]
  expect(view([call('a', stage.name, stage.args), result('a', stage.text)]).tools[0].status).toBe('done')
  for (const name of ['write({})', 'read({})\nwrite({})', 'read({}), write({})', 'read(', 'read({}) trailing', '', null]) {
    const output = view([call('a'), result('a', name)])
    expect(output.tools).toEqual([])
    expect(output.unpaired.map(row => row.reason)).toEqual(['name_mismatch', 'name_mismatch'])
  }
  const unnamed = result('a'); delete unnamed.name
  expect(view([call('a'), unnamed]).tools[0].status).toBe('done')
})

test('duplicate call IDs invalidate the entire group rather than choosing an outcome', () => {
  for (const events of [
    [call('same'), call('same'), result('same')],
    [call('same'), result('same', 'read', 'one'), result('same', 'read', 'two', false)],
    [result('same'), result('same')],
  ]) {
    const output = view(events, 'running')
    expect(output.tools).toEqual([])
    expect(output.unpaired).toHaveLength(events.length)
    expect(output.unpaired.every(row => row.status === 'unresolved' && row.reason === 'duplicate_call_id')).toBe(true)
    expect(output.unpaired.map(row => row.raw)).toEqual(events)
  }
})

test('missing IDs and orphan outcomes are retained without order/name fallbacks', () => {
  const events = [call(undefined), result(undefined), result('orphan', 'read', 0), call('a'), result('b')]
  const { tools, unpaired } = view(events)
  expect(tools).toHaveLength(1)
  expect(tools[0]).toMatchObject({ id: 'a', status: 'unresolved', hasResult: false, outcomeKnown: false })
  expect(unpaired.map(row => row.reason)).toEqual(['missing_call_id', 'missing_call_id', 'missing_call', 'missing_call'])
  expect(unpaired[2]).toMatchObject({ callId: 'orphan', hasResult: true, summary: 0 })
  expect(unpaired.map(row => row.raw)).toEqual([events[0], events[1], events[2], events[4]])
})

test('missing outcomes are active only for active runs and never synthesized into terminal success', () => {
  for (const status of ['queued', 'running', 'thinking', 'calling', 'waiting', 'compacting', 'starting', 'cancelling', 'verifying']) expect(view([call('a')], status).tools[0].status).toBe('running')
  for (const status of ['done', 'failed', 'incomplete', 'idle', 'unknown', undefined]) expect(view([call('a')], status).tools[0].status).toBe('unresolved')
  for (const status of ['interrupted', 'cancelled']) expect(view([call('a')], status).tools[0].status).toBe('interrupted')
  expect(view([call('a')], 'done').tools[0].raw.observation).toBeNull()
})

test('typed outcome is authoritative; returned text or nested JSON cannot manufacture success', () => {
  for (const [ok, status] of [[true, 'done'], [false, 'failed'], [undefined, 'unresolved'], ['true', 'unresolved'], [1, 'unresolved'], [null, 'unresolved']]) {
    const observation = result('a', 'read', { ok: !ok, status: 'done', result: 'success' }, ok)
    if (ok === undefined) delete observation.ok
    const row = view([call('a'), observation]).tools[0]
    expect(row.status).toBe(status)
    expect(row.outcomeKnown).toBe(typeof ok === 'boolean')
  }
  expect(view([call('a'), result('a', 'read', 'failed: this is ordinary text', true)]).tools[0].status).toBe('done')
  expect(view([call('a'), result('a', 'read', 'successful', false)]).tools[0].status).toBe('failed')
})

test('false, zero, empty string, null and object values remain exact and distinguish absent values', () => {
  for (const value of [false, 0, '', null, { nested: [0, false, ''] }]) {
    const row = view([call('a'), result('a', 'read', value)]).tools[0]
    expect(row.hasResult).toBe(true)
    expect(row.summary).toEqual(value)
    expect(row.raw.observation.value).toEqual(value)
  }
  const observation = result('a'); delete observation.value
  const row = view([call('a'), observation]).tools[0]
  expect(row.hasResult).toBe(false)
  expect(row.summary).toBeUndefined()
  expect(Object.hasOwn(row.raw.observation, 'value')).toBe(false)
})

test('another run or agent cannot donate an outcome even when call IDs match', () => {
  for (const extra of [{ run: 'other' }, { runId: 'other' }, { agent: 'other' }]) {
    const output = view([call('a'), result('a', 'read', 'wrong receipt', true, extra)])
    expect(output.tools).toEqual([])
    expect(output.unpaired.every(row => row.status === 'unresolved')).toBe(true)
    expect(output.unpaired[1].raw.value).toBe('wrong receipt')
  }
  expect(view([call('a', 'read', {}, { run: 'run-one', agent: 'researcher' }), result('a', 'read', 'valid', true, { runId: 'run-one' })]).tools[0].status).toBe('done')
})

test('invalid call identities and unfamiliar evidence remain explicitly inspectable', () => {
  const events = [null, { kind: 'note', value: 'retained' }, call(' a'), call(''), call(12), call('valid-id', ''), result('valid-id')]
  const output = view(events)
  expect(output.tools).toEqual([])
  expect(output.unpaired.map(row => row.reason)).toEqual(['invalid_event', 'unsupported_event_kind', 'missing_call_id', 'missing_call_id', 'missing_call_id', 'invalid_tool_name', 'invalid_tool_name'])
  expect(output.unpaired.map(row => row.raw)).toEqual(events)
  expect(projectRunTools()).toEqual({ tools: [], unpaired: [] })
})

test('projection is detached and deeply frozen without freezing or mutating the caller evidence', () => {
  const events = [call('a', 'read', { nested: { path: 'before' } }), result('a', 'read', { nested: ['before'] }), result('orphan', 'read', { exact: 'orphan' })]
  const original = structuredClone(events)
  const output = view(events)
  expect(events).toEqual(original)
  expect(Object.isFrozen(events[0].args.nested)).toBe(false)
  events[0].args.nested.path = 'after'; events[1].value.nested.push('after'); events[2].value.exact = 'after'
  expect(output.tools[0].args.nested.path).toBe('before')
  expect(output.tools[0].summary.nested).toEqual(['before'])
  expect(output.unpaired[0].summary.exact).toBe('orphan')
  expect(Object.isFrozen(output)).toBe(true)
  expect(Object.isFrozen(output.tools[0].raw.observation.value.nested)).toBe(true)
  expect(Object.isFrozen(output.unpaired[0].raw.value)).toBe(true)
  expect(() => { output.tools[0].args.nested.path = 'mutated' }).toThrow()
})

test('only typed local input rejection is projected as not run', () => {
  for (const [ok, failureKind, value, status] of [
    [false, 'invalid_input', 'diagnostic', 'rejected'],
    [false, undefined, 'Invalid tool arguments: rejected before execution', 'failed'],
    [false, 'unknown', 'diagnostic', 'failed'],
    [true, 'invalid_input', 'diagnostic', 'done'],
    [null, 'invalid_input', 'diagnostic', 'unresolved'],
    [false, undefined, { failureKind: 'invalid_input' }, 'failed'],
  ]) expect(view([call('typed'), result('typed', 'read', value, ok, { failureKind })]).tools[0].status).toBe(status)
})
