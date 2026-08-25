'use client'

import { get } from '@harness/kernel'

import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { useAgent } from '@/components/shell/use-agent'
import { useSession, useProjection } from '@/components/shell/use-session'
import { BOOTING } from '@/lib/copy'
import s from '@/components/views/views.module.css'

/**
 * THE AGENTS SCREEN, OVER THE REAL SEAM. Two panes, and each can fail on its
 * own: `GET /agents` is about the FILES this browser holds and `GET /tools` is
 * about what the agent in the address can actually call, so a build whose
 * roster loaded and whose toolbox did not is a real state and shows as one.
 *
 * The three states are the same three the Work screen has, and for the same
 * reason: a screen that paints a full frame over a core that never started is
 * how a whole round of this project was spent.
 */
export function LiveAgents() {
  const session = useSession()
  const { agent } = useAgent()
  if (!session) return <Empty note={BOOTING} />
  if (session.problem) return <View view="problem" data={session.problem} />
  return <Live session={session} agent={agent} />
}

/** @param {{session: import('@/lib/session').Session, agent: string}} props */
function Live({ session, agent }) {
  const roster = useProjection(session, get('/agents'))
  const tools = useProjection(session, get('/tools', { 'x-agent': agent }))
  return (
    <div className={s.stack}>
      <View view={roster.view} data={roster.data} />
      <View view={tools.view} data={tools.data} />
    </div>
  )
}
