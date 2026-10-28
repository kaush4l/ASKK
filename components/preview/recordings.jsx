"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, CircleIcon, PauseIcon, PlayIcon } from "lucide-react"

import { recHref, recordingsOf } from "@/backend/live/preview"
import { shotSrc } from "@/backend/live/workbench"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The preview's recordings (kernel builtin/preview.js preview.record / preview.cut; 2026-10-25 owner: "The lead should
// be able to open the webpage, record, navigate and perform actions"): each one a chip — ● while it records — and the
// one picked played back: its frame's screenshot, what was done, a scrubber, play / pause and step. The newest is picked.
const FRAME_MS = 900

// initial: the recording a /live?rec=<id> link names (ItemStrip's dialog), picked first; label: the inner "Recordings"
// line (off in the dialog, whose title already says it).
export function PreviewRecordings({ state, initial = null, label = true }) {
  const recordings = recordingsOf(state)
  const [picked, setPicked] = React.useState(initial)
  // the page's search, read after mount (the server render has none), so a chip's link keeps ?desk
  const [search, setSearch] = React.useState("")
  React.useEffect(() => setSearch(window.location.search), [])
  const rec = recordings.find((r) => r.id === picked) ?? recordings[0]
  if (!rec) return null
  // a plain click picks it here and puts rec=<id> in the address, with no reload; a modified click opens the link
  const pick = (e, id) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    setPicked(id)
    const href = recHref(window.location.search, id)
    window.history.replaceState(window.history.state, "", href)
    setSearch(href)
  }
  return (
    <section aria-label="Recordings" className="flex min-w-0 flex-col gap-1.5">
      {label && <p className="text-xs text-muted-foreground">Recordings</p>}
      <ul className="flex flex-wrap gap-1">
        {recordings.map((r) => (
          <li key={r.id}>
            <a
              href={recHref(search, r.id)}
              onClick={(e) => pick(e, r.id)}
              aria-current={r.id === rec.id ? "true" : undefined}
              className={cn("flex min-h-7 items-center gap-1 rounded-md border px-2 text-[11px] pointer-coarse:min-h-10", r.id === rec.id ? "border-foreground/40 text-foreground" : "text-muted-foreground")}
            >
              {r.status === "recording" && <CircleIcon className="size-2.5 fill-red-500 text-red-500 motion-safe:animate-pulse" aria-label="recording" />}
              <span className={cn("truncate", label ? "max-w-40" : "max-w-72")} title={r.title}>{r.title}</span>
              <span className="tabular-nums">{r.frames.length}</span>
              {r.span && <span className="tabular-nums text-muted-foreground">· {r.span}</span>}
            </a>
          </li>
        ))}
      </ul>
      <Player key={rec.id} rec={rec} wide={!label} />
    </section>
  )
}

function Player({ rec, wide = false }) {
  const n = rec.frames.length
  const [at, setAt] = React.useState(n - 1)
  const [playing, setPlaying] = React.useState(false)
  const [following, setFollowing] = React.useState(rec.status === "recording")
  // while it records, the newest frame shows (until the owner steps back)
  React.useEffect(() => {
    if (following) setAt(n - 1)
  }, [n, following])
  React.useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setAt((i) => Math.min(i + 1, n - 1)), FRAME_MS)
    return () => clearInterval(t)
  }, [playing, n])
  React.useEffect(() => {
    if (playing && at >= n - 1) setPlaying(false)
  }, [playing, at, n])
  if (!n) return <p className="text-xs text-muted-foreground">no frames yet</p>
  const i = Math.min(Math.max(at, 0), n - 1)
  const f = rec.frames[i]
  const go = (k) => {
    setFollowing(false)
    setPlaying(false)
    setAt(Math.min(Math.max(k, 0), n - 1))
  }
  const play = () => {
    setFollowing(false)
    if (!playing && i >= n - 1) setAt(0)
    setPlaying((p) => !p)
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export) */}
      <img src={shotSrc({ url: f.src, n: f.n })} alt={`Frame ${i + 1} of ${rec.title}: ${f.action}`} className={cn("h-auto max-w-full rounded-sm border object-contain object-left-top", wide ? "max-h-[55svh]" : "max-h-56")} />
      <p className="break-words text-[11px] text-muted-foreground">
        {f.caption}
        {f.place ? <span className="font-mono"> · {f.place}</span> : null}
      </p>
      <div className="flex min-w-0 items-center gap-1">
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-10" aria-label="Previous frame" onClick={() => go(i - 1)} disabled={i === 0}>
          <ChevronLeftIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-10" aria-label={playing ? "Pause" : "Play"} onClick={play}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-10" aria-label="Next frame" onClick={() => go(i + 1)} disabled={i >= n - 1}>
          <ChevronRightIcon />
        </Button>
        <input type="range" min={0} max={n - 1} value={i} onChange={(e) => go(Number(e.target.value))} aria-label="Frame" className="min-w-0 flex-1 pointer-coarse:h-10" />
      </div>
      {rec.note && <p className="break-words text-xs">{rec.note}</p>}
    </div>
  )
}
