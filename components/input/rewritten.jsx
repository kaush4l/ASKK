"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

// The owner's own words under a request the host rewrote on-device (2026-10-24 owner: "a sanitize method for the input
// … the voice input can be corrected and even general input can be enhanced"; companion/capabilities/sanitize.js): a
// line saying it was rewritten, how it came in and how long it took, and the words as the owner typed or said them,
// shown on a click. The request row carries `original` and `rewrite {via, model, ms}` (backend/live/team-rows.js).
const HOW = { voice: "spoken", telegram: "from Telegram", typed: "typed" }

// shown: controlled by the caller (a bubble that is itself a button opens it), else a toggle of its own.
export function Rewritten({ original, rewrite, shown = null, className }) {
  const [own, setOwn] = React.useState(false)
  if (!original) return null
  const how = HOW[rewrite?.via] ?? null
  const label = `rewritten on-device${how ? ` · ${how}` : ""}${rewrite?.ms ? ` · ${(rewrite.ms / 1000).toFixed(1)} s` : ""}`
  const open = shown ?? own
  return (
    <span className={cn("flex flex-col gap-0.5 text-[11px] opacity-80", className)}>
      {shown == null ? (
        <button type="button" aria-expanded={open} onClick={() => setOwn((o) => !o)} className="self-start text-left underline decoration-dotted underline-offset-2 pointer-coarse:min-h-10">
          {label} — {open ? "hide" : "your words"}
        </button>
      ) : (
        <span>
          {label}
          {open ? "" : " — tap for your words"}
        </span>
      )}
      {open && <span className="whitespace-pre-wrap break-words italic">“{original}”</span>}
    </span>
  )
}
