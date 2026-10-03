"use client"

import { AgentCard } from "@/components/agents/agent-card"
import { useEngines } from "@/hooks/use-engines"

// Every agent read from public/agents/, one card each.
export function AgentsPage() {
  const { agents, edited, engines, status, error } = useEngines()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Loaded from <code>public/agents/</code>. Edits are saved in this browser and apply to
          live engines on their next message.
        </p>
      </div>

      {status === "loading" && <p className="text-sm text-muted-foreground">Loading agents…</p>}
      {status === "error" && <p className="text-sm text-destructive">Agents failed to load: {error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            edited={edited.includes(agent.name)}
            liveCount={engines.filter((e) => e.agent.name === agent.name).length}
          />
        ))}
      </div>
    </div>
  )
}
