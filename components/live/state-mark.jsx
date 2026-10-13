import { CheckIcon, CircleDotIcon, HandIcon, LoaderIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function StateMark({ event, className }) {
  if (event.state === "running") return <LoaderIcon className={cn("size-3.5 shrink-0 animate-spin text-sky-500", className)} aria-label="Running" />
  if (event.state === "approval") return <HandIcon className={cn("size-3.5 shrink-0 text-amber-500", className)} aria-label="Waiting for approval" />
  if (event.skipped) return <CircleDotIcon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-label="Skipped" />
  return event.ok ? (
    <CheckIcon className={cn("size-3.5 shrink-0 text-emerald-500", className)} aria-label="Succeeded" />
  ) : (
    <XIcon className={cn("size-3.5 shrink-0 text-destructive", className)} aria-label="Failed" />
  )
}
