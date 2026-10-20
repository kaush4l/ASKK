"use client"

import * as React from "react"
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react"
import { usePanelRef } from "react-resizable-panels"

import { LiveTree } from "@/backend/live/fs-watch"
import { currentRef, itemKey, previewItems } from "@/backend/live/preview"
import { TermActivity } from "@/backend/live/term-stream"
import { followSession, followTab, mergeSessions, noteOutput, paneIds, pickWorkbench, sessionTabs, workbenchTabs } from "@/backend/live/workbench"
import { GuideBox } from "@/components/live/guide-box"
import { FeedList, LiveHeader, LiveTabs } from "@/components/live/live-side"
import { EditorPane } from "@/components/live/workbench/editor-pane"
import { FilesPane } from "@/components/live/workbench/files-pane"
import { PreviewPane } from "@/components/live/workbench/preview-pane"
import { TerminalPane } from "@/components/live/workbench/terminal-pane"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, useResizableLayout } from "@/components/ui/resizable"
import { LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

// The Live page as a workbench, for a desk whose agents hold the inbuilt files / terminal / preview artifacts
// (2026-10-17, the owner's sketch): Files left; the tab strip of open and modified files and the one Preview tab over
// the open tab (the preview: one pane for its pages and the agents' visuals, the owner's questions — 2026-10-17 owner:
// "There will be need for only one preview pane"); the Terminal below it; the feed, call panel, other artifacts and
// guide box in a collapsible 4th slot. Panels resize and keep their layout. Phone: one window at a time from a tab bar.
// The Following toggle drives which file, session and preview item show (backend/live/workbench.js chooses); any click
// of the owner's pauses it.

const PANE = { overflow: "hidden" } // a pane scrolls inside itself, never its panel
const noSubscribe = () => () => {}
const noSnapshot = () => null
const WINDOWS = [
  { id: "files", label: "Files" },
  { id: "editor", label: "Editor" },
  { id: "preview", label: "Preview" },
  { id: "terminal", label: "Terminal" },
  { id: "feed", label: "Feed" },
]

// md and up: panels; below: windows. null until known (the first client render), so a phone never opens the desktop
// panes' streams.
function useWide() {
  const query = `(min-width: ${LIMITS.ui.mobileBreakpointPx}px)`
  return React.useSyncExternalStore(
    (fn) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", fn)
      return () => mql.removeEventListener("change", fn)
    },
    () => window.matchMedia(query).matches,
    () => null
  )
}

// The files root's disk tree, live while fs/watch is open (backend/live/fs-watch.js).
function useLiveTree(root, enabled) {
  const tree = React.useMemo(() => (enabled ? new LiveTree(root) : null), [root, enabled])
  React.useEffect(() => {
    tree?.start()
    return () => tree?.close()
  }, [tree])
  return React.useSyncExternalStore(tree?.subscribe ?? noSubscribe, tree?.getSnapshot ?? noSnapshot, noSnapshot)
}

// Every session's last lines from term/list (backend/live/term-stream.js TermActivity), so the Terminal pane and its
// follow see sessions and output the terminal twin has not caught up with; null without a terminal artifact.
function useTermActivity(enabled) {
  const act = React.useMemo(() => (enabled ? new TermActivity() : null), [enabled])
  React.useEffect(() => {
    act?.start()
    return () => act?.close()
  }, [act])
  return React.useSyncExternalStore(act?.subscribe ?? noSubscribe, act?.getSnapshot ?? noSnapshot, noSnapshot)
}

const NONE = { tab: null, file: null, page: null, session: null }

