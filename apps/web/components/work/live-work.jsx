'use client'

import { get, problem } from '@harness/kernel'

import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { useAgent } from '@/components/shell/use-agent'
import { useSession, useProjection } from '@/components/shell/use-session'
import { Work } from './work'

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
  if (session.state === 'failed' && session.problem) {
    return <View view="problem" data={session.problem} />
  }
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
  return (
    <Work
      roster={roster}
      transcript={renderable(transcript)}
      onSend={(text) => void session.send(agent, text)}
    />
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
 * file with an expiry date, and the check is deliberately the narrowest one
 * that catches the disagreement: is there a `rows` array to render at all.
 * Exported for `test/work.test.js` alone: a bridge nothing executes is a bridge
 * that is silently already broken when it is finally deleted.
 * @param {import('@harness/kernel').Response} response
 * @returns {import('@harness/kernel').Response}
 */
export function renderable(response) {
  if (response.view !== 'chat' || Array.isArray(response.data.rows)) return response
  return problem(500, 'The core projected this agent’s transcript in a shape this interface cannot draw.', {
    id: 'chat', kind: 'projection_mismatch',
    detail: 'GET /chat answered with `messages` of plain strings; the transcript here renders `rows` of typed blocks and a composer, so no message could be drawn without inventing its structure.',
    repair: 'Nothing you can do from this page — the two halves are being reconciled. The log is intact and nothing has been lost.',
  })
}
