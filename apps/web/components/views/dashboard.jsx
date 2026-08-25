import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import { Tiles } from './tiles'
import s from './views.module.css'

/**
 * @typedef {object} RosterRow
 * @property {string} name
 * @property {string} status       the machine field: idle · starting · waiting · working · failed · closed
 * @property {string} statusLabel  the same fact in words, and the primary channel
 * @property {string} detail       why it is in that state, or what it is doing
 */

/**
 * @typedef {object} DashboardData
 * @property {import('./tiles').TilesData} tiles
 * @property {ReadonlyArray<RosterRow>} roster
 * @property {string} rosterEmptyNote
 * @property {string} runningLabel  what is running, in words — never a count taken here
 */

/**
 * EVERY PANE'S TILE, THE ROSTER, AND WHAT IS RUNNING (`GET /`).
 *
 * The roster arrives in the order the core sends it. The interface does not
 * sort it: order is a fact the log is the authority on, and a pane that
 * re-orders what it was handed is a pane that disagrees with the history a
 * person is reading beside it (I5, I8).
 *
 * @param {{data: DashboardData}} props
 */
export function Dashboard({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption="At a glance">
        <Tiles data={data.tiles} />
        <p className={s.meta}>{data.runningLabel}</p>
      </Panel>
      <Panel caption="Every agent">
        {data.roster.length === 0 ? <Empty note={data.rosterEmptyNote} /> : (
          <ul className={s.rows}>
            {data.roster.map((row) => (
              <li key={row.name} className={s.row} data-status={row.status}>
                <span className={s.name}>{row.name}</span>
                <Badge status={row.status} label={row.statusLabel} />
                <span className={s.meta}>{row.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
