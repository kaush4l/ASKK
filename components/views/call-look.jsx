import {
  BotIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  CompassIcon,
  DatabaseIcon,
  GlobeIcon,
  ListChecksIcon,
  ListIcon,
  OctagonAlertIcon,
  PlugIcon,
  TerminalIcon,
  WrenchIcon,
  FolderTreeIcon,
  AppWindowIcon,
  UserPlusIcon,
  MessagesSquareIcon,
  BlocksIcon,
  NotebookPenIcon,
} from "lucide-react"

import { callLook } from "@/backend/live/visual"
import { cn } from "@/lib/utils"

// A call drawn the same everywhere (the canvas's chips and step rows, the Live feed): callLook
// (backend/live/visual.js) says its kind, tone and icon; this maps them to a lucide icon and classes.

export const CALL_ICONS = {
  bot: BotIcon,
  globe: GlobeIcon,
  terminal: TerminalIcon,
  plug: PlugIcon,
  "clipboard-list": ClipboardListIcon,
  list: ListIcon,
  "list-checks": ListChecksIcon,
  "calendar-clock": CalendarClockIcon,
  database: DatabaseIcon,
  wrench: WrenchIcon,
  "octagon-alert": OctagonAlertIcon,
  compass: CompassIcon,
  "folder-tree": FolderTreeIcon, // 2026-10-17: files, preview and spawn calls drew the wrench
  "app-window": AppWindowIcon,
  "user-plus": UserPlusIcon,
  "messages-square": MessagesSquareIcon,
  blocks: BlocksIcon, // 2026-10-20: desk.* calls
  "notebook-pen": NotebookPenIcon, // 2026-10-20: practice commands
}

// Tone → classes. -500 borders read on white and on OLED black; text pairs a dark shade (light) with a light one (dark).
export const CALL_TONES = {
  blue: { text: "text-blue-700 dark:text-blue-300", border: "border-blue-500/70", dot: "bg-blue-500" },
  sky: { text: "text-sky-700 dark:text-sky-300", border: "border-sky-500/70", dot: "bg-sky-500" },
  emerald: { text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/70", dot: "bg-emerald-500" },
  cyan: { text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-500/70", dot: "bg-cyan-500" },
  violet: { text: "text-violet-700 dark:text-violet-300", border: "border-violet-500/70", dot: "bg-violet-500" },
  amber: { text: "text-amber-700 dark:text-amber-300", border: "border-amber-500/70", dot: "bg-amber-500" },
  red: { text: "text-red-700 dark:text-red-400", border: "border-red-500/70", dot: "bg-red-500" },
  orange: { text: "text-orange-700 dark:text-orange-300", border: "border-orange-500/70", dot: "bg-orange-500" },
  teal: { text: "text-teal-700 dark:text-teal-300", border: "border-teal-500/70", dot: "bg-teal-500" },
  indigo: { text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-500/70", dot: "bg-indigo-500" },
  pink: { text: "text-pink-700 dark:text-pink-300", border: "border-pink-500/70", dot: "bg-pink-500" },
  rose: { text: "text-rose-700 dark:text-rose-300", border: "border-rose-500/70", dot: "bg-rose-500" },
  lime: { text: "text-lime-700 dark:text-lime-300", border: "border-lime-500/70", dot: "bg-lime-500" },
}

export const toneOf = (look) => CALL_TONES[look?.tone] ?? CALL_TONES.amber

// The call's icon in its tone. `look`: callLook(call), or pass the call.
export function CallIcon({ look, call, className }) {
  const l = look ?? callLook(call)
  const Icon = CALL_ICONS[l.icon] ?? WrenchIcon
  return <Icon aria-hidden data-icon={l.icon} className={cn("shrink-0", toneOf(l).text, className)} />
}
