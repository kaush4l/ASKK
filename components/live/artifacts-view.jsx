"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { ArtifactBlock } from "@/components/views/artifact"
import { cn } from "@/lib/utils"

// Every artifact of the desk, grouped by owner (the team or agent that keeps it), each drawn by its view. Closed it
// shows its brief and a compact body; a click opens it whole. Used by the Live page and the agent page.
export function ArtifactsView({ artifacts, empty = "No artifacts yet." }) {
  const [open, setOpen] = React.useState(() => new Set())
  const groups = React.useMemo(() => {
    const byOwner = new Map()
    for (const a of Object.values(artifacts ?? {}).sort((x, y) => x.id.localeCompare(y.id))) {
      const owner = a.owner ?? a.holders?.[0] ?? "desk"
      if (!byOwner.has(owner)) byOwner.set(owner, [])
      byOwner.get(owner).push(a)
    }
    return [...byOwner]
  }, [artifacts])
  if (!groups.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      {groups.map(([owner, list]) => (
        <section key={owner} className="flex flex-col gap-1.5" aria-label={`${owner} artifacts`}>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{owner}</h2>
          {list.map((a) => (
            <div key={a.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(a.id)}
                aria-expanded={open.has(a.id)}
                className="flex min-h-10 items-center gap-2 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-accent"
                title={`Held by ${(a.holders ?? []).join(", ")}`}
              >
                <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open.has(a.id) && "rotate-180")} />
                <span className="truncate">held by {(a.holders ?? []).join(", ") || "—"}</span>
              </button>
              <ArtifactBlock artifact={a} expanded={open.has(a.id)} />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
