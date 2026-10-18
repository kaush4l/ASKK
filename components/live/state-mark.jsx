import { CheckIcon, LoaderIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// A Live feed row's state: liveFeed (backend/live/follow.js) gives running | done, a done row ok or not
// (2026-10-17: the retired engine's approval and skipped states had no source left).
export function StateMark({ event, className }) {
  if (event.state === "running") return <LoaderIcon className={cn("size-3.5 shrink-0 animate-spin text-sky-500", className)} aria-label="Running" />
  return event.ok ? (
    <CheckIcon className={cn("size-3.5 shrink-0 text-emerald-500", className)} aria-label="Succeeded" />
  ) : (
    <XIcon className={cn("size-3.5 shrink-0 text-destructive", className)} aria-label="Failed" />
  )
}
