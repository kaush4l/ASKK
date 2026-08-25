import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import { Problem } from './problem'
import s from './views.module.css'

/**
 * @typedef {object} AgentCard one agent, as `GET /agents` words it.
 * @property {string} id
 * @property {string} name
 * @property {string} path         the file it was read from
 * @property {string} originLabel  written here, or shipped with this build
 * @property {string} modelLabel   the key its file names, or the catalogue's default
 * @property {string} toolsLabel   what it may call, in words
 * @property {boolean} isMe        whether this page's own turns run as this agent
 */

/**
 * @typedef {object} AgentsData
 * @property {ReadonlyArray<AgentCard>} rows
 * @property {ReadonlyArray<import('./problem').ProblemData>} refusals  files that would not load
 * @property {string} emptyNote
 */

/**
 * EVERY AGENT, ITS FILE, ITS MODEL, AND WHAT FAILED TO LOAD (`GET /agents`).
 *
 * The failures are the seam's `problem` shape and not loose sentences. The
 * predecessor rendered `Skipped — {reason}` as a red paragraph, which is a
 * failure with no kind, no repair and nothing for the debug view to read — and
 * they are keyed on `id`, because two agents missing from one manifest is two
 * 404s with identical prose (docs/SEAM.md).
 *
 * WHERE AN AGENT'S CALLS ACTUALLY GO IS SETUP'S SENTENCE AND NOT THIS PANE'S.
 * `modelLabel` is what the FILE asks for; which endpoint answers it is a fact
 * about this browser's catalogue, and inventing a resolution here would be the
 * roster and Setup wording one fact twice (I5). Filed for the SPINE lane.
 *
 * @param {{data: AgentsData}} props
 */
export function Agents({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption="Loaded in this browser">
        {data.rows.length === 0 ? <Empty note={data.emptyNote} /> : (
          <ul className={s.rows}>
            {data.rows.map((card) => (
              // `data-me` and not a word: which agent this page runs as is
              // already the plate at the top of the screen, and a second
              // sentence for it is a second voice for one fact.
              <li key={card.id} className={s.row} data-me={String(card.isMe)}>
                <span className={s.name}>{card.name}</span>
                <span className={s.meta}>{card.originLabel}</span>
                <span className={s.machine}>{card.path}</span>
                <span className={s.meta}>{card.modelLabel}</span>
                <span className={s.meta}>{card.toolsLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data.refusals.map((refusal) => (
        <Problem key={refusal.id} data={refusal} subject={refusal.id} placement="banner" />
      ))}
    </div>
  )
}
