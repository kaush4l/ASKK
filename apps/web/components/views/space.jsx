import { Empty } from '@/components/ui/empty'
import { Facts } from '@/components/ui/facts'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Note
 * @property {string} id
 * @property {string} author  MARKED UP, not four characters inside the
 *   sentence. The stored line is `[main] …` because that is what the model must
 *   read in its prompt; a person scanning a column of them could not find who
 *   wrote what. The core splits it, because splitting it here would be the
 *   interface parsing a projection.
 * @property {string} said
 */

/**
 * @typedef {object} SpaceData
 * @property {string} spaceLabel  which space, and who else works in it
 * @property {string} pathLabel   the folder, and whether a reload keeps it
 * @property {ReadonlyArray<{key: string, value: string}>} facts
 * @property {string} factsEmptyNote
 * @property {ReadonlyArray<Note>} notes
 * @property {string} notesEmptyNote
 * @property {string} note        how the space is read, in the pane's own voice
 */

/**
 * THE SHARED SPACE'S CONTENTS (`GET /space`).
 *
 * Facts are settled key/value pairs; notes are a noticeboard in log order.
 * Neither is sorted or counted here — the core sends both in the order they are
 * to be read, and the newest-N rule is the core's (I5).
 *
 * @param {{data: SpaceData}} props
 */
export function Space({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption="Where this agent works">
        <p>{data.spaceLabel}</p>
        <p className={s.machine}>{data.pathLabel}</p>
      </Panel>
      <Panel caption="Shared facts">
        {data.facts.length === 0
          ? <Empty note={data.factsEmptyNote} />
          : <Facts label="Shared facts" facts={data.facts} />}
      </Panel>
      <Panel caption="Recent notes">
        {data.notes.length === 0 ? <Empty note={data.notesEmptyNote} /> : (
          <ul className={s.rows}>
            {data.notes.map((note) => (
              <li key={note.id} className={s.row} data-author={note.author}>
                <span className={s.speaker}>{note.author}</span>
                <p className={s.said}>{note.said}</p>
              </li>
            ))}
          </ul>
        )}
        <p className={s.meta}>{data.note}</p>
      </Panel>
    </div>
  )
}
