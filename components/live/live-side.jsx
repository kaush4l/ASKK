"use client"

import * as React from "react"

import { liveFeed } from "@/backend/live/follow"
import { ArtifactsView } from "@/components/live/artifacts-view"
import { DeskLogView } from "@/components/live/desk-log"
import { FeedRow } from "@/components/live/feed/feed-row"
import { useWakes, WakesView } from "@/components/live/panels/wakes-panel"
import { CallPanel } from "@/components/live/views/call-panel"
import { FollowToggle } from "@/components/live/workbench/pane"
import { TabRow } from "@/components/shell/tab-row"
import { useDesk, useDeskLog, useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The Live page's follow state and the parts both of its layouts draw (2026-10-17: split out of live-page.jsx so the
// workbench's side slot shows the same feed, call panel, tabs and guide box as the page without artifacts panes).

const LIVE_TABS = [["call", "Call"], ["artifacts", "Artifacts"], ["desk", "Desk log"], ["schedule", "Schedule"]].map(([id, label]) => ({ id, label }))

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
  // when this tab saw each artifact's state change (ms): the call panel tells a change no call made (audit 19)
  const seen = React.useRef(new Map()) // id -> { ref, sig, at }
  const changes = React.useMemo(() => {
    const out = new Map()
    for (const [id, a] of Object.entries(desk?.artifacts ?? {})) {
      const was = seen.current.get(id)
      if (was?.ref === a) {
        out.set(id, was.at)
        continue
      }
      const sig = JSON.stringify(a?.state ?? null)
      const at = was ? (was.sig === sig ? was.at : Date.now()) : null // first sight: no change seen yet
      seen.current.set(id, { ref: a, sig, at })
      out.set(id, at)
    }
    return out
  }, [desk?.artifacts])

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

  return { engines, states, desk, log, events, newestFirst, running, following, setFollowing, selected, select, tab, setTab, wakes, guideEngine, guideState, changes }
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
        <FollowToggle
          following={following}
          className="pointer-coarse:h-10"
          onClick={() => {
            setFollowing((f) => !f)
            setTab("call")
          }}
        />
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
  const { tab, setTab, selected, log, wakes, events, changes } = live
  const counts = { artifacts: Object.keys(artifacts ?? {}).length, desk: log.length, schedule: wakes.open.length }
  return (
    <>
      <TabRow label="Live views" tabs={LIVE_TABS.map((t) => ({ ...t, count: counts[t.id] || null }))} value={tab} onPick={setTab} />
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "call" && (selected ? <CallPanel event={selected} events={events} artifacts={live.desk?.artifacts ?? artifacts} changes={changes} /> : <p className="text-sm text-muted-foreground">Nothing selected.</p>)}
        {tab === "artifacts" && <ArtifactsView artifacts={artifacts ?? {}} />}
        {tab === "desk" && <DeskLogView lines={log} />}
        {tab === "schedule" && <WakesView book={wakes} />}
      </div>
    </>
  )
}
