"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { describeActivity } from "@/backend/live/activity"
import { detectHost } from "@/backend/live/host"
import { registry } from "@/backend/live/registry"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDeskLog, useEngineState, useEngines } from "@/hooks/use-engines"
import { engineTone, initials } from "@/lib/engine-tone"
import { ROUTES } from "@/lib/config"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// The status bar: a thin strip pinned to the bottom of every page, showing live state at a glance — where the
// desk runs, every agent's status, the desk's newest background line, and what the selected agent is doing and
// what its model calls cost. It only reads state (registry, agent snapshots, the desk log), like every other view.
//
// Add an item: a component built on <StatusItem>, placed in the left group (overall state) or the right group
// (the selected agent).

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
  const { status } = useEngines() // probed again when the tab's desk changes (2026-10-20: an agent in this browser)
  React.useEffect(() => {
    detectHost().then(setHost)
  }, [status])
  if (!host) return null
  const local = host.mode === "local"
  const browser = host.mode === "browser"
  const name = local ? (host.desk?.name ?? host.root.split(/[\\/]/).filter(Boolean).at(-1)) : null
  return (
    <StatusItem
      aria-label={local ? `Desk ${name} on this computer, workspace ${host.root}` : browser ? "An agent runs in this browser" : "No desk server"}
      tip={local ? <span className="break-all">Desk {name} · {host.root}</span> : browser ? "A single agent runs in this tab against the model you named; the terminal and other desks need the desk server" : "No desk server answers here: start it with bun run dev, or run an agent in this browser"}
    >
      <Dot className={local || browser ? "bg-emerald-500" : "bg-amber-500"} />
      <span className="max-w-32 truncate max-sm:hidden">{local ? name : browser ? "This browser" : "No desk"}</span>
    </StatusItem>
  )
}

function EngineItem({ engine, active }) {
  const router = useRouter()
  const state = useEngineState(engine)
  const tone = engineTone(state)
  return (
    <StatusItem
      onClick={() => {
        registry.select(engine.id)
        router.push(agentHref(engine.name))
      }}
      aria-label={`${engine.name}: ${tone.word}`}
      className={cn(active && "text-foreground")}
      tip={
        <>
          <span className="text-foreground">
            {engine.name} · {tone.word}
          </span>
          {engine.description && <span className="line-clamp-3">{engine.description}</span>}
          {state?.error && <span className="text-destructive">{state.error}</span>}
          <span className="text-muted-foreground">Open its page</span>
        </>
      }
    >
      <Dot className={tone.dot} />
      <span className="sm:hidden">{initials(engine.name)}</span>
      <span className="max-w-24 truncate max-sm:hidden">{engine.name}</span>
    </StatusItem>
  )
}

// ── right ──────────────────────────────────────────────────────────────────

// The desk's newest background line (watchers, schedule, wakes, Telegram); the whole log is on the Live page.
function DeskLogItem() {
  const router = useRouter()
  const lines = useDeskLog()
  const last = lines.at(-1)
  if (!last) return null
  return (
    <StatusItem
      onClick={() => router.push(`${ROUTES.live}?tab=desk`)}
      aria-label={`Desk log: ${last.text}. Open the desk log`}
      tip={
        <>
          <span className="text-foreground">{new Date(last.at).toLocaleTimeString()} · {last.source}</span>
          <span className="break-words">{last.text}</span>
          <span className="text-muted-foreground">Open the desk log</span>
        </>
      }
      className="min-w-0 shrink max-md:hidden"
    >
      <span className="max-w-64 truncate">{last.text}</span>
    </StatusItem>
  )
}

function ActivityItem({ engine, state }) {
  if (!state || (state.status !== "running" && state.activity?.phase !== "waiting")) return null
  const text = describeActivity(state.activity)
  return (
    <StatusItem tip={`${engine.name} · ${text}`} className="min-w-0 shrink" aria-live="polite">
      <span className="truncate">{text}</span>
    </StatusItem>
  )
}

const seconds = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

// The selected agent's model and its model calls (kernel step stats: count, latency, prompt size).
function ModelItem({ engine, state }) {
  if (!engine || !state) return null
  const stats = state.stats
  return (
    <StatusItem
      aria-label={`${engine.name}'s model: ${engine.model ?? "the desk's default"}`}
      tip={
        <>
          <span className="text-foreground">{engine.name} · {engine.model ?? "the desk's default model"}</span>
          {stats ? (
            <>
              <span>{stats.calls} model call{stats.calls === 1 ? "" : "s"} · last {seconds(stats.lastMs)} · average {seconds(stats.avgMs)}</span>
              <span>last prompt {stats.promptChars?.toLocaleString()} chars · reply {stats.replyChars?.toLocaleString()} chars</span>
            </>
          ) : (
            <span>No model calls since the desk started.</span>
          )}
        </>
      }
    >
      <span className="max-w-32 truncate">{engine.model ?? "default"}</span>
      {stats && <span className="tabular-nums max-md:hidden">{stats.calls}× · {seconds(stats.lastMs)}</span>}
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
        {status === "connecting" && <StatusItem>Connecting to the desk…</StatusItem>}
        {status === "error" && <StatusItem className="text-destructive">The desk failed to start</StatusItem>}
        {engines.map((engine) => (
          <EngineItem key={engine.id} engine={engine} active={engine.id === activeId} />
        ))}
      </div>
      <div className="flex min-w-0 items-stretch justify-end">
        <DeskLogItem />
        <ActivityItem engine={active} state={state} />
        <ModelItem engine={active} state={state} />
      </div>
    </footer>
  )
}
