"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// What every workbench pane shares: a header line (title, then what it shows) and an empty state that says why.

export function PaneHeader({ icon: Icon, title, children, className }) {
  return (
    <div className={cn("flex min-h-9 shrink-0 items-center gap-2 border-b px-2 text-xs text-muted-foreground", className)}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="shrink-0 text-sm text-foreground">{title}</span>
      {children}
    </div>
  )
}

export function Empty({ children }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>
}

// "10:42:07" for a twin time (ISO or ms).
export const clock = (at) => {
  const d = typeof at === "number" ? new Date(at) : at ? new Date(at) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""
}

// A session's or page's state as a coloured dot: running/open green, failed red, the rest muted.
export function StatusDot({ status, className }) {
  const tone = status === "running" || status === "open" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "stopped" ? "bg-amber-500" : "bg-muted-foreground/60"
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", tone, status === "running" && "motion-safe:animate-pulse", className)} />
}
