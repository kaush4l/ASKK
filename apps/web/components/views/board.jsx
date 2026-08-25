import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} BoardRow
 * @property {string} name
 * @property {string} status
 * @property {string} statusLabel
 * @property {string} routeLabel  which loop the strategy stage voted, and why
 * @property {string} stageLabel  the stage walk: where this turn is in it
 * @property {string} lapLabel    how long it has been in that stage, ALREADY
 *   WORDED. The number is a subtraction of two logged times in the core, never
 *   a reading taken here: `Date.now()` cannot appear in this tree (I7, I5).
 * @property {string} detail
 */

/** @typedef {{rows: ReadonlyArray<BoardRow>, emptyNote: string}} BoardData */

/**
 * EVERY AGENT'S STATUS, ROUTE, STAGE WALK AND LAP (`GET /board`).
 *
 * A projection of a fold of status facts over the log, so what the board shows
 * during a delegation and what the log says happened cannot disagree (I8).
 *
 * The predecessor learned whether anything was running by re-reading its own
 * fragment; that is why a run was invisible from every view but Chat. A pane
 * must not parse its own markup to know what it is showing — the fact is on the
 * projection now, and `statusLabel` is where it is.
 *
 * @param {{data: BoardData}} props
 */
export function Board({ data }) {
  if (data.rows.length === 0) {
    return <Panel caption="What everything is doing"><Empty note={data.emptyNote} /></Panel>
  }
  return (
    <Panel caption="What everything is doing">
      <ul className={s.rows}>
        {data.rows.map((row) => (
          <li key={row.name} className={s.row} data-status={row.status}>
            <span className={s.name}>{row.name}</span>
            <Badge status={row.status} label={row.statusLabel} />
            <span className={s.meta}>{row.routeLabel}</span>
            <span className={s.meta}>{row.stageLabel}</span>
            <span className={s.machine}>{row.lapLabel}</span>
            <span className={s.meta}>{row.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
