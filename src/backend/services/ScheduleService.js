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
 */

/** A schedule may not ask more often than this. */
export const MIN_PERIOD_SECONDS = 60

/** Enough for a question, short enough that a record is not a document. */
export const MAX_TEXT = 2000

export class ScheduleService {
  constructor(repository) {
    this.repository = repository
  }

  /** @returns {Promise<Outcome>} value is every schedule, oldest first */
  async list() {
    const all = await this.repository.list()
    if (!all.ok) return all
    return Outcome.ok([...all.value].sort((a, b) => a.createdAt - b.createdAt))
  }

  /**
   * Add one.
   *
   * Corrected rather than refused, in the house style: a period under the floor
   * becomes the floor with a note, and an over-long question is cut and says so.
   * What IS refused is an empty question, because there is nothing to ask and no
   * repair that invents one.
   *
   * @param {{text: string, everySeconds: number, conversationId: string}} params
   */
  async create({ text, everySeconds, conversationId } = {}) {
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

    const record = {
      id: newId(),
      text: question,
      everySeconds: period,
      conversationId,
      createdAt: Date.now(),
      // Zero, not now: a schedule someone has just written should ask its first
      // question at the next tick rather than a period from now, because the way
      // a person finds out whether this works is by watching it happen.
      lastRanAt: 0,
    }
    const saved = await this.repository.put(record)
    return saved.ok ? Outcome.ok(record, notes) : saved
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
    const ready = all.value.filter((one) => now - (one.lastRanAt || 0) >= one.everySeconds * 1000)
    return Outcome.ok(ready.sort((a, b) => (a.lastRanAt || 0) - (b.lastRanAt || 0)))
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
    return saved.ok ? Outcome.ok(record) : saved
  }
}
