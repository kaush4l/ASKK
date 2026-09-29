import { expect, test } from 'bun:test'
import { createStrategyRun, validateStrategy } from '../src/core/strategy.js'

const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function clockFixture() {
  let time = 100, serial = 0
  const timers = new Map()
  return {
    now: () => time,
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { at: time + ms, fn }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn() } },
    get pending() { return timers.size },
  }
}
function definition() {
  return { version: 1, id: 'perspectives', kind: 'graph', limits: { maxParallel: 2, maxWallMs: 1000 }, output: 'synthesis', nodes: [
    { id: 'facts', agent: 'roles/facts', dependsOn: [], template: 'Find evidence: {{goal}}', inputs: { goal: { from: 'goal' } } },
    { id: 'risks', agent: 'roles/risks', dependsOn: [], template: 'Question assumptions: {{goal}}', inputs: { goal: { from: 'goal' } } },
    { id: 'synthesis', agent: 'roles/synthesis', dependsOn: ['facts', 'risks'], template: 'Evidence: {{facts}}\nRisks: {{risks}}', inputs: { facts: { from: 'node', node: 'facts' }, risks: { from: 'node', node: 'risks' } } },
  ] }
}
function fixture(spec = definition(), overrides = {}) {
  const calls = [], cancellations = [], events = [], children = new Map(), clock = clockFixture()
  const run = createStrategyRun(spec, {
    id: 'strategy-1', trace: 'trace-1', definitionHash: 'fixture-hash', goal: 'Original goal', clock,
    startAgent(request) { calls.push(request); const child = defer(); children.set(request.nodeId, child); return { runId: `run-${request.nodeId}`, finished: child.promise } },
    cancelAgent(id, reason) { cancellations.push({ id, reason }) },
    onEvent: state => events.push(state), ...overrides,
  })
  return { run, calls, cancellations, events, children, clock }
}

test('parallel roles genuinely overlap and fan-in receives only declared successful outputs', async () => {
  const f = fixture(); const done = f.run.start()
  expect(f.calls.map(call => call.nodeId)).toEqual(['facts', 'risks'])
  expect(f.calls.map(call => call.session)).toEqual(['fresh', 'fresh'])
  expect(f.run.getSnapshot().nodes.map(node => node.runId)).toEqual(['run-facts', 'run-risks', null])
  f.children.get('risks').resolve({ status: 'done', output: 'Risk result' }); await tick()
  expect(f.calls).toHaveLength(2)
  f.children.get('facts').resolve({ status: 'done', output: 'Fact result' }); await tick()
  expect(f.calls[2].query).toBe('Evidence: Fact result\nRisks: Risk result')
  expect(f.calls[2].query).not.toContain('Original goal')
  f.children.get('synthesis').resolve({ status: 'done', output: 'Synthesized answer' })
  expect((await done).output).toBe('Synthesized answer')
  expect(f.run.getSnapshot()).toMatchObject({ definitionId: 'perspectives', definitionHash: 'fixture-hash', status: 'done', trace: 'trace-1' })
  expect(f.clock.pending).toBe(0)
  expect(f.events.map(state => state.seq)).toEqual(f.events.map((_, index) => index + 1))
  expect(f.events.every(state => Object.isFrozen(state) && Object.isFrozen(state.nodes))).toBe(true)
  expect(f.events[0].nodes.every(node => node.status === 'queued')).toBe(true)
})

test('configurable concurrency one serializes independent roles without serializing the graph definition', async () => {
  const spec = definition(); spec.limits.maxParallel = 1
  const f = fixture(spec); f.run.start()
  expect(f.calls.map(call => call.nodeId)).toEqual(['facts'])
  f.children.get('facts').resolve({ status: 'done', output: 'F' }); await tick()
  expect(f.calls.map(call => call.nodeId)).toEqual(['facts', 'risks'])
  f.children.get('risks').resolve({ status: 'done', output: 'R' }); await tick()
  f.children.get('synthesis').resolve({ status: 'done', output: 'S' })
  expect((await f.run.finished).status).toBe('done')
})

