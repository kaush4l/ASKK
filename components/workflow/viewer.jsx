"use client"

import * as React from "react"
import { PencilLineIcon, PlayIcon, SquareIcon } from "lucide-react"

import { followStage, pipelineView, runWorkflow } from "@/backend/live/pipeline"
import { nowLine, phaseCards, progressOf } from "@/backend/live/workflow-view"
import { Button } from "@/components/ui/button"
import { LiveLog, Outcome, useCalls, useNow } from "@/components/views/pipeline"
import { cn } from "@/lib/utils"

import { WorkflowEditor } from "./editor"
import { FlowColumn, NowStrip, ProgressBar, StatusDot, tone } from "./flow"
import { PhaseDetail } from "./phase"

// The workflow viewer (2026-10-22 owner: "a specific workflow viewer where the phase can see and the prompt and variables
// and the last output. The UI should follow live the workflow progress"; then "no separation of elements … give live
// feedback of the state and keep it informative … configuration driven … editable"; then "I want the workflow UI in the
// dashboard page itself. There on expanding the workflow card, show this view"). A workflow is a loop over phases that
// hand data on as variables, so it draws the process: the run (what it is for, its progress phase by phase, what runs
// right now), the flow (each phase with how it runs, what it reads and what it hands on), the phase shown as INPUT →
// WORK → OUTPUT, and what the run produced (the desk's outcome: its result, report, learnings waiting for the owner).
// Following, it moves to the phase that runs; a click stays on a phase until Follow. The workflow's file is edited here,
// checked as you type (./editor.jsx). It is the expanded view of every workflow artifact (view pipeline: ./card.jsx) —
// the dashboard card opened big. Everything is the artifact's twin from the team stream; a phase's whole detail is read
// again when its row changes, never polled. embedded: inside the big view (its head already names the workflow).

