"use client"

import * as React from "react"
import { PauseIcon, RadioIcon } from "lucide-react"

import { captureBefore, liveArtifacts, liveFeed, termRuns } from "@/backend/features/live/follow"
import { FeedRow } from "@/components/live/feed/feed-row"
import { GuideBox } from "@/components/live/guide-box"
import { artifactTabs } from "@/components/live/panels"
import { TerminalView } from "@/components/live/panels/terminal-panel"
import { useWakes, WakesView } from "@/components/live/panels/wakes-panel"
import { WorkspaceView } from "@/components/live/panels/workspace-panel"
import { CallView } from "@/components/live/views/call-view"
import { Button } from "@/components/ui/button"
import { useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"


// Every tool call of the team as it happens, beside the chat rather than in
// it. Left: the calls (UI-renderable ones; "All" adds the log-only ones).
// Right: the followed call, rendered by its tool's `view` (a live terminal,
// a file diff, the quest…), and the live artifacts the engines publish
// — one tab per artifact present (panels/index.js) — and the wake book. Below:
// guide the agent that made the call, without stopping it.
export function LivePage() {
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  const all = React.useMemo(() => liveFeed(engines, states), [engines, states])
  const artifacts = React.useMemo(() => liveArtifacts(engines, states), [engines, states])
  const terminal = React.useSyncExternalStore(termRuns.subscribe, termRuns.getSnapshot, termRuns.getSnapshot)
  const [following, setFollowing] = React.useState(true)
  const [chosen, setChosen] = React.useState(null)
  const [everything, setEverything] = React.useState(false)
  const [tab, setTab] = React.useState("call")
  const wakes = useWakes()
  const tabs = React.useMemo(
    () => [{ id: "call", label: "Call" }, ...artifactTabs(artifacts, { terminal: terminal.available }), { id: "schedule", label: "Schedule" }],
    [artifacts, terminal.available]
  )
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]

  const events = React.useMemo(() => (everything ? all : all.filter((e) => e.view)), [all, everything])
  const hidden = all.length - events.length

  // Following: the newest call in progress, else the newest call.
  const followed = events.findLast((e) => e.state !== "done") ?? events.at(-1) ?? null
  const selected = following ? followed : (all.find((e) => e.id === chosen) ?? followed)

  React.useEffect(() => {
    for (const event of all) captureBefore(event)
  }, [all])

  const select = React.useCallback((id) => {
    setChosen(id)
    setFollowing(false)
    setTab("call")
  }, [])

  const listRef = React.useRef(null)
  React.useEffect(() => {
    if (following && listRef.current) listRef.current.scrollTop = 0
  }, [following, events.length])

  const running = all.filter((e) => e.state !== "done").length
  const newestFirst = React.useMemo(() => [...events].reverse(), [events])
  const guideIndex = engines.findIndex((e) => e.id === selected?.engineId)
  const guideEngine = engines[guideIndex] ?? engines.find((e) => states[engines.indexOf(e)]?.status === "running") ?? engines[0]
  const guideState = states[engines.indexOf(guideEngine)]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl">Live follow</h1>
        <span className="text-xs text-muted-foreground">
          {events.length} call{events.length === 1 ? "" : "s"}
          {running ? ` · ${running} in progress` : ""}
          {terminal.available ? ` · terminal ${terminal.connected ? "live" : "reconnecting"}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() => setEverything((e) => !e)}
            aria-pressed={everything}
            title="Log-only calls are the ones whose tool declares no view"
          >
            {everything ? "All calls" : `Renderable${hidden ? ` · ${hidden} log-only hidden` : ""}`}
          </Button>
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

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav ref={listRef} aria-label="Tool calls" className="max-h-56 overflow-auto rounded-lg border md:max-h-none">
          {!newestFirst.length && (
            <p className="p-3 text-xs text-muted-foreground">No calls yet. When an agent runs a command, writes a file or hands out a quest, it shows here as it happens.</p>
          )}
          {newestFirst.map((event) => (
            <FeedRow key={event.id} event={event} selected={event.id === selected?.id} onSelect={select} />
          ))}
        </nav>
        <div className="flex min-h-[60svh] min-w-0 flex-col gap-3 md:min-h-0">
          <div role="tablist" aria-label="Live views" className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={current.id === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs pointer-coarse:py-2.5",
                  current.id === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                {t.id === "terminal" && terminal.procs.some((p) => p.status === "running") && <span className="ml-1 text-emerald-500">●</span>}
                {t.id === "files" && artifacts.filesystem && <span className="ml-1 text-muted-foreground">v{artifacts.filesystem.version}</span>}
                {t.id === "schedule" && wakes.open.length > 0 && <span className="ml-1 text-muted-foreground">{wakes.open.length}</span>}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {current.id === "call" && <CallView event={selected} events={all} runs={terminal.runs} onSelect={select} />}
            {current.id === "files" && <WorkspaceView snapshot={artifacts.filesystem} shared={artifacts.shared} events={all} onSelect={select} />}
            {current.id === "terminal" && <TerminalView terminal={terminal} events={all} snapshot={artifacts.terminal} />}
            {current.id === "schedule" && <WakesView book={wakes} />}
            {current.Panel && <current.Panel snapshot={artifacts[current.type]} />}
          </div>
          <GuideBox engine={guideEngine} state={guideState} />
        </div>
      </div>
    </div>
  )
}
