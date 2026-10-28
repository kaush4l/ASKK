"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

// The response contract (kernel Agent answerContract → stats.contract): the report fields the agent's newest answer
// holds. Nothing missed: a muted "report ✓ n/n"; else the missed fields in amber. One line, truncated (the mid card has
// a fixed height); title: every field the answer was checked against.
export function ContractLine({ contract, className }) {
  const fields = contract?.fields ?? []
  if (!fields.length) return null
  const missed = contract.missed ?? []
  return (
    <p data-contract title={`report fields: ${fields.join(", ")}`} className={cn("truncate text-[10px] leading-snug", missed.length ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground", className)}>
      {missed.length ? `missed: ${missed.join(", ")}` : `report ✓ ${fields.length}/${fields.length}`}
    </p>
  )
}

// The fields a closed report shows, in this order (only those present).
const FIRST = ["VERDICT", "CONFIDENCE", "GAPS"]

// The rows ReportRows draws: closed, VERDICT, CONFIDENCE and GAPS and how many more are hidden; open, every entry.
export function reportRows(report, open) {
  const entries = Object.entries(report ?? {})
  if (open) return { rows: entries, hidden: 0 }
  const rows = FIRST.flatMap((f) => entries.filter(([k]) => k.toUpperCase() === f))
  return { rows, hidden: entries.length - rows.length }
}

// The report object (kernel Agent answerReport → stats.report): each field of the newest answer on its own muted row,
// "FIELD value", truncated, the full value in its title. CONFIDENCE as a number (an unparsable one as is). Closed it
// shows VERDICT, CONFIDENCE and GAPS with a "+n fields" toggle, so a long report does not push the Turns down.
export function ReportRows({ report, className }) {
  const [open, setOpen] = useState(false)
  const all = Object.keys(report ?? {}).length
  if (!all) return null
  const { rows } = reportRows(report, open)
  const more = reportRows(report, false).hidden
  const shown = (f, v) => {
    const c = Number.parseFloat(v)
    return f.toUpperCase() === "CONFIDENCE" && Number.isFinite(c) ? c.toFixed(2) : v
  }
  return (
    <div data-report className={cn("min-w-0 text-[10px] leading-snug text-muted-foreground", className)}>
      {rows.map(([f, v]) => (
        <p key={f} title={v} className="truncate">
          <span className="font-medium">{f}</span> {shown(f, v)}
        </p>
      ))}
      {more > 0 && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-10 text-[10px] text-muted-foreground hover:text-foreground">
          {open ? "fewer fields" : `+${more} fields`}
        </button>
      )}
    </div>
  )
}
