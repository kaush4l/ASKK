import { expect, test } from 'bun:test'
import { createObservedWorkspace, createWriteObservations } from '../src/core/write-observations.js'

const receipt = (id = 'one', path = 'a.js', rev = 'sha:1') => ({ content: 'old', rev, writeObservation: { id, path, revision: rev } })
const proposal = (path = 'a.js') => ({ path, content: 'new', observed: true })

test('resolution freezes exact read evidence and earlier snapshots survive later reads', () => {
  const ledger = createWriteObservations(), read = receipt()
  ledger.accept('a.js', read)
  const resolved = ledger.resolve(proposal())
  read.writeObservation.revision = 'tampered'; read.rev = 'tampered'
  ledger.accept('a.js', receipt('two', 'a.js', 'sha:2'))
  expect(resolved.expect).toBe('sha:1')
  expect(Object.isFrozen(resolved)).toBe(true)
  expect(ledger.resolve(resolved, { resolved: true })).toEqual(resolved)
  expect(ledger.resolve(proposal()).expect).toBe('sha:2')
  expect(() => ledger.resolve({ ...resolved, path: 'b.js' }, { resolved: true })).toThrow()
  expect(() => ledger.resolve({ ...resolved, expect: 'sha:2' }, { resolved: true })).toThrow()
  ledger.invalidate('a.js')
  expect(() => ledger.resolve(resolved, { resolved: true })).toThrow()
})

test('malformed reads and model-provided provenance cannot mint observations', () => {
  const ledger = createWriteObservations()
  for (const read of [null, { ...receipt(), ok: false }, { ...receipt(), conflict: true }, { ...receipt(), content: null }, { ...receipt(), rev: 'other' }, receipt('one', 'b.js')]) expect(() => ledger.accept('a.js', read)).toThrow()
  for (const args of [proposal(), { ...proposal(), expect: 0 }, { ...proposal(), observed: false }, { ...proposal(), observationId: 'one' }, { path: 'a.js', content: 'new' }, { ...proposal('../a.js') }, { path: 'a.js', content: 'new', expect: -1 }]) expect(() => ledger.resolve(args)).toThrow()
  expect(ledger.resolve({ path: 'a.js', content: 'new', expect: 0 })).toEqual({ path: 'a.js', content: 'new', expect: 0 })
})

function fixture() {
  let runtime = 'runtime:root:1', rev = 'sha:1', content = 'old', calls = 0
  const adapter = createObservedWorkspace({ identity: () => runtime, read: async () => ({ content, rev }), write: async args => {
    calls++
    if (args.expect !== rev) return { conflict: true, rev }
    content = args.content; rev = 'sha:written'; return { ok: true, rev }
  } })
  return { adapter, mutate: value => { rev = value }, runtime: value => { runtime = value }, calls: () => calls }
}

test('adapter validates run, path and runtime provenance before any write', async () => {
  const f = fixture(), run = {}, ledger = createWriteObservations()
  ledger.accept('a.js', await f.adapter.read({ path: 'a.js' }, run))
  const resolved = ledger.resolve(proposal())
  await expect(f.adapter.write(resolved, {})).rejects.toThrow()
  await expect(f.adapter.write({ ...resolved, path: 'b.js' }, run)).rejects.toThrow()
  f.runtime('runtime:root:2')
  await expect(f.adapter.write(resolved, run)).rejects.toThrow()
  await expect(f.adapter.read({ path: 'a.js' }, run)).rejects.toThrow()
  expect(f.calls()).toBe(0)
})

test('stale CAS is preserved and a conflict revokes all references until an explicit read', async () => {
  const f = fixture(), run = {}, ledger = createWriteObservations()
  ledger.accept('a.js', await f.adapter.read({ path: 'a.js' }, run))
  const resolved = ledger.resolve(proposal())
  f.mutate('external')
  expect(await f.adapter.write(resolved, run)).toEqual({ conflict: true, rev: 'external' })
  await expect(f.adapter.write(resolved, run)).rejects.toThrow()
  expect(f.calls()).toBe(1)
  ledger.accept('a.js', await f.adapter.read({ path: 'a.js' }, run))
  expect(await f.adapter.write(ledger.resolve(proposal()), run)).toEqual({ ok: true, rev: 'sha:written' })
})

