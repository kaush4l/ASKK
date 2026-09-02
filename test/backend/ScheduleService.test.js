import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { MIN_PERIOD_SECONDS, ScheduleService } from '../../src/backend/services/ScheduleService.js'

/**
 * Questions that ask themselves.
 *
 * The rules worth asserting are the ones that decide how a person's day goes: a
 * period that is honoured rather than silently divided by a parser, one
 * question at the next open rather than one per period missed, and a run that
 * is recorded whether or not it succeeded.
 */
const service = () => new ScheduleService(new MemoryRepository('Schedule'))

const make = (service, values = {}) =>
  service.create({ text: 'check the build', everySeconds: 3600, conversationId: 'c1', ...values })

describe('a schedule', () => {
  test('is stored with what to ask, how often, and where the answer lands', async () => {
    const made = await make(service())
    expect(made.ok).toBe(true)
    expect(made.value.text).toBe('check the build')
    expect(made.value.everySeconds).toBe(3600)
    expect(made.value.conversationId).toBe('c1')
    // Zero and not now: the first question goes at the next tick, because the
    // way a person finds out whether this works is by watching it happen.
    expect(made.value.lastRanAt).toBe(0)
  })

  test('needs a question and a conversation, and says which is missing', async () => {
    const plans = service()
    expect((await make(plans, { text: '  ' })).failure.message).toContain('a question to ask')
    expect((await make(plans, { conversationId: '' })).failure.message).toContain('a conversation')
  })

  /**
   * `Number`, not `parseInt`. `parseInt('10m')` is 10, which would read "every
   * ten minutes" as every ten seconds — the exact silent thousandth-of-what-you-
   * asked-for that `AgentSpec`'s budget parser was rewritten to stop.
   */
  test('a period that is not a number becomes the floor, and says so', async () => {
    const made = await make(service(), { everySeconds: '10m' })
    expect(made.value.everySeconds).toBe(MIN_PERIOD_SECONDS)
    expect(made.notes[0]).toContain('not a number of seconds')
  })

  test('a period under the floor is raised, and says so', async () => {
    const made = await make(service(), { everySeconds: 5 })
    expect(made.value.everySeconds).toBe(MIN_PERIOD_SECONDS)
    expect(made.notes[0]).toContain('too often')
  })
})

describe('what is due', () => {
  test('a fresh schedule is due at once, and not again until its period has passed', async () => {
    const plans = service()
    const made = await make(plans, { everySeconds: 60 })
    const at = 1_000_000

    expect((await plans.due({ now: at })).value.map((one) => one.id)).toEqual([made.value.id])
    await plans.ran({ id: made.value.id, at })
    expect((await plans.due({ now: at + 59_000 })).value).toEqual([])
    expect((await plans.due({ now: at + 60_000 })).value.map((one) => one.id)).toEqual([
      made.value.id,
    ])
  })

  /**
   * The whole of "overdue, not skipped". A week of closure must not open into a
   * hundred and sixty-eight questions, so a schedule that missed many periods is
   * due exactly once.
   */
  test('a week of missed periods is one question, not a hundred and sixty-eight', async () => {
    const plans = service()
    const made = await make(plans, { everySeconds: 3600 })
    await plans.ran({ id: made.value.id, at: 1_000_000 })

    const week = 7 * 24 * 60 * 60 * 1000
    const due = await plans.due({ now: 1_000_000 + week })

    expect(due.value).toHaveLength(1)
    await plans.ran({ id: made.value.id, at: 1_000_000 + week })
    expect((await plans.due({ now: 1_000_000 + week })).value).toEqual([])
  })

  test('the most overdue comes first, because a tick runs one', async () => {
    const plans = service()
    const older = await make(plans, { text: 'older', everySeconds: 60 })
    const newer = await make(plans, { text: 'newer', everySeconds: 60 })
    await plans.ran({ id: older.value.id, at: 1_000 })
    await plans.ran({ id: newer.value.id, at: 5_000 })

    const due = await plans.due({ now: 1_000_000 })

    expect(due.value.map((one) => one.text)).toEqual(['older', 'newer'])
  })

  test('a schedule that is gone is not a crash, and says what happened', async () => {
    const plans = service()
    const said = await plans.ran({ id: 'no-such' })
    expect(said.ok).toBe(false)
    expect(said.failure.hint).toContain('removed while it was running')
  })
})
