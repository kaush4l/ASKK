/**
 * ONE REALISTIC PROJECTION PER VIEW — the run's four (docs/SEAM.md: dashboard,
 * tiles, chat, board).
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
    { id: 'board', label: 'Working', value: '2 of 4', note: 'scout and critic are inside a turn' },
    { id: 'chat', label: 'Waiting on you', value: 'critic', note: 'asked a question 3 minutes ago' },
    { id: 'processes', label: 'Running', value: '1 process', note: 'ticker, started 12 minutes ago' },
    { id: 'debug', label: 'Spent on this page', value: '41,206 tokens', note: 'across 9 turns' },
  ],
}

/** @type {import('@/components/views/dashboard').DashboardData} */
export const dashboard = {
  tiles,
  runningLabel: 'scout and critic are inside a turn; main and archivist are idle.',
  rosterEmptyNote:
    'No agents are loaded. public/agents/index.json is the manifest — an agent folder that is not listed there is never fetched.',
  roster: [
    { name: 'main', status: 'idle', statusLabel: 'Idle', detail: 'Last answered 6 minutes ago.' },
    { name: 'scout', status: 'working', statusLabel: 'Working — inside a turn', detail: 'Reading three search results.' },
    { name: 'critic', status: 'waiting', statusLabel: 'Waiting on you', detail: 'Asked whether to keep the old wording.' },
    { name: 'archivist', status: 'failed', statusLabel: 'Failed', detail: 'The endpoint refused the last call: 401.' },
  ],
}

/** @type {import('@/components/views/chat').ChatData} */
export const chat = {
  agent: 'scout',
  stageLabel: 'scout · work stage, 2 of 4',
  emptyNote: 'Nothing has been said to scout yet. What you type starts a turn.',
  waitingLabel: 'Working — 14 seconds in this call',
  waitingStatus: 'working',
  messages: [
    { id: 'm1', kind: 'user', speaker: 'You', said: 'Find out whether Firecrawl still answers without a key.' },
    { id: 'm2', kind: 'assistant', speaker: 'scout', said: 'I will search, then read the two most recent results.' },
    { id: 'm3', kind: 'tool', speaker: 'scout ran web_search', said: 'query="firecrawl keyless CORS" — 8 results' },
    { id: 'm4', kind: 'error', speaker: 'Note:', said: 'The second fetch was refused by the browser: no access-control-allow-origin on the response.' },
    { id: 'm5', kind: 'pending', speaker: 'scout is calling read_page', said: 'url="https://firecrawl.dev/docs"' },
  ],
}

/** @type {import('@/components/views/board').BoardData} */
export const board = {
  emptyNote: 'No agents are loaded, so there is nothing running.',
  rows: [
    {
      name: 'scout', status: 'working', statusLabel: 'Working — inside a turn',
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
      name: 'main', status: 'idle', statusLabel: 'Idle',
      routeLabel: 'No route yet — it has not been asked anything since the reload',
      stageLabel: 'No stage', lapLabel: 'Idle for 6m 02s',
      detail: 'Last answered 6 minutes ago.',
    },
  ],
}
