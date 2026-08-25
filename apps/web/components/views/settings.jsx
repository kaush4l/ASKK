import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Endpoint
 * @property {string} id
 * @property {string} name
 * @property {string} addressLabel   where a turn is sent
 * @property {string} keyLabel       WHETHER a key is set, never the key. `GET
 *   /settings` projects the catalogue through the seam and `handle` records a
 *   fact for every request, so a credential must never be in either — the
 *   broker has its own door for exactly this (I6, docs/SEAM.md).
 * @property {string} status         `ok` when the address resolves
 * @property {string} resolvesLabel  what it resolves to, or why it does not
 */

/** @typedef {{entries: ReadonlyArray<Endpoint>, emptyNote: string, note: string}} SettingsData */

/**
 * THE ENDPOINT CATALOGUE AND WHAT IT RESOLVES TO (`GET /settings`).
 *
 * Read-only until the seam is wired. The form belongs with the broker call that
 * saves a key, and a field a person types a credential into that goes nowhere
 * is the worst control this product could ship.
 *
 * @param {{data: SettingsData}} props
 */
export function Settings({ data }) {
  return (
    <Panel caption="Where turns are sent">
      {data.entries.length === 0 ? <Empty note={data.emptyNote} /> : (
        <ul className={s.rows}>
          {data.entries.map((entry) => (
            <li key={entry.id} className={s.row} data-status={entry.status}>
              <span className={s.name}>{entry.name}</span>
              <Badge status={entry.status} label={entry.resolvesLabel} />
              <span className={s.machine}>{entry.addressLabel}</span>
              <span className={s.meta}>{entry.keyLabel}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.meta}>{data.note}</p>
    </Panel>
  )
}
