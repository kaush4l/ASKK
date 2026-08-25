/**
 * ONE REALISTIC PROJECTION PER VIEW — the run's three (docs/SEAM.md: dashboard,
 * tiles, board). The transcript is `fixtures/transcript.js`.
 *
 * NOTHING HERE IS TRUE, and every value is shaped exactly like what the seam
 * will hand the component, so `/design-system/` renders a state a critic can
 * reject without running an agent. They are typed against each component's own
 * typedef, which is what makes them a check and not decoration: change a shape
 * in one place and `tsc` names the other.
 *
 * The wordings are deliberately the ones the core owes the interface — a lap,
 * a count, a plural, a status in words — because a fixture that leaves them out
 * would let a component quietly start composing them.
 */

/** @type {import('@/components/views/tiles').TilesData} */
export const tiles = {
  emptyNote: 'No agents are loaded, so there is nothing to show at a glance.',
  tiles: [
    { id: 'board', label: 'Working', value: '2 of 6', note: 'main and indexer are inside a turn' },
    { id: 'chat', label: 'Waiting on you', value: 'critic', note: 'asked a question 3 minutes ago' },
    { id: 'processes', label: 'Running', value: '1 process', note: 'ticker, started 12 minutes ago' },
    { id: 'debug', label: 'Spent on this page', value: '41,206 tokens', note: 'across 9 turns' },
  ],
}

/**
 * @type {import('@/components/views/dashboard').DashboardData}
 *
 * FOUR GROUPS, AND THE ONE THAT NEEDS A PERSON IS FIRST BY CONSTRUCTION rather
 * than by arriving first: `Dashboard` gives the `waiting` group its own slot at
 * the top of the screen, so this array's order is not what puts it there. Six
 * statuses appear between the six rows, which is every state this product draws
 * a shape for (`ui/glyph.jsx`) — the roster is where they are all visible at
 * once, and where a greyscale screenshot is judged.
 */
export const dashboard = {
  tiles,
  runningLabel: 'main and indexer are inside a turn; scout and compactor are not running.',
  rosterEmptyNote:
    'No agents are loaded. public/agents/index.json is the manifest — an agent folder that is not listed there is never fetched.',
  groups: [
    {
      id: 'waiting',
      label: 'Needs you — 1 agent',
      rows: [{ name: 'critic', status: 'waiting', statusLabel: 'Waiting on you', detail: 'Asked whether to keep the old wording.' }],
    },
    {
      id: 'live',
      label: 'Working — 2 agents',
      rows: [
        { name: 'main', status: 'working', statusLabel: 'Working — inside a turn', detail: 'Reading three search results.' },
        { name: 'indexer', status: 'starting', statusLabel: 'Starting', detail: 'Its file is being read.' },
      ],
    },
    {
      id: 'failed',
      label: 'Failed — 1 agent',
      rows: [{ name: 'archivist', status: 'failed', statusLabel: 'Failed', detail: 'The endpoint refused the last call: 401.' }],
    },
    {
      id: 'resting',
      label: 'Not running — 2 agents',
      rows: [
        { name: 'scout', status: 'idle', statusLabel: 'Idle', detail: 'Last answered 6 minutes ago.' },
        { name: 'compactor', status: 'closed', statusLabel: 'Stopped — you ended its run', detail: 'Ran for 4 minutes.' },
      ],
    },
  ],
}

/** @type {import('@/components/views/board').BoardData} */
export const board = {
  emptyNote: 'No agents are loaded, so there is nothing running.',
  rows: [
    {
      name: 'main', status: 'working', statusLabel: 'Working — inside a turn',
      routeLabel: 'Route: react — the question needs a lookup, not an answer',
      stageLabel: 'Stage: work, 2 of 4', lapLabel: '14s in this stage',
      detail: 'Second tool call of this turn.',
    },
    {
      name: 'critic', status: 'waiting', statusLabel: 'Waiting on you',
      routeLabel: 'Route: answer — nothing to look up',
      stageLabel: 'Stage: critique, 4 of 4', lapLabel: '3m 12s in this stage',
      detail: 'Asked whether to keep the old wording.',
    },
    {
      name: 'archivist', status: 'failed', statusLabel: 'Failed',
      routeLabel: 'Route: react — chosen before the call failed',
      stageLabel: 'Stage: work, 2 of 4', lapLabel: '1m 40s since it failed',
      detail: 'The endpoint refused the last call: 401.',
    },
    {
      name: 'scout', status: 'idle', statusLabel: 'Idle',
      routeLabel: 'No route yet — it has not been asked anything since the reload',
      stageLabel: 'No stage', lapLabel: 'Idle for 6m 02s',
      detail: 'Last answered 6 minutes ago.',
    },
  ],
}