test('failure cancels active siblings but cannot invent their completion or start successors', async () => {
  const f = fixture(); let settled = false
  f.run.start().then(() => { settled = true })
  f.children.get('facts').resolve({ status: 'failed', output: 'Looks successful', reason: 'Actual role failure' }); await tick()
  expect(f.run.getSnapshot().status).toBe('cancelling')
  expect(f.run.getSnapshot().nodes.map(node => node.status)).toEqual(['failed', 'cancelling', 'skipped'])
  expect(f.cancellations.map(row => row.id)).toEqual(['run-risks'])
  expect(settled).toBe(false)
  f.children.get('risks').resolve({ status: 'done', output: 'Finished before stop arrived' })
  const result = await f.run.finished
  expect(result.status).toBe('failed')
  expect(result.output).toBe('')
  expect(result.snapshot.nodes[1].status).toBe('done')
  expect(result.snapshot.nodes[1].result).toEqual({ status: 'done', outputRef: { runId: 'run-risks', field: 'result' } })
  expect(f.calls).toHaveLength(2)
})

test('cancel acknowledgement is not a result; cancelled nodes keep actual run links', async () => {
  const f = fixture(); f.run.start()
  const result = f.run.cancel('Owner stopped this task'); f.run.cancel('Duplicate stop')
  expect(f.cancellations).toHaveLength(2)
  expect(f.run.getSnapshot().status).toBe('cancelling')
  f.children.get('facts').resolve({ status: 'cancelled', reason: 'Stopped' }); await tick()
  expect(f.run.getSnapshot().status).toBe('cancelling')
  f.children.get('risks').resolve({ status: 'cancelled', reason: 'Stopped' })
  expect((await result).status).toBe('cancelled')
  expect(f.run.getSnapshot().nodes.map(node => node.runId)).toEqual(['run-facts', 'run-risks', null])
  expect(f.calls).toHaveLength(2)
})

test('cancellation rejection remains visible and does not abandon the actual role', async () => {
  const f = fixture(undefined, { cancelAgent() { throw new Error('Stop transport failed') } }); f.run.start(); f.run.cancel()
  expect(f.run.getSnapshot().nodes[0].cancellationError).toBe('Stop transport failed')
  expect(f.run.getSnapshot().status).toBe('cancelling')
  for (const child of f.children.values()) child.resolve({ status: 'cancelled' })
  expect((await f.run.finished).status).toBe('cancelled')
})

test('cancel during synchronous handle allocation cancels the returned run exactly once', async () => {
  const child = defer(), cancelled = []; let run, starts = 0
  run = createStrategyRun(definition(), { id: 'race', goal: 'G', clock: clockFixture(), startAgent() { starts++; run.cancel(); return { runId: 'late-handle', finished: child.promise } }, cancelAgent: id => cancelled.push(id) })
  run.start()
  expect(starts).toBe(1)
  expect(cancelled).toEqual(['late-handle'])
  expect(run.getSnapshot().status).toBe('cancelling')
  child.resolve({ status: 'cancelled' })
  expect((await run.finished).status).toBe('cancelled')
})

test('cancel before start and observer cancellation before dispatch never invoke a worker', async () => {
  const before = fixture(); before.run.cancel(); before.run.start()
  expect((await before.run.finished).status).toBe('cancelled')
  expect(before.calls).toHaveLength(0)
  let observed
  observed = fixture(undefined, { onEvent(state) { if (state.nodes[0].status === 'running' && !state.nodes[0].runId) observed.run.cancel() } })
  observed.run.start()
  expect((await observed.run.finished).status).toBe('cancelled')
  expect(observed.calls).toHaveLength(0)
})

test('wall-clock deadline stops admission and waits for actual receipts before incomplete', async () => {
  const f = fixture(); f.run.start(); f.clock.advance(1000)
  expect(f.run.getSnapshot().status).toBe('cancelling')
  f.children.get('facts').resolve({ status: 'done', output: 'Late result' }); await tick()
  expect(f.calls).toHaveLength(2)
  expect(f.run.getSnapshot().status).toBe('cancelling')
  f.children.get('risks').resolve({ status: 'cancelled' })
  expect((await f.run.finished).status).toBe('incomplete')
  expect(f.run.getSnapshot().reason).toContain('wall-clock')
})

test('a throttled timer cannot admit downstream work after the actual deadline', async () => {
  let time = 0
  const f = fixture(undefined, { clock: { now: () => time, setTimeout() { return 1 }, clearTimeout() {} } })
  f.run.start(); time = 1001 // Deliberately never deliver the scheduled timer callback.
  f.children.get('facts').resolve({ status: 'done', output: 'F' })
  f.children.get('risks').resolve({ status: 'done', output: 'R' })
  expect((await f.run.finished).status).toBe('incomplete')
  expect(f.calls).toHaveLength(2)
})

