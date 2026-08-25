import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Said
 * @property {string} id       stable across polls, so the VDOM can key the row
 * @property {'user'|'assistant'|'tool'|'pending'|'error'} kind
 * @property {string} speaker  WHO, in words. Every row is labelled: the one row
 *                             that was not — the page's own compaction note —
 *                             read as an unattributed aside in a column where
 *                             everything else says who is talking.
 * @property {string} said
 */

/**
 * @typedef {object} ChatData
 * @property {string} agent
 * @property {string} stageLabel    which loop this turn is running, and how far in
 * @property {ReadonlyArray<Said>} messages
 * @property {string} emptyNote
 * @property {string} waitingLabel  what the turn is waiting on, '' when nothing is
 * @property {string} waitingStatus the machine field behind that wait
 */

/**
 * ONE AGENT'S TRANSCRIPT, ITS STAGE, AND WHAT IT IS WAITING ON (`GET /chat`).
 *
 * Five classes, THREE treatments — speech, machinery, failure — and the
 * grouping is done in the stylesheet's selector rather than here, because
 * deciding that `tool` and `pending` look alike is a derivation and the
 * interface may not make one (I5). Five consecutive rows once carried five
 * different boxes and a reader had to learn five things to read one column.
 *
 * The composer is not here. It is the one control that starts a turn and it
 * arrives with the seam wired; a text box that cannot send is a control that
 * lies about what pressing it does.
 *
 * `said` is a text child, so JSX escapes it. That is the whole reason markdown
 * is parsed into typed nodes in `packages/context` — a model cannot inject
 * markup into the page it is talking to, structurally rather than by sanitizer.
 *
 * @param {{data: ChatData}} props
 */
export function Chat({ data }) {
  return (
    <Panel caption={data.stageLabel}>
      {data.messages.length === 0 ? <Empty note={data.emptyNote} /> : (
        <div className={s.stack}>
          {data.messages.map((row) => (
            <div key={row.id} className={s.msg} data-kind={row.kind}>
              <span className={s.speaker}>{row.speaker}</span>
              <p className={s.said}>{row.said}</p>
            </div>
          ))}
        </div>
      )}
      {data.waitingLabel ? <Badge status={data.waitingStatus} label={data.waitingLabel} /> : null}
    </Panel>
  )
}
