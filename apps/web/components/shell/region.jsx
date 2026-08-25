import s from './shell.module.css'

/**
 * THE REGION A DESTINATION FILLS, and right now nothing fills it.
 *
 * It takes its heading, its note and the seam views it will compose as explicit
 * props from the destination table, and it stamps NOTHING on the element any
 * more: `data-placeholder` was how a probe found a screen whose facts were
 * invented, and Work's facts are the seam's now.
 *
 * THE NOTE IS ONE LINE ON A SCREEN THAT HAS CONTENT — a sentence, and not the
 * 403-pixel paragraph the editorial round measured between a person and the
 * product (DESIGN.md §1).
 *
 * The panes are listed rather than summarised because they are the contract:
 * a destination COMPOSES panes, and naming them is what stops "add a pane" from
 * quietly meaning "add a tab".
 *
 * A destination that HAS something to render passes it as children. Everything
 * else still gets the panes and the admission, because a screen that says
 * nothing about being unbuilt is a screen that looks broken — and the admission
 * is now true of Agents and Setup alone, which is the point of it.
 *
 * @param {{id: string, heading: string, note: string, panes: string[],
 *          children?: React.ReactNode}} props
 */
export function Region({ id, heading, note, panes, children }) {
  return (
    <main id={id} className={s.region} aria-labelledby={`${id}-heading`}>
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
