import { NOT_REAL_YET } from '@/lib/placeholder'
import s from './shell.module.css'

/**
 * THE REGION A DESTINATION FILLS, and right now nothing fills it.
 *
 * It takes its heading, its note and the seam views it will compose as explicit
 * props from `lib/placeholder.js`, and it stamps `data-placeholder` on the
 * element so a probe — and a reader — can tell at a glance that no fact on this
 * screen came from the log. Increment 3 replaces the props with `response.data`
 * and deletes the stamp; nothing else about this component changes.
 *
 * The panes are listed rather than summarised because they are the contract:
 * a destination COMPOSES panes, and naming them is what stops "add a pane" from
 * quietly meaning "add a tab".
 *
 * A destination that HAS something to render passes it as children — today
 * that is the design system alone, whose content is components rather than a
 * projection. Everything else still gets the panes and the admission, because a
 * screen that says nothing about being unbuilt is a screen that looks broken.
 *
 * @param {{id: string, heading: string, note: string, panes: string[],
 *          children?: React.ReactNode}} props
 */
export function Region({ id, heading, note, panes, children }) {
  return (
    <main id={id} className={s.region} aria-labelledby={`${id}-heading`} data-placeholder={NOT_REAL_YET}>
      <h2 id={`${id}-heading`}>{heading}</h2>
      <p className={s.regionNote}>{note}</p>
      {children ?? (
        <>
          <ul className={s.panes}>
            {panes.map((pane) => (
              <li key={pane} className={s.pane}>{pane}</li>
            ))}
          </ul>
          <p className={s.unbuilt}>Not wired to the seam yet</p>
        </>
      )}
    </main>
  )
}
