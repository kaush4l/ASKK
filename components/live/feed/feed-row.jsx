"use client"

import { BotIcon, CalendarClockIcon, FileIcon, FilePenIcon, FilePlusIcon, FileXIcon, GlobeIcon, ListChecksIcon, MonitorIcon, TerminalIcon, WrenchIcon } from "lucide-react"

import { eventTarget, isFileEvent } from "@/backend/features/live/follow"
import { time } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { cn } from "@/lib/utils"

const VIEW_ICONS = {
  terminal: TerminalIcon,
  quest: BotIcon,
  web: GlobeIcon,
  browser: MonitorIcon,
  checklist: ListChecksIcon,
  schedule: CalendarClockIcon,
}

function toolIcon(event) {
  if (event.name === "fs.write") return FilePlusIcon
  if (event.name === "fs.delete") return FileXIcon
  if (event.view === "file") return isFileEvent(event) ? FilePenIcon : FileIcon
  return VIEW_ICONS[event.view] ?? WrenchIcon
}

export function FeedRow({ event, selected, onSelect }) {
  const Icon = toolIcon(event)
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-2 border-l-2 px-3 py-2 text-left text-xs hover:bg-muted/50 pointer-coarse:py-3",
        selected ? "border-l-primary bg-muted/40" : "border-l-transparent",
        !event.view && "opacity-60"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{event.name}</span>
          <span className="shrink-0 text-muted-foreground">· {event.agent}</span>
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{eventTarget(event)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StateMark event={event} />
        <span className="text-[10px] text-muted-foreground tabular-nums">{time(event.at)}</span>
      </span>
    </button>
  )
}
