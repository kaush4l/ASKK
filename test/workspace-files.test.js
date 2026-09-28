import { test, expect } from 'bun:test'
import { ProjectFiles } from '../src/workspace/files.js'
import { openStore } from '../src/runtime/store.js'
async function memoryFixture() { const files = new ProjectFiles(); files.store = await openStore('memory-fixture'); files.store.durable = true; return files }

test('revision-checked concurrent offline commits preserve the winning content', async () => {
  const files = await memoryFixture()
  await files.save({ path: 'app/page.jsx', content: 'original', expect: 0 })
  const results = await Promise.all([files.save({ path: 'app/page.jsx', content: 'one', expect: 1 }), files.save({ path: 'app/page.jsx', content: 'two', expect: 1 })])
  expect(results.filter(row => row.conflict)).toHaveLength(1)
  expect((await files.read('app/page.jsx')).content).toBe('one')
  const conflict = results.find(row => row.conflict)
  expect(conflict.current.content).toBe('one')
})

test('offline rename is atomic and cannot overwrite a concurrent destination', async () => {
  const files = await memoryFixture()
  await files.save({ path: 'a', content: 'A', expect: 0 }); await files.save({ path: 'b', content: 'B', expect: 0 })
  const results = await Promise.allSettled([files.rename('a', 'destination', 1), files.rename('b', 'destination', 1)])
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect((await files.list()).map(row => row.path)).toEqual(['b', 'destination'])
  await expect(files.remove('destination', 1)).rejects.toThrow('changed')
  expect((await files.read('destination')).content).toBe('A')
})

test('unavailable durable storage never acknowledges an offline save', async () => {
  const files = await memoryFixture(); files.store.durable = false
  await expect(files.save({ path: 'draft.js', content: 'important', expect: 0 })).rejects.toThrow('not been saved durably')
  expect(await files.read('draft.js')).toBe(null)
})

for (const operation of ['write', 'rename', 'delete']) test(`mounted ${operation} reports the real mutation before a cache failure`, async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'a.js': 'original' }); const events = []
  backend.rename = async ({ path, destination, expectedRevision }) => {
    const current = backend.records.get(path)
    if (current?.rev !== expectedRevision) throw new Error('Revision conflict')
    backend.records.set(destination, { ...current, path: destination }); backend.records.delete(path)
  }
  await files.mount(backend); files.onCommit = event => events.push(event)
  files.store.put = async () => { throw new Error('Cache unavailable') }
  files.store.delete = async () => { throw new Error('Cache unavailable') }
  const mutate = operation === 'write' ? () => files.save({ path: 'a.js', content: 'changed', expect: 1 }) : operation === 'rename' ? () => files.rename('a.js', 'b.js', 1) : () => files.remove('a.js', 1)
  const outcome = await mutate().catch(error => error)
  expect(outcome).toMatchObject({ code: 'WORKSPACE_RECONCILIATION_FAILED', committed: true, operation, path: operation === 'rename' ? 'b.js' : 'a.js' })
  expect(outcome.message).toContain('Cache unavailable')
  expect(outcome.message).toContain('runtime acknowledged')
  if (operation === 'write') expect(outcome.writtenRevision).toBe(2)
  expect(events).toHaveLength(1)
  expect(events[0].operation).toBe(operation)
  if (operation === 'write') expect((await backend.read('a.js')).content).toBe('changed')
  else expect(await backend.read('a.js')).toBe(null)
  if (operation === 'rename') expect((await backend.read('b.js')).content).toBe('original')
})

for (const operation of ['rename', 'delete']) test(`mounted ${operation} cannot acknowledge a backend CAS conflict`, async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'a.js': 'original' }); const events = []
  await files.mount(backend); files.onCommit = event => events.push(event)
  backend[operation === 'rename' ? 'rename' : 'remove'] = async () => ({ conflict: true, rev: 2 })
  await expect(operation === 'rename' ? files.rename('a.js', 'b.js', 1) : files.remove('a.js', 1)).rejects.toThrow('changed')
  expect(events).toHaveLength(0)
  expect((await files.store.get('files', 'a.js')).content).toBe('original')
  expect((await backend.read('a.js')).content).toBe('original')
})

