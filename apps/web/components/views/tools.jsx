import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} ToolRow
 * @property {string} id
 * @property {string} name
 * @property {string} usage          the signature AND what it does, exactly as
 *   the model is shown it. It is the one string this pane renders about what a
 *   tool IS, because `description` is its tail: rendering both put the same
 *   sentence twice on a screen already 21 tools long.
 * @property {string} needsLabel     which capability it needs, in words
 * @property {boolean} resolves      whether this build has something behind it
 * @property {string} resolvesLabel  what it resolves to, or why it does not
 */

/** @typedef {{rows: ReadonlyArray<ToolRow>, emptyNote: string, resolvedLabel: string}} ToolsData */

/**
 * EVERY TOOL, ITS CAPABILITY, AND WHETHER IT RESOLVES (`GET /tools`).
 *
 * The third column is the point of the pane. A tool listed as available that
 * fails on its first call is worse than one absent from the list: the model is
 * told it can do something the build cannot do, and the turn it wastes finding
 * out is charged to the person. Default deny means the grant is the
 * intersection of what a module asked for with what this build offers (I6), and
 * this is where that intersection is legible.
 *
 * @param {{data: ToolsData}} props
 */
export function Tools({ data }) {
  return (
    <Panel caption="What this agent can actually do here">
      {data.rows.length === 0 ? <Empty note={data.emptyNote} /> : (
        <ul className={s.rows}>
          {data.rows.map((tool) => (
            // THE TONE IS CHOSEN HERE FROM A BOOLEAN THE CORE SENT, and the
            // words beside it are the core's. `resolves` is the fact; `ok` and
            // `failed` are this palette's names for the two sides of it, and
            // mapping them here is the same act as choosing a border colour.
            <li key={tool.id} className={s.row} data-status={tool.resolves ? 'ok' : 'failed'}>
              <span className={s.name}>{tool.name}</span>
              <Badge status={tool.resolves ? 'ok' : 'failed'} label={tool.resolvesLabel} />
              <span className={s.machine}>{tool.usage}</span>
              <span className={s.meta}>{tool.needsLabel}</span>
            </li>
          ))}
        </ul>
      )}
      {data.resolvedLabel ? <p className={s.meta}>{data.resolvedLabel}</p> : null}
    </Panel>
  )
}
