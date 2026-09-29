import { expect, test } from 'bun:test'
import { inspectPendingCommands } from '../src/core/completion.js'
import { createEvaluationWorkspace } from '../scripts/evals/workspace-evidence.js'

const contract = (...commands) => ({ checks: [{ capability: 'workspace.commands', options: { commands } }] })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

test('pending references keep original exact-command indices and use the actual adapter', async () => {
  const seen = []
  const result = await inspectPendingCommands(contract(' check first ', 'check second', 'check third'), {
    'workspace.commands': options => {
      seen.push(options)
      return options.commands[0] === 'check second' ? { ok: true } : { ok: false, reason: 'Needs execution' }
    },
  })
  expect(seen).toEqual([' check first ', 'check second', 'check third'].map(command => ({ commands: [command], requireFresh: true })))
  expect(result).toEqual([{ requiredCheck: 0, reason: 'Needs execution' }, { requiredCheck: 2, reason: 'Needs execution' }])
  expect(Object.isFrozen(result)).toBe(true)
  expect(result.every(Object.isFrozen)).toBe(true)
})

test('only the supplied current-run required-command contract creates references', async () => {
  let called = false
  const adapters = { 'workspace.commands': () => { called = true; return { ok: false } } }
  for (const value of [{ checks: [] }, { checks: [{ capability: 'workspace.command' }, { capability: 'workspace.artifact' }] }]) {
    const result = await inspectPendingCommands(value, adapters)
    expect(result).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  }
  expect(called).toBe(false)
  await expect(inspectPendingCommands(contract('check', 'check'), adapters)).rejects.toThrow()
})

test('missing, inherited, malformed, and throwing adapters fail closed with bounded reasons', async () => {
  const adapters = [
    {}, { 'workspace.commands': null },
    Object.create({ 'workspace.commands': () => ({ ok: true }) }),
    ...[null, true, [], { ok: 'true' }, { ok: false }, { ok: false, reason: { message: 'bad shape' } }, { ok: false, reason: 'x'.repeat(3000) }].map(result => ({ 'workspace.commands': () => result })),
    { 'workspace.commands': () => { throw new Error('x'.repeat(3000)) } },
  ]
  for (const adapter of adapters) {
    const result = await inspectPendingCommands(contract('check'), adapter)
    expect(result).toHaveLength(1)
    expect(result[0].requiredCheck).toBe(0)
    expect(typeof result[0].reason).toBe('string')
    expect(result[0].reason.length).toBeGreaterThan(0)
    expect(result[0].reason.length).toBeLessThanOrEqual(1200)
  }
})

test('pending inspection pins contract and adapter across asynchronous validation', async () => {
  const entered = deferred(), release = deferred(), value = contract('first', 'second'), seen = []
  const adapters = { 'workspace.commands': async options => {
    seen.push(options.commands[0]); entered.resolve(); await release.promise
    return { ok: false, reason: 'pending' }
  } }
  const pending = inspectPendingCommands(value, adapters)
  await entered.promise
  value.checks[0].options.commands.splice(0, 2, 'replacement')
  adapters['workspace.commands'] = () => ({ ok: true })
  release.resolve()
  expect((await pending).map(row => row.requiredCheck)).toEqual([0, 1])
  expect(seen).toEqual(['first', 'second'])
})

test('cancellation before or during inspection throws instead of becoming pending or success', async () => {
  let calls = 0
  await expect(inspectPendingCommands(contract('check'), { 'workspace.commands': () => { calls++; return { ok: true } } }, {
    assertActive: () => { throw new Error('cancelled') },
  })).rejects.toThrow('cancelled')
  expect(calls).toBe(0)
  for (const throws of [false, true]) {
    let active = true
    await expect(inspectPendingCommands(contract('check'), { 'workspace.commands': async () => {
      active = false
      if (throws) throw new Error('adapter failed')
      return { ok: true }
    } }, { assertActive: () => { if (!active) throw new Error('cancelled') } })).rejects.toThrow('cancelled')
  }
})

function evaluationFixture() {
  let revision = 'source-a', code = 0, runtimeId = 'runtime'
  const owner = { id: 'run', trace: 'task' }
  const execution = {
    describeCapabilities: () => ({ runtimeId, root: '/project' }),
    snapshot: async () => ({ revision }),
    write: async () => ({ ok: true }),
    startJob: async () => ({ code, runtimeId }),
  }
  const workspace = createEvaluationWorkspace(execution)
  const inspect = () => inspectPendingCommands(contract('test', 'acceptance'), { 'workspace.commands': options => workspace.checkRequired(options, owner) })
  return { workspace, owner, inspect, source: value => { revision = value }, exit: value => { code = value }, rebind: () => { runtimeId = 'replacement' } }
}

test('real evaluation validator exposes missing and foreign receipts then fresh task-owned success', async () => {
  const f = evaluationFixture()
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0, 1])
  await f.workspace.run('test', { id: 'foreign', trace: 'other-task' })
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0, 1])
  await f.workspace.run('test', f.owner)
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([1])
  await f.workspace.run('acceptance', { id: 'child', trace: f.owner.trace })
  const count = f.workspace.commands.length
  expect(await f.inspect()).toEqual([])
  expect(f.workspace.commands).toHaveLength(count)
})

test('real evaluation validator recomputes stale, write-and-revert, and runtime invalidation', async () => {
  const f = evaluationFixture()
  for (const command of ['test', 'acceptance']) await f.workspace.run(command, f.owner)
  expect(await f.inspect()).toEqual([])
  f.source('source-b')
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0, 1])
  f.source('source-a')
  await f.workspace.write({})
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0, 1])
  for (const command of ['test', 'acceptance']) await f.workspace.run(command, f.owner)
  expect(await f.inspect()).toEqual([])
  f.rebind()
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0, 1])
})

test('real evaluation validator does not reuse success after a newer owned failure', async () => {
  const f = evaluationFixture()
  for (const command of ['test', 'acceptance']) await f.workspace.run(command, f.owner)
  expect(await f.inspect()).toEqual([])
  f.exit(1)
  await f.workspace.run('test', f.owner)
  f.exit(0)
  await f.workspace.run('test', { id: 'foreign', trace: 'other-task' })
  expect((await f.inspect()).map(row => row.requiredCheck)).toEqual([0])
  await f.workspace.run('test', f.owner)
  expect(await f.inspect()).toEqual([])
})
