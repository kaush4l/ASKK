"use client"

import * as React from "react"

import { readWakes, WAKES_POLL_MS } from "@/backend/features/live/wakes"
import { cn } from "@/lib/utils"

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "")
const STATE = { done: "text-emerald-500", missed: "text-amber-500", cancelled: "text-muted-foreground" }

// The wake book (GET wakes): runs the team booked for later with schedule.wake,
// and the ones lately run, missed or cancelled. Re-read every 30 s.
export function useWakes() {
  const [book, setBook] = React.useState({ available: false, open: [], recent: [], loading: true })
  React.useEffect(() => {
    let alive = true
    const load = () => readWakes().then((b) => alive && setBook(b))
    load()
    const timer = setInterval(load, WAKES_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return book
}

function Wake({ wake }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-foreground">{when(wake.at)}</span>
        {wake.agent && <span className="text-muted-foreground">→ {wake.agent}</span>}
        {wake.state && <span className={cn("ml-auto", STATE[wake.state])}>{wake.state} {when(wake.closedAt)}</span>}
      </div>
      {wake.reason && <p className="break-words text-foreground">{wake.reason}</p>}
      {wake.message && <p className="line-clamp-3 break-words text-muted-foreground">{wake.message}</p>}
    </div>
  )
}

export function WakesView({ book }) {
  if (book.loading) return <p className="text-sm text-muted-foreground">Reading the wake book…</p>
  if (!book.available) return <p className="text-sm text-muted-foreground">No wake book here: it needs the local server (restart it after an update).</p>
  return (
    <div className="flex flex-col gap-4 overflow-auto text-xs">
      {book.error && <p className="text-destructive">{book.error}</p>}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm">Booked ({book.open.length})</h2>
        {!book.open.length && <p className="text-muted-foreground">Nothing booked. schedule.wake books the team's next run.</p>}
        {book.open.map((w) => <Wake key={w.id} wake={w} />)}
      </section>
      {!!book.recent.length && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm">Lately</h2>
          {book.recent.map((w, i) => <Wake key={`${w.id}-${i}`} wake={w} />)}
        </section>
      )}
    </div>
  )
}
