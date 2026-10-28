"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

import { ProgressBar, StatusDot, tone, useActivity, useWorkflow } from "./flow"
import { WorkflowViewer } from "./viewer"

// A workflow artifact (view pipeline) wherever an artifact is drawn (components/views/artifact.jsx). 2026-10-22 owner:
// "I want the workflow UI in the dashboard page itself. There on expanding the workflow card, show this view" and "the
// live dialogue box to show the status": closed (the dashboard's tile, a card) its live status — the run's state and
// time, its progress phase by phase, what each running phase does right now (its agent's activity), what it is for,
// the decision, what waits for the owner; expanded (the tile opened big) the whole viewer (./viewer.jsx).

export function WorkflowArtifact({ id, artifact, state, expanded }) {
  if (expanded) return <WorkflowViewer id={id} artifact={artifact ?? { id, state }} embedded />
  return <WorkflowTile state={state} />
}

function WorkflowTile({ state }) {
  const { running, v, cfg, cards, progress, live } = useWorkflow(state)
  const t = tone(v.status === "idle" ? "waiting" : v.status)
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1.5" aria-live="polite">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
        <StatusDot status={v.status === "idle" ? "waiting" : v.status} />
        <span className={cn("rounded border px-1", t.card, t.text)}>{v.run ? v.status : "no run today"}</span>
        {v.run && <span className="text-muted-foreground tabular-nums">{v.run.elapsed}{!running && v.run.started ? ` · ${v.run.started} ET` : ""}</span>}
        {v.result?.decision && <span className="rounded border px-1 text-foreground">{v.result.decision}</span>}
        {v.pending.length > 0 && <span className="text-amber-700 dark:text-amber-400">{v.pending.length} waiting for you</span>}
      </div>
      {cfg?.error ? <p className="line-clamp-2 text-[11px] break-words text-red-700 dark:text-red-400">does not load: {cfg.error}</p> : <ProgressBar progress={progress} />}
      {live.map((it) => <NowLine key={it.id} item={it} />)}
      {!live.length && v.run?.request && <p className="truncate text-[11px] text-muted-foreground">for <span className="text-foreground/80">{v.run.request}</span></p>}
      {!live.length && !v.run && cards.length > 0 && <p className="truncate font-mono text-[11px] text-muted-foreground">{cards.map((c) => c.id).join(" → ")}</p>}
    </div>
  )
}

// One running phase in a line: its title, time, turns and calls; under it what its agent does now.
function NowLine({ item }) {
  const doing = useActivity(item.agent)
  return (
    <div className="flex min-w-0 flex-col border-l-2 border-emerald-500/60 pl-1.5 text-[11px]">
      <span className="flex min-w-0 gap-1.5">
        <span className="min-w-0 truncate text-foreground">{item.title}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{item.text}</span>
      </span>
      {doing && <span className="truncate text-emerald-700 dark:text-emerald-400">{doing}</span>}
    </div>
  )
}
