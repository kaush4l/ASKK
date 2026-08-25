import { NOT_REAL_YET } from '@/lib/placeholder'
import s from './shell.module.css'

/**
 * THE INSTRUMENTS COLUMN — what else you need while you are doing this.
 *
 * It is rendered only where it has something to say (`Destination.rail`, which
 * is Work and nowhere else), and ABSENT rather than present-and-empty
 * elsewhere: the predecessor shipped a header switch reading `Hide workspace
 * files` with `aria-expanded="true"` over a `#rail` that was `display: none` at
 * 0×0 — a dead control reporting a state it did not have.
 *
 * It is named for what is IN it and never for its geometry: it wore `Side panel
 * · main` once, a region named after itself, which tells a reader nothing they
 * cannot already see.
 *
 * @param {{noun: string, subject: string, note: string}} props
 */
export function Rail({ noun, subject, note }) {
  return (
    <aside className={s.rail} aria-label={noun} data-placeholder={NOT_REAL_YET}>
      <p className={s.railWho}>
        {noun} · <strong>{subject}</strong>
      </p>
      <p>{note}</p>
    </aside>
  )
}
