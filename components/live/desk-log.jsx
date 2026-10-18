"use client"

import * as React from "react"

import { time } from "@/components/live/format"
import { cn } from "@/lib/utils"

// The desk's background log: every line its own code writes — watchers, the schedule, the wake book, the
// Telegram bridge, the desk host — newest first, filterable by source. Fed by the team stream (backend/live/log.js).
export function DeskLogView({ lines }) {
  const [source, setSource] = React.useState(null)
  const sources = React.useMemo(() => [...new Set(lines.map((l) => l.source))].sort(), [lines])
  const shown = React.useMemo(() => [...lines].reverse().filter((l) => !source || l.source === source), [lines, source])
  if (!lines.length) return <p className="text-sm text-muted-foreground">Nothing from the desk's background work yet (watchers, schedule, wakes, Telegram).</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by source">
        {[null, ...sources].map((s) => (
          <button
            key={s ?? "all"}
            type="button"
            aria-pressed={source === s}
            onClick={() => setSource(s)}
            className={cn("rounded-full border px-2.5 text-xs leading-7 pointer-coarse:leading-10", source === s ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {s ?? "all"}
          </button>
        ))}
      </div>
      <ol className="min-h-0 flex-1 overflow-auto rounded-lg border font-mono text-[12px]" aria-live="polite">
        {shown.map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex gap-2 border-b px-2 py-1 last:border-b-0">
            <span className="shrink-0 text-muted-foreground tabular-nums">{time(l.at)}</span>
            <span className="min-w-0 break-words">{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
