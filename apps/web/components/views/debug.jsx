import { Empty } from '@/components/ui/empty'
import { Facts } from '@/components/ui/facts'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Turn
 * @property {string} id
 * @property {string} headline  which turn this is and what it decided
 * @property {ReadonlyArray<{key: string, value: string}>} facts  the route the
 *   strategy stage voted and its clause, the stage entered, the Document hash
 *   each model call was sent, what it cost, and the writes that failed
 */

/**
 * @typedef {object} DebugData
 * @property {ReadonlyArray<{key: string, value: string}>} counts
 * @property {string} ownLogNote  WHETHER THIS LOG IS THE ONE THAT RAN THE
 *   TURNS. A sub-agent runs in its own Worker, so its route, stage and
 *   model-call facts are in ITS log and this one holds only what came back.
 *   The pane says so rather than drawing a turn that cost nothing (I16).
 * @property {ReadonlyArray<Turn>} turns
 * @property {string} emptyNote
 */

/**
 * THE LOG, FOLDED INTO TURNS, AS FACTS (`GET /debug`).
 *
 * It adds nothing to the log. Every fact drawn here was already being emitted
 * and persisted with zero readers, which is the whole reason this pane exists —
 * so it owns no capability, emits no event, and makes no request of anything.
 * There is nothing here to press.
 *
 * @param {{data: DebugData}} props
 */
export function Debug({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption="This log">
        <Facts facts={data.counts} />
        <p className={s.meta}>{data.ownLogNote}</p>
      </Panel>
      {data.turns.length === 0 ? <Empty note={data.emptyNote} /> : data.turns.map((turn) => (
        <Panel key={turn.id} caption={turn.headline}>
          <Facts facts={turn.facts} />
        </Panel>
      ))}
    </div>
  )
}