test('typed incomplete, interrupted and malformed results never become success by their text', async () => {
  for (const [receipt, terminal] of [[{ status: 'incomplete', output: 'All done' }, 'incomplete'], [{ status: 'interrupted', output: 'All done' }, 'interrupted'], [{ status: 'success', output: 'All done' }, 'failed'], [{ status: 'done', output: { verified: true } }, 'failed'], ['done', 'failed']]) {
    const spec = definition(); spec.nodes = [spec.nodes[0]]; spec.output = 'facts'
    const f = fixture(spec); f.run.start(); f.children.get('facts').resolve(receipt)
    const result = await f.run.finished
    expect(result.status).toBe(terminal)
    expect(result.output).toBe('')
  }
})

test('a rejected child promise is a failure and bounds public diagnostics', async () => {
  const spec = definition(); spec.nodes = [spec.nodes[0]]; spec.output = 'facts'
  const f = fixture(spec); f.run.start(); f.children.get('facts').reject(new Error(`token=private-value Bearer private-bearer https://name:secret@example.test/path ${'x'.repeat(1000)}`))
  const result = await f.run.finished
  expect(result.status).toBe('failed')
  expect(result.reason.length).toBeLessThanOrEqual(512)
  expect(result.reason).not.toContain('private-value')
  expect(result.reason).not.toContain('private-bearer')
  expect(result.reason).not.toContain('name:secret')
})

test('input limits fail without truncating evidence or admitting the downstream role', async () => {
  const spec = definition(); spec.nodes[2].inputs.facts.maxChars = 3
  const f = fixture(spec); f.run.start()
  f.children.get('facts').resolve({ status: 'done', output: 'More than three' })
  f.children.get('risks').resolve({ status: 'done', output: 'R' })
  expect((await f.run.finished).status).toBe('incomplete')
  expect(f.calls).toHaveLength(2)
  expect(f.run.getSnapshot().nodes[2]).toMatchObject({ status: 'incomplete', runId: null, result: null })
})

test('substitution is literal and cannot recursively inject another input or authority', async () => {
  const spec = definition(); spec.nodes[2].template = '{{facts}}'; delete spec.nodes[2].inputs.risks
  const context = { toolPolicy: { allowDelegation: true }, binding: { root: '/original' } }
  const f = fixture(spec, { context }); context.binding.root = '/changed'
  spec.nodes[2].template = 'Mutation after creation'
  f.run.start()
  f.children.get('facts').resolve({ status: 'done', output: '{{risks}}' })
  f.children.get('risks').resolve({ status: 'done', output: 'Undeclared secret' }); await tick()
  expect(f.calls[2].query).toBe('{{risks}}')
  expect(f.calls[2].context.binding.root).toBe('/original')
  expect(Object.isFrozen(f.calls[2].context)).toBe(true)
  f.children.get('synthesis').resolve({ status: 'done', output: 'S' }); await f.run.finished
})

test('typed waiting metadata rejects stale handles and cannot settle a role', async () => {
  const f = fixture(); f.run.start()
  expect(f.run.updateAgent('facts', 'wrong-run', { waiting: { kind: 'approval', approvalIds: [1] } })).toBe(false)
  expect(f.run.updateAgent('facts', 'run-facts', { waiting: { kind: 'approval', approvalIds: [1] } })).toBe(true)
  expect(f.run.getSnapshot().nodes[0].waiting).toEqual({ kind: 'approval', approvalIds: [1] })
  expect(f.run.getSnapshot().nodes[0].status).toBe('running')
  expect(f.run.updateAgent('facts', 'run-facts', { waiting: { kind: 'done', approvalIds: [] } })).toBe(false)
  expect(f.run.updateAgent('facts', 'run-facts', { waiting: null })).toBe(true)
  f.run.cancel()
  expect(f.run.updateAgent('facts', 'run-facts', { waiting: { kind: 'approval' } })).toBe(false)
  for (const child of f.children.values()) child.resolve({ status: 'cancelled' }); await f.run.finished
})

test('start is idempotent and a stopped graph cannot be replayed', async () => {
  const f = fixture(); const first = f.run.start(); expect(f.run.start()).toBe(first)
  expect(f.calls).toHaveLength(2)
  f.run.cancel(); for (const child of f.children.values()) child.resolve({ status: 'cancelled' })
  await first; expect(f.run.start()).toBe(first); expect(f.calls).toHaveLength(2)
})

