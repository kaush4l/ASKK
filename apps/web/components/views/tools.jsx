import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/empty'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} ToolRow
 * @property {string} name
 * @property {string} capabilityLabel  which capability it needs, in words
 * @property {string} status           `ok` when it resolves, `failed` when it does not
 * @property {string} resolvesLabel    what it resolves TO, or why it does not
 */

/** @typedef {{tools: ReadonlyArray<ToolRow>, emptyNote: string}} ToolsData */

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
    <Panel caption="What an agent can actually do here">
      {data.tools.length === 0 ? <Empty note={data.emptyNote} /> : (
        <ul className={s.rows}>
          {data.tools.map((tool) => (
            <li key={tool.name} className={s.row} data-status={tool.status}>
              <span className={s.name}>{tool.name}</span>
              <Badge status={tool.status} label={tool.resolvesLabel} />
              <span className={s.meta}>{tool.capabilityLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
