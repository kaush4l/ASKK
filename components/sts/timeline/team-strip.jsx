"use client"

import { describeActivity } from "@/backend/live/activity"
import { useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// An agent's dot: working, waiting on someone, failed, else quiet.
const DOT = { busy: "animate-pulse bg-amber-500", waiting: "bg-sky-500", error: "bg-destructive", idle: "bg-muted-foreground/40" }

export function TeamStrip() {
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  if (engines.length < 2) return null
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none]">
      {engines.map((engine, i) => {
        const s = states[i]
        const busy = s?.status === "running"
        const waiting = s?.activity?.phase === "waiting"
        return (
          <span
            key={engine.id}
            title={busy ? describeActivity(s.activity) : (s?.status ?? "")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-500",
              busy ? "border-amber-500/60 text-foreground" : "text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", DOT[busy ? "busy" : waiting ? "waiting" : s?.status === "error" ? "error" : "idle"])} />
            {engine.name}
          </span>
        )
      })}
    </div>
  )
}
