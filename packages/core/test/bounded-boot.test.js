/**
 * I20, EXECUTED. Two numbers and no prose: how many records 10,000 facts take
 * up, and how many storage transactions a cold boot over them costs compared
 * with a cold boot over a twentieth as many.
 *
 * The measurement this replaces: a real browser holding 39,237 facts, booted
 * one read-only transaction per record. Under that design the second number
 * here would be 39,237 and would grow every day the product was used.
 */
import { expect, test, describe } from 'bun:test'
import { fakeClock } from '@harness/adapters-test'
import { freshLog, bootLog, segStream, snapStream, SEGMENT_SIZE, SNAPSHOT_EVERY, SNAPSHOTS_KEPT } from '@harness/core'
import { memorySegments, countsReducer } from './doubles.js'

/**
 * Write `count` facts the way a session does — persisting as it goes, not once
 * at the end, because a single giant flush would write one snapshot and hide
 * exactly the growth this test exists to catch.
 * @param {number} count
 */
async function written(count) {
  const store = memorySegments()
  const clock = fakeClock()
  const log = freshLog(store, { clock, reducers: [countsReducer] })
  for (let i = 0; i < count; i++) {
    log.append({ type: 'user_message', text: `m${i}`, agent: 'main', from: 'person' }, 1000 + i)
    if (i % 100 === 99) await log.persist()
  }
  await log.persist()
  return { store, clock }
}

describe('I20 — bounded boot', () => {
  test('10,000 facts occupy history/512 records plus its snapshots, not 10,000 records', async () => {
    const { store } = await written(10_000)
    const segments = store.indices(segStream('main'))
    const snapshots = store.indices(snapStream('main'))
    expect(segments).toHaveLength(Math.ceil(10_000 / SEGMENT_SIZE))
    expect(snapshots.length).toBeLessThanOrEqual(SNAPSHOTS_KEPT)
    expect(segments.length + snapshots.length).toBeLessThanOrEqual(Math.ceil(10_000 / SEGMENT_SIZE) + SNAPSHOTS_KEPT)
  })

  test('a cold boot costs the SAME transactions over 10,000 facts as over 500', async () => {
    const small = await written(500)
    const large = await written(10_000)

    const smallBefore = small.store.txns()
    const smallLog = await bootLog(small.store, { clock: small.clock, reducers: [countsReducer] })
    const smallTxns = small.store.txns() - smallBefore

    const largeBefore = large.store.txns()
    const largeReadBefore = large.store.read()
    const largeLog = await bootLog(large.store, { clock: large.clock, reducers: [countsReducer] })
    const largeTxns = large.store.txns() - largeBefore

    expect(smallTxns).toBe(largeTxns)
    expect(largeTxns).toBe(2)
    // And the records those two reads returned are bounded by the snapshot
    // cadence — the tail behind the newest snapshot, plus the snapshots kept.
    expect(large.store.read() - largeReadBefore).toBeLessThanOrEqual(SNAPSHOT_EVERY + SNAPSHOTS_KEPT + 1)

    // Bounded reads are only worth anything if nothing was lost by them.
    expect(smallLog.read('counts')).toEqual({ user_message: 500 })
    expect(largeLog.read('counts')).toEqual({ user_message: 10_000 })
    expect(largeLog.length).toBe(10_000)
    expect(largeLog.quarantined).toEqual([])
  })

  test('memory holds the head record and no more, and the next fact continues it', async () => {
    const { store, clock } = await written(10_000)
    const log = await bootLog(store, { clock, reducers: [countsReducer] })
    expect(log.resident).toBeLessThan(SEGMENT_SIZE)
    log.append({ type: 'user_message', text: 'and one more', agent: 'main', from: 'person' }, 9)
    await log.persist()
    expect(log.resident).toBeLessThan(SEGMENT_SIZE)
    const again = await bootLog(store, { clock, reducers: [countsReducer] })
    expect(again.length).toBe(10_001)
    expect(again.read('counts')).toEqual({ user_message: 10_001 })
  })
})
