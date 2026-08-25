import { Facts } from './facts'
import s from './meter.module.css'

/** @typedef {{id: string, key: string, value: string, fraction: number}} CostPart */

/**
 * @typedef {object} CostData what this turn will cost, before it is sent.
 * @property {string} label          the whole of it, worded: "6,102 of 128,000 tokens"
 * @property {string} headroomLabel  what is left, worded
 * @property {ReadonlyArray<CostPart>} parts input · output · reasoning · cached
 */

/** The circle whose circumference is exactly 100, so a part's share IS its
 *  dash length and no unit conversion sits between the number and the arc. */
const R = 15.9155

/**
 * THE MOST CONTESTED NUMBER IN THIS PROJECT, DRAWN.
 *
 * How much of the window a turn is about to spend has been an argument in this
 * repo for its whole life — one round measured a 4,174-token prompt against a
 * 4,096-token budget that nothing on screen stated. A ring beside the composer
 * turns it from an argument into an observation, and the breakdown says where
 * it went: input, output, reasoning and cached are four different problems and
 * a single total hides which one you have.
 *
 * Every `fraction` is the core's (I5: the budget is derived from the model,
 * never declared here). Turning fractions into arc lengths is geometry, and
 * geometry is the one arithmetic this tree is allowed — it produces a shape,
 * never a fact and never a word.
 *
 * @param {{cost: CostData}} props
 */
export function Ring({ cost }) {
  let used = 0
  const arcs = cost.parts.map((part) => {
    const arc = { id: part.id, dash: part.fraction * 100, offset: used }
    used += arc.dash
    return arc
  })
  return (
    <div className={s.meter}>
      {/* FOCUSABLE, so the breakdown below is reachable without a pointer. It
          carries no role and no label: the ring draws what the sentence beside
          it already says, and a second voice for one fact is the defect this
          product keeps finding (I5). */}
      <div className={s.ring} tabIndex={0}>
        <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
          <circle className={s.track} cx="20" cy="20" r={R} />
          {arcs.map((arc) => (
            <circle
              key={arc.id} className={s.arc} data-part={arc.id} cx="20" cy="20" r={R}
              strokeDasharray={`${arc.dash} 100`} strokeDashoffset={-arc.offset}
            />
          ))}
        </svg>
      </div>
      <p className={s.ringLabel}>{cost.label}</p>
      {/* ALWAYS IN THE DOCUMENT, revealed on hover and on focus — faded, never
          removed. A breakdown a keyboard cannot reach is a breakdown half the
          readers do not have, and one that is `display: none` until a pointer
          arrives is one a screen reader never hears at all. */}
      <div className={s.breakdown}>
        <Facts facts={cost.parts} />
        <p className={s.headroom}>{cost.headroomLabel}</p>
      </div>
    </div>
  )
}