test('validation rejects invalid graphs before any worker admission', () => {
  const bad = []
  const add = mutate => { const spec = definition(); mutate(spec); bad.push(spec) }
  add(s => { s.nodes[1].id = 'facts' })
  add(s => { s.nodes[0].dependsOn = ['missing'] })
  add(s => { s.nodes[0].dependsOn = ['synthesis'] })
  add(s => { s.nodes[2].inputs.facts.node = 'unmentioned' })
  add(s => { s.nodes[0].template = '{{unknown}}' })
  add(s => { s.nodes[0].template = '{{goal' })
  add(s => { s.nodes[0].template = '{{goal}}'; s.nodes[0].inputs.unused = { from: 'goal' } })
  add(s => { s.nodes[0].tools = ['host_exec'] })
  add(s => { s.nodes[0].agent = '../escape' })
  add(s => { s.output = 'facts' })
  add(s => { s.limits.maxParallel = 33 })
  add(s => { s.limits.maxWallMs = Infinity })
  add(s => { s.nodes[0].inputs.goal.maxChars = 0 })
  add(s => { s.nodes = Array.from({ length: 65 }, (_, i) => ({ ...s.nodes[0], id: `n${i}` })) })
  let starts = 0
  for (const spec of bad) expect(() => fixture(spec, { startAgent() { starts++ } })).toThrow('Invalid strategy')
  expect(() => fixture(definition(), { hasAgent: () => false })).toThrow('available role')
  expect(() => fixture(definition(), { context: { toolPolicy: { allowDelegation: false } } })).toThrow('disabled delegation')
  expect(starts).toBe(0)
  const highest = definition(); highest.limits.maxParallel = 32
  expect(validateStrategy(highest).limits.maxParallel).toBe(32)
})

test('synchronous start failure skips every later node and never claims a child result', async () => {
  const f = fixture(undefined, { startAgent() { throw new Error('Cannot allocate worker') } }); f.run.start()
  const result = await f.run.finished
  expect(result.status).toBe('failed')
  expect(result.snapshot.nodes.map(node => node.status)).toEqual(['failed', 'skipped', 'skipped'])
  expect(result.snapshot.nodes.every(node => node.result === null)).toBe(true)
})

test('known malformed handle retains unknown outcome until an explicit actual receipt arrives', async () => {
  const cancellations = []
  const f = fixture(undefined, { startAgent() { return { runId: 'admitted-without-promise' } }, cancelAgent: id => cancellations.push(id) })
  let finished = false; f.run.start().then(() => { finished = true }); await tick()
  const node = f.run.getSnapshot().nodes[0]
  expect(node).toMatchObject({ runId: 'admitted-without-promise', status: 'cancelling', result: null })
  expect(node.cancellationError).toContain('Outcome unknown')
  expect(finished).toBe(false)
  expect(cancellations).toEqual(['admitted-without-promise'])
  f.run.cancel(); expect(cancellations).toHaveLength(1)
  expect(f.run.settleAgent('facts', 'stale-id', { status: 'cancelled' })).toBe(false)
  expect(f.run.settleAgent('facts', 'admitted-without-promise', { ok: true })).toBe(false)
  expect(f.run.settleAgent('facts', 'admitted-without-promise', { status: 'cancelled' })).toBe(true)
  expect(f.run.settleAgent('facts', 'admitted-without-promise', { status: 'done', output: 'Duplicate' })).toBe(false)
  expect((await f.run.finished).status).toBe('failed')
})

test('explicit receipt and normal promise cannot double-complete or replay downstream work', async () => {
  const f = fixture(); f.run.start()
  expect(f.run.settleAgent('facts', 'run-facts', { status: 'done', output: 'Actual F' })).toBe(true)
  f.children.get('facts').resolve({ status: 'failed', reason: 'Duplicate stale delivery' })
  f.children.get('risks').resolve({ status: 'done', output: 'R' }); await tick()
  expect(f.calls).toHaveLength(3)
  expect(f.calls[2].query).toBe('Evidence: Actual F\nRisks: R')
  f.children.get('synthesis').resolve({ status: 'done', output: 'S' })
  expect((await f.run.finished).status).toBe('done')
})
