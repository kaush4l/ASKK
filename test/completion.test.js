import { expect, test } from 'bun:test'
import { normalizeCompletion, evaluateCompletion } from '../src/core/completion.js'
const declared = () => ({ checks: [{ capability: 'workspace.artifact', options: { requireFresh: true, requireInteraction: true } }] })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

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
