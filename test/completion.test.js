import { expect, test } from 'bun:test'
import { normalizeCompletion, evaluateCompletion } from '../src/core/completion.js'
import { selectRequiredCommands, requiredCommandReason } from '../src/core/command-checks.js'
const declared = () => ({ checks: [{ capability: 'workspace.artifact', options: { requireFresh: true, requireInteraction: true } }] })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

test('required command contracts preserve exact strings and freeze detached configuration', () => {
  const commands = ['npm test', ' npm test ']
  const contract = normalizeCompletion({ checks: [{ capability: 'workspace.commands', options: { commands } }] })
  commands[0] = 'echo passed'
  expect(contract.checks[0].options).toEqual({ commands: ['npm test', ' npm test '], requireFresh: true })
  expect(Object.isFrozen(contract.checks[0].options.commands)).toBe(true)
  const invalid = [{}, { commands: [] }, { commands: new Array(1) }, { commands: [''] }, { commands: ['  '] }, { commands: [42] }, { commands: ['a\0b'] }, { commands: ['x'.repeat(8193)] }, { commands: Array.from({ length: 17 }, (_, i) => `check ${i}`) }, { commands: ['npm test', 'npm test'] }, { commands: ['npm test'], requireFresh: false }, { commands: ['npm test'], requireFresh: 'true' }, { commands: ['npm test'], extra: true }]
  for (const options of invalid) expect(() => normalizeCompletion({ checks: [{ capability: 'workspace.commands', options }] })).toThrow()
  expect(normalizeCompletion({ checks: [{ capability: 'workspace.command', options: { requireFresh: false } }] }).checks[0].options.requireFresh).toBe(false)
})

test('required command selection cannot substitute unrelated successes or hide latest owned failure', () => {
  const records = [
    { id: 'old', command: 'npm test', runId: 'ours', exitCode: 0 },
    { id: 'failed', command: 'npm test', runId: 'ours', exitCode: 2, output: 'assertion failed' },
    { id: 'unrelated', command: 'echo passed', runId: 'ours', exitCode: 0 },
    { id: 'foreign', command: 'npm test', runId: 'theirs', exitCode: 0 },
  ]
  const selected = selectRequiredCommands(records, ['npm test', 'npm run acceptance'], row => row.runId === 'ours')
  expect(selected.map(row => row?.id ?? null)).toEqual(['failed', null])
  records[1].exitCode = 0
  expect(selected[0].exitCode).toBe(2)
  expect(Object.isFrozen(selected)).toBe(true)
  expect(Object.isFrozen(selected[0])).toBe(true)
  expect(requiredCommandReason('npm test', selected[0])).toContain('assertion failed')
  expect(requiredCommandReason('npm run acceptance', selected[1])).toContain('available permitted tools')
  const diagnostic = requiredCommandReason('npm test', { exitCode: 2, output: 'x'.repeat(3000) + 'FAILED' })
  expect(diagnostic.length).toBeLessThan(1200)
  expect(diagnostic.endsWith('FAILED')).toBe(true)
})

test('required command evaluation pins the suite before awaiting the adapter', async () => {
  const entered = deferred(), release = deferred()
  const commands = ['npm test', 'npm run acceptance']
  const contract = { checks: [{ capability: 'workspace.commands', options: { commands } }] }
  let seen
  const pending = evaluateCompletion(contract, { 'workspace.commands': async options => { seen = options; entered.resolve(); await release.promise; return { ok: false, reason: 'acceptance failed' } } })
  await entered.promise
  commands.splice(1)
  release.resolve()
  expect(seen.commands).toEqual(['npm test', 'npm run acceptance'])
  expect((await pending).ok).toBe(false)
})

test('completion contract defaults are frozen; unknown capabilities, keys and duplicate checks fail closed', () => {
  const normalized = normalizeCompletion({ checks: [{ capability: 'workspace.artifact' }] })
  expect(normalized).toEqual(declared())
  expect(Object.isFrozen(normalized.checks[0].options)).toBe(true)
  for (const value of [null, {}, { checks: new Array(1) }, { checks: [], command: 'anything' }, { checks: [{ capability: 'shell.execute' }] }, { checks: [...declared().checks, ...declared().checks] }, { checks: [{ capability: 'workspace.artifact', options: { requireFresh: 'yes' } }] }, { checks: [{ capability: 'workspace.artifact', options: { command: 'anything' } }] }]) expect(() => normalizeCompletion(value)).toThrow()
})

test('completion captures requested options and adapter before any awaited work', async () => {
  const entered = deferred(), release = deferred(), value = declared()
  let seen
  const adapters = { 'workspace.artifact': async options => { seen = options; entered.resolve(); await release.promise; return { ok: options.requireFresh, revision: 42 } } }
  const pending = evaluateCompletion(value, adapters)
  await entered.promise
  value.checks[0].options.requireFresh = false
  adapters['workspace.artifact'] = () => ({ ok: false })
  release.resolve()
  const result = await pending
  expect(seen.requireFresh).toBe(true)
  expect(result.ok).toBe(true)
  expect(result.checks[0].evidence.revision).toBe(42)
  expect(Object.isFrozen(result.checks[0].evidence)).toBe(true)
})

test('missing adapters, rejected evidence and handler errors cannot imply success', async () => {
  await expect(evaluateCompletion(declared(), {})).rejects.toThrow('unavailable')
  await expect(evaluateCompletion(declared(), Object.create({ 'workspace.artifact': () => ({ ok: true }) }))).rejects.toThrow('unavailable')
  for (const evidence of [undefined, true, { ok: 'true' }, { ok: false, reason: 'stale evidence' }]) expect((await evaluateCompletion(declared(), { 'workspace.artifact': () => evidence })).ok).toBe(false)
  expect(await evaluateCompletion(declared(), { 'workspace.artifact': () => { throw new Error('adapter failed') } })).toMatchObject({ ok: false, reason: 'adapter failed' })
  expect(await evaluateCompletion({ checks: [] }, {})).toMatchObject({ ok: true, checks: [] })
})

test('cancellation before or during evidence lookup cannot return a successful receipt', async () => {
  let active = false, calls = 0
  const assertActive = () => { if (!active) throw new Error('cancelled') }
  await expect(evaluateCompletion(declared(), { 'workspace.artifact': () => { calls++; return { ok: true } } }, { assertActive })).rejects.toThrow('cancelled')
  expect(calls).toBe(0)
  active = true
  const entered = deferred(), release = deferred()
  const pending = evaluateCompletion(declared(), { 'workspace.artifact': async () => { entered.resolve(); return release.promise } }, { assertActive })
  await entered.promise; active = false; release.resolve({ ok: true })
  await expect(pending).rejects.toThrow('cancelled')
})
