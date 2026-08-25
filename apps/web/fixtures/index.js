import * as run from './run'
import { chat } from './transcript'
import * as shape from './shape'
import * as workspace from './workspace'

/**
 * EVERY VIEW'S FIXTURE, UNDER ITS VIEW NAME.
 *
 * The keys are the route table's view column, exactly as
 * `components/views/index.jsx` is, and `test/views.test.js` asserts the three
 * sets agree — the registry, the fixtures and `docs/SEAM.md`. A view with a
 * component and no fixture is a state nobody can look at before shipping it,
 * which is how the predecessor's gallery came to be missing six of the
 * components it claimed to hold.
 *
 * `unknown` values, deliberately: `View` takes the seam's `data` as `unknown`
 * and each component narrows to the shape its own typedef declares. The typing
 * that matters happened where each fixture was written.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
export const FIXTURES = Object.freeze({
  dashboard: run.dashboard,
  tiles: run.tiles,
  status: shape.status,
  chat,
  agents: shape.agents,
  board: run.board,
  tools: shape.tools,
  space: workspace.space,
  files: workspace.files,
  terminal: workspace.terminal,
  processes: workspace.processes,
  debug: workspace.debug,
  settings: shape.settings,
  problem: shape.problem,
})

/** The same views, holding nothing — the state `Empty` is for (`fixtures/empty.js`). */
export { EMPTY } from './empty'
