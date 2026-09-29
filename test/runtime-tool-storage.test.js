import { expect, test } from 'bun:test'
import { Hub } from '../src/runtime/hub.js'
import { openStore } from '../src/runtime/store.js'

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const fixture = async (id = 'run') => {
  const hub = new Hub(); hub.store = await openStore(`tool-storage-${crypto.randomUUID()}`)
  const run = { id, trace: id, agent: 'fixture', at: 1, children: [], slot: { status: 'thinking' }, turns: [], prompts: [], requests: [], completions: [], toolEvents: [], spans: [], log: [] }
  hub.runs.set(id, run)
  return { hub, run }
}
const emit = (hub, run, value = 'Exact raw evidence') => hub.record(run, { kind: 'observation', name: 'fixture({})', callId: `call-${run.toolEvents.length + 1}`, ok: true, value })

test('one raw event append never rewrites earlier events inside the run record', async () => {
  const { hub, run } = await fixture(); const writes = []; const appends = []
  const put = hub.store.put; const append = hub.store.appendToolEvent
  hub.store.put = async (name, value) => { if (name === 'runs') writes.push(structuredClone(value)); return put(name, value) }
  hub.store.appendToolEvent = async (id, event) => { appends.push(structuredClone(event)); return append(id, event) }
  for (let index = 0; index < 30; index++) emit(hub, run, `${index}:${'Raw proof '.repeat(1000)}`)
  await hub.persist(run)
  expect(appends).toEqual(run.toolEvents)
  expect(appends).toHaveLength(30)
  expect(writes.every(row => !Object.hasOwn(row, 'toolEvents'))).toBe(true)
  expect(writes.at(-1)).toMatchObject({ toolEventStorage: 'separate-v1', toolEventCount: 30 })
  const reader = new Hub(); reader.store = hub.store
  const restored = await reader.runsApi.get(run.id)
  expect(restored.toolEvents).toEqual(run.toolEvents)
  expect(Object.isFrozen(restored.toolEvents)).toBe(true)
  expect(await hub.store.readToolEvents(run.id)).toEqual(appends)
})

test('export waits only its captured event boundary while new events continue arriving', async () => {
  const { hub, run } = await fixture(); const first = deferred(); const second = deferred(); const captured = deferred()
  const append = hub.store.appendToolEvent; const flush = hub.flushToolEvents.bind(hub)
  const persist = hub.persist.bind(hub); await persist(run)
  // Isolate export's flush notification from the ordinary event-triggered saves.
  hub.persist = async () => {}
  hub.store.appendToolEvent = async (id, event) => { await (event.sequence === 1 ? first : second).promise; return append(id, event) }
  emit(hub, run, 'first')
  hub.flushToolEvents = (id, through) => { captured.resolve(through); return flush(id, through) }
  const exporting = hub.traces.export(run.trace, { timeoutMs: 1000 })
  await captured.promise
  // The flush spy now signals export's exact snapshot boundary, not a timer.
  emit(hub, run, 'second')
  first.resolve()
  const trace = await exporting
  expect(trace.runs[0].toolEvents.map(event => event.value)).toEqual(['first'])
  expect(trace.runs[0].toolEventPersistence).toBe('memory-only')
  expect(Object.isFrozen(trace.runs[0].toolEvents)).toBe(true)
  second.resolve(); await persist(run)
  expect((await hub.traces.export(run.trace)).runs[0].toolEvents).toHaveLength(2)
})

test('a blocked evidence write makes bounded export fail rather than return partial proof', async () => {
  const { hub, run } = await fixture(); const gate = deferred(); const append = hub.store.appendToolEvent
  hub.store.appendToolEvent = async (...args) => { await gate.promise; return append(...args) }
  emit(hub, run)
  await expect(hub.traces.export(run.trace, { timeoutMs: 10 })).rejects.toThrow('no partial export')
  gate.resolve(); await hub.persist(run)
  expect((await hub.traces.export(run.trace)).runs[0].toolEvents).toEqual(run.toolEvents)
})

