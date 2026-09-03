import { newId } from '../../core/ids.js'
import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * Questions that ask themselves, on a period.
 *
 * ## What a schedule is, and what it deliberately is not
 *
 * A schedule is a question and how often to ask it. It is NOT a second way to
 * run an agent: when one comes due the page sends it through `chat.send` — the
 * same route the composer uses, the same conversation, the same transcript, the
 * same live view. Anything else would be a second path to the model that could
 * drift from the one people actually use, which is how a feature comes to work
 * only in the demo that exercises it.
 *
 * ## Why there is no cron expression
 *
 * `everySeconds`, and nothing else. A cron expression is a language: it needs a
 * parser, a timezone policy, and an answer for what "the 31st" means in
 * February. A page that is only awake while a tab is open cannot honour any of
 * that, and pretending to would be worse than not offering it. "Every so often,
 * while I have this open" is exactly what this can promise.
 *
 * ## Why nothing here holds a timer
 *
 * The backend is a worker that answers requests; it never wakes on its own, and
 * a `setInterval` in here would fire in every tab at once against one store. So
 * the CALLER ticks — `page.jsx`, under a `navigator.locks` lease so that one tab
 * does where the browser has Web Locks, and every open tab does where it does
 * not — and this service only says what is due and records what ran.
 * That leaves the whole of "when" in the realm that can see a clock and a user,
 * and leaves this a store with rules.
 *
 * ## Overdue, not skipped
 *
 * A schedule that came due while the tab was closed runs ONCE at the next open,
 * not once per period missed. A week of closure must not open into a hundred
 * and sixty-eight questions.
 *
 * ## The first question is a whole period away
 *
 * Creating a schedule is not a way of asking something now — the composer is
 * two inches above it and asks better. So creation stamps `countsFrom`, the
 * clock the first period is measured from, and a schedule written at noon with
 * an hourly period asks at one. This service read a missing last-run as the
 * epoch for one wave, which made every new schedule fifty-six years overdue and
 * put a question into the open conversation the instant the button was pressed.
 *
 * ## When it next asks is derived, never stored
 *
 * `whenNext` is the single answer to "when", and both readers go through it:
 * `due` filters on it and `list` reports it so the panel can say the future
 * out loud instead of only the past. Storing it would be a second copy of a
 * fact the period and the last run already decide, and the copy is the one that
 * goes stale the day a period changes.
 */

/** A schedule may not ask more often than this. */
export const MIN_PERIOD_SECONDS = 60

/** Enough for a question, short enough that a record is not a document. */
export const MAX_TEXT = 2000

/**
 * A day, in seconds.
 *
 * A time of day is a statement about days, so it is honoured on a period made
 * of whole ones and dropped on any other. "Every 15 minutes at 09:00" has no
 * reading that is true to both halves of the sentence, and quietly picking one
 * would be this service deciding which half the person meant.
 */
export const DAY_SECONDS = 86_400

/** Minutes in a day, which is the one past the last valid time of day. */
const DAY_MINUTES = 1440

/** Whether an optional argument was given at all, as against given wrongly. */
const given = (value) =>
  typeof value === 'number' ? true : typeof value === 'string' && !!value.trim()

/**
 * A time of day as minutes past midnight, or null when it is not one.
 *
 * A number and not a written time, so there is no clock parser here for the
 * same reason there is no cron parser: a format is a language, and a language
 * arrives with questions about "9", "9am" and "09:00:00" that this has no way
 * to answer better than the field that collected it. `SchedulePanel` owns the
 * control a person actually types into and hands over the number it means.
 */
const readMinutes = (value) => {
  // Refused before the conversion rather than after it. `Number(null)` is 0,
  // `Number('')` is 0, and midnight is a real time of day — so a schedule that
  // named no time at all would otherwise be read as one that asks at midnight.
  if (!given(value)) return null
  const minutes = Math.floor(Number(value))
  return Number.isFinite(minutes) && minutes >= 0 && minutes < DAY_MINUTES ? minutes : null
}

/** How many whole days a period is, or null when it is not made of them. */
const wholeDays = (seconds) => (seconds % DAY_SECONDS === 0 ? seconds / DAY_SECONDS : null)

/**
 * The most recent moment at `atMinutes` past midnight that is at or before `at`.
 *
 * The baseline for a schedule that names a time: counting from the LAST time it
 * came round means the next one is the next time it comes round. Counting from
 * the moment of writing instead would make "every day at 09:00", written at
 * half past two, wait until the morning after next.
 */
