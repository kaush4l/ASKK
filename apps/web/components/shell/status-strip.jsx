import { NOT_REAL_YET } from '@/lib/placeholder'
import s from './shell.module.css'

/**
 * ONE STRIP FOR EVERY FACT, IN PRIORITY ORDER, AND NOTHING IT DOES NOT YET
 * KNOW. The predecessor rendered `Agent: main` and a sandbox state while the
 * core was still booting, asserting two things it could not know — it had not
 * read the roster, so it did not know `main` was on it. A status the page does
 * not have yet is not rendered, so every value here is `—` until increment 3
 * gives the strip a projection to read.
 *
 * The strip renders `facts` and derives nothing from them (I5). It does not
 * decide that four values mean "healthy", it does not count them, and it does
 * not word one: the core sends the label and the already-worded value.
 *
 * @param {{facts: Array<{id: string, label: string, value: string}>}} props
 */
export function StatusStrip({ facts }) {
  return (
    <dl className={s.strip} data-placeholder={NOT_REAL_YET}>
      {facts.map((fact) => (
        <div key={fact.id} className={s.cell}>
          <dt className={s.stripLabel}>{fact.label}</dt>
          <dd className={s.stripValue}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
