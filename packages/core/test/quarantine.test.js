/**
 * A record this build cannot read costs that record and not the session. The
 * Rust refused to boot at all on one bad JSON line (`boot.rs:98-122`), which is
 * data loss with extra steps: the person loses every fact either side of the
 * damage and gets a blank product instead of a banner.
 */
import { expect, test, describe } from 'bun:test'
import { StoreError } from '@harness/kernel'
import { fakeClock } from '@harness/adapters-test'
import { freshLog, bootLog, segStream, snapStream, quarantineStream, SEGMENT_SIZE, SNAPSHOT_EVERY, SNAPSHOTS_KEPT } from '@harness/core'
import { memorySegments, historyReducer, countsReducer } from './doubles.js'

/** @param {import('@harness/core').Log} log @param {number} n */
function say(log, n) {
  for (let i = 0; i < n; i++) {
    log.append({ type: 'user_message', text: `m${i}`, agent: 'main', from: 'person' }, 1000 + i)
  }
}

/** Only the failures, so a sixteen-segment test does not fold sixteen thousand facts into an array. */
const failuresReducer = {
  name: 'failures',
  version: 1,
  init: () => /** @type {import('@harness/kernel').Fact[]} */ ([]),
  fold: (/** @type {import('@harness/kernel').Fact[]} */ state, /** @type {import('@harness/kernel').Event} */ e) =>
    e.fact.type === 'store_failed' ? [...state, e.fact] : state,
}

/** Overwrite a segment record that is known to exist, so a typo cannot pass as damage. */
function damage(/** @type {ReturnType<typeof memorySegments>} */ store, /** @type {number} */ index, /** @type {string} */ text) {
  expect(store.indices(segStream('main'))).toContain(index)
  return store.put(segStream('main'), index, text)
}

describe('quarantine', () => {
  test('an unreadable line costs that line: boot COMPLETES, the rest of the record replays, and the damage is named', async () => {
    const store = memorySegments()
    const clock = fakeClock({ start: 99, step: 0 })
    const log = freshLog(store, { clock, reducers: [historyReducer] })
    say(log, 5)
    await log.persist()
    const [record] = await store.range(segStream('main'))
    const lines = String(record?.text).split('\n')
    lines[3] = '{ this is not json'
    await damage(store, 0, lines.join('\n'))

    const back = await bootLog(store, { clock, reducers: [historyReducer] })
    expect(back.quarantined).toHaveLength(1)
    expect(back.quarantined[0]).toMatchObject({ segment: 0, line: 3, reason: 'the line is not readable JSON' })
    expect(/** @type {any[]} */ (back.read('history')).map((e) => e.fact.text)).toEqual(['m0', 'm1', 'm3', 'm4'])

    const [held] = await store.range(quarantineStream('main'))
    expect(JSON.parse(String(held?.text))).toMatchObject({ stream: 'main', segment: 0, at: 99 })
  })

  test('the damaged record is abandoned, never repacked — the next fact opens the following one', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    const log = freshLog(store, { clock, reducers: [historyReducer] })
    say(log, 5)
    await log.persist()
    const [record] = await store.range(segStream('main'))
    const wounded = String(record?.text).split('\n')
    wounded[3] = '{ this is not json'
    await damage(store, 0, wounded.join('\n'))

    const back = await bootLog(store, { clock, reducers: [historyReducer] })
    // Not 5: the rest of record 0's sequence numbers are given up so that
    // record is never rewritten from the four lines that survived.
    expect(back.length).toBe(SEGMENT_SIZE)
    say(back, 1)
    await back.persist()
    expect(store.indices(segStream('main'))).toEqual([0, 1])
    const [first] = await store.range(segStream('main'))
    expect(String(first?.text)).toContain('{ this is not json')
  })

  test('a fact type this build has no name for is quarantined by name, not guessed at', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    const log = freshLog(store, { clock, reducers: [historyReducer] })
    say(log, 3)
    await log.persist()
    const [record] = await store.range(segStream('main'))
    const lines = String(record?.text).split('\n')
    lines[2] = JSON.stringify({ id: 1, seq: 1, at: 1, v: 1, fact: { type: 'moon_phase_observed' } })
    await damage(store, 0, lines.join('\n'))

    const back = await bootLog(store, { clock, reducers: [historyReducer] })
    expect(back.quarantined[0]?.reason).toContain('moon_phase_observed')
    expect(/** @type {any[]} */ (back.read('history'))).toHaveLength(2)
  })

  test('a segment whose header is gone quarantines the record and boot still comes up', async () => {
    const store = memorySegments()
    const clock = fakeClock()
    const log = freshLog(store, { clock, reducers: [countsReducer] })
    say(log, SEGMENT_SIZE + 4)
    await log.persist()
    await damage(store, 0, 'shredded')

    const back = await bootLog(store, { clock, reducers: [countsReducer] })
    expect(back.quarantined[0]).toMatchObject({ segment: 0, line: 0 })
    expect(back.read('counts')).toEqual({ user_message: 4 })
    expect(back.length).toBe(SEGMENT_SIZE + 4)
  })

  test('a record that never came back is a NAMED GAP, not a short history reported as a healthy one', async () => {
    const store = memorySegments()
    const clock = fakeClock({ start: 99, step: 0 })
    const log = freshLog(store, { clock, reducers: [countsReducer] })
    say(log, SEGMENT_SIZE * 3)
    await log.persist()
    expect(store.indices(segStream('main'))).toEqual([0, 1, 2])
    await store.delete(segStream('main'), 1)

    const back = await bootLog(store, { clock, reducers: [countsReducer] })
    // The two numbers that used to disagree in silence: `length` still comes
    // from the surviving headers, the fold is 512 facts short of it, and it is
    // the quarantine that says so.
    expect(back.length).toBe(SEGMENT_SIZE * 3)
    expect(back.read('counts')).toEqual({ user_message: SEGMENT_SIZE * 2 })
    expect(back.quarantined).toHaveLength(1)
    expect(back.quarantined[0]).toMatchObject({ segment: 2, line: -1 })
    expect(back.quarantined[0]?.reason).toBe(
      'facts 512..1023 are missing: this record starts at 1024 and the record before it ended at 511',
    )
    const [held] = await store.range(quarantineStream('main'))
    expect(JSON.parse(String(held?.text))).toMatchObject({ segment: 2, damage: [{ line: -1 }] })
  })
})

