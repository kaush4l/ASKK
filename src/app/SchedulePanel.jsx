'use client'

import { useState } from 'react'

/**
 * Questions that ask themselves.
 *
 * Deliberately a question, a period and a list. What a person has to decide is
 * what to ask and how often; everything else — which conversation, when it last
 * ran, what the floor on a period is — is either implied by where they are
 * standing or reported back to them in words. A time of day is the one addition
 * to that, and it appears for the one period where "how often" leaves "when"
 * unanswered: every day, which otherwise means whenever the button was pressed.
 *
 * Every row says when it will next ask. A list that reported only the past —
 * "never run yet", and later "last ran just now" — withheld the single fact a
 * person opens this panel to check.
 *
 * It says out loud what this cannot do, because the alternative is someone
 * closing the tab expecting to come back to eight answers. A page is only awake
 * while it is open: a schedule runs in the conversation it was made in, while
 * that conversation is open, and a period that elapsed while it was closed is
 * one question at the next open rather than one per period missed. The times on
 * these rows inherit that honesty — they are this device's clock, and one that
 * comes round while the tab is shut is asked when it is opened again, not at
 * the minute shown.
 */

/** The choices, in the words a person would use. */
const PERIODS = [
  { label: 'every minute', seconds: 60 },
  { label: 'every 5 minutes', seconds: 300 },
  { label: 'every 15 minutes', seconds: 900 },
  { label: 'every hour', seconds: 3600 },
  { label: 'every 6 hours', seconds: 21_600 },
  { label: 'every day', seconds: 86_400 },
]

/**
 * The one period that leaves "when" open.
 *
 * Every other choice here answers it by being short enough that nobody cares
 * which minute of the hour it lands on. A day is long enough that the answer
 * matters, so that is the choice — and only that choice — that asks for a time.
 */
const DAILY_SECONDS = 86_400

/**
 * The two halves of the time field, which speaks `HH:MM` while the record and
 * the wire carry minutes past midnight.
 *
 * The number is the honest thing to store — it needs no parser and no format —
 * and the string is the only thing an `<input type="time">` will hold, so the
 * conversion lives here, at the one place the control meets the record.
 */
const minutesOf = (written) => {
  const said = /^(\d{1,2}):([0-5]\d)/.exec(written ?? '')
  if (!said) return null
  const minutes = Number(said[1]) * 60 + Number(said[2])
  return minutes < 1440 ? minutes : null
}