for (const mutation of ['edit', 'delete', 'same-content-new-revision']) test(`mounted save preserves its acknowledged CAS base after an external ${mutation}`, async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'a.js': 'original' }); const events = []
  await files.mount(backend); files.onCommit = event => events.push(event)
  const write = backend.write.bind(backend)
  backend.write = async args => {
    const receipt = await write(args)
    if (mutation === 'delete') backend.records.delete(args.path)
    else backend.records.set(args.path, { path: args.path, content: mutation === 'edit' ? 'external edit' : args.content, rev: 3 })
    return receipt
  }
  const result = await files.save({ path: 'a.js', content: 'owner edit', expect: 1 })
  expect(result).toMatchObject({ conflict: true, committed: true, writtenRevision: 2, rev: mutation === 'delete' ? 0 : 3 })
  expect(result.ok).not.toBe(true)
  expect(result.current?.content ?? null).toBe(mutation === 'delete' ? null : mutation === 'edit' ? 'external edit' : 'owner edit')
  expect(events).toEqual([expect.objectContaining({ operation: 'write', content: 'owner edit', rev: 2 })])
  expect((await files.store.get('files', 'a.js')).content).toBe('original')
  const next = await files.save({ path: 'a.js', content: 'owner next edit', expect: 1 })
  expect(next.conflict).toBe(true)
  expect(backend.operations).toHaveLength(1)
})

test('a committed save invalidates evidence even when its verification read fails', async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'a.js': 'original' }); const events = []
  await files.mount(backend); files.onCommit = event => events.push(event)
  const write = backend.write.bind(backend)
  backend.write = async args => {
    const receipt = await write(args)
    backend.read = async () => { throw new Error('Disconnected after commit') }
    return receipt
  }
  const outcome = await files.save({ path: 'a.js', content: 'owner edit', expect: 1 }).catch(error => error)
  expect(outcome).toMatchObject({ code: 'WORKSPACE_RECONCILIATION_FAILED', committed: true, operation: 'write', path: 'a.js', writtenRevision: 2 })
  expect(outcome.cause.message).toBe('Disconnected after commit')
  expect(backend.operations).toHaveLength(1)
  expect(events).toEqual([expect.objectContaining({ operation: 'write', content: 'owner edit', rev: 2 })])
  expect(backend.records.get('a.js').content).toBe('owner edit')
})

function backendFixture(initial = {}) {
  const records = new Map(Object.entries(initial).map(([path, content]) => [path, { path, content, rev: 1 }]))
  const operations = []
  const backend = {
    records, operations,
    async list() { return [...records.values()].map(({ path, content, rev }) => ({ path, rev, size: new TextEncoder().encode(content).length })) },
    async read(path) { return structuredClone(records.get(path) ?? null) },
    async write({ path, content, expectedRevision }) {
      await backend.beforeWrite?.(path)
      const previous = records.get(path); const rev = previous?.rev ?? 0
      if (String(expectedRevision) !== String(rev)) return { conflict: true, rev, current: structuredClone(previous) }
      const next = typeof rev === 'number' ? rev + 1 : `${rev}:next`
      records.set(path, { path, content, rev: next }); operations.push(['write', path, expectedRevision]); return { rev: next }
    },
    async remove({ path, expectedRevision }) {
      await backend.beforeRemove?.(path)
      const rev = records.get(path)?.rev ?? 0
      if (String(expectedRevision) !== String(rev)) return { conflict: true, rev }
      records.delete(path); operations.push(['remove', path, expectedRevision])
    },
  }
  return backend
}
function reload(files) { const next = new ProjectFiles(); next.store = files.store; return next }
async function cachedFixture(initial) {
  const files = await memoryFixture(); const backend = backendFixture(initial)
  await files.mount(backend)
  return { files: reload(files), backend }
}

