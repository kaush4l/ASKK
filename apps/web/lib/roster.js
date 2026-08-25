/**
 * THE FLEET, AND WHAT THIS SCREEN SAYS WHEN IT CANNOT DRAW IT.
 *
 * `GET /` projects `rows` — one already-worded card per agent, in log order.
 * This screen draws GROUPS, because the only question a roster answers at a
 * glance is which agent needs a person, and a band that only that group can
 * fill is what puts it above the fold however many agents exist
 * (`components/views/dashboard.jsx`).
 *
 * THE INTERFACE MAY NOT MAKE THE GROUPS. Which state an agent is in is a fold
 * of the log, and a pane that groups what it was handed can disagree with the
 * transcript beside it (I5, I8). So this states the disagreement in the one
 * failure shape and lets the rest of the screen render — a build that serves
 * `/chat` and not a roster this screen can draw is still a build a person can
 * work in, and the previous shape took the whole page down with a TypeError
 * mid-render instead.
 *
 * DELETE THIS the day `GET /` projects groups.
 */

import { problem } from '@harness/kernel'

/** @typedef {import('@harness/kernel').Response} Response */

/**
 * @param {Response} response as `GET /` answered
 * @returns {Response} the same response where this screen can draw it
 */
export function drawable(response) {
  if (response.view !== 'dashboard') return response
  const data = response.data
  if (Array.isArray(data.groups) && typeof data.rosterEmptyNote === 'string') return response
  return problem(500, 'The core projected the fleet in a shape this screen cannot draw.', {
    id: 'dashboard', kind: 'projection_mismatch',
    detail: 'GET / answered with a flat `rows` list and no `groups`. Which agents are waiting on a person is a fold of the log, so this screen cannot form the groups itself without disagreeing with the transcript beside it.',
    repair: 'Nothing you can do from this page — the log is intact and the transcript below is live.',
  })
}
