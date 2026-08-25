import { Shell } from '@/components/shell/shell'
import { LiveAgents } from '@/components/agents/live-agents'

/**
 * AGENTS, at `/agents/`. Every agent, the file it was read from, and what the
 * one in the address can actually call.
 */
export default function Page() {
  return (
    <Shell slug="agents">
      <LiveAgents />
    </Shell>
  )
}
