"use client"

import { PauseIcon, RadioIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
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

// A pane's "Show" switch (shot | live, full | diff): the shown one pressed; `disabled(option)` and `title(option)` per option.
export const ShowSwitch = ({ options, value, onPick, disabled = () => false, title = () => undefined, className }) => (
  <div role="group" aria-label="Show" className={cn("flex shrink-0 gap-1", className)}>
    {options.map((m) => (
      <button key={m} type="button" aria-pressed={value === m} disabled={disabled(m)} title={title(m)} onClick={() => onPick(m)} className={cn("rounded-md border px-2 leading-6 disabled:opacity-40 pointer-coarse:leading-10", value === m ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
        {m}
      </button>
    ))}
  </div>
)

// The Following toggle (the Live header, the preview pane's own follow): following, the radio; paused, Follow.
export const FollowToggle = ({ following, onClick, className }) => (
  <Button variant={following ? "secondary" : "outline"} size="sm" className={className} onClick={onClick} aria-pressed={following}>
    {following ? <RadioIcon className="text-emerald-500" /> : <PauseIcon />}
    {following ? "Following" : "Follow"}
  </Button>
)

export function Empty({ children }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>
}

export { time as clock } from "@/components/live/format"

// A session's or page's state as a coloured dot: running/open green, failed red, the rest muted.
export function StatusDot({ status, className }) {
  const tone = status === "running" || status === "open" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "stopped" ? "bg-amber-500" : "bg-muted-foreground/60"
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", tone, status === "running" && "motion-safe:animate-pulse", className)} />
}