describe('a failure that is told', () => {
  test('a refused write becomes a store_failed fact naming the key — once per outage, not once per retry', async () => {
    const store = memorySegments({ fail: () => new StoreError('quota', 'the origin is out of room') })
    const clock = fakeClock({ start: 5000, step: 0 })
    const log = freshLog(store, { clock, reducers: [historyReducer] })
    say(log, 3)

    await log.persist()
    clock.advance(10_000)
    await log.persist()
    clock.advance(10_000)
    await log.persist()

    const told = /** @type {any[]} */ (log.read('history')).filter((e) => e.fact.type === 'store_failed')
    expect(told).toHaveLength(1)
    expect(told[0].fact.key).toBe('seg/main/0')
    expect(told[0].fact.message).toContain('out of room')
  })

  test('a snapshot the store refuses FOREVER is told once, and boot then costs more records than I20 promises', async () => {
    const store = memorySegments({ fail: (stream) => (stream.startsWith('snap/') ? new StoreError('quota', 'no room for a snapshot') : null) })
    const clock = fakeClock({ start: 5000, step: 0 })
    const log = freshLog(store, { clock, reducers: [failuresReducer] })
    for (let i = 0; i < SNAPSHOT_EVERY * 2; i++) {
      say(log, SEGMENT_SIZE)
      await log.persist()
    }

    const told = /** @type {any[]} */ (log.read('failures'))
    expect(told).toHaveLength(1)
    expect(String(told[0].key)).toMatch(/^snap\/main\/\d+$/)
    expect(store.indices(snapStream('main'))).toEqual([])

    // I20's record bound is CONDITIONAL on snapshots landing: with none on
    // disk, boot reads every segment, and that number grows with every segment
    // the product ever adds.
    const before = store.read()
    const back = await bootLog(store, { clock, reducers: [failuresReducer] })
    expect(store.read() - before).toBeGreaterThan(SNAPSHOT_EVERY + SNAPSHOTS_KEPT + 1)
    expect(back.length).toBe(log.length)
  })
})