test('retrying a failed captured event does not wait behind a later blocked event', async () => {
  const { hub, run } = await fixture(); const later = deferred(); const append = hub.store.appendToolEvent
  let attempts = 0; let finished = false
  hub.store.appendToolEvent = async (id, event) => {
    if (event.sequence === 1 && ++attempts === 1) throw new Error('transient first write')
    if (event.sequence === 2) await later.promise
    return append(id, event)
  }
  await hub.queueToolEvent(run.id, { sequence: 1, value: 'captured' })
  const pendingLater = hub.queueToolEvent(run.id, { sequence: 2, value: 'future' })
  const flushed = hub.flushToolEvents(run.id, 1).then(() => { finished = true })
  for (let pass = 0; pass < 20; pass++) await Promise.resolve()
  try {
    expect(finished).toBe(true)
    expect((await hub.store.readToolEvents(run.id)).map(event => event.value)).toEqual(['captured'])
  } finally { later.resolve(); await Promise.all([pendingLater, flushed]) }
})

test('failed persistence is visible, retryable without reexecuting tools, and cannot produce a successful partial export', async () => {
  const { hub, run } = await fixture(); const errors = []; const append = hub.store.appendToolEvent
  let failing = true; let calls = 0
  hub.subscribe(event => { if (event.type === 'persistence-error') errors.push(event.error) })
  hub.store.appendToolEvent = async (...args) => { calls++; if (failing) throw new Error('fixture quota failure'); return append(...args) }
  emit(hub, run); await hub.persist(run)
  expect(errors.some(error => error.includes('fixture quota failure'))).toBe(true)
  await expect(hub.traces.export(run.trace)).rejects.toThrow('not saved')
  expect(run.toolEvents).toHaveLength(1)
  const attempts = calls; failing = false
  const recovered = await hub.traces.export(run.trace)
  expect(calls).toBe(attempts + 1)
  expect(recovered.runs[0].toolEvents).toEqual(run.toolEvents)
  expect(await hub.store.readToolEvents(run.id)).toEqual(run.toolEvents)
})

test('legacy inline evidence survives unchanged and separate records reject gaps', async () => {
  const { hub } = await fixture(); hub.runs.clear()
  const event = { sequence: 1, kind: 'observation', value: 'legacy exact content', args: { nested: [1] } }
  await hub.store.put('runs', { id: 'legacy', trace: 'old', at: 1, toolEvents: [event] })
  expect((await hub.traces.export('old')).runs[0].toolEvents).toEqual([event])
  expect((await hub.store.get('runs', 'legacy')).toolEvents).toEqual([event])
  expect(Object.isFrozen((await hub.runsApi.get('legacy')).toolEvents[0].args.nested)).toBe(true)
  await hub.store.put('runs', { id: 'gap', trace: 'gap', toolEventStorage: 'separate-v1', toolEventCount: 2 })
  await hub.store.appendToolEvent('gap', { sequence: 2, kind: 'observation', value: 'later' })
  expect((await hub.traces.export('old')).runs[0].toolEvents).toEqual([event])
  await expect(hub.runsApi.get('gap')).rejects.toThrow('incomplete')
  await expect(hub.traces.export('gap')).rejects.toThrow('incomplete')
  await hub.store.put('runs', { id: 'tail', trace: 'tail', toolEventStorage: 'separate-v1', toolEventCount: 0 })
  await hub.store.appendToolEvent('tail', { sequence: 1, kind: 'observation', value: 'not in metadata' })
  await expect(hub.runsApi.get('tail')).rejects.toThrow('incomplete')
})