// What the panes show: the tabs, and the tab / session / preview item in view — followed (the preview: the item the
// agents put in the pane, its `current`), or while follow is paused the owner's pick, else what the pane showed when it
// paused (backend/live/workbench.js paneIds).
function useWorkbench({ files, terminal, preview }, { following, setFollowing }) {
  const [pinned, setPinned] = React.useState([])
  const [dismissed, setDismissed] = React.useState(() => new Map())
  const [chosen, setChosen] = React.useState(NONE)
  const [frozen, setFrozen] = React.useState(null)
  const [wasFollowing, setWasFollowing] = React.useState(following)
  const tabs = React.useMemo(() => workbenchTabs({ files, preview, pinned, dismissed }), [files, preview, pinned, dismissed])
  const fileTabs = React.useMemo(() => tabs.filter((t) => t.kind === "file"), [tabs])
  const items = React.useMemo(() => previewItems(preview?.state), [preview])
  const activity = useTermActivity(!!terminal)
  const polled = activity?.sessions ?? null
  // at most two tabs per agent: its main session and its long one (backend/live/workbench.js sessionTabs)
  const sessions = React.useMemo(() => sessionTabs(mergeSessions(terminal?.state?.sessions ?? [], polled)), [terminal, polled])
  const outputs = polled ?? sessions
  const seenRef = React.useRef(new Map())
  const seen = React.useMemo(() => (seenRef.current = noteOutput(seenRef.current, outputs)), [outputs])

  const followed = { tab: followTab(tabs), file: followTab(fileTabs), page: itemKey(currentRef(preview?.state)), session: followSession(sessions, seen) }
  const lists = { tab: tabs.map((t) => t.id), file: fileTabs.map((t) => t.id), page: items.map((i) => i.key), session: sessions.map((s) => s.id) }
  // Follow resumed: the owner's earlier picks and the freeze go. Paused: every pane stays on what it showed.
  if (wasFollowing !== following) {
    setWasFollowing(following)
    if (following) {
      setChosen(NONE)
      setFrozen(null)
    }
  }
  if (!following && !frozen) setFrozen(paneIds({ following: true, followed, lists }))
  const ids = paneIds({ following, chosen, frozen, followed, lists })

  const pause = () => setFollowing(false)
  return {
    tabs,
    fileTabs,
    items,
    tab: tabs.find((t) => t.id === ids.tab) ?? null,
    fileTab: fileTabs.find((t) => t.id === ids.file) ?? null,
    itemKey: ids.page,
    sessions,
    session: sessions.find((s) => s.id === ids.session) ?? null,
    pickTab(t) {
      setChosen((c) => ({ ...c, tab: t.id, ...(t.kind === "file" ? { file: t.id } : {}) }))
      pause()
    },
    // the owner's pick in the preview pane's strip (or an answer's item)
    pickItem(key) {
      setChosen((c) => ({ ...c, page: key }))
      pause()
    },
    closeTab(t) {
      setDismissed((m) => new Map(m).set(t.path, Date.now()))
      setPinned((p) => p.filter((x) => x.path !== t.path))
      pause()
    },
    openFile(path) {
      setDismissed((m) => {
        const next = new Map(m)
        next.delete(path)
        return next
      })
      setPinned((p) => [...p.filter((x) => x.path !== path), { path, at: Date.now() }])
      setChosen((c) => ({ ...c, tab: `file:${path}`, file: `file:${path}` }))
      pause()
    },
    pickSession(id) {
      setChosen((c) => ({ ...c, session: id }))
      pause()
    },
  }
}

export function Workbench({ live }) {
  const artifacts = live.desk?.artifacts
  const panes = React.useMemo(() => pickWorkbench(artifacts), [artifacts])
  const bench = useWorkbench(panes, live)
  const wide = useWide()
  const tree = useLiveTree(panes.files?.state?.root ?? "", !!panes.files && wide !== null)
  if (wide === null) return null
  // the one preview pane, following with the page (its pick pauses every pane, as any of the owner's clicks)
  const preview = panes.preview ? <PreviewPane artifact={panes.preview} artifacts={artifacts} follow={{ following: live.following, key: bench.itemKey, pick: bench.pickItem }} /> : null
  return wide ? <DesktopBench live={live} panes={panes} bench={bench} tree={tree} preview={preview} /> : <PhoneBench live={live} panes={panes} bench={bench} tree={tree} preview={preview} />
}

