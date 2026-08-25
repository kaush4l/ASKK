'use client'

import { Facts } from './facts'
import { Ring } from './ring'
import s from './meter.module.css'

/**
 * @typedef {object} ComposerData
 * @property {string} promptLabel   what the box is for, in words
 * @property {string} placeholder
 * @property {string} sendLabel
 * @property {string} refusedLabel  why pressing send would do nothing today,
 *   '' when it would do something. It is the core's sentence, not a flag this
 *   file words for itself — the terminal pane already carries the same field
 *   for the same reason, and one product says one thing about being unwired.
 * @property {ReadonlyArray<{key: string, value: string}>} sentWith
 * @property {import('./ring').CostData} cost
 */

/**
 * WHAT YOU ARE SAYING, WHAT IT WILL BE SENT WITH, AND WHAT IT WILL COST.
 *
 * Three bands, because those are three different questions and the predecessor
 * answered only the first: the agent, the model and the tool set were decided
 * somewhere else, on another screen, and the person typing found out which one
 * had answered by reading the reply. A composer that does not state its own
 * envelope is a send button with a surprise attached.
 *
 * IT SENDS NOW, AND IT IS A FORM. `onSend` is what a press does; the draft is
 * the browser's, not React's, because a half-typed sentence is not a fact and
 * the log is the authority on every fact this screen shows. `required` is what
 * refuses an empty message, so the refusal happens in the browser before a
 * request is built — the core refuses it a second time, which is where the
 * rule actually lives.
 *
 * A COMPOSER WITH NOWHERE TO SEND SAYS SO, and that is `NOWHERE`: the gallery
 * renders this component with no session behind it, and a disabled control
 * whose reason is unstated is the dead switch this product keeps deleting.
 *
 * @param {{data: ComposerData, onSend?: (text: string) => void}} props
 */
export function Composer({ data, onSend }) {
  const refusedLabel = data.refusedLabel || (onSend ? '' : NOWHERE)
  return (
    <form className={s.composer} aria-label={data.promptLabel} onSubmit={(event) => submit(event, onSend)}>
      {/* THE LABEL WRAPS THE BOX rather than pointing at it by id. This
          component renders twice on one document — `/design-system/` puts every
          state in both rooms — and an id is a promise of uniqueness that a
          gallery breaks the moment it shows a second specimen. */}
      <label className={s.promptLabel}>
        {data.promptLabel}
        <textarea
          className={s.prompt} rows={3} name="message" required
          placeholder={data.placeholder} disabled={Boolean(refusedLabel)}
        />
      </label>
      <div className={s.envelope}>
        <Facts facts={data.sentWith} />
      </div>
      <div className={s.send}>
        <Ring cost={data.cost} />
        <button type="submit" className={s.sendButton} disabled={Boolean(refusedLabel)}>
          {data.sendLabel}
        </button>
      </div>
      {refusedLabel ? <p className={s.refusal}>{refusedLabel}</p> : null}
    </form>
  )
}

/** Interface copy, because there is no core on the other side to have worded
 *  it: a composer with no `onSend` is one nothing is listening to. */
const NOWHERE = 'Nothing typed here is sent — this composer is not attached to a running agent.'

/**
 * @param {React.FormEvent<HTMLFormElement>} event
 * @param {((text: string) => void) | undefined} onSend
 */
function submit(event, onSend) {
  event.preventDefault()
  const field = event.currentTarget.elements.namedItem('message')
  if (!onSend || !(field instanceof HTMLTextAreaElement)) return
  const text = field.value.trim()
  if (text === '') return
  onSend(text)
  // The draft is gone because the message is a fact now: leaving it in the box
  // is the second copy the person then sends twice.
  event.currentTarget.reset()
}
