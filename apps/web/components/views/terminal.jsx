import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Run
 * @property {string} id
 * @property {string} command
 * @property {string} output
 * @property {string} status      `ok` · `failed` · `working`
 * @property {string} statusLabel and for one still going, its AGE — `Running…`
 *   read the same at four seconds and at seven minutes, which is the fact this
 *   pane was missing. The core measures it; nothing here reads a clock.
 */

/**
 * @typedef {object} TerminalData
 * @property {string} whereLabel   whose folder a command typed here would run in
 * @property {ReadonlyArray<Run>} runs
 * @property {string} emptyNote
 * @property {string} refusedLabel why the box cannot take a command, '' when it can
 */

/**
 * THE COMMAND HISTORY AND WHAT IS IN FLIGHT (`GET /terminal`).
 *
 * The prompt itself is not here. A box that runs in a folder it does not name
 * is the defect this pane was built around — with anyone but this page's own
 * agent selected it was main's shell wearing another agent's label — so the
 * control arrives with the seam that can refuse it, and until then the pane
 * says whose folder this is and why nothing can be typed.
 *
 * A shell row scrolls sideways rather than wrapping: the columns of `ls -la`
 * are the content (DESIGN.md §8, Machine output). Every other block of tool
 * output in this product wraps, and that is two components with two rules
 * rather than one component with two.
 *
 * @param {{data: TerminalData}} props
 */
export function Terminal({ data }) {
  return (
    <Panel caption={data.whereLabel}>
      {data.runs.length === 0 ? <Empty note={data.emptyNote} /> : (
        <ul className={s.rows}>
          {data.runs.map((run) => (
            <li key={run.id} className={s.row} data-status={run.status}>
              <span className={s.machine}>{run.command}</span>
              <Badge status={run.status} label={run.statusLabel} />
              <pre className={`${s.shell} ${s.machine}`}>{run.output}</pre>
            </li>
          ))}
        </ul>
      )}
      {data.refusedLabel ? <p className={s.meta}>{data.refusedLabel}</p> : null}
    </Panel>
  )
}