const clockAtOrBefore = (at, atMinutes) => {
  const stamp = new Date(at)
  // Minutes into a day that starts at midnight, which `setHours` normalises
  // into the hour and minute they add up to.
  stamp.setHours(0, atMinutes, 0, 0)
  if (stamp.getTime() > at) stamp.setDate(stamp.getDate() - 1)
  return stamp.getTime()
}

/**
 * `days` calendar days after `from`, at `atMinutes` past midnight.
 *
 * Calendar days rather than that many lots of 86,400,000 milliseconds, because
 * the two are different numbers on the two days a year the clocks move. A
 * morning question added up in milliseconds would drift an hour every spring
 * and, since the drift is one-way, eventually be asked in the middle of the
 * night.
 */
const clockDaysAfter = (from, atMinutes, days) => {
  const stamp = new Date(from)
  stamp.setDate(stamp.getDate() + days)
  stamp.setHours(0, atMinutes, 0, 0)
  return stamp.getTime()
}

export class ScheduleService {
  constructor(repository) {
    this.repository = repository
  }

  /**
   * When a schedule asks next, in epoch milliseconds, or null when nothing
   * truthful can be said.
   *
   * Static and pure so that the two callers who need it — `due`, which decides,
   * and `list`, which tells the panel — are asking one question rather than
   * agreeing to answer the same one twice.
   *
   * Null is the honest answer for a record this build cannot read: one written
   * by a build that is not this one, or one whose period did not survive
   * whatever wrote it. Such a schedule is never due either, because a page that
   * cannot say when it would ask has no business asking.
   */
  static whenNext(record) {
    const period = Number(record?.everySeconds)
    if (!Number.isFinite(period) || period < 1) return null

    // `countsFrom` is the baseline creation stamps. `createdAt` stands in for it
    // on the records that were written before there was one and are already in
    // people's browsers: "waiting since it was written" is the reading of those
    // that invents nothing.
    const from = Number(record.lastRanAt) || Number(record.countsFrom) || Number(record.createdAt)
    if (!Number.isFinite(from) || from <= 0) return null

    const atMinutes = readMinutes(record.atMinutes)
    const days = atMinutes === null ? null : wholeDays(period)
    // The time of day wins over the arithmetic when there is one, so a run that
    // happened late — the tab was shut at nine and opened at a quarter past
    // three — does not move tomorrow's question to a quarter past three.
    return days ? clockDaysAfter(from, atMinutes, days) : from + period * 1000
  }

  /**
   * A record as the page reads it: what was stored, plus when it asks next.
   *
   * A COPY, and that matters rather than being tidiness: `MemoryRepository`
   * hands back the very object it is holding, so writing a derived field onto
   * what `list` returns would put it in the store and it would be read back as
   * fact by the next build to look.
   */
  static reported(record) {
    return { ...record, nextRunAt: ScheduleService.whenNext(record) }
  }

  /**
   * @returns {Promise<Outcome>} value is every schedule, oldest first, each
   *   carrying the `nextRunAt` the panel says out loud
   */
  async list() {
    const all = await this.repository.list()
    if (!all.ok) return all
    return Outcome.ok(
      [...all.value]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((one) => ScheduleService.reported(one)),
    )
  }

