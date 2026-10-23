"use client"

import { eventTarget } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { duration, time } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { cn } from "@/lib/utils"

// The call's icon and colour by its tool's type and view (callLook): a refused answer is a gate; the owner's note
// to a run, guidance.
export function FeedRow({ event, selected, onSelect }) {
  const look = callLook(event)
  return (
    <button
      type="button"
      data-call-kind={look.kind}
      onClick={() => onSelect(event.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-2 border-l-2 px-3 py-2 text-left text-xs hover:bg-muted/50 pointer-coarse:py-3",
        selected ? "border-l-primary bg-muted/40" : "border-l-transparent",
        look.kind === "gate" && toneOf(look).text
      )}
    >
      <CallIcon look={look} className="mt-0.5 size-3.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{event.name}</span>
          <span className="shrink-0 text-muted-foreground">· {event.agent}</span>
          {/* a view the UI has no look for (an MCP server's own, a desk's): named, so it is never a silent wrench */}
          {look.kind === "function" && event.view && !["data", "function"].includes(event.view) && <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">{event.view}</span>}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{eventTarget(event)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StateMark event={event} />
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {event.ms != null ? <span data-call-ms>{duration(event.ms)} · </span> : null}
          {time(event.at)}
        </span>
      </span>
    </button>
  )
}
