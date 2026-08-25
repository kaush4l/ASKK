import * as run from './run'
import * as shape from './shape'
import * as workspace from './workspace'

/**
 * EVERY VIEW HOLDING NOTHING — the state `components/ui/empty.jsx` exists for,
 * and until now the one state the gallery could not show. Thirteen `emptyNote`
 * sentences shipped and not one of them had ever been on a screen: every list
 * in `fixtures/` is populated, so `Empty` was a component in the design system
 * with no specimen and the words in it were nobody's to reject.
 *
 * Each entry is its populated sibling with the lists emptied, so every other
 * string is the SAME string — the specimen differs from the one above it in
 * exactly the way the state does, and the note that renders is the note the
 * projection really carries.
 *
 * Two of them carry a second empty, because the distinction is the whole
 * argument of `empty.jsx` and it cannot be judged from one specimen: a folder
 * that a reload emptied does not say what one that never held a file says, and
 * neither does a folder whose processes a reload destroyed.
 *
 * @type {Readonly<Record<string, ReadonlyArray<unknown>>>}
 */
export const EMPTY = Object.freeze({
  dashboard: [{ ...run.dashboard, roster: [], tiles: { ...run.tiles, tiles: [] } }],
  tiles: [{ ...run.tiles, tiles: [] }],
  // A transcript with nothing in it is also waiting on nothing: leaving the
  // badge would draw a turn that is not running.
  chat: [{ ...run.chat, messages: [], waitingLabel: '', waitingStatus: '' }],
  agents: [{ ...shape.agents, entries: [], problems: [] }],
  board: [{ ...run.board, rows: [] }],
  tools: [{ ...shape.tools, tools: [] }],
  settings: [{ ...shape.settings, entries: [] }],
  space: [{ ...workspace.space, facts: [], notes: [] }],
  files: [
    { ...workspace.files, entries: [], open: null },
    {
      ...workspace.files,
      entries: [],
      open: null,
      emptyNote: 'This folder has never held a file. Nothing an agent wrote is missing from it.',
    },
  ],
  // `refusedLabel` is the other branch nothing had ever rendered: the box is
  // absent until the seam can refuse a command, and this is the pane saying so.
  terminal: [{
    ...workspace.terminal,
    runs: [],
    refusedLabel: 'Nothing can be typed here yet — the seam that would run it, or refuse it, is not wired.',
  }],
  processes: [
    { ...workspace.processes, rows: [] },
    { ...workspace.processes, rows: [], emptyNote: 'Nothing has ever been started in this folder.' },
  ],
  debug: [{ ...workspace.debug, turns: [], counts: [{ key: 'Turns', value: '0' }] }],
})