test('saved offline edits survive reload and safely replay over an existing cached volume', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original', 'other.js': 'untouched' })
  const saved = await files.save({ path: 'app.js', content: 'saved offline', expect: 1 })
  const restored = reload(files)
  expect((await restored.read('app.js')).content).toBe('saved offline')
  expect((await restored.read('app.js')).rev).toBe(saved.rev)
  await restored.mount(backend)
  expect((await restored.read('app.js')).content).toBe('saved offline')
  expect(backend.operations).toEqual([['write', 'app.js', 1]])
  expect((await reload(restored).read('app.js')).content).toBe('saved offline')
  expect(Object.keys((await restored.journal()).entries)).toHaveLength(0)
})

test('a changed backend rejects mount without replacing saved browser content or writing other pending files', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original' })
  await files.save({ path: 'new.js', content: 'new offline file', expect: 0 })
  await files.save({ path: 'app.js', content: 'saved offline', expect: 1 })
  backend.records.set('app.js', { path: 'app.js', content: 'external change', rev: 2 })
  const restored = reload(files)
  await expect(restored.mount(backend)).rejects.toMatchObject({ code: 'WORKSPACE_MOUNT_CONFLICT', conflicts: [{ path: 'app.js', operation: 'write', expectedRevision: 1, actualRevision: 2 }] })
  expect(restored.backend).toBe(null)
  expect((await restored.read('app.js')).content).toBe('saved offline')
  expect((await backend.read('app.js')).content).toBe('external change')
  expect(backend.operations).toEqual([])
  expect((await reload(restored).read('new.js')).content).toBe('new offline file')
})

test('clean cached files never overwrite external edits or resurrect externally deleted files', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'old', 'removed.js': 'old' })
  backend.records.set('app.js', { path: 'app.js', content: 'external', rev: 2 })
  backend.records.delete('removed.js')
  await files.mount(backend)
  expect((await files.read('app.js')).content).toBe('external')
  expect(await files.read('removed.js')).toBe(null)
  expect(backend.operations).toEqual([])
  const restored = reload(files); backend.records.clear()
  await restored.mount(backend)
  expect(await restored.list()).toEqual([])
  expect(backend.operations).toEqual([])
})

test('new saved files replay into a nonempty volume only at absent paths', async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'existing.js': 'external' })
  await files.save({ path: 'new.js', content: 'saved', expect: 0 })
  await files.mount(backend)
  expect((await files.read('existing.js')).content).toBe('external')
  expect((await files.read('new.js')).content).toBe('saved')
  const conflict = await memoryFixture()
  await conflict.save({ path: 'existing.js', content: 'different local file', expect: 0 })
  await expect(conflict.mount(backend)).rejects.toThrow('saved browser copies are preserved')
  expect((await conflict.read('existing.js')).content).toBe('different local file')
})

test('offline rename and deletion survive reload and replay only after destination writes', async () => {
  const { files, backend } = await cachedFixture({ 'from.js': 'move me', 'delete.js': 'delete me' })
  await files.rename('from.js', 'folder/to.js', 1)
  await files.remove('delete.js', 1)
  const restored = reload(files)
  expect((await restored.list()).map(row => row.path)).toEqual(['folder/to.js'])
  expect((await restored.snapshot()).map(row => row.path)).toEqual(['folder/to.js'])
  await restored.mount(backend)
  expect((await restored.list()).map(row => row.path)).toEqual(['folder/to.js'])
  expect(backend.operations[0]).toEqual(['write', 'folder/to.js', 0])
  expect(backend.operations.slice(1).every(row => row[0] === 'remove')).toBe(true)
})