const timeOf = (minutes) => {
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** A period the person did not have to be told, said back as they chose it. */
const said = (seconds, atMinutes) => {
  const period = PERIODS.find((one) => one.seconds === seconds)?.label ?? `every ${seconds}s`
  // Against null rather than for truthiness, because midnight is zero minutes
  // past midnight and "every day" would swallow the one time of day a person is
  // most likely to have chosen deliberately.
  return atMinutes === null || atMinutes === undefined
    ? period
    : `${period} at ${timeOf(atMinutes)}`
}

/** When it last ran, in the terms a person asks the question in. */
function lastRan(at) {
  if (!at) return 'never run'
  const minutes = Math.round(Math.max(0, Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

/**
 * Whole nights between two instants.
 *
 * Midnight to midnight rather than a difference divided by a day, because
 * "tomorrow" is a fact about the calendar and not about elapsed time: twenty to
 * midnight and twenty past are forty minutes and one whole "tomorrow" apart,
 * and it is the second of those a person means when they read the word.
 */
function nightsBetween(from, to) {
  const midnight = (at) => {
    const stamp = new Date(at)
    stamp.setHours(0, 0, 0, 0)
    return stamp.getTime()
  }
  return Math.round((midnight(to) - midnight(from)) / 86_400_000)
}

/** A wall-clock time, on the 24-hour clock the time field is written in. */
function clockOf(at) {
  const stamp = new Date(at)
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`
}

/**
 * When it next asks, in the terms a person asks the question in.
 *
 * Nothing at all when the record could not say. The backend answers null for a
 * schedule whose period it cannot read, and it will never run one of those —
 * "next in NaNm" under a row that is going to sit there forever is worse than
 * the silence, and a guess would be worse than either.
 */
function nextRun(at) {
  if (!at) return ''
  const now = Date.now()
  // Not "now" and not "overdue": the page looks for due questions on a tick, so
  // what is true about something already past its time is that it goes at the
  // next look, and only while this tab is the one open on its conversation.
  if (at <= now) return 'due at the next check'

  const minutes = Math.round((at - now) / 60_000)
  if (minutes < 1) return 'next in under a minute'
  if (minutes < 60) return `next in ${minutes}m`

  // Within a few hours the elapsed time is the answer even when a midnight
  // falls inside it. Measured: an hourly schedule made at 23:29 read "next
  // tomorrow at 00:30", which is true, sounds like a day away, and is a worse
  // answer than "next in 1h" for the only question being asked — how long.
  const hours = Math.round(minutes / 60)
  if (hours <= 6) return `next in ${hours}h`

  // Named by the clock once it is far enough out that the arithmetic is the
  // hard part: "next in 19h" is a sum a person then has to do, whereas
  // tomorrow at 09:00 is the thing they already have an opinion about.
  const nights = nightsBetween(now, at)
  if (nights === 0) return `next in ${hours}h`
  if (nights === 1) return `next tomorrow at ${clockOf(at)}`
  return `next in ${nights}d`
}

/**
 * The clause the panel's one promise ends with, and the only place it is said.
 *
 * Written once because a time this page names is a time this page can only keep
 * while it is the page in front of you. Said once because it used to end this
 * sentence AND the sentence directly beneath it, and the same caveat in two
 * consecutive paragraphs reads as a page hedging rather than as a page being
 * straight with you. Beside the button is where it belongs: that is the last
 * thing read before a schedule is committed to, and a warning that arrives
 * after the press is a correction.
 */
const ONLY_WHILE_OPEN = 'and then only while this tab is open on this conversation'

/**
 * What pressing the button will actually do, said before it is pressed.
 *
 * Three cases and three sentences, none of which claims a minute. A daily
 * question at a time that has not come round yet today goes TODAY, so a
 * sentence that said "tomorrow" would be wrong for every schedule written
 * before breakfast — and this panel is not allowed to be a second place that
 * decides when a schedule runs, so it describes the rule rather than computing
 * the answer. `ScheduleService.whenNext` is the one thing that computes it, and
 * the row shows what it said.
 */
function promiseFor(daily, timeOfDay) {
  if (!daily) {
    return `A new schedule waits one whole period before its first question, ${ONLY_WHILE_OPEN}.`
  }
  if (!timeOfDay) {
    return `With no time given, the first question goes a day from now, ${ONLY_WHILE_OPEN}.`
  }
  return `The first goes at ${timeOfDay} — today if that is still to come — ${ONLY_WHILE_OPEN}.`
}

export function SchedulePanel({
  schedules = [],
  conversationId = '',
  onCreate,
  onRemove,
  ready = true,
}) {
  const [text, setText] = useState('')
  const [seconds, setSeconds] = useState(3600)
  // Nine in the morning rather than the current time: a default of "now" is how
  // "every day" came to mean "whenever you happened to press the button", and a
  // daily question is nearly always a morning one.
  const [timeOfDay, setTimeOfDay] = useState('09:00')

  const daily = seconds === DAILY_SECONDS

  async function add(event) {
    event.preventDefault()
    const asked = text.trim()
    if (!asked) return
    // Sent only for the period it means something on, so that switching to
    // hourly after typing a time does not quietly file the time away with it.
    await onCreate?.({
      text: asked,
      everySeconds: seconds,
      atMinutes: daily ? minutesOf(timeOfDay) : null,
    })
    setText('')
  }

  return (
    <div className="plans" data-testid="plans-panel-body">
      {/* The class on every control below is load-bearing and not decoration.
          `globals.css` reaches into this panel through `.plan-what` and
          `.plan-when` and through nothing else, so a control wearing neither is
          drawn by the browser rather than by this app — measured on the shipped
          page, these came back as Arial at 13.33px inside an inset border,
          beside a screen where every other field is a rounded hairline box. One
          screen of browser defaults reads as a screen nobody finished, and it
          makes a reader doubt the finished ones too. It is also why the choices
          and the button share a row: `.plan-when` IS that row, and the select
          and the button are only styled as its children. */}
      <form className="plan-new" onSubmit={add}>
        <label>
          ask this
          <input
            className="plan-what"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="what to ask, in full — nobody is here to clarify it"
            disabled={!ready}
            data-testid="plan-text"
          />
        </label>
        <div className="plan-when">
          <label>
            how often
            <select
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
              disabled={!ready}
              data-testid="plan-period"
            >
              {PERIODS.map((one) => (
                <option key={one.seconds} value={one.seconds}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          {daily ? (
            <label>
              at
              <input
                className="plan-what"
                type="time"
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
                disabled={!ready}
                data-testid="plan-time"
              />
            </label>
          ) : null}
          <button type="submit" disabled={!ready || !text.trim()} data-testid="plan-add">
            schedule it
          </button>
        </div>
        {/* Said where the choice is made rather than only in the empty state,
            because a time of day is the field most likely to be read as a
            promise that something will happen at that minute whatever else is
            true. The first question is a whole period away either way, which is
            worth saying next to a button that used to ask one immediately. */}
        <p className="hint" data-testid="plan-promise">
          {promiseFor(daily, timeOfDay)}
        </p>
      </form>

      {schedules.length === 0 ? (
        // The caveat that used to end the first sentence here is said once now,
        // beside the button, where it is read while the decision is still being
        // made. What is left is the catch-up rule, which is a different fact and
        // the one nobody can guess.
        <p className="hint" data-testid="plans-empty">
          Nothing is scheduled yet. A scheduled question is asked in this conversation, the same way
          you would ask it yourself, and one that came due while you were away is asked once when
          you open the tab again, however long you were gone.
        </p>
      ) : (
        <>
          <ul className="plan-list" data-testid="plan-list">
            {schedules.map((one) => {
              // Worked out once for the row rather than in each place it is
              // read: the empty string is how a schedule with nothing truthful
              // to say about its next run stays quiet, and asking twice would
              // be asking a clock two questions and hoping for one answer.
              const next = nextRun(one.nextRunAt)
              return (
                <li key={one.id} data-testid={`plan-${one.id}`}>
                  <div className="plan-what">{one.text}</div>
                  <div className="plan-when">
                    <span>{said(one.everySeconds, one.atMinutes)}</span>
                    {next ? (
                      <span className="dim" data-testid={`plan-next-${one.id}`}>
                        {next}
                      </span>
                    ) : null}
                    {/* "last not yet" read as a typo. The two cases are different
                        sentences, not one sentence with a hole in it. */}
                    <span className="dim">
                      {one.lastRanAt ? `last ran ${lastRan(one.lastRanAt)}` : 'never run yet'}
                    </span>
                    {/* Which conversation it belongs to, said only when that is not
                        this one. A schedule asks in the chat it was made in, and a
                        list that looked identical in every chat would have someone
                        waiting here for a question that is asked over there. */}
                    {conversationId && one.conversationId !== conversationId ? (
                      <span className="dim" data-testid={`plan-elsewhere-${one.id}`}>
                        in another chat
                      </span>
                    ) : null}
                    <button type="button" onClick={() => onRemove?.(one.id)}>
                      remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {/* What these particular numbers are, for the reader who has schedules
              and therefore never sees the empty state. Not the tab caveat a
              second time — that is said beside the button and only there — but
              the two things a row's time hides: whose clock it is, and what
              becomes of the one that comes round while nobody is looking. */}
          <p className="hint" data-testid="plans-clock">
            Times are this device's clock. One whose time came round while you were away is asked
            once when you come back, not at the minute it says.
          </p>
        </>
      )}
    </div>
  )
}
