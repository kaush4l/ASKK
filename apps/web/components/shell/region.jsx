import s from './shell.module.css'

/**
 * THE REGION A DESTINATION FILLS — the QUIET WORKING MIDDLE (DESIGN.md §1).
 *
 * Opaque, at full opacity, never over a blur, and one step below the panels
 * standing on it so a reader can tell in one second which surface is on top.
 *
 * IT TAKES CHILDREN AND NOTHING ELSE OPTIONAL, and that is this increment: the
 * fallback that listed a destination's panes and admitted `Not wired to the
 * seam yet` is deleted, because every destination is wired. A placeholder that
 * outlives the thing it was standing in for is how a product ships a screen
 * nobody looked at.
 *
 * THE NOTE IS ONE LINE — a sentence, not the 403-pixel paragraph the editorial
 * round measured between a person and the product (DESIGN.md §1).
 *
 * @param {{id: string, heading: string, note: string, children: React.ReactNode}} props
 */
export function Region({ id, heading, note, children }) {
  return (
    <main id={id} className={s.region} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{heading}</h2>
      <p className={s.regionNote}>{note}</p>
      {children}
    </main>
  )
}
