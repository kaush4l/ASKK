import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import { Tiles } from './tiles'
import s from './views.module.css'

/**
 * @typedef {object} RosterRow
 * @property {string} name
 * @property {string} status       the machine field, from the kernel's closed
 *   vocabulary: idle · thinking · calling · waiting · failed · stopped
 * @property {string} statusLabel  the same fact in words, and the primary channel
 * @property {string} detail       why it is in that state, or what it is doing
 */

/**
 * @typedef {object} RosterGroup agents that are in the same state, grouped by
 *   the core. The interface never forms a group: which state an agent is in is
 *   a fold of the log, and a pane that groups what it was handed is a pane that
 *   can disagree with the history beside it (I5, I8).
 * @property {string} id     the state this group is about
 * @property {string} label  what to call it, already worded and already counted
 * @property {ReadonlyArray<RosterRow>} rows
 */

/**
 * @typedef {object} DashboardData
 * @property {import('./tiles').TilesData} tiles
 * @property {ReadonlyArray<RosterGroup>} groups
 * @property {string} rosterEmptyNote
 * @property {string} runningLabel  what is running, in words — never a count taken here
 */

/**
 * THE GROUP THAT GETS THE TOP OF THE SCREEN. It is a slot in the layout, and
 * only this group can fill it, so "which agent needs me" is above the fold
 * however many agents exist and whatever order they arrive in.
 */
export const NEEDS_YOU = 'waiting'

/**
 * WHICH ONE NEEDS ME — the only question a roster answers at a glance.
 *
 * The predecessor's roster was one flat list in log order, so the agent waiting
 * on an answer sat wherever it happened to be and a person read four rows to
 * find it. Sorting is not the fix: order is a fact the log owns, and a pane
 * that re-orders what it was handed disagrees with the transcript beside it.
 * BY CONSTRUCTION is the fix — the core groups by state and the group that
 * needs a person has its own place at the top of the screen.
 *
 * The four parts are exported separately because a SCREEN composes them in its
 * own order: the Work screen puts the attention band above the transcript and
 * the rest of the fleet below it, which is the whole difference between a
 * control surface and a list of panels (`components/work/work.jsx`).
 *
 * @param {{data: DashboardData}} props
 */
export function Dashboard({ data }) {
  return (
    <div className={s.stack}>
      <Attention data={data} />
      <Glance data={data} />
      <Fleet data={data} />
    </div>
  )
}

/**
 * THE BAND AT THE TOP OF THE WORK SCREEN, and the only group that can fill it.
 * Absent when nobody is waiting: a band that says "nobody needs you" is a row
 * of furniture between a person and the thing they came to do.
 * @param {{data: DashboardData}} props
 */
export function Attention({ data }) {
  const needsYou = data.groups.find((group) => group.id === NEEDS_YOU)
  if (!needsYou) return null
  return <Panel caption={needsYou.label} status={NEEDS_YOU}><Roster rows={needsYou.rows} /></Panel>
}

/** The fleet as four numbers. @param {{data: DashboardData}} props */
export function Glance({ data }) {
  return (
    <Panel caption="At a glance">
      <Tiles data={data.tiles} />
      <p className={s.meta}>{data.runningLabel}</p>
    </Panel>
  )
}

/**
 * Every other group, in the order the core sent them.
 * @param {{data: DashboardData}} props
 */
export function Fleet({ data }) {
  if (data.groups.length === 0) {
    return <Panel caption="Every agent"><Empty note={data.rosterEmptyNote} /></Panel>
  }
  return data.groups.filter((group) => group.id !== NEEDS_YOU).map((group) => (
    <Panel key={group.id} caption={group.label}><Roster rows={group.rows} /></Panel>
  ))
}

/** @param {{rows: ReadonlyArray<RosterRow>}} props */
function Roster({ rows }) {
  return (
    <ul className={s.rows}>
      {rows.map((row) => (
        <li key={row.name} className={s.row} data-status={row.status}>
          <span className={s.name}>{row.name}</span>
          <Badge status={row.status} label={row.statusLabel} />
          <span className={s.meta}>{row.detail}</span>
        </li>
      ))}
    </ul>
  )
}
