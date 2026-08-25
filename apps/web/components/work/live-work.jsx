'use client'

import { useState } from 'react'

import { get, problem } from '@harness/kernel'

import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { useAgent } from '@/components/shell/use-agent'
import { useSession, useProjection } from '@/components/shell/use-session'
import { Work } from './work'

/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */

/**
 * THE WORK SCREEN, OVER THE REAL SEAM — and this is the increment where the
 * fixtures stopped reaching a page a person can open.
 *
 * Three states, and none of them asserts anything it does not know. Coming up
 * says so. A boot that did not come up says WHAT went wrong and what to do,
 * because the alternative — the predecessor's — is a full frame painted over a
 * core that never started, discovered by typing into a box that did nothing. A
 * core that is up projects, and every fact below is read from the log.
 */
export function LiveWork() {
  const session = useSession()
  const { agent } = useAgent()
  if (!session) return <Empty note="Reading this browser’s log…" />
  if (session.problem) return <View view="problem" data={session.problem} />
  return <Live session={session} agent={agent} />
}

/**
 * The hooks are in here and not above because a projection can only be read off
 * a session that exists, and a hook cannot be called conditionally. Both panes
 * re-read on the same signal: `subscribe` fires when the log has grown, and
 * that is the only signal the interface gets (docs/SEAM.md).
 *
 * @param {{session: import('@/lib/session').Session, agent: string}} props
 */
function Live({ session, agent }) {
  const roster = useProjection(session, get('/'))
  const transcript = useProjection(session, get('/chat', { 'x-agent': agent }))
  // THE ONLY STATE ON THIS SCREEN, and it is not a projection: what the seam
  // said about ONE request a person made. The transcript is still read from the
  // log — a refusal appends no message, so there would be nothing there to
  // read, and the box would empty and the page would say nothing.
  const [refused, setRefused] = useState(/** @type {ProblemData|null} */ (null))
  return (
    <>
      <Work
        roster={roster}
        transcript={renderable(transcript)}
        onSend={(text) => void session.send(agent, text).then(setRefused)}
      />
      {refused ? <View view="problem" data={refused} /> : null}
    </>
  )
}

/**
 * THE TWO LANES DISAGREE ABOUT ONE PROJECTION, AND THE SCREEN SAYS SO RATHER
 * THAN GOING WHITE.
 *
 * `packages/core/src/chat.js` projects `messages`, each row a `said` STRING,
 * and no composer. This interface renders `rows` of TYPED BLOCKS and a
 * composer, because a reply a model wrote is parsed into a block tree and
 * rendered as elements — which is what makes markup injection structurally
 * impossible rather than sanitized (docs/RULINGS.md, ruling 6). Neither lane
 * may edit the other's files, so the disagreement is filed for the lead and the
 * page states it in the one failure shape until it is ruled on.
 *
 * DELETE THIS the moment the two shapes agree. It is the only thing in this
 * file with an expiry date, and the guard covers BOTH halves of what is drawn:
 * a projection carrying `rows` and no `composer` reaches `Composer`, which
 * reads a field off it and throws mid-render — and there is no boundary in this
 * app, so that is a blank document. Both halves fail together, so the day the
 * shapes agree the whole bridge can go at once.
 * Exported for `test/work.test.js` alone: a bridge nothing executes is a bridge
 * that is silently already broken when it is finally deleted.
 * @param {import('@harness/kernel').Response} response
 * @returns {import('@harness/kernel').Response}
 */
export function renderable(response) {
  const drawable = Array.isArray(response.data.rows)
    && typeof response.data.composer === 'object' && response.data.composer !== null
  if (response.view !== 'chat' || drawable) return response
  return problem(500, 'The core projected this agent’s transcript in a shape this interface cannot draw.', {
    id: 'chat', kind: 'projection_mismatch',
    detail: 'GET /chat answered without both of the things this transcript draws — `rows` of typed blocks and a `composer`. The core projects `messages` of plain strings, and no message could be drawn from those without inventing its structure.',
    repair: 'Nothing you can do from this page — the two halves are being reconciled. The log is intact and nothing has been lost.',
  })
}
