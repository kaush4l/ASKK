import { Empty } from '@/components/ui/empty'
import s from './views.module.css'

/**
 * @typedef {object} Tile
 * @property {string} id     the pane this tile is about
 * @property {string} label  the eyebrow, already worded
 * @property {string} value  the number or state, ALREADY WORDED — the core
 *                           counts, the interface never does (I5)
 * @property {string} note   one line of context under the value
 */

/** @typedef {{tiles: ReadonlyArray<Tile>, emptyNote: string}} TilesData */

/**
 * THE FLEET AT A GLANCE. `GET /tiles` exists so the dashboard's strip can poll
 * on its own without re-projecting the roster underneath it — the same fold,
 * counted (`crates/core/src/board/pane.rs`), which is why both belong to the
 * module that owns the fleet's status. Two modules holding one fold is how the
 * strip and the rows below it come to disagree.
 *
 * Every `value` arrives worded. The predecessor's tile said how many agents
 * were working from its own filter, and the header below it named them from a
 * different one; the count and the names drifted the first time one of the two
 * forgot the queued state.
 *
 * @param {{data: TilesData}} props
 */
export function Tiles({ data }) {
  if (data.tiles.length === 0) return <Empty note={data.emptyNote} />
  return (
    <ul className={s.tiles}>
      {data.tiles.map((tile) => (
        <li key={tile.id} className={s.tile}>
          <span className={s.tileLabel}>{tile.label}</span>
          <span className={s.tileValue}>{tile.value}</span>
          <span className={s.meta}>{tile.note}</span>
        </li>
      ))}
    </ul>
  )
}