  /**
   * Add one.
   *
   * Corrected rather than refused, in the house style: a period under the floor
   * becomes the floor with a note, and an over-long question is cut and says so.
   * What IS refused is an empty question, because there is nothing to ask and no
   * repair that invents one.
   *
   * `atMinutes` is a time of day, in minutes past midnight, and optional:
   * "every day" alone means a day from now, which is a defensible answer, while
   * "every day at 09:00" is the one a person usually means and could not be
   * said at all until this took the argument.
   *
   * `now` is a parameter for the reason `due`'s is — the caller's clock is the
   * only clock, and a baseline is a promise about when, so it must be testable
   * without waiting an hour to find out.
   *
   * @param {{text: string, everySeconds: number, conversationId: string,
   *   atMinutes?: number, now?: number}} params
   */
  async create({ text, everySeconds, conversationId, atMinutes, now = Date.now() } = {}) {
    const notes = []
    const asked = typeof text === 'string' ? text.trim() : ''
    if (!asked) {
      return Outcome.failed(Reason.BAD_REQUEST, 'a schedule needs a question to ask', {
        hint: 'Type what you want asked, then choose how often.',
      })
    }
    if (!conversationId) {
      return Outcome.failed(Reason.BAD_REQUEST, 'a schedule needs a conversation to ask in', {
        hint: 'Start a chat first; the answers land in it.',
      })
    }

    let question = asked
    if (question.length > MAX_TEXT) {
      question = question.slice(0, MAX_TEXT)
      notes.push(`the question was cut to ${MAX_TEXT} characters`)
    }

    // `Number`, not `parseInt`: `parseInt('10m')` is 10, which would silently
    // turn "every ten minutes" into every ten seconds. The same argument is
    // written out at length on `AgentSpec`'s budget parser.
    let period = Math.floor(Number(everySeconds))
    if (!Number.isFinite(period) || period < 1) {
      notes.push(
        `${JSON.stringify(everySeconds)} is not a number of seconds; used ${MIN_PERIOD_SECONDS}`,
      )
      period = MIN_PERIOD_SECONDS
    } else if (period < MIN_PERIOD_SECONDS) {
      notes.push(`every ${period}s is too often; used ${MIN_PERIOD_SECONDS}s`)
      period = MIN_PERIOD_SECONDS
    }

    let minutes = readMinutes(atMinutes)
    if (given(atMinutes) && minutes === null) {
      notes.push(`${JSON.stringify(atMinutes)} is not a time of day; the period decides on its own`)
    } else if (minutes !== null && !wholeDays(period)) {
      // Dropped rather than honoured, and said out loud. Keeping both would
      // mean answering "every 15 minutes at 09:00", and every answer to that is
      // a different feature from the one the person asked for.
      notes.push(`a time of day needs a period of whole days; every ${period}s ignores it`)
      minutes = null
    }

    const record = {
      id: newId(),
      text: question,
      everySeconds: period,
      conversationId,
      // Null when there is no time of day, which is a different fact from
      // midnight and has to stay one: `whenNext` reads a null here as "the
      // period decides" and a zero as "ask at twelve at night".
      atMinutes: minutes,
      createdAt: now,
      // Zero, and it says never run rather than ran in 1970. What the first
      // period is measured from is `countsFrom`, immediately below, so the two
      // facts stopped sharing one field and stopped disagreeing about what a
      // schedule that has never run is owed.
      lastRanAt: 0,
      // The clock the first question is counted from.
      //
      // This is the whole of the fix for a schedule that ran the moment it was
      // written: there was no baseline, `due` read the missing last-run as zero,
      // and "every hour" therefore asked its first question straight into the
      // open conversation where it was indistinguishable from something the
      // person had typed.
      //
      // With a time of day it is the last time that time came round, so a daily
      // 09:00 written at half past two asks tomorrow morning rather than the
      // morning after.
      //
      // Read against null and never for truthiness: midnight is zero minutes
      // past midnight, and a schedule set for midnight is a schedule.
      countsFrom: minutes === null ? now : clockAtOrBefore(now, minutes),
    }
    const saved = await this.repository.put(record)
    return saved.ok ? Outcome.ok(ScheduleService.reported(record), notes) : saved
  }

  async remove({ id } = {}) {
    return this.repository.remove(id)
  }

  /**
   * Which schedules are due, at a moment the caller names.
   *
   * `now` is a parameter rather than `Date.now()` so this is testable without
   * waiting, and so the caller's clock is the only clock: a tick that decides
   * with one time and records with another can run the same schedule twice.
   *
   * @returns {Promise<Outcome>} value is the due schedules, most overdue first
   */
  async due({ now = Date.now() } = {}) {
    const all = await this.list()
    if (!all.ok) return all
    // Against the time each one says it will next ask, which is the same field
    // the panel shows. A row that reads "next in 58m" and is asked anyway would
    // be the page and the store telling a person two different stories about
    // the same schedule.
    const ready = all.value.filter((one) => one.nextRunAt !== null && one.nextRunAt <= now)
    // Longest overdue first, and a tick takes one. Sorting by the last run said
    // the same thing only while every schedule shared a period.
    return Outcome.ok(ready.sort((a, b) => a.nextRunAt - b.nextRunAt))
  }

  /**
   * Write down that one ran.
   *
   * Recorded whatever the turn did, including when it failed. A schedule that
   * only records its successes retries a failing question on every tick for as
   * long as it keeps failing, which turns one unreachable endpoint into a flood.
   */
  async ran({ id, at = Date.now() } = {}) {
    const found = await this.repository.get(id)
    if (!found.ok) return found
    if (!found.value) {
      return Outcome.failed(Reason.NOT_FOUND, `no schedule ${id}`, {
        hint: 'It was removed while it was running.',
      })
    }
    const record = { ...found.value, lastRanAt: at }
    const saved = await this.repository.put(record)
    return saved.ok ? Outcome.ok(ScheduleService.reported(record)) : saved
  }
}