test('a saved event with a failed metadata watermark cannot be silently omitted after reload or labelled committed on export', async () => {
  const { hub, run } = await fixture(); await hub.persist(run)
  const put = hub.store.put; let failing = true
  hub.store.put = (name, record) => name === 'runs' && failing ? Promise.reject(new Error('metadata quota failure')) : put(name, record)
  emit(hub, run, 'retained raw event'); await hub.toolEventWrites.get(run.id).tail
  const reader = new Hub(); reader.store = hub.store
  expect(await hub.store.readToolEvents(run.id)).toHaveLength(1)
  await expect(reader.runsApi.get(run.id)).rejects.toThrow('incomplete')
  await expect(hub.traces.export(run.trace)).rejects.toThrow('metadata is not saved')
  failing = false
  expect((await hub.traces.export(run.trace)).runs[0].toolEvents).toEqual(run.toolEvents)
  expect((await reader.runsApi.get(run.id)).toolEvents).toEqual(run.toolEvents)
})

test('append is idempotent for identical evidence and refuses replacement under the same identity', async () => {
  const store = await openStore('tool-append-fixture')
  const event = { sequence: 1, value: 'first', args: { nested: [1, 2] } }
  await store.appendToolEvent('a', event); await store.appendToolEvent('a', structuredClone(event))
  event.args.nested.push(3)
  await expect(store.appendToolEvent('a', event)).rejects.toThrow('different content')
  expect(await store.readToolEvents('a')).toEqual([{ sequence: 1, value: 'first', args: { nested: [1, 2] } }])
})

test('retention waits pending writes and atomically removes old run evidence, preserving active and legacy records', async () => {
  const { hub, run } = await fixture('old'); const gate = deferred(); const append = hub.store.appendToolEvent
  hub.store.appendToolEvent = async (...args) => { await gate.promise; return append(...args) }
  emit(hub, run); run.slot.status = 'done'
  await hub.store.put('runs', { id: run.id, at: 1, slot: run.slot, toolEventStorage: 'separate-v1', toolEventCount: 1 })
  await hub.store.put('runs', { id: 'active', at: 0, slot: { status: 'thinking' } })
  for (let index = 0; index < 199; index++) await hub.store.put('runs', { id: `keep-${index}`, at: index + 2, slot: { status: 'done' }, toolEvents: [{ sequence: 1, value: 'legacy' }] })
  const retention = hub.retainRuns()
  gate.resolve(); await retention
  expect(await hub.store.get('runs', run.id)).toBeUndefined()
  expect(await hub.store.readToolEvents(run.id)).toEqual([])
  expect(await hub.store.get('runs', 'active')).toBeDefined()
  expect((await hub.store.get('runs', 'keep-0')).toolEvents).toHaveLength(1)
  await hub.persist(run)
  expect(await hub.store.get('runs', run.id)).toBeUndefined()
  const exported = await hub.traces.export(run.trace)
  expect(exported.runs[0].toolEvents).toEqual(run.toolEvents)
  expect(exported.runs[0].toolEventPersistence).toBe('retention-evicted')
})

test('a metadata flush paused during retention cannot recreate the deleted run', async () => {
  const { hub, run } = await fixture('old'); run.slot.status = 'done'
  await hub.persist(run)
  for (let index = 0; index < 200; index++) await hub.store.put('runs', { id: `keep-${index}`, at: index + 2, slot: { status: 'done' } })
  const get = hub.store.get; const entered = deferred(); const release = deferred(); let pause = true
  hub.store.get = async (name, id) => { if (name === 'runs' && id === run.id && pause) { pause = false; entered.resolve(); await release.promise } return get(name, id) }
  const flushing = hub.flushRunRecord(run.id, 0); await entered.promise
  await hub.retainRuns(); release.resolve(); await flushing
  expect(await get('runs', run.id)).toBeUndefined()
  expect(await hub.store.readToolEvents(run.id)).toEqual([])
})