test('a rename destination conflict preserves both original runtime files and the saved renamed staging file', async () => {
  const { files, backend } = await cachedFixture({ 'from.js': 'original' })
  await files.rename('from.js', 'to.js', 1)
  backend.records.set('to.js', { path: 'to.js', content: 'concurrent destination', rev: 1 })
  await expect(files.mount(backend)).rejects.toThrow('to.js')
  expect((await files.read('to.js')).content).toBe('original')
  expect((await backend.read('from.js')).content).toBe('original')
  expect((await backend.read('to.js')).content).toBe('concurrent destination')
  expect(backend.operations).toEqual([])
})

test('late backend CAS failure cannot delete a rename source', async () => {
  const { files, backend } = await cachedFixture({ 'from.js': 'original' })
  await files.rename('from.js', 'to.js', 1)
  backend.beforeWrite = path => { backend.records.set(path, { path, content: 'raced', rev: 5 }) }
  await expect(files.mount(backend)).rejects.toThrow('saved browser copies are preserved')
  expect((await backend.read('from.js')).content).toBe('original')
  expect((await reload(files).read('to.js')).content).toBe('original')
  expect(backend.operations.some(row => row[0] === 'remove')).toBe(false)
})

test('an interrupted rename mount can retry without rewriting its already-copied destination', async () => {
  const { files, backend } = await cachedFixture({ 'from.js': 'original' })
  await files.rename('from.js', 'to.js', 1)
  backend.beforeRemove = () => { throw new Error('connection interrupted') }
  await expect(files.mount(backend)).rejects.toThrow('saved browser copies are preserved')
  expect((await reload(files).read('to.js')).content).toBe('original')
  delete backend.beforeRemove
  const restored = reload(files)
  await restored.mount(backend)
  expect(await restored.read('from.js')).toBe(null)
  expect((await restored.read('to.js')).content).toBe('original')
  expect(backend.operations.filter(row => row[0] === 'write')).toHaveLength(1)
})

test('legacy untagged saved files are preserved on ambiguous mounts, and import into empty volumes', async () => {
  const files = await memoryFixture()
  await files.store.put('files', { path: 'legacy.js', content: 'saved by older release', rev: 4 })
  await expect(files.mount(backendFixture({ 'legacy.js': 'different runtime bytes' }))).rejects.toThrow('legacy.js')
  expect((await reload(files).read('legacy.js')).content).toBe('saved by older release')
  const backend = backendFixture()
  await files.mount(backend)
  expect((await backend.read('legacy.js')).content).toBe('saved by older release')
})

test('offline edits support opaque backend revisions without losing the original CAS base', async () => {
  const files = await memoryFixture(); const backend = backendFixture({ 'app.js': 'original' })
  backend.records.get('app.js').rev = 'content-hash'
  await files.mount(backend)
  const offline = reload(files)
  const first = await offline.save({ path: 'app.js', content: 'first', expect: 'content-hash' })
  expect(typeof first.rev).toBe('string')
  await offline.save({ path: 'app.js', content: 'second', expect: first.rev })
  await offline.mount(backend)
  expect(backend.operations).toEqual([['write', 'app.js', 'content-hash']])
  expect((await offline.read('app.js')).content).toBe('second')
})

test('offline deletion refuses to delete a file that changed since its cached base', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original' })
  await files.remove('app.js', 1)
  backend.records.set('app.js', { path: 'app.js', content: 'external update', rev: 2 })
  await expect(reload(files).mount(backend)).rejects.toThrow('app.js')
  expect((await backend.read('app.js')).content).toBe('external update')
  expect(backend.operations).toEqual([])
})

test('offline rename and deletion cannot acknowledge unavailable durable storage', async () => {
  const files = await memoryFixture()
  await files.save({ path: 'app.js', content: 'saved', expect: 0 })
  files.store.durable = false
  await expect(files.rename('app.js', 'other.js', 1)).rejects.toThrow('not been saved durably')
  await expect(files.remove('app.js', 1)).rejects.toThrow('not been saved durably')
  expect((await files.read('app.js')).content).toBe('saved')
})

