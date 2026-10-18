"use client"

import * as React from "react"
import { PauseIcon, RadioIcon } from "lucide-react"

import { liveFeed } from "@/backend/live/follow"
import { ArtifactsView } from "@/components/live/artifacts-view"
import { DeskLogView } from "@/components/live/desk-log"
import { FeedRow } from "@/components/live/feed/feed-row"
import { useWakes, WakesView } from "@/components/live/panels/wakes-panel"
import { CallPanel } from "@/components/live/views/call-panel"
import { Button } from "@/components/ui/button"
import { useDesk, useDeskLog, useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The Live page's follow state and the parts both of its layouts draw (2026-10-17: split out of live-page.jsx so the
// workbench's side slot shows the same feed, call panel, tabs and guide box as the page without artifacts panes).

export const LIVE_TABS = [
  { id: "call", label: "Call" },
  { id: "artifacts", label: "Artifacts" },
  { id: "desk", label: "Desk log" },
  { id: "schedule", label: "Schedule" },
]

// One follow state for the page: the feed's followed call, and (workbench) the file, session and page it shows.
// `?tab=desk` opens a tab.
export function useLiveFollow() {
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  const desk = useDesk()
  const log = useDeskLog()
  const events = React.useMemo(() => liveFeed(engines, states), [engines, states])
  const [following, setFollowing] = React.useState(true)
  const [chosen, setChosen] = React.useState(null)
  const [tab, setTab] = React.useState("call")
  const wakes = useWakes()

  React.useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab")
    if (LIVE_TABS.some((t) => t.id === asked)) setTab(asked)
  }, [])

  // Following: the newest call in progress, else the newest call.
  const followed = events.findLast((e) => e.state !== "done") ?? events.at(-1) ?? null
  const selected = following ? followed : (events.find((e) => e.id === chosen) ?? followed)

  const select = React.useCallback((id) => {
    setChosen(id)
    setFollowing(false)
    setTab("call")
  }, [])

  const running = events.filter((e) => e.state !== "done").length
  const newestFirst = React.useMemo(() => [...events].reverse(), [events])
  const guideIndex = engines.findIndex((e) => e.id === selected?.engineId)
  const guideEngine = engines[guideIndex] ?? engines.find((e, i) => states[i]?.status === "running") ?? engines[0]
  const guideState = states[engines.indexOf(guideEngine)]

  return { engines, states, desk, log, events, newestFirst, running, following, setFollowing, selected, select, tab, setTab, wakes, guideEngine, guideState }
}

// Title, call counts, the Following toggle (it drives the feed and, on the workbench, the panes); `children` sit
// beside the toggle.
export function LiveHeader({ live, children, className }) {
  const { events, running, following, setFollowing, setTab } = live
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <h1 className="text-xl">Live follow</h1>
      <span className="text-xs text-muted-foreground">
        {events.length} call{events.length === 1 ? "" : "s"}
        {running ? ` · ${running} in progress` : ""}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Button
          variant={following ? "secondary" : "outline"}
          size="sm"
          className="pointer-coarse:h-10"
          onClick={() => {
            setFollowing((f) => !f)
            setTab("call")
          }}
          aria-pressed={following}
        >
          {following ? <RadioIcon className="text-emerald-500" /> : <PauseIcon />}
          {following ? "Following" : "Follow"}
        </Button>
      </div>
    </div>
  )
}

// Every tool call and refused answer, newest first; following, it stays scrolled to the top.
export function FeedList({ live, className }) {
  const { newestFirst, selected, select, following, events } = live
  const listRef = React.useRef(null)
  React.useEffect(() => {
    if (following && listRef.current) listRef.current.scrollTop = 0
  }, [following, events.length])
  return (
    <nav ref={listRef} aria-label="Tool calls" className={cn("overflow-auto", className)}>
      {!newestFirst.length && <p className="p-3 text-xs text-muted-foreground">No calls yet. When an agent calls a tool or hands out a quest, it shows here as it happens.</p>}
      {newestFirst.map((event) => (
        <FeedRow key={event.id} event={event} selected={event.id === selected?.id} onSelect={select} />
      ))}
    </nav>
  )
}

// The tab row and the open tab: the followed call, artifacts (by view), the desk log, the wake book.
export function LiveTabs({ live, artifacts }) {
  const { tab, setTab, selected, log, wakes } = live
  const artifactCount = Object.keys(artifacts ?? {}).length
  return (
    <>
      <div role="tablist" aria-label="Live views" className="flex flex-wrap gap-1">
        {LIVE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs pointer-coarse:min-h-10 pointer-coarse:py-2.5",
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.id === "artifacts" && artifactCount > 0 && <span className="ml-1 text-muted-foreground">{artifactCount}</span>}
            {t.id === "desk" && log.length > 0 && <span className="ml-1 text-muted-foreground">{log.length}</span>}
            {t.id === "schedule" && wakes.open.length > 0 && <span className="ml-1 text-muted-foreground">{wakes.open.length}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "call" && (selected ? <CallPanel event={selected} /> : <p className="text-sm text-muted-foreground">Nothing selected.</p>)}
        {tab === "artifacts" && <ArtifactsView artifacts={artifacts ?? {}} />}
        {tab === "desk" && <DeskLogView lines={log} />}
        {tab === "schedule" && <WakesView book={wakes} />}
      </div>
    </>
  )
}
