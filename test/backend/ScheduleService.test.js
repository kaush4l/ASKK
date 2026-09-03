import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { MIN_PERIOD_SECONDS, ScheduleService } from '../../src/backend/services/ScheduleService.js'

/**
 * Questions that ask themselves.
 *
 * The rules worth asserting are the ones that decide how a person's day goes: a
 * period that is honoured rather than silently divided by a parser, a first
 * question that waits the period it was promised, one question at the next open
 * rather than one per period missed, and a run that is recorded whether or not
 * it succeeded.
 */
const service = () => new ScheduleService(new MemoryRepository('Schedule'))

const make = (service, values = {}) =>
  service.create({ text: 'check the build', everySeconds: 3600, conversationId: 'c1', ...values })

/**
 * A local wall-clock instant in January 2026.
 *
 * Local, and built the same way the service builds one, because a time of day
 * is a statement about the clock on the wall in front of the person who wrote
 * it. An assertion written in epoch milliseconds would pass in one timezone and
 * fail in another, and the thing it would be measuring is the test's arithmetic
 * rather than the service's.
 */
const clock = (day, hours, minutes = 0) => new Date(2026, 0, day, hours, minutes, 0, 0).getTime()

describe('a schedule', () => {
  test('is stored with what to ask, how often, and where the answer lands', async () => {
    const made = await make(service(), { now: 1_000_000 })
    expect(made.ok).toBe(true)
    expect(made.value.text).toBe('check the build')
    expect(made.value.everySeconds).toBe(3600)
    expect(made.value.conversationId).toBe('c1')
    // Never run, which is a different fact from never due. The baseline is the
    // one the first period is measured from, and it is the moment of writing —
    // a schedule that counted from zero was overdue by fifty-six years the
    // instant it existed.
    expect(made.value.lastRanAt).toBe(0)
    expect(made.value.countsFrom).toBe(1_000_000)
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

  /**
   * "Every day" without a time of day means "whenever you happened to press the
   * button", which is a promise nobody made. A daily schedule given a time is
   * counted from the most recent occurrence of that time, so the next one is
   * the next occurrence rather than the one after it.
   */
  test('a time of day is kept, and counted from the last time it came round', async () => {
    const made = await make(service(), {
      everySeconds: 86_400,
      atMinutes: 9 * 60,
      now: clock(5, 14, 30),
    })
    expect(made.value.atMinutes).toBe(9 * 60)
    expect(made.value.countsFrom).toBe(clock(5, 9))
  })

  test('a time of day on a period that is not whole days is dropped, and says so', async () => {
    const made = await make(service(), { everySeconds: 3600, atMinutes: 9 * 60 })
    expect(made.value.atMinutes).toBe(null)
    expect(made.notes.join(' ')).toContain('time of day')
  })

  test('a time of day that is not a time is dropped, and says so', async () => {
    const made = await make(service(), { everySeconds: 86_400, atMinutes: '9am' })
    expect(made.value.atMinutes).toBe(null)
    expect(made.notes.join(' ')).toContain('not a time of day')
  })
})

/**
 * When it next asks — the one thing a list of schedules never said.
 *
 * A row that reports only "never run yet" is a row a person cannot act on: it
 * says the past and withholds the future, and the future is the whole reason
 * the thing exists.
 */
describe('when it next runs', () => {
  test('a new schedule asks one whole period from when it was written', async () => {
    const made = await make(service(), { everySeconds: 3600, now: 1_000_000 })
    expect(made.value.nextRunAt).toBe(1_000_000 + 3_600_000)
  })

  test('after a run it is a period from that run, not from the clock', async () => {
    const plans = service()
    const made = await make(plans, { everySeconds: 60, now: 1_000_000 })
    const recorded = await plans.ran({ id: made.value.id, at: 5_000_000 })

    expect(recorded.value.nextRunAt).toBe(5_060_000)
    expect((await plans.list()).value[0].nextRunAt).toBe(5_060_000)
  })

  test('a daily schedule with a time of day asks at that time', async () => {
    const made = await make(service(), {
      everySeconds: 86_400,
      atMinutes: 9 * 60,
      now: clock(5, 14, 30),
    })
    expect(made.value.nextRunAt).toBe(clock(6, 9))
  })

  /**
   * A time of day is a place in the day, not an offset from a run. This tab was
   * shut at nine and the question was asked at a quarter past three; measuring
   * the next one from THAT would walk a morning question round the clock a
   * little further every time a person opened their laptop late.
   */
  test('a late run does not drag the time of day to when it happened', async () => {
    const plans = service()
    const made = await make(plans, {
      everySeconds: 86_400,
      atMinutes: 9 * 60,
      now: clock(5, 14, 30),
    })
    const recorded = await plans.ran({ id: made.value.id, at: clock(6, 15, 12) })

    expect(recorded.value.nextRunAt).toBe(clock(7, 9))
  })

  /**
   * Midnight is zero minutes past midnight, and zero is the number every
   * shortcut in this language reads as "nothing was given". A schedule set for
   * midnight is a schedule, so every test of a time of day here is against
   * null, and this is the one that would catch it going back to truthiness.
   */
  test('midnight is a time of day, not a missing one', async () => {
    const made = await make(service(), {
      everySeconds: 86_400,
      atMinutes: 0,
      now: clock(5, 14, 30),
    })

    expect(made.value.atMinutes).toBe(0)
    expect(made.value.nextRunAt).toBe(clock(6, 0))
  })

  /**
   * Records written by an earlier build are already in people's browsers, and
   * they have no baseline. `createdAt` stands in for one, because the reading
   * that needs no invention is "it has been waiting since it was written".
   */
  test('a schedule stored before there was a baseline counts from when it was made', async () => {
    const repository = new MemoryRepository('Schedule')
    const plans = new ScheduleService(repository)
    await repository.put({
      id: 'older',
      text: 'check the build',
      everySeconds: 3600,
      conversationId: 'c1',
      createdAt: 1_000_000,
      lastRanAt: 0,
    })

    expect((await plans.list()).value[0].nextRunAt).toBe(1_000_000 + 3_600_000)
  })

  /**
   * The rule that keeps this honest: a record this build cannot read has no
   * next run to report and no run to take. Inventing a time would put a
   * confident sentence under a row that will never do anything.
   */
  test('a record with no readable period offers no time, and is never due', async () => {
    const repository = new MemoryRepository('Schedule')
    const plans = new ScheduleService(repository)
    await repository.put({
      id: 'unreadable',
      text: 'check the build',
      conversationId: 'c1',
      createdAt: 1_000_000,
    })

    expect((await plans.list()).value[0].nextRunAt).toBe(null)
    expect((await plans.due({ now: 9_000_000_000_000 })).value).toEqual([])
  })
})

describe('what is due', () => {
  /**
   * The defect this rule exists for: writing "every hour" used to ask its
   * question in the open conversation before the person had let go of the
   * button, in a turn indistinguishable from one they had typed. "Every hour"
   * says the first one is an hour away, and a schedule is the one feature whose
   * whole content is a promise about when.
   */
  test('a new schedule is not due until one whole period has passed', async () => {
    const plans = service()
    const made = await make(plans, { everySeconds: 60, now: 1_000_000 })

    expect((await plans.due({ now: 1_000_000 })).value).toEqual([])
    expect((await plans.due({ now: 1_059_000 })).value).toEqual([])
    expect((await plans.due({ now: 1_060_000 })).value.map((one) => one.id)).toEqual([
      made.value.id,
    ])
  })

  test('and not again until another period has passed', async () => {
    const plans = service()
    const made = await make(plans, { everySeconds: 60, now: 1_000_000 })
    await plans.ran({ id: made.value.id, at: 1_060_000 })

    expect((await plans.due({ now: 1_119_000 })).value).toEqual([])
    expect((await plans.due({ now: 1_120_000 })).value.map((one) => one.id)).toEqual([
      made.value.id,
    ])
  })

  test('a time of day decides when a daily schedule is due', async () => {
    const plans = service()
    await make(plans, { everySeconds: 86_400, atMinutes: 9 * 60, now: clock(5, 14, 30) })

    expect((await plans.due({ now: clock(6, 8, 59) })).value).toEqual([])
    expect((await plans.due({ now: clock(6, 9) })).value).toHaveLength(1)
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