test('adapter uses the immutable selected read even if another read happens before execution', async () => {
  const f = fixture(), run = {}, ledger = createWriteObservations()
  ledger.accept('a.js', await f.adapter.read({ path: 'a.js' }, run))
  const resolved = ledger.resolve(proposal())
  f.mutate('external')
  ledger.accept('a.js', await f.adapter.read({ path: 'a.js' }, run))
  expect((await f.adapter.write(resolved, run)).conflict).toBe(true)
})

test('an execution change during an asynchronous read cannot mint a reference', async () => {
  let runtime = 'first', complete
  const adapter = createObservedWorkspace({ identity: () => runtime, read: () => new Promise(resolve => { complete = resolve }), write: () => { throw new Error('unexpected write') } })
  const pending = adapter.read({ path: 'a.js' }, {})
  runtime = 'second'; complete({ content: 'old', rev: '1' })
  await expect(pending).rejects.toThrow('execution identity changed')
})

test('literal creation revisions and legacy alias arguments reach adapters unchanged', async () => {
  const received = []
  const adapter = createObservedWorkspace({ identity: () => 'runtime', read: async () => receipt(), write: async args => { received.push(args); return { conflict: true } } })
  const run = {}
  await adapter.read({ path: 'a.js' }, run)
  for (const args of [{ path: 'a.js', content: 'new', expect: 0 }, { path: 'a.js', content: 'new', expectedRevision: 0 }]) {
    await adapter.write(args, run)
    expect(received.at(-1)).toBe(args)
  }
})

test('write errors revoke references without retrying', async () => {
  let calls = 0
  const adapter = createObservedWorkspace({ identity: () => 'runtime', read: async () => ({ content: 'old', rev: 1 }), write: async () => { calls++; throw new Error('storage failed') } })
  const run = {}, ledger = createWriteObservations()
  ledger.accept('a.js', await adapter.read({ path: 'a.js' }, run))
  const resolved = ledger.resolve(proposal())
  await expect(adapter.write(resolved, run)).rejects.toThrow('storage failed')
  await expect(adapter.write(resolved, run)).rejects.toThrow()
  expect(calls).toBe(1)
})

test('an explicit absence observation can create but cannot overwrite an intervening creation', async () => {
  for (const intervening of [false, true]) {
    let file = null
    const adapter = createObservedWorkspace({ identity: () => 'runtime', read: async () => file, write: async args => {
      if (args.expect !== (file?.rev ?? 0)) return { conflict: true, rev: file.rev, current: file }
      file = { content: args.content, rev: 'created' }; return { ...file, ok: true }
    } })
    const run = {}, ledger = createWriteObservations()
    const read = await adapter.read({ path: 'a.js' }, run)
    expect(read).toMatchObject({ found: false, content: null, rev: 0 })
    ledger.accept('a.js', read)
    const resolved = ledger.resolve(proposal())
    expect(resolved.expect).toBe(0)
    if (intervening) file = { content: 'owner content', rev: 'owner' }
    const result = await adapter.write(resolved, run)
    expect(file.content).toBe(intervening ? 'owner content' : 'new')
    expect(Boolean(result.conflict)).toBe(intervening)
    if (intervening) await expect(adapter.write(resolved, run)).rejects.toThrow()
  }
})

test('undefined, failed, and contradictory reads cannot mint absence observations', async () => {
  for (const value of [undefined, false, { ok: false }, { content: 'text', rev: 1, found: false }, { content: null, rev: 0, found: false }]) {
    const adapter = createObservedWorkspace({ identity: () => 'runtime', read: async () => value, write: () => { throw Error('unexpected write') } })
    const result = await adapter.read({ path: 'a.js' }, {}).catch(() => null)
    expect(result?.writeObservation).toBeUndefined()
  }
  const ledger = createWriteObservations()
  for (const value of [{ ...receipt(), found: false }, { ...receipt(), found: false, content: null }, { ...receipt('zero', 'a.js', 0), found: false, content: '' }]) expect(() => ledger.accept('a.js', value)).toThrow()
})