test('retention waits metadata writes and releases later writes when atomic deletion fails', async () => {
  const { hub, run } = await fixture('old'); run.slot.status = 'done'
  await hub.persist(run)
  for (let index = 0; index < 200; index++) await hub.store.put('runs', { id: `keep-${index}`, at: index + 2, slot: { status: 'done' } })
  const put = hub.store.put; const started = deferred(); const release = deferred(); let deletes = 0
  hub.store.put = async (name, record) => { if (name === 'runs' && record.id === run.id) { started.resolve(); await release.promise } return put(name, record) }
  const writing = hub.writeRunRecord(hub.runRecord(run)); await started.promise
  hub.store.deleteRun = async () => { deletes++; throw new Error('fixture atomic delete failure') }
  const retaining = hub.retainRuns()
  for (let pass = 0; pass < 5; pass++) await Promise.resolve()
  expect(deletes).toBe(0)
  const later = hub.queueToolEvent(run.id, { sequence: 1, value: 'arrived during reservation' })
  release.resolve(); await writing
  await expect(retaining).rejects.toThrow('atomic delete failure')
  await later
  expect(hub.evictedEvidence.has(run.id)).toBe(false)
  expect(await hub.store.get('runs', run.id)).toBeDefined()
  expect((await hub.store.readToolEvents(run.id))[0].value).toBe('arrived during reservation')
})

test('v2 schema upgrade creates only the event store and closes a connection on later version changes', async () => {
  const original = globalThis.indexedDB; const created = []; let requestedVersion; let closed = 0
  const existing = new Set(['settings', 'sessions', 'runs', 'files', 'memory', 'dreams', 'learned'])
  const db = { objectStoreNames: { contains: name => existing.has(name) }, createObjectStore: (name, options) => { created.push({ name, options }); existing.add(name) }, close: () => closed++ }
  globalThis.indexedDB = { open: (_, version) => { requestedVersion = version; const request = { result: db }; queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess() }); return request } }
  try {
    const store = await openStore('upgrade-fixture')
    expect(requestedVersion).toBe(2)
    expect(created).toEqual([{ name: 'toolEvents', options: { keyPath: ['runId', 'sequence'] } }])
    db.onversionchange()
    expect(closed).toBe(1); expect(store.durable).toBe(false); expect(store.why).toContain('reload')
  } finally { globalThis.indexedDB = original }
})

test('a blocked old-tab upgrade refuses an empty replacement workspace and closes a late successful connection', async () => {
  const original = globalThis.indexedDB; let request; let closed = 0
  globalThis.indexedDB = { open: () => { request = { result: { close: () => closed++ } }; queueMicrotask(() => request.onblocked()); return request } }
  try {
    await expect(openStore('blocked-fixture')).rejects.toMatchObject({ code: 'STORE_UPGRADE_BLOCKED', message: expect.stringContaining('Existing saved work has not been changed') })
    request.onsuccess(); expect(closed).toBe(1)
  } finally { globalThis.indexedDB = original }
})

test('a client older than the stored schema cannot open an empty replacement workspace', async () => {
  const original = globalThis.indexedDB
  globalThis.indexedDB = { open: () => { const request = { error: new DOMException('The stored database has a newer version; reload the current application', 'VersionError') }; queueMicrotask(() => request.onerror()); return request } }
  try { await expect(openStore('newer-schema-fixture')).rejects.toMatchObject({ name: 'VersionError' }) }
  finally { globalThis.indexedDB = original }
})

test('retention protects completed siblings of an active strategy and evicts completed traces together', async () => {
  const hub = new Hub(); hub.store = await openStore(`strategy-retention-${crypto.randomUUID()}`)
  for (const record of [
    { id: 'root', trace: 'graph', at: 1, slot: { status: 'running' } },
    { id: 'child', trace: 'graph', at: 2, slot: { status: 'done' } },
    { id: 'old-root', trace: 'old-graph', at: 3, slot: { status: 'done' } },
    { id: 'old-child', trace: 'old-graph', at: 4, slot: { status: 'done' } },
  ]) await hub.store.put('runs', record)
  for (let index = 0; index < 198; index++) await hub.store.put('runs', { id: `keep-${index}`, at: index + 10, slot: { status: 'done' } })
  await hub.retainRuns()
  expect(await hub.store.get('runs', 'root')).toBeDefined(); expect(await hub.store.get('runs', 'child')).toBeDefined()
  expect(await hub.store.get('runs', 'old-root')).toBeUndefined(); expect(await hub.store.get('runs', 'old-child')).toBeUndefined()
})
