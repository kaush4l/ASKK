import s from './ui.module.css'

/**
 * A KEY AND ITS VALUE ARE A DEFINITION LIST. Used wherever a pane shows named
 * machine values — the shared space's facts, a debug turn's fields, the strip
 * of counts under the log — so a screen reader says "key, value" instead of
 * reading two unrelated paragraphs.
 *
 * @param {{label: string, facts: ReadonlyArray<{key: string, value: string}>}} props
 *   `label` names the list for assistive technology; the pane's own caption is
 *   not always the right name for the values inside it.
 */
export function Facts({ label, facts }) {
  return (
    <dl className={s.facts} aria-label={label}>
      {facts.map((fact) => (
        <div key={fact.key} className={s.fact}>
          <dt>{fact.key}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
