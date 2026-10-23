"use client"

import * as React from "react"
import { ArrowDownIcon, BotIcon, CodeIcon, GlobeIcon, PencilLineIcon, SparklesIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { flowLayout } from "@/backend/live/workflow-view"
import { useEngines, useEngineState } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The flow of a workflow (components/workflow/workflow-page.jsx): the run's progress by phase, what runs right now, and
// the phases in order — each a card with how it runs, what it reads (in) and what it hands on (out), its live state. The
// same cards draw a draft in the editor (no run: no state).

export const TONE = {
  running: { dot: "bg-emerald-500 motion-safe:animate-pulse", card: "border-emerald-500/70", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500 motion-safe:animate-pulse" },
  done: { dot: "bg-sky-500", card: "border-sky-500/40", text: "text-sky-700 dark:text-sky-400", bar: "bg-sky-500" },
  reused: { dot: "bg-sky-500/40", card: "border-sky-500/25", text: "text-sky-700/80 dark:text-sky-400/80", bar: "bg-sky-500/40" },
  failed: { dot: "bg-red-500", card: "border-red-500/60", text: "text-red-700 dark:text-red-400", bar: "bg-red-500" },
  stopped: { dot: "bg-amber-500", card: "border-amber-500/50", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  interrupted: { dot: "bg-amber-500", card: "border-amber-500/50", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  skipped: { dot: "bg-muted-foreground/40", card: "border-border", text: "text-muted-foreground", bar: "bg-muted-foreground/30" },
  waiting: { dot: "border border-muted-foreground/50", card: "border-dashed border-border", text: "text-muted-foreground", bar: "bg-muted-foreground/15" },
}
export const tone = (status) => TONE[status] ?? TONE.waiting

export const StatusDot = ({ status, className }) => <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", tone(status).dot, className)} />

const KIND_ICON = { agent: BotIcon, "own agent": SparklesIcon, research: GlobeIcon, code: CodeIcon }
export function KindIcon({ label, className }) {
  const Icon = KIND_ICON[label] ?? BotIcon
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />
}

// A variable or field as a chip: from the run (plain), from an upstream phase (violet), a field handed on (sky).
export function Chip({ children, kind = "run", title, className }) {
  const k = { run: "border-border text-muted-foreground", field: "border-violet-500/50 text-violet-700 dark:text-violet-300", report: "border-violet-500/50 text-violet-700 dark:text-violet-300", out: "border-sky-500/50 text-sky-700 dark:text-sky-300", board: "border-dashed border-border text-muted-foreground", document: "border-violet-500/30 text-violet-700/80 dark:text-violet-300/80", all: "border-violet-500/30 text-violet-700/80 dark:text-violet-300/80" }
  return (
    <span title={title} className={cn("inline-flex max-w-full min-w-0 items-center truncate rounded border px-1 font-mono text-[11px] leading-4", k[kind] ?? k.run, className)}>
      {children}
    </span>
  )
}

// The run's progress: one segment per phase in its status's colour, how many settled. With onPick each segment shows
// its phase; without (a tile) it only draws.
export function ProgressBar({ progress, onPick, selected }) {
  if (!progress.total) return null
  const seg = (s) => cn("h-full min-w-1 flex-1 rounded-sm", tone(s.status).bar, s.id === selected && "ring-1 ring-foreground/60 ring-offset-1 ring-offset-background")
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-2 min-w-0 flex-1 gap-0.5" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.settled} aria-label="Phases settled">
        {progress.segments.map((s) => (onPick ? <button key={s.id} type="button" title={`${s.id}: ${s.status}`} onClick={() => onPick(s.id)} className={seg(s)} /> : <span key={s.id} title={`${s.id}: ${s.status}`} className={seg(s)} />))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {progress.settled}/{progress.total}
      </span>
    </div>
  )
}

// What an agent is doing now, from its live state (its last call or thought).
export function useActivity(name) {
  const { engines } = useEngines()
  const engine = name ? (engines.find((e) => e.name === name) ?? null) : null
  const st = useEngineState(engine)
  return st?.status === "running" && st?.activity ? describeActivity(st.activity) : ""
}

function NowItem({ item, onPick }) {
  const doing = useActivity(item.agent)
  return (
    <button type="button" onClick={() => onPick(item.id)} className="flex min-h-8 min-w-0 items-center gap-2 rounded-md border border-emerald-500/50 px-2 text-left text-xs pointer-coarse:min-h-10">
      <StatusDot status="running" />
      <span className="shrink-0 text-foreground">{item.title}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{item.text}</span>
      {doing && <span className="min-w-0 truncate text-muted-foreground">· {doing}</span>}
    </button>
  )
}

// The live line: every phase running right now (a click shows it), what its agent does.
export function NowStrip({ items, onPick }) {
  if (!items.length) return null
  return (
    <div className="flex min-w-0 flex-col gap-1" aria-live="polite">
      {items.map((it) => (
        <NowItem key={it.id} item={it} onPick={onPick} />
      ))}
    </div>
  )
}

// One phase as a card: status, number and title, how it runs, in → out, its time; running: what it does now.
function PhaseCard({ card, selected, onPick, compact = false, changed = false }) {
  const t = tone(card.status)
  const doing = useActivity(card.status === "running" ? card.agent : null)
  const ins = [...card.reads.vars, ...card.reads.inputs]
  return (
    <button
      type="button"
      data-phase={card.id}
      aria-current={selected ? "step" : undefined}
      onClick={() => onPick?.(card.id)}
      className={cn("flex w-full min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors", t.card, selected ? "ring-1 ring-foreground/70" : "hover:border-foreground/40", compact && "w-44 shrink-0 lg:w-full")}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusDot status={card.status} />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{card.n || "·"}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{card.title}</span>
        {card.elapsed && <span className={cn("shrink-0 text-[11px] tabular-nums", t.text)}>{card.elapsed}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <KindIcon label={card.how.label} />
        <span className="min-w-0 truncate">
          {card.how.label}
          {card.how.detail ? ` · ${card.how.detail}` : ""}
        </span>
        {card.title !== card.id && <span className="ml-auto shrink-0 font-mono">{card.id}</span>}
      </span>
      {!compact && (ins.length > 0 || card.reads.board) && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="w-6 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">in</span>
          {ins.map((v) => (
            <Chip key={v.name} kind={v.kind} title={v.from === "run" ? "a run variable" : `from ${v.from}`}>
              {v.name}
            </Chip>
          ))}
          {card.reads.board && <Chip kind="board">board</Chip>}
        </span>
      )}
      {!compact && card.hands.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="w-6 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">out</span>
          {card.hands.map((h) => (
            <Chip key={h.name} kind="out" title={`{{${h.name}}}`}>
              {h.field}
            </Chip>
          ))}
        </span>
      )}
      {doing && <span className="min-w-0 truncate text-[11px] text-emerald-700 dark:text-emerald-400">{doing}</span>}
      {/* 2026-10-23: the head of what it handed on this run; while it waits, the run before's (status, when, how long) */}
      {!compact && card.row?.head && card.status !== "running" && <span data-stage-head className="min-w-0 truncate text-[11px] text-muted-foreground" title={card.row.head}>{card.row.head}</span>}
      {!compact && card.last && (card.status === "waiting" || card.status === "running") && (
        <span data-stage-last className="min-w-0 truncate text-[11px] text-muted-foreground">
          before: run {card.last.run ?? "earlier"} · {card.last.status}
          {card.last.at ? ` · ${card.last.at} ET` : ""}
          {card.last.took ? ` · ${card.last.took}` : ""}
        </span>
      )}
      {card.gate && !card.gate.ok && <span className="min-w-0 truncate text-[11px] text-amber-700 dark:text-amber-400">⚠ {card.gate.problems?.[0] ?? "check failed"}</span>}
      {card.error && card.status === "failed" && <span className="min-w-0 truncate text-[11px] text-red-700 dark:text-red-400">{card.error}</span>}
      {(card.edited || changed) && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <PencilLineIcon aria-hidden className="size-3" />
          {changed ? "changed in this draft" : "edited since this output"}
        </span>
      )}
    </button>
  )
}

// What passes from one depth to the next: the arrow, and the variables carried along it.
function Connector({ vars }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-0.5 pl-3 text-muted-foreground" aria-hidden>
      <ArrowDownIcon className="size-3.5 shrink-0" />
      {vars.length > 0 && <span className="min-w-0 truncate font-mono text-[10px]">{vars.join(" · ")}</span>}
    </div>
  )
}

// The phases in order. A wide screen: a column of full cards, phases that run together side by side, the variables
// each step carries on the arrows. A phone: a strip of compact cards that scrolls sideways (never the page).
export function FlowColumn({ cards, selected, onPick, following = false, changed = null, compactOnPhone = true }) {
  const strip = React.useRef(null)
  const { groups, edges } = flowLayout(cards.map((c) => c.step ?? { id: c.id, after: c.row?.after ?? [] }))
  const byId = new Map(cards.map((c) => [c.id, c]))
  React.useEffect(() => {
    if (!following || !selected) return
    const box = strip.current
    const el = box?.querySelector(`[data-phase="${CSS.escape(selected)}"]`)
    if (el && box && box.scrollWidth > box.clientWidth) box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2
  }, [selected, following])
  return (
    <nav aria-label="Phases" className="min-w-0">
      {compactOnPhone && (
        <div ref={strip} className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 lg:hidden">
          {cards.map((c) => (
            <PhaseCard key={c.id} card={c} selected={c.id === selected} onPick={onPick} compact changed={changed?.has(c.id)} />
          ))}
        </div>
      )}
      <ol className={cn("min-w-0 flex-col", compactOnPhone ? "hidden lg:flex" : "flex")}>
        {groups.map((ids, gi) => {
          const into = gi ? [...new Set(edges.filter((e) => ids.includes(e.to)).flatMap((e) => e.vars))] : []
          return (
            <li key={ids.join("+")} className="flex min-w-0 flex-col">
              {gi > 0 && <Connector vars={into} />}
              <div className={cn("grid min-w-0 gap-1.5", ids.length > 1 && "grid-cols-2 rounded-lg border border-dashed p-1.5")}>
                {ids.length > 1 && <span className="col-span-2 text-[10px] tracking-wide text-muted-foreground uppercase">run together</span>}
                {ids.map((id) => byId.get(id) && <PhaseCard key={id} card={byId.get(id)} selected={id === selected} onPick={onPick} changed={changed?.has(id)} />)}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
