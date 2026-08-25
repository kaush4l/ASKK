import { Badge } from '@/components/ui/badge'
import { Composer } from '@/components/ui/composer'
import { Empty } from '@/components/ui/empty'
import { Inspector } from '@/components/ui/inspector'
import { Markdown } from '@/components/ui/markdown'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Said one turn somebody took.
 * @property {string} id       stable across polls, so the VDOM can key the row
 * @property {'said'} row
 * @property {string} kind  what the row IS, stamped as a data attribute. Open
 *   rather than a union because the core's vocabulary is the core's: it words
 *   `tool` and `attachment` rows too, and a union here would make a row this
 *   pane can draw perfectly well into a type error in the lane that sends it.
 * @property {string} speaker  WHO, in words, and '' only on a failure — naming
 *   an agent as the speaker of "the endpoint could not be reached" attributes
 *   the failure to it (DESIGN.md §8, Message).
 * @property {ReadonlyArray<import('@/components/ui/markdown').Block>} blocks
 */

/**
 * @typedef {object} ChatData
 * @property {string} agent
 * @property {string} stageLabel    which loop this turn is running, and how far in
 * @property {ReadonlyArray<Said | import('@/components/ui/inspector').CallData>} rows
 * @property {string} emptyNote
 * @property {string} waitingLabel  what the turn is waiting on, '' when nothing is
 * @property {string} waitingStatus the machine field behind that wait
 * @property {import('@/components/ui/composer').ComposerData} composer
 */

/**
 * ONE AGENT'S TRANSCRIPT: A PERSON'S TURN, AN AGENT'S TURN, AND BETWEEN THEM
 * THE WORK (`GET /chat`).
 *
 * The work is not a message and this is the increment that stopped pretending
 * it was. A tool call used to be a fifth kind of speech bubble carrying a line
 * of arguments as prose; it is a four-state inspector now, one line while it
 * runs and open when it has something to read (`ui/inspector.jsx`).
 *
 * A reply is a TREE, not a string. `blocks` are typed nodes the core parsed,
 * and `ui/markdown.jsx` turns each one into an element — which is why a model
 * cannot inject markup into the page it is talking to, structurally rather than
 * by sanitizer (STATUS.md, ruling 6).
 *
 * @param {{data: ChatData, onSend?: (text: string) => void}} props `onSend` is
 *   absent wherever nothing is listening — the gallery, and every pane that is
 *   showing a transcript rather than driving one — and the composer states that
 *   for itself rather than sitting disabled with no reason given.
 */
export function Chat({ data, onSend }) {
  return (
    <div className={s.stack}>
      <Panel caption={data.stageLabel}>
        {data.rows.length === 0 ? <Empty note={data.emptyNote} /> : (
          <div className={s.stack}>
            {data.rows.map((row) => (
              row.row === 'call'
                ? <Inspector key={row.id} data={row} />
                : <Said key={row.id} said={row} />
            ))}
          </div>
        )}
        {data.waitingLabel ? <Badge status={data.waitingStatus} label={data.waitingLabel} /> : null}
      </Panel>
      <Composer data={data.composer} onSend={onSend} />
    </div>
  )
}

/** @param {{said: Said}} props */
function Said({ said }) {
  return (
    <div className={s.msg} data-row={said.row} data-kind={said.kind}>
      {said.speaker ? <span className={s.speaker}>{said.speaker}</span> : null}
      <Markdown blocks={said.blocks} />
    </div>
  )
}
