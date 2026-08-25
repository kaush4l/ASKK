import s from './shell.module.css'

/**
 * THE COMMANDING FRONT DOOR (DESIGN.md §1, the editorial amendment).
 *
 * Eight rounds of critique each correctly removed one more source of visual
 * interest, and the page arrived at "a cheap imitation of a webpage". The
 * amendment is that a control surface is allowed ONE place where it is not
 * calm: a ruled plate, in the serif, naming the screen's SUBJECT. Never a
 * view's own name — that is the 11px kicker above it, and if the name is the
 * largest thing on the screen the mockup is rejected.
 *
 * @param {{kicker: string, subject: string}} props
 */
export function Masthead({ kicker, subject }) {
  return (
    <h1 className={s.masthead}>
      <span className={s.kicker}>{kicker}</span>
      <span className={s.plate}>{subject}</span>
    </h1>
  )
}