export function WorkflowViewer({ id, artifact, embedded = false, initial = null, onRoute = () => {} }) {
  const state = artifact?.state ?? {}
  const running = state.status === "running"
  const now = useNow(running)
  const v = pipelineView(state, { now })
  const cfg = state.config ?? null
  const cards = phaseCards(cfg, v.stages)
  const progress = progressOf(cards)
  const live = nowLine(cards, { status: v.status })
  const [calls, call] = useCalls(id)
  const [following, setFollowing] = React.useState(!initial)
  const [picked, setPicked] = React.useState(initial)
  const [editing, setEditing] = React.useState(null) // {focus: phase id | null} while the file is open
  const [start, setStart] = React.useState({ busy: false, error: null })
  const follow = followStage(
    cards.map((c) => ({ id: c.id, status: c.status, startedAt: c.row?.startedAt ?? null })),
    running,
  )
  const selectedId = following ? follow : cards.some((c) => c.id === picked) ? picked : follow
  const card = cards.find((c) => c.id === selectedId) ?? null
  const pick = (sid) => {
    setFollowing(false)
    setPicked(sid)
    onRoute(sid)
  }
  const go = async (o) => {
    setStart({ busy: true, error: null })
    try {
      await runWorkflow(id, o)
      setStart({ busy: false, error: null })
      setFollowing(true)
    } catch (error) {
      setStart({ busy: false, error: error?.message ?? String(error) })
    }
  }
  const title = cfg?.title ?? artifact?.title ?? id

  // Embedded (the dashboard card opened big, 2026-10-22 owner: "The trade card scroll is too much. Limit the size to a view
  // point and make the internal content scroll area"): on a wide screen the viewer fills the dialog — the header and the
  // run stay put, the phases and the phase shown (with the outcome, runs and log under it) scroll each in its own area. A
  // phone's sheet keeps one scroll.
  const fit = embedded && !editing
  const below = (
    <>
      <Outcome id={id} v={v} calls={calls} call={call} />
      {v.runs.length > 0 && <Runs runs={v.runs} current={v.run?.id} revision={cfg?.revision} />}
      {v.log.length > 0 && <LiveLog lines={v.log} running={running} />}
    </>
  )
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", fit && "lg:min-h-0 lg:flex-1")}>
      <header className="flex min-w-0 shrink-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {!embedded && (
            <>
              <h1 className="min-w-0 text-xl break-words text-foreground">{title}</h1>
              <span className="font-mono text-xs text-muted-foreground">{id}</span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Button type="button" size="xs" variant={following ? "outline" : "ghost"} aria-pressed={following} className="h-7 px-2 text-[11px] pointer-coarse:h-10" onClick={() => setFollowing((f) => !f)} title={following ? "The viewer moves to the phase that runs; click to stay on this one" : "Follow the run: show the phase that runs"}>
              <span className={cn("mr-1 inline-block size-1.5 rounded-full", following ? "bg-emerald-500" : "bg-muted-foreground/40", following && running && "motion-safe:animate-pulse")} aria-hidden />
              {following ? "Following" : "Follow live"}
            </Button>
            {cfg?.editable && !editing && (
              <Button type="button" size="xs" variant="outline" className="h-7 gap-1 px-2 text-[11px] pointer-coarse:h-10" onClick={() => setEditing({ focus: null })}>
                <PencilLineIcon aria-hidden className="size-3" /> Edit workflow
              </Button>
            )}
          </span>
        </div>
        {cfg?.description && <Description text={cfg.description} />}
        {v.config?.error && <p className="text-xs break-words text-red-700 dark:text-red-400">The workflow does not load: {v.config.error}{cfg?.editable === false ? "" : " — Edit workflow to fix it."}</p>}
        {/* 2026-10-23 audit: the configuration as it runs (configView) — the run-wide settings, a desk's own from code included,
            and each step's how / waits / reads / contract */}
        {v.config && !v.config.error && (v.config.settings?.length > 0 || v.config.steps?.length > 0) && (
          <details data-config className="min-w-0 rounded-md border px-2 py-1 text-[11px]">
            <summary className="flex min-h-7 cursor-pointer list-none flex-wrap items-center gap-x-1.5 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
              <span className="text-foreground/90">Configuration</span>
              {v.config.folder && <span className="font-mono break-all text-muted-foreground">{v.config.folder}</span>}
              <span className="min-w-0 break-words text-muted-foreground">{v.config.settings.join(" · ")}</span>
            </summary>
            <ul className="flex min-w-0 flex-col gap-0.5 pb-1">
              {v.config.steps.map((x) => (
                <li key={x.id} className="min-w-0 break-words text-muted-foreground">
                  <span className="font-mono text-foreground/90">{x.id}</span> · {x.runs}
                  {x.waits ? ` · after ${x.waits}` : ""}
                  {x.reads ? ` · reads ${x.reads}` : ""}
                  {x.contract ? ` · ${x.contract}` : ""}
                  {x.kind === "code" && x.barrier ? " · barrier" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>

      <div className="shrink-0">
        <RunPanel v={v} cfg={cfg} running={running} progress={progress} live={live} selected={selectedId} onPick={pick} onRun={go} start={start} calls={calls} call={call} />
      </div>

      {editing ? (
        <WorkflowEditor id={id} config={cfg} focus={editing.focus} onClose={() => setEditing(null)} />
      ) : (
        <div className={cn("grid min-w-0 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]", fit && "lg:min-h-0 lg:flex-1")}>
          <div className={cn("min-w-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1", fit ? "lg:min-h-0" : "lg:sticky lg:top-2 lg:max-h-[calc(100svh-1rem)] lg:self-start")}>
            <FlowColumn cards={cards} selected={selectedId} onPick={pick} following={following} />
          </div>
          <div className={cn("flex min-w-0 flex-col gap-3", fit && "lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1")}>
            {card ? (
              <PhaseDetail key={card.id} id={id} card={card} running={running} editable={!!cfg?.editable} onEdit={(sid) => setEditing({ focus: sid })} onRunFrom={(sid) => go({ from: sid, request: state.run?.request ?? "", vars: state.run?.vars ?? null })} runBusy={start.busy} />
            ) : (
              <p className="text-sm text-muted-foreground">No phases.</p>
            )}
            {fit && <div className="hidden min-w-0 flex-col gap-3 lg:flex">{below}</div>}
          </div>
        </div>
      )}

      <div className={cn("flex min-w-0 flex-col gap-3", fit && "lg:hidden")}>{below}</div>
    </div>
  )
}

// The workflow's own words (the text before its first phase): two lines, the rest on a click.
function Description({ text }) {
  const [open, setOpen] = React.useState(false)
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} className={cn("min-w-0 text-left text-sm break-words whitespace-pre-line text-muted-foreground", !open && "line-clamp-2")} title={open ? "Show less" : "Show all"}>
      {text}
    </button>
  )
}

// The run: what it is for and by whom, its progress phase by phase, what runs right now — Stop while it runs; idle, the
// Run box with the workflow's own variables (its `vars:`, their defaults filled in).
function RunPanel({ v, cfg, running, progress, live, selected, onPick, onRun, start, calls, call }) {
  const declared = cfg?.vars ?? {}
  const usesRequest = (cfg?.steps ?? []).some((s) => (s.uses ?? []).includes("request") || s.kind === "phase")
  const [request, setRequest] = React.useState("")
  const [vars, setVars] = React.useState(() => ({ ...declared }))
  const t = tone(v.status === "idle" ? "waiting" : v.status)
  return (
    <section aria-label="The run" className={cn("flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5", running ? "border-emerald-500/60" : "border-border")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <StatusDot status={v.status === "idle" ? "waiting" : v.status} />
        <span className={cn("rounded border px-1.5", t.card, t.text)}>{v.status}</span>
        {v.run ? (
          <span className="min-w-0 break-words text-muted-foreground tabular-nums">
            run {v.run.id} · by {v.run.by} · {v.run.started} ET{v.run.elapsed ? ` · ${v.run.elapsed}` : ""}
            {v.run.from ? ` · from ${v.run.from}` : ""}
            {v.run.deadline ? ` · deadline ${v.run.deadline} ET` : ""}
            {v.run.note ? ` · note: ${v.run.note}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">no run today</span>
        )}
        {v.result?.decision && <span className="rounded border px-1.5 text-foreground">{v.result.decision}</span>}
        {v.pending.length > 0 && <span className="rounded border border-amber-500/60 px-1.5 text-amber-700 dark:text-amber-400">{v.pending.length} waiting for you</span>}
        {/* 2026-10-23: the learnings already accepted, and the desk's own line on its prompts (trade-card: owner / merged) */}
        {v.accepted > 0 && <span className="rounded border px-1.5 text-muted-foreground">{v.accepted} learnings in force</span>}
        {v.prompts && <span className="rounded border px-1.5 text-muted-foreground">prompts: {v.prompts}</span>}
        {running && (
          <Button type="button" variant="destructive" size="xs" className="ml-auto h-7 gap-1 px-2 text-[11px] pointer-coarse:h-10" disabled={calls.stop?.busy} onClick={() => call("stop", "stop")}>
            <SquareIcon aria-hidden className="size-3" /> {calls.stop?.busy ? "Stopping…" : "Stop"}
          </Button>
        )}
      </div>
      {v.run?.request && (
        <p className="min-w-0 text-sm break-words text-foreground/90">
          <span className="text-[11px] text-muted-foreground">for </span>
          {v.run.request}
          {v.run.vars && Object.keys(v.run.vars).length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {" "}
              · {Object.entries(v.run.vars).map(([k, x]) => `${k}: ${x}`).join(" · ")}
            </span>
          )}
        </p>
      )}
      <ProgressBar progress={progress} onPick={onPick} selected={selected} />
      <NowStrip items={live} onPick={onPick} />
      {calls.stop?.error && <p className="text-[11px] text-red-700 dark:text-red-400">Not stopped: {calls.stop.error}</p>}
      {!running && (
        <form
          className="flex min-w-0 flex-col gap-1.5 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            onRun({ request: request.trim(), vars })
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder={usesRequest ? "What this run is for ({{request}})" : "Note for this run (optional)"} aria-label="Request for this run" className="h-8 min-w-0 flex-1 rounded border bg-transparent px-2 text-base sm:text-xs pointer-coarse:h-10" />
            <Button type="submit" size="xs" className="h-8 gap-1 px-3 text-[11px] pointer-coarse:h-10" disabled={start.busy}>
              <PlayIcon aria-hidden className="size-3" /> {start.busy ? "Starting…" : "Run"}
            </Button>
          </div>
          {Object.keys(declared).length > 0 && (
            <div className="grid min-w-0 gap-1.5 sm:grid-cols-2">
              {Object.keys(declared).map((k) => (
                <label key={k} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="w-20 shrink-0 truncate font-mono" title={`{{${k}}}`}>
                    {k}
                  </span>
                  <input value={vars[k] ?? ""} onChange={(e) => setVars((x) => ({ ...x, [k]: e.target.value }))} aria-label={`Run variable ${k}`} className="h-8 min-w-0 flex-1 rounded border bg-transparent px-2 text-base text-foreground sm:text-xs pointer-coarse:h-10" />
                </label>
              ))}
            </div>
          )}
          {start.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{start.error}</p>}
        </form>
      )}
    </section>
  )
}

// Today's runs, newest first: each with its status, who ran it, what it was for and whether the workflow file changed
// since (the revision it ran with).
function Runs({ runs, current, revision }) {
  return (
    <details className="min-w-0 rounded-md border px-2 py-1 text-[11px]">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
        <span className="text-foreground/90">Runs today</span>
        <span className="text-muted-foreground">{runs.length}</span>
      </summary>
      <ul className="flex min-w-0 flex-col gap-0.5 pb-1">
        {runs.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-2">
            <StatusDot status={r.status} />
            <span className={cn("font-mono", r.id === current ? "text-foreground" : "text-muted-foreground")}>{r.id}</span>
            <span className="text-muted-foreground">
              {r.status} · by {r.by}
              {r.startedAt ? ` · ${r.startedAt}${r.endedAt ? `–${r.endedAt}` : ""} ET` : ""}
              {r.from ? ` · from ${r.from}` : ""}
              {r.decision ? ` · ${r.decision}` : ""}
            </span>
            {r.revision && revision && r.revision !== revision && <span className="text-amber-700 dark:text-amber-400">· older wording</span>}
            {r.request && <span className="min-w-0 basis-full truncate pl-3.5 text-muted-foreground">{r.request}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}
