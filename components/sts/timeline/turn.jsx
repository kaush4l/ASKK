"use client"

import { HandIcon, Volume2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

const time = (at) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

export function Turn({ turn }) {
  if (turn.kind === "you") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-right-2 flex flex-col items-end gap-0.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-sky-500/40 px-3 py-2 text-base break-words">{turn.text}</div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {time(turn.at)}
          {turn.ms != null ? ` · ${turn.seconds?.toFixed(1)} s heard, ${turn.ms} ms` : ""}
        </span>
      </div>
    )
  }
  if (turn.kind === "answer") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-left-2 flex flex-col gap-0.5">
        <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-emerald-500/40 px-3 py-2 text-base whitespace-pre-wrap break-words">
          {turn.text}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{time(turn.at)} · answer</span>
      </div>
    )
  }
  if (turn.kind === "approval") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 px-3 py-2 text-sm">
        <HandIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 break-words">{turn.text}</span>
        <span className="text-xs text-muted-foreground">{turn.resolved == null ? "waiting" : turn.resolved ? "approved" : "declined"}</span>
      </div>
    )
  }
  const quiet = turn.kind === "system" || turn.level === 3
  return (
    <div
      className={cn(
        "animate-in fade-in-0 flex items-center gap-2 text-sm",
        turn.kind === "error" ? "text-destructive" : quiet ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          turn.kind === "error"
            ? "bg-destructive"
            : turn.status === "quest" || turn.status === "report"
              ? "bg-amber-500"
              : "bg-muted-foreground/60",
        )}
      />
      <span className="min-w-0 flex-1 truncate" title={turn.text}>
        {turn.text}
      </span>
      {turn.spoken ? <Volume2Icon className="size-3 shrink-0 text-emerald-500" aria-label="Spoken" /> : null}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{time(turn.at)}</span>
    </div>
  )
}
