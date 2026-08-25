import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import { Problem } from './problem'
import s from './views.module.css'

/**
 * @typedef {object} AgentCard
 * @property {string} name
 * @property {string} status
 * @property {string} statusLabel
 * @property {string} fileLabel   the file it was read from
 * @property {string} modelLabel  the key its file names
 * @property {string} resolvesLabel  WHAT THAT KEY REALLY REACHES, asked of the
 *   port that will make the call. Empty when this build's port has no
 *   catalogue — then the card says the file's own words and no more, which is
 *   the one thing it must never invent.
 */

/**
 * @typedef {object} AgentsData
 * @property {ReadonlyArray<AgentCard>} entries
 * @property {ReadonlyArray<import('./problem').ProblemData>} problems  what failed to load
 * @property {string} emptyNote
 */

/**
 * EVERY AGENT, ITS FILE, ITS MODEL, AND WHAT FAILED TO LOAD (`GET /agents`).
 *
 * The failures are the seam's `problem` shape and not loose sentences. The
 * predecessor rendered `Skipped — {reason}` as a red paragraph, which is a
 * failure with no kind, no repair and nothing for the debug view to read.
 *
 * @param {{data: AgentsData}} props
 */
export function Agents({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption="Loaded from the manifest">
        {data.entries.length === 0 ? <Empty note={data.emptyNote} /> : (
          <ul className={s.rows}>
            {data.entries.map((card) => (
              <li key={card.name} className={s.row} data-status={card.status}>
                <span className={s.name}>{card.name}</span>
                <Badge status={card.status} label={card.statusLabel} />
                <span className={s.machine}>{card.fileLabel}</span>
                <span className={s.meta}>{card.modelLabel}</span>
                {card.resolvesLabel ? <span className={s.machine}>{card.resolvesLabel}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data.problems.map((problem) => (
        <Problem key={problem.detail} data={problem} placement="banner" />
      ))}
    </div>
  )
}
