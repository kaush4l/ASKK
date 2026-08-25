import { expect, test, describe } from 'bun:test'
import { StoreError } from '@harness/kernel'
import { fakeClock } from '@harness/adapters-test'
import { freshLog, bootLog, segStream, snapStream, SEGMENT_SIZE, SNAPSHOT_EVERY } from '@harness/core'
import { memorySegments, historyReducer, countsReducer } from './doubles.js'

/** @param {import('@harness/core').Log} log @param {number} n @param {number} [from] */
function say(log, n, from = 0) {
  for (let i = from; i < from + n; i++) {
    log.append({ type: 'user_message', text: `m${i}`, agent: 'main', from: 'person' }, 1000 + i)
  }
}

describe('the segment format', () => {
  test('a whole batch lands as ONE record, and the record states the range it holds', async () => {
    const store = memorySegments()
    const log = freshLog(store, { clock: fakeClock(), reducers: [historyReducer] })
    say(log, 300)
    const before = store.txns()
    const flushed = await log.persist()
    expect(flushed.written).toBe(300)
    expect(store.txns() - before).toBe(1)
    expect(store.indices(segStream('main'))).toEqual([0])
    const [record] = await store.range(segStream('main'))
    const lines = String(record?.text).split('\n')
    expect(JSON.parse(String(lines[0]))).toEqual({ firstSeq: 0, lastSeq: 299, count: 300 })
    expect(lines).toHaveLength(301)
  })

  test('facts spill into a second record at the segment boundary, never before it', async () => {
    const store = memorySegments()
    const log = freshLog(store, { clock: fakeClock(), reducers: [historyReducer] })
    say(log, SEGMENT_SIZE)
    await log.persist()
    expect(store.indices(segStream('main'))).toEqual([0])
    say(log, 1, SEGMENT_SIZE)
    await log.persist()
    expect(store.indices(segStream('main'))).toEqual([0, 1])
  })

  test('the store is handed a NUMBER, and eleven segments come back in numeric order', async () => {
    const store = memorySegments()
    const log = freshLog(store, { clock: fakeClock(), reducers: [countsReducer] })
    say(log, SEGMENT_SIZE * 11)
    await log.persist()
    const indices = (await store.range(segStream('main'))).map((r) => r.index)
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // The claim is that numeric order is not lexical order: a zero-padded key
    // would sort these the same way and hide the difference until the padding
    // ran out, so the test proves the two orders actually disagree here.
    expect(indices.map(String)).not.toEqual([...indices.map(String)].sort())
  })
})

describe('persisting', () => {
  test('a refused write leaves the queue INTACT and lands the whole batch on the retry', async () => {
    let broken = true
    const store = memorySegments({ fail: () => (broken ? new StoreError('quota', 'the origin is out of room') : null) })
    const clock = fakeClock({ start: 5000, step: 0 })
    const log = freshLog(store, { clock, reducers: [historyReducer] })
    say(log, 40)

    const failed = await log.persist()
    expect(failed.failure?.kind).toBe('quota')
    expect(failed.written).toBe(0)
    // Forty-one, not forty: nothing left the queue, and the fact recording the
    // refusal joined it.
    expect(log.unpersisted).toBe(41)
    expect(store.indices(segStream('main'))).toEqual([])

    broken = false
    expect((await log.persist()).deferred).toBe(true)
    expect(log.unpersisted).toBe(41)

    clock.advance(250)
    const retried = await log.persist()
    expect(retried.deferred).toBe(false)
    expect(retried.written).toBe(41)
    expect(log.unpersisted).toBe(0)
    const back = await bootLog(store, { clock, reducers: [historyReducer] })
    expect(back.length).toBe(41)
  })
})

describe('booting', () => {
  test('the head segment is rewritten in place, so a partial record keeps growing', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    const log = freshLog(store, { clock, reducers: [countsReducer] })
    say(log, 700)
    await log.persist()
    const back = await bootLog(store, { clock, reducers: [countsReducer] })
    say(back, 3, 700)
    await back.persist()
    const again = await bootLog(store, { clock, reducers: [countsReducer] })
    expect(again.length).toBe(703)
    expect(again.read('counts')).toEqual({ user_message: 703 })
  })

  test('bumping a reducer version refuses its snapshot and replays from a segment boundary', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    const log = freshLog(store, { clock, reducers: [countsReducer] })
    for (let i = 0; i < 20; i++) {
      say(log, SEGMENT_SIZE, i * SEGMENT_SIZE)
      await log.persist()
    }
    const all = SEGMENT_SIZE * 20
    expect(store.indices(snapStream('main')).length).toBeGreaterThan(0)

    // Same NAME, same shape, different arithmetic — which is exactly the change
    // a version exists to catch. A snapshot wrongly accepted would fold the old
    // meaning under the new name and answer with neither.
    const bumped = {
      name: 'counts',
      version: 2,
      init: () => /** @type {Record<string, number>} */ ({}),
      fold: (/** @type {Record<string, number>} */ state, /** @type {import('@harness/kernel').Event} */ e) => {
        state[e.fact.type] = (state[e.fact.type] ?? 0) + 2
        return state
      },
    }
    const kept = await bootLog(store, { clock, reducers: [countsReducer] })
    const readWithSnapshot = store.read()
    expect(kept.read('counts')).toEqual({ user_message: all })

    const before = store.txns()
    const readBefore = store.read()
    const back = await bootLog(store, { clock, reducers: [bumped] })
    expect(back.read('counts')).toEqual({ user_message: all * 2 })
    expect(back.length).toBe(all)
    // The cost of a bump is RECORDS — every segment is read again — and never
    // transactions: it is still two range reads.
    expect(store.txns() - before).toBe(2)
    expect(store.read() - readBefore).toBeGreaterThan(readWithSnapshot)
  })

  test('a projection that cannot be written as JSON fails AT THE SNAPSHOT, naming the reducer', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    // A Set restores from JSON as `{}`, and `snapshotMatches` would accept it
    // because the version agrees — so the boot that survives it renders a
    // projection that is wrong. It has to be refused where it is written.
    const seen = {
      name: 'seen',
      version: 1,
      init: () => /** @type {Set<string>} */ (new Set()),
      fold: (/** @type {Set<string>} */ state, /** @type {import('@harness/kernel').Event} */ e) => state.add(e.fact.type),
    }
    const log = freshLog(store, { clock, reducers: [seen] })
    for (let i = 0; i < SNAPSHOT_EVERY - 1; i++) {
      say(log, SEGMENT_SIZE, i * SEGMENT_SIZE)
      await log.persist()
    }
    say(log, SEGMENT_SIZE, (SNAPSHOT_EVERY - 1) * SEGMENT_SIZE)

    await expect(log.persist()).rejects.toThrow('the seen projection cannot be persisted')
    // The FACTS are durable either way — it is the shortcut that was refused.
    expect(store.indices(segStream('main'))).toHaveLength(SNAPSHOT_EVERY)
    expect(store.indices(snapStream('main'))).toEqual([])
  })
})
