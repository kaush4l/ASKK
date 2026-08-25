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
 * cannot already see. The noun and the line are the interface's own, because
 * this column says what it is FOR — the folder, the processes and the artifacts
 * inside it are projections, and they arrive when the seam serves those panes.
 *
 * @param {{subject: string}} props
 */
export function Rail({ subject }) {
  return (
    <aside className={s.rail} aria-label={NOUN}>
      <p className={s.railWho}>
        {NOUN} · <strong>{subject}</strong>
      </p>
      <p>{NOTE}</p>
    </aside>
  )
}

/** Named for its CONTENTS and not its position (DESIGN.md §11, R8-7). */
const NOUN = 'folder'

const NOTE = 'The folder this agent’s commands ran in, what is still running in it, and what the turn left behind.'
