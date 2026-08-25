'use client'

import { useState } from 'react'

import { get } from '@harness/kernel'

import { drawable as chatDrawable } from '@/lib/chat'
import { BOOTING } from '@/lib/copy'
import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { useAgent } from '@/components/shell/use-agent'
import { useSession, useProjection } from '@/components/shell/use-session'
import { Work } from './work'

/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */

/**
 * THE WORK SCREEN, OVER THE REAL SEAM — and the fleet under it is the core's
 * own grouping now. `lib/roster.js` stood here for two increments saying the
 * projection could not be drawn; `GET /` groups by state, so the sentence it
 * held is unreachable rather than guarded, and the file is gone.
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
  if (!session) return <Empty note={BOOTING} />
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
        transcript={chatDrawable(transcript)}
        onSend={(text) => void session.send(agent, text).then(setRefused)}
      />
      {refused ? <View view="problem" data={refused} /> : null}
    </>
  )
}
