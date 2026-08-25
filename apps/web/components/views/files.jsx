import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Entry
 * @property {string} name
 * @property {string} kind       `folder` or `file` — the LISTING said which (a
 *   trailing slash from `ls -1Ap`), so nothing guesses it from the name. `ls`
 *   on a file succeeds and prints it, which is how "list, and read if the
 *   listing failed" opened nothing and re-listed everything.
 * @property {string} meta
 */

/**
 * @typedef {object} OpenFile
 * @property {string} pathLabel
 * @property {string} stateLabel  Reading or Editing — a machine RECORD opens
 *   read-only, because a process's captured output opened in a live textarea
 *   under a Save button meant one keystroke overwrote a running process's log.
 * @property {string} contents
 */

/**
 * @typedef {object} FilesData
 * @property {string} atLabel   which folder this is, in the pane's own words —
 *   never `.`, which is the shell's name for it and the one piece of raw shell
 *   that used to reach a person's sentences
 * @property {ReadonlyArray<Entry>} entries
 * @property {string} emptyNote
 * @property {OpenFile | null} open
 */

/**
 * ONE DIRECTORY OF THE WORKSPACE, AND ONE FILE IN IT (`GET /files`).
 *
 * @param {{data: FilesData}} props
 */
export function Files({ data }) {
  return (
    <div className={s.stack}>
      <Panel caption={data.atLabel}>
        {data.entries.length === 0 ? <Empty note={data.emptyNote} /> : (
          <ul className={s.rows}>
            {data.entries.map((entry) => (
              <li key={entry.name} className={s.row} data-kind={entry.kind}>
                <span className={s.machine}>{entry.name}</span>
                <span className={s.meta}>{entry.meta}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data.open ? (
        <Panel caption={data.open.stateLabel}>
          <p className={s.machine}>{data.open.pathLabel}</p>
          <pre className={s.said}>{data.open.contents}</pre>
        </Panel>
      ) : null}
    </div>
  )
}
