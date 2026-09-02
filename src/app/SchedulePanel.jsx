'use client'

import { useState } from 'react'

/**
 * Questions that ask themselves.
 *
 * Deliberately three fields and a list. What a person has to decide is what to
 * ask and how often; everything else — which conversation, when it last ran,
 * what the floor on a period is — is either implied by where they are standing
 * or reported back to them in words.
 *
 * It says out loud what this cannot do, because the alternative is someone
 * closing the tab expecting to come back to eight answers. A page is only awake
 * while it is open: a schedule runs in the conversation it was made in, while
 * that conversation is open, and a period that elapsed while it was closed is
 * one question at the next open rather than one per period missed.
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

const said = (seconds) =>
  PERIODS.find((one) => one.seconds === seconds)?.label ?? `every ${seconds}s`

/** When it last ran, in the terms a person asks the question in. */
function lastRan(at) {
  if (!at) return 'never run'
  const minutes = Math.round(Math.max(0, Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
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

  async function add(event) {
    event.preventDefault()
    const asked = text.trim()
    if (!asked) return
    await onCreate?.({ text: asked, everySeconds: seconds })
    setText('')
  }

  return (
    <div className="plans" data-testid="plans-panel-body">
      <form className="plan-new" onSubmit={add}>
        <label>
          ask this
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="what to ask, in full — nobody is here to clarify it"
            disabled={!ready}
            data-testid="plan-text"
          />
        </label>
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
        <button type="submit" disabled={!ready || !text.trim()} data-testid="plan-add">
          schedule it
        </button>
      </form>

      {schedules.length === 0 ? (
        <p className="hint" data-testid="plans-empty">
          Nothing is scheduled yet. A scheduled question is asked in this conversation, the same way
          you would ask it yourself, and only while this tab is open. Close the tab and nothing
          runs; open it again and a question that came due while you were away is asked once,
          however long you were gone.
        </p>
      ) : (
        <ul className="plan-list" data-testid="plan-list">
          {schedules.map((one) => (
            <li key={one.id} data-testid={`plan-${one.id}`}>
              <div className="plan-what">{one.text}</div>
              <div className="plan-when">
                <span>{said(one.everySeconds)}</span>
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
          ))}
        </ul>
      )}
    </div>
  )
}