function DesktopBench({ live, panes, bench, tree, preview }) {
  const outer = useResizableLayout("live.workbench")
  const center = useResizableLayout("live.workbench.center")
  const side = useResizableLayout("live.workbench.side")
  const sideRef = usePanelRef()
  const [sideOpen, setSideOpen] = React.useState(true)
  const toggleSide = () => (sideRef.current?.isCollapsed() ? sideRef.current.expand() : sideRef.current?.collapse())

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:p-3">
      <LiveHeader live={live}>
        <Button variant="outline" size="sm" onClick={toggleSide} aria-pressed={sideOpen} aria-label={sideOpen ? "Hide the feed" : "Show the feed"}>
          {sideOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          Feed
        </Button>
      </LiveHeader>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
        <ResizablePanelGroup orientation="horizontal" id="live-workbench" {...outer}>
          <ResizablePanel id="files" defaultSize="18%" minSize="10%" className="flex flex-col" style={PANE}>
            <FilesPane files={panes.files} live={tree} activePath={bench.tab?.path} onOpen={bench.openFile} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="center" defaultSize="54%" minSize="25%" className="flex flex-col" style={PANE}>
            <ResizablePanelGroup orientation="vertical" id="live-workbench-center" {...center}>
              <ResizablePanel id="editor" defaultSize="62%" minSize="15%" className="flex flex-col" style={PANE}>
                <EditorPane
                  tabs={bench.tabs}
                  tab={bench.tab}
                  onPick={bench.pickTab}
                  onClose={bench.closeTab}
                  live={tree}
                  preview={preview}
                  empty={panes.files || panes.preview ? "No open files yet. Files the agents open or change show here as tabs; the Preview tab shows their pages and visuals." : "This desk has no files or preview artifact."}
                />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="terminal" defaultSize="38%" minSize="10%" className="flex flex-col" style={PANE}>
                <TerminalPane terminal={panes.terminal} sessions={bench.sessions} session={bench.session} onPick={bench.pickSession} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="side"
            defaultSize="28%"
            minSize="16%"
            collapsible
            collapsedSize="0%"
            panelRef={sideRef}
            onResize={(size) => setSideOpen(size.asPercentage > 0)}
            className="flex flex-col"
            style={PANE}
          >
            <ResizablePanelGroup orientation="vertical" id="live-workbench-side" {...side}>
              <ResizablePanel id="feed" defaultSize="40%" minSize="10%" className="flex flex-col" style={PANE}>
                <FeedList live={live} className="min-h-0 flex-1" />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="details" defaultSize="60%" minSize="20%" className="flex flex-col gap-2 p-2" style={PANE}>
                <LiveTabs live={live} artifacts={panes.others} />
                <GuideBox engine={live.guideEngine} state={live.guideState} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

function PhoneBench({ live, panes, bench, tree, preview }) {
  const [win, setWin] = React.useState("editor")
  const counts = { editor: bench.fileTabs.length, preview: bench.items.length, terminal: bench.sessions.length, feed: live.events.length }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <LiveHeader live={live} />
      <div role="tablist" aria-label="Workbench windows" className="grid shrink-0 grid-cols-5 rounded-lg border">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={win === w.id}
            onClick={() => setWin(w.id)}
            className={cn("flex min-h-10 min-w-0 flex-col items-center justify-center border-b-2 px-0.5 text-xs", win === w.id ? "border-b-primary text-foreground" : "border-b-transparent text-muted-foreground")}
          >
            <span className="truncate">{w.label}</span>
            {counts[w.id] > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{counts[w.id]}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-[60svh] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
        {win === "files" && (
          <FilesPane
            files={panes.files}
            live={tree}
            activePath={bench.fileTab?.path}
            onOpen={(path) => {
              bench.openFile(path)
              setWin("editor")
            }}
          />
        )}
        {win === "editor" && (
          <EditorPane tabs={bench.fileTabs} tab={bench.fileTab} onPick={bench.pickTab} onClose={bench.closeTab} live={tree} empty={panes.files ? "No open files yet. Files the agents open or change show here." : "This desk has no files artifact."} />
        )}
        {win === "preview" && (preview ?? <p className="p-3 text-xs text-muted-foreground">This desk has no preview artifact.</p>)}
        {win === "terminal" && <TerminalPane terminal={panes.terminal} sessions={bench.sessions} session={bench.session} onPick={bench.pickSession} />}
        {win === "feed" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2">
            <FeedList live={live} className="max-h-56 shrink-0 rounded-lg border" />
            <LiveTabs live={live} artifacts={panes.others} />
            <GuideBox engine={live.guideEngine} state={live.guideState} />
          </div>
        )}
      </div>
    </div>
  )
}