test('a save from another owner during mount cannot be cleared by the older replay', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original' })
  await files.save({ path: 'app.js', content: 'first saved edit', expect: 1 })
  const concurrent = reload(files)
  backend.beforeWrite = async () => { delete backend.beforeWrite; await concurrent.save({ path: 'app.js', content: 'newer saved edit', expect: 2 }) }
  await expect(files.mount(backend)).rejects.toThrow('changed during mount')
  expect(files.backend).toBe(null)
  expect((await reload(files).read('app.js')).content).toBe('newer saved edit')
})

test('legacy staging remains recoverable if runtime files change while the checkpoint is captured', async () => {
  const files = await memoryFixture(); const backend = backendFixture()
  await files.store.put('files', { path: 'legacy.js', content: 'saved original', rev: 1 })
  const list = backend.list
  backend.list = async () => { backend.records.set('legacy.js', { path: 'legacy.js', content: 'external race', rev: 3 }); return list() }
  await expect(files.mount(backend)).rejects.toThrow('saved browser copies are preserved')
  expect(files.backend).toBe(null)
  expect((await reload(files).read('legacy.js')).content).toBe('saved original')
  expect((await backend.read('legacy.js')).content).toBe('external race')
})

test('legitimate filenames matching object prototype names are ordinary staged paths', async () => {
  const files = await memoryFixture(); const backend = backendFixture()
  await files.save({ path: '__proto__', content: 'plain file', expect: 0 })
  await files.rename('__proto__', 'constructor', 1)
  await files.mount(backend)
  expect((await files.read('constructor')).content).toBe('plain file')
  expect(await files.read('__proto__')).toBe(null)
})

for (const choice of ['saved', 'runtime', 'merge']) test(`offline conflict resolution retains both copies until mount and applies the ${choice} choice`, async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original' })
  await files.save({ path: 'app.js', content: 'saved draft', expect: 1 })
  backend.records.set('app.js', { path: 'app.js', content: 'external edit', rev: 3 })
  await expect(files.mount(backend)).rejects.toThrow('conflict')
  const review = await files.reviewConflict(backend, 'app.js')
  expect(review.saved.content).toBe('saved draft')
  expect(review.runtime.content).toBe('external edit')
  await files.resolveConflict(backend, { path: review.path, journalRevision: review.journalRevision, runtimeRevision: review.runtime.rev, choice, content: 'merged result' })
  expect((await backend.read('app.js')).content).toBe('external edit')
  const retained = (await files.journal()).entries['app.js'].review
  expect(retained.previous.value.content).toBe('saved draft')
  expect(retained.runtime.content).toBe('external edit')
  const restored = reload(files)
  await restored.mount(backend)
  expect((await restored.read('app.js')).content).toBe({ saved: 'saved draft', runtime: 'external edit', merge: 'merged result' }[choice])
})

test('conflict resolution rejects stale browser or runtime review without changing either copy', async () => {
  const { files, backend } = await cachedFixture({ 'app.js': 'original' })
  await files.save({ path: 'app.js', content: 'saved draft', expect: 1 })
  backend.records.set('app.js', { path: 'app.js', content: 'external edit', rev: 3 })
  const review = await files.reviewConflict(backend, 'app.js')
  const resolution = { path: review.path, journalRevision: review.journalRevision, runtimeRevision: review.runtime.rev, choice: 'saved' }
  backend.records.set('app.js', { path: 'app.js', content: 'newer external edit', rev: 4 })
  await expect(files.resolveConflict(backend, resolution)).rejects.toThrow('runtime file changed again')
  await files.save({ path: 'app.js', content: 'newer saved draft', expect: review.saved.rev })
  await expect(files.resolveConflict(backend, { ...resolution, runtimeRevision: 4 })).rejects.toThrow('saved changes changed during review')
  expect((await files.read('app.js')).content).toBe('newer saved draft')
  expect((await backend.read('app.js')).content).toBe('newer external edit')
})
