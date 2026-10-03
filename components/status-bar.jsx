"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { describeActivity } from "@/backend/core/activity"
import { formatTokens } from "@/backend/models/metrics"
import { detectHost } from "@/backend/platform/host"
import { engineRegistry } from "@/backend/runtime/registry"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEngineState, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The status bar: a thin strip pinned to the bottom of every page, showing
// live state at a glance — where ASKK runs, every agent's status, and what
// the selected agent is doing. It only reads state (registry, engine
// snapshots), like every other view.
//
// Add an item: a component built on <StatusItem>, placed in the left group
// (overall state) or the right group (the selected agent).

// One item: compact text with an optional tooltip; a button when clickable.
function StatusItem({ tip, onClick, className, children, ...props }) {
  const Item = onClick ? "button" : "div"
  const item = (
    <Item
      type={onClick ? "button" : undefined}
      onClick={onClick}
      tabIndex={onClick ? undefined : 0}
      className={cn(
        "flex h-full min-w-0 shrink-0 items-center gap-1.5 px-2 outline-none focus-visible:bg-accent focus-visible:text-foreground",
        "pointer-coarse:min-w-10 pointer-coarse:justify-center",
        onClick && "hover:bg-accent hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Item>
  )
  if (!tip) return item
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent side="top" className="flex max-w-80 flex-col gap-0.5 text-left">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

const Dot = ({ className }) => <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} />

// ── left: overall state ────────────────────────────────────────────────────

function HostItem() {
  const [host, setHost] = React.useState(null)
  React.useEffect(() => {
    detectHost().then(setHost)
  }, [])
  if (!host) return null
  const local = host.mode === "local"
  const folder = local ? host.root.split(/[\\/]/).filter(Boolean).at(-1) : null
  return (
    <StatusItem
      aria-label={local ? `Running on this computer, workspace ${host.root}` : "Running in the browser only"}
      tip={local ? <span className="break-all">This computer · {host.root}</span> : "Browser only: files are kept in this browser"}
    >
      <Dot className={local ? "bg-emerald-500" : "bg-amber-500"} />
      <span className="max-w-32 truncate max-sm:hidden">{local ? folder : "Browser"}</span>
    </StatusItem>
  )
}

// What an engine's dot and words say about its state.
function engineTone(state) {
  if (!state) return { dot: "bg-muted-foreground/40", word: "starting" }
  if (state.approvals?.length) return { dot: "bg-amber-500 animate-pulse", word: "needs your approval" }
  if (state.status === "error") return { dot: "bg-destructive", word: "error" }
  if (state.status === "running") return { dot: "bg-emerald-500 animate-pulse", word: describeActivity(state.activity) }
  if (state.activity?.phase === "waiting") return { dot: "bg-amber-500", word: describeActivity(state.activity) }
  return { dot: "bg-muted-foreground/40", word: "idle" }
}

// "planner" -> "Pl", "planner 2" -> "Pl2" (as in the engine bar)
function initials(name) {
  const [word, suffix = ""] = name.split(" ")
  return word.slice(0, 1).toUpperCase() + word.slice(1, 2) + suffix
}

function EngineItem({ engine, active }) {
  const router = useRouter()
  const state = useEngineState(engine)
  const tone = engineTone(state)
  const approvals = state?.approvals?.length ?? 0
  const quests = state?.quests ?? []
  const queued = state?.inbox?.length ?? 0

  return (
    <StatusItem
      onClick={() => {
        engineRegistry.select(engine.id)
        router.push("/chat")
      }}
      aria-label={`${engine.name}: ${tone.word}${approvals ? `, ${approvals} waiting for approval` : ""}`}
      className={cn(active && "text-foreground")}
      tip={
        <>
          <span className="text-foreground">
            {engine.name} · {tone.word}
          </span>
          {state?.error && <span className="text-destructive">{state.error}</span>}
          {approvals > 0 && <span>{approvals} change{approvals > 1 ? "s" : ""} waiting for your approval</span>}
          {quests.map((q) => (
            <span key={q.id} className="truncate">
              Quest out → {q.to}: {q.text}
            </span>
          ))}
          {queued > 0 && <span>{queued} letter{queued > 1 ? "s" : ""} in its inbox</span>}
          <span className="text-muted-foreground">Open its chat</span>
        </>
      }
    >
      <Dot className={tone.dot} />
      <span className="sm:hidden">{initials(engine.name)}</span>
      <span className="max-w-24 truncate max-sm:hidden">{engine.name}</span>
      {approvals > 0 && (
        <span className="rounded-full bg-amber-500 px-1 text-[10px] leading-3.5 text-black tabular-nums">{approvals}</span>
      )}
    </StatusItem>
  )
}

// ── right: the selected agent ──────────────────────────────────────────────

function ActivityItem({ engine, state }) {
  if (!state || (state.status !== "running" && state.activity?.phase !== "waiting")) return null
  const text = describeActivity(state.activity)
  return (
    <StatusItem tip={`${engine.name} · ${text}`} className="min-w-0 shrink" aria-live="polite">
      <span className="truncate">{text}</span>
    </StatusItem>
  )
}

function ModelItem({ engine, state }) {
  if (!state) return null
  const model = engine.model
  const stats = state.stats
  const window = state.contextWindow ?? stats?.contextWindow ?? null
  const used = stats?.contextUsed ?? null
  const percent = used != null && window ? Math.round(Math.min(100, (used / window) * 100)) : null
  const approx = stats?.estimated ? "~" : ""
  const speed = stats?.tokensPerSecond != null ? `${approx}${stats.tokensPerSecond.toFixed(1)} tok/s` : null
  return (
    <StatusItem
      className="max-md:hidden"
      tip={
        <>
          <span className="text-foreground">{model ? `${model.key} · ${model.id}` : "No model: add one in Settings"}</span>
          <span>
            Context {approx}
            {formatTokens(used)} of {formatTokens(window)} tokens
          </span>
        </>
      }
    >
      <span className={cn("max-w-32 truncate", !model && "text-destructive")}>{model?.key ?? "no model"}</span>
      {speed && <span className="tabular-nums">{speed}</span>}
      {percent != null && <span className="tabular-nums">ctx {percent}%</span>}
    </StatusItem>
  )
}

export function StatusBar() {
  const { engines, activeId, status } = useEngines()
  const active = engines.find((e) => e.id === activeId) ?? null
  const state = useEngineState(active)

  return (
    <footer
      aria-label="Status"
      className="box-content flex h-7 shrink-0 items-stretch justify-between gap-2 border-t pb-[env(safe-area-inset-bottom)] text-xs text-muted-foreground pointer-coarse:h-10"
    >
      <div className="flex min-w-0 items-stretch overflow-x-auto">
        <HostItem />
        {status === "loading" && <StatusItem>Starting agents…</StatusItem>}
        {status === "error" && <StatusItem className="text-destructive">Agents failed to start</StatusItem>}
        {engines.map((engine) => (
          <EngineItem key={engine.id} engine={engine} active={engine.id === activeId} />
        ))}
      </div>
      <div className="flex min-w-0 items-stretch justify-end">
        <ActivityItem engine={active} state={state} />
        <ModelItem engine={active} state={state} />
      </div>
    </footer>
  )
}
