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
 * IT IS DISABLED, AND IT SAYS WHY. The seam that would carry a message is not
 * wired yet, so an enabled box would be a control lying about what pressing it
 * does — the same reason `Empty` ships without its action. The refusal is a
 * sentence the projection carries, so wiring it is deleting a string rather
 * than editing this file.
 *
 * @param {{data: ComposerData}} props
 */
export function Composer({ data }) {
  return (
    <section className={s.composer} aria-label={data.promptLabel}>
      {/* THE LABEL WRAPS THE BOX rather than pointing at it by id. This
          component renders twice on one document — `/design-system/` puts every
          state in both rooms — and an id is a promise of uniqueness that a
          gallery breaks the moment it shows a second specimen. */}
      <label className={s.promptLabel}>
        {data.promptLabel}
        <textarea
          className={s.prompt} rows={3} placeholder={data.placeholder}
          disabled={Boolean(data.refusedLabel)}
        />
      </label>
      <div className={s.envelope}>
        <Facts facts={data.sentWith} />
      </div>
      <div className={s.send}>
        <Ring cost={data.cost} />
        <button type="button" className={s.sendButton} disabled={Boolean(data.refusedLabel)}>
          {data.sendLabel}
        </button>
      </div>
      {data.refusedLabel ? <p className={s.refusal}>{data.refusedLabel}</p> : null}
    </section>
  )
}
