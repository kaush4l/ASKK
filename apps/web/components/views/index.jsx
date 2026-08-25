import { Agents } from './agents'
import { Board } from './board'
import { Chat } from './chat'
import { Dashboard } from './dashboard'
import { Debug } from './debug'
import { Files } from './files'
import { Problem, UNKNOWN_VIEW } from './problem'
import { Processes } from './processes'
import { Settings } from './settings'
import { Space } from './space'
import { Status } from './status'
import { Terminal } from './terminal'
import { Tiles } from './tiles'
import { Tools } from './tools'

/**
 * ONE COMPONENT PER VIEW NAME, AND THE MAP IS THE PROOF.
 *
 * `docs/SEAM.md` names every view the seam can return. The predecessor had no
 * such list: the core built an HTML fragment, the interface recovered its parts
 * by scanning for substrings, and control flow keyed on CSS class names — so
 * "which screens exist" was a question you answered by reading the whole tree
 * and hoping. Here it is a lookup table, `test/views.test.js` reads the route
 * table out of `docs/SEAM.md` and asserts these keys ARE that set, and a view
 * the table does not list therefore cannot be produced.
 *
 * `any` on the value type, with the reason: the seam hands the interface
 * `Response.data` as `Record<string, unknown>` and each component declares the
 * shape ITS view carries. Narrowing here would mean a second copy of all
 * fourteen shapes living in the interface, and two spellings of one shape is
 * the defect this whole increment exists to remove. The check that matters is
 * the fixture: `fixtures/` types every projection against the component's own
 * typedef, so a component and its data cannot disagree without `tsc` saying so.
 *
 * @type {Readonly<Record<string, (props: {data: any}) => React.ReactNode>>}
 */
export const VIEWS = Object.freeze({
  dashboard: Dashboard,
  tiles: Tiles,
  status: Status,
  chat: Chat,
  agents: Agents,
  board: Board,
  tools: Tools,
  space: Space,
  files: Files,
  terminal: Terminal,
  processes: Processes,
  debug: Debug,
  settings: Settings,
  problem: Problem,
})

/**
 * THE ONE PLACE A VIEW NAME BECOMES A COMPONENT.
 *
 * A name outside the table renders the problem projection with the name that
 * arrived beside it — as a VALUE, never spliced into the sentence, because the
 * interface chooses layout and never composes prose (I5). Rendering nothing
 * would be the predecessor's silent rewrite in a new place: the address that
 * named no view landed you somewhere else and no word on the page mentioned it.
 *
 * @param {{view: string, data: unknown}} props
 */
export function View({ view, data }) {
  const Component = VIEWS[view]
  if (!Component) return <Problem data={UNKNOWN_VIEW} subject={view} />
  return <Component data={data} />
}
