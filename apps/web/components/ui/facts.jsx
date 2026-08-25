import s from './ui.module.css'

/**
 * A KEY AND ITS VALUE ARE A DEFINITION LIST. Used wherever a pane shows named
 * machine values — the shared space's facts, a debug turn's fields, the strip
 * of counts under the log — so a screen reader says "key, value" instead of
 * reading two unrelated paragraphs.
 *
 * No accessible name of its own. Two of the three call sites passed the
 * enclosing `<h2>` verbatim, so a screen reader said the caption twice; a
 * definition list inside a `Panel` is already named by that heading.
 *
 * @param {{facts: ReadonlyArray<{key: string, value: string}>}} props
 */
export function Facts({ facts }) {
  return (
    <dl className={s.facts}>
      {facts.map((fact) => (
        <div key={fact.key} className={s.fact}>
          <dt>{fact.key}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
