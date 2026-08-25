import s from './ui.module.css'

/**
 * WHAT A REGION SAYS WHEN IT HOLDS NOTHING (DESIGN.md §8, EmptyState).
 *
 * One sentence, no glyph, and never a bare "No data" — every list region in
 * this product renders this rather than a blank box. The sentence is the
 * core's: an empty Files pane that HELD files before a reload says something
 * different from one that never held any, and only the log knows which.
 *
 * No action yet. The specified anatomy ends in one primary action and there is
 * nothing to press until the seam is wired, so the button is absent rather
 * than present and inert.
 *
 * @param {{note: string}} props
 */
export function Empty({ note }) {
  return <p className={s.empty}>{note}</p>
}
