"use client"

import * as React from "react"
import { ArrowDownToLineIcon, SquareIcon, TerminalIcon } from "lucide-react"

import { stripAnsi } from "@/backend/live/term-lines"
import { stopSession, TermView } from "@/backend/live/term-stream"
import { sessionLabel } from "@/backend/live/workbench"
import { clock, Empty, PaneHeader, StatusDot } from "@/components/live/workbench/pane"
import { LeaseBadge } from "@/components/views/artifact"
import { LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

const SLACK = LIMITS.ui.workbench.bottomSlackPx
const noSubscribe = () => () => {}
const noSnapshot = () => null

// The session's live text (term/stream through TermView); null without a session.
function useTerm(id) {
  const view = React.useMemo(() => (id != null ? new TermView(id) : null), [id])
  React.useEffect(() => {
    view?.start()
    return () => view?.close()
  }, [view])
  return React.useSyncExternalStore(view?.subscribe ?? noSubscribe, view?.getSnapshot ?? noSnapshot, noSnapshot)
}

// Terminal: a tab per session — at most two per agent, its main session (the commands it runs, one after another) and
// its long one (the run it keeps going; backend/live/workbench.js sessionTabs) — the shown one's live output: its
// scrollback, each command under its `$` line, following the end until the owner scrolls up, with the current
// command's status and exit code. The owner can stop the command running in it. A session holding a lease (2026-10-17:
// `lease: "gpu"`, one GPU run at a time) shows it on its tab.
export function TerminalPane({ terminal, sessions, session, onPick }) {
  return (
    <section aria-label="Terminal" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader icon={TerminalIcon} title="Terminal">
        <div role="tablist" aria-label="Sessions" className="flex min-w-0 flex-1 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === session?.id}
              onClick={() => onPick(s.id)}
              title={`${sessionLabel(s)}: ${s.command}${s.lease ? ` (holds the ${s.lease} lease)` : ""}`}
              className={cn(
                "flex min-h-8 max-w-48 shrink-0 items-center gap-1.5 border-b-2 px-2 pointer-coarse:min-h-10",
                s.id === session?.id ? "border-b-primary text-foreground" : "border-b-transparent hover:text-foreground"
              )}
            >
              <StatusDot status={s.status} />
              <span className="truncate font-mono">{sessionLabel(s)}</span>
              <LeaseBadge lease={s.lease} />
              {s.status !== "running" && s.exit != null && <span className={cn("shrink-0 tabular-nums", s.exit === 0 ? "" : "text-red-700 dark:text-red-400")}>{s.exit}</span>}
              {s.status !== "running" && (s.reason || s.error || s.signal) && <span className="min-w-0 truncate text-muted-foreground" title={[s.reason, s.error, s.signal].filter(Boolean).join(" · ")}>{[s.reason, s.error, s.signal].filter(Boolean).join(" · ")}</span>}
            </button>
          ))}
        </div>
      </PaneHeader>
      {!terminal && <Empty>This desk has no terminal artifact.</Empty>}
      {terminal && !session && <Empty>No sessions yet. When an agent runs a command, its output streams here live.</Empty>}
      {session && <SessionView key={session.id} session={session} />}
    </section>
  )
}

// One session's live output (also the preview pane's {terminal} item, 2026-10-17: a build or log session the agents put
// before the owner).
export function SessionView({ session: listed }) {
  const term = useTerm(listed.id)
  // a slot session's current command: the stream hears its next one (run) before the twin and the polls do
  const session = (term?.session?.runs ?? 0) >= (listed.runs ?? 1) ? { ...listed, ...term.session } : listed
  const status = term?.status ?? session.status
  const exit = term?.exit ?? session.exit
  // The stream's lines once it answers; the twin's tail before that, or when this server has no term stream.
  const lines = React.useMemo(() => (term?.session || term?.lines?.length ? term.lines : (session.tail ?? []).map((l) => stripAnsi(l))), [term?.session, term?.lines, session.tail])
  const boxRef = React.useRef(null)
  const [stick, setStick] = React.useState(true)
  const [stopping, setStopping] = React.useState(null)

  React.useLayoutEffect(() => {
    const box = boxRef.current
    if (stick && box) box.scrollTop = box.scrollHeight
  }, [lines, stick])

  const onScroll = () => {
    const box = boxRef.current
    if (box) setStick(box.scrollHeight - box.scrollTop - box.clientHeight <= SLACK)
  }

  const stop = async () => {
    setStopping("stopping…")
    try {
      await stopSession(session.id)
      setStopping(null)
    } catch (e) {
      setStopping(e.message)
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 break-all font-mono text-foreground/90">$ {session.command}</span>
        {session.cwd && <span className="font-mono">in {session.cwd}</span>}
        {session.agent && <span>by {session.agent}</span>}
        {session.startedAt && <span>{clock(session.startedAt)}</span>}
        {session.slot && session.runs > 1 && <span className="tabular-nums">command {session.runs}</span>}
        <LeaseBadge lease={session.lease} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className={cn("rounded-md border px-1.5 leading-5", status === "running" ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-300" : status === "failed" ? "border-red-500/60 text-red-700 dark:text-red-300" : "")}>
            {status ?? "unknown"}
            {status !== "running" && exit != null ? ` · exit ${exit}` : ""}
          </span>
          {term?.live && status === "running" && <span className="text-emerald-600 dark:text-emerald-400">live</span>}
          {status === "running" && (
            <button type="button" onClick={stop} disabled={!!stopping} aria-label="Stop this session" className="flex h-6 items-center gap-1 rounded-md border px-1.5 hover:text-foreground disabled:opacity-50 pointer-coarse:h-10">
              <SquareIcon className="size-3" /> Stop
            </button>
          )}
        </span>
        {stopping && stopping !== "stopping…" && <span className="w-full text-red-700 dark:text-red-400">{stopping}</span>}
      </div>
      {(session.urls ?? []).length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b px-2 py-0.5 text-[11px]">
          {session.urls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center font-mono text-sky-700 hover:underline pointer-coarse:min-h-10 dark:text-sky-300">
              {u}
            </a>
          ))}
        </div>
      )}
      <pre ref={boxRef} onScroll={onScroll} aria-live="off" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-2 py-1 font-mono text-[12px] leading-5">
        {term?.dropped > 0 && <span className="text-muted-foreground">{`… ${term.dropped} earlier lines (term/read has them)\n`}</span>}
        {lines.join("\n") || <span className="text-muted-foreground">(no output yet)</span>}
      </pre>
      {term?.error && !term.session && <p className="shrink-0 border-t px-2 py-0.5 text-[11px] text-muted-foreground">{term.error} Showing the artifact's last lines.</p>}
      {!stick && (
        <button
          type="button"
          onClick={() => setStick(true)}
          className="absolute right-3 bottom-3 flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-xs shadow-sm hover:text-foreground pointer-coarse:h-10"
        >
          <ArrowDownToLineIcon className="size-3.5" /> Follow output
        </button>
      )}
    </div>
  )
}
