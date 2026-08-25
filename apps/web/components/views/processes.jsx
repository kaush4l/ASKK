import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} ProcRow
 * @property {string} id
 * @property {string} name
 * @property {string} status  `working` while it runs, `closed` when it was
 *   stopped, `failed` when a reload destroyed it. STOPPED and GONE were the
 *   same grey caption in the same weight: stopped is a thing you chose, gone is
 *   work a reload took, and the more alarming state may not be the quieter one.
 * @property {string} statusLabel
 * @property {string} commandLabel  which process this row IS. The predecessor
 *   shipped the whole table as one 1770px `<pre>` in a 254px rail, so this
 *   column — the only one that identifies a row — was never on screen.
 * @property {string} ageLabel
 */

/** @typedef {{rows: ReadonlyArray<ProcRow>, emptyNote: string}} ProcessesData */

/**
 * WHAT IS RUNNING, AND FOR HOW LONG (`GET /processes`).
 *
 * A person watching an agent work should not have to ask it what it started.
 * What this shows is what the AGENT was told: the same listing, through the
 * same gate, recorded as the same fact — so the pane and the model can never
 * disagree about which processes exist (I8).
 *
 * @param {{data: ProcessesData}} props
 */
export function Processes({ data }) {
  return (
    <Panel caption="Left running in the folder">
      {data.rows.length === 0 ? <Empty note={data.emptyNote} /> : (
        <ul className={s.rows}>
          {data.rows.map((row) => (
            <li key={row.id} className={s.row} data-status={row.status}>
              <span className={s.name}>{row.name}</span>
              <Badge status={row.status} label={row.statusLabel} />
              <span className={s.machine}>{row.commandLabel}</span>
              <span className={s.meta}>{row.ageLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
