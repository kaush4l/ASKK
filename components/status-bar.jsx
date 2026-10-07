"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { describeActivity } from "@/backend/core/activity"
import { models } from "@/backend/models/catalog"
import { formatTokens } from "@/backend/models/metrics"
import { detectHost } from "@/backend/platform/host"
import { engineRegistry } from "@/backend/runtime/registry"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEngineState, useEngines } from "@/hooks/use-engines"
import { useModels } from "@/hooks/use-models"
import { engineTone, initials } from "@/lib/engine-tone"
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

function EngineItem({ engine, active }) {
  const router = useRouter()
  const state = useEngineState(engine)
  const tone = engineTone(state)
  const approvals = state?.approvals?.length ?? 0
  const quests = state?.quests ?? []
  const queued = state?.inbox?.length ?? 0
  const spawned = engine.agent?.spawned ?? null // created by another agent (team artifact)

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
          {spawned && (
            <span>
              Sub-agent of {spawned.by} · {spawned.keep ? "kept on the team" : `task agent (ends after ${spawned.idle_minutes} min idle)`}
            </span>
          )}
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
      <span className={cn("max-w-24 truncate max-sm:hidden", spawned && !spawned.keep && "italic")}>
        {spawned ? "↳ " : ""}
        {engine.name}
      </span>
      {approvals > 0 && (
        <span className="rounded-full bg-amber-500 px-1 text-[10px] leading-3.5 text-black tabular-nums">{approvals}</span>
      )}
    </StatusItem>
  )
}

// Autopilot mode (registry): on, every tool call is approved without asking,
// so scheduled runs work unattended; off, each one waits for the owner.
function AutopilotItem({ on }) {
  return (
    <StatusItem
      onClick={() => engineRegistry.setAutopilot(!on)}
      aria-pressed={on}
      aria-label={on ? "Autopilot: tool calls are approved automatically. Turn off" : "Approvals: tool calls wait for you. Turn on autopilot mode"}
      tip={
        on
          ? "Autopilot: every agent's tool calls are approved automatically (scheduled runs work unattended). Click to ask first again."
          : "Agents ask before each change. Click for autopilot mode: approve every tool call automatically."
      }
      className={cn(on && "text-amber-500")}
    >
      <Dot className={on ? "bg-amber-500" : "bg-muted-foreground/40"} />
      <span className="max-md:hidden">{on ? "Autopilot" : "Asks first"}</span>
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

// The selected agent's model, and a menu to switch the default model. Every
// agent without its own `model:` uses the default, so it switches on the fly
// (the registry reconfigures engines when the catalogue changes).
function ModelItem({ engine, state }) {
  const catalogue = useModels()
  if (!state) return null
  const model = engine.model
  const fixed = engine.agent?.model ?? null
  const stats = state.stats
  const window = state.contextWindow ?? stats?.contextWindow ?? null
  const used = stats?.contextUsed ?? null
  const percent = used != null && window ? Math.round(Math.min(100, (used / window) * 100)) : null
  const approx = stats?.estimated ? "~" : ""
  const speed = stats?.tokensPerSecond != null ? `${approx}${stats.tokensPerSecond.toFixed(1)} tok/s` : null
  const tip = `${model ? `${model.key} · ${model.id}` : "No model: add one in Settings"} · context ${approx}${formatTokens(used)} of ${formatTokens(window)} tokens`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={tip}
            aria-label={`Model: ${model?.key ?? "none"}. Switch the default model`}
            className="flex h-full min-w-0 shrink-0 items-center gap-1.5 px-2 outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground pointer-coarse:min-w-10 pointer-coarse:justify-center"
          />
        }
      >
        <span className={cn("max-w-32 truncate", !model && "text-destructive")}>{model?.key ?? "no model"}</span>
        {speed && <span className="tabular-nums max-md:hidden">{speed}</span>}
        {percent != null && <span className="tabular-nums max-md:hidden">ctx {percent}%</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Default model</DropdownMenuLabel>
          {catalogue.models.length ? (
            <DropdownMenuRadioGroup
              value={catalogue.default ?? ""}
              onValueChange={(key) => {
                if (key && key !== catalogue.default) models.setDefault(key)
              }}
            >
              {catalogue.models.map((m) => (
                <DropdownMenuRadioItem key={m.key} value={m.key} className="pointer-coarse:min-h-10">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{m.label || m.key}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.provider} · {m.id}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuLabel className="font-normal text-muted-foreground">No models: add one in Settings</DropdownMenuLabel>
          )}
        </DropdownMenuGroup>
        {fixed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              {engine.name} keeps its own model ({fixed})
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StatusBar() {
  const { engines, activeId, status, autopilot } = useEngines()
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
        {status === "ready" && <AutopilotItem on={autopilot} />}
        <ActivityItem engine={active} state={state} />
        <ModelItem engine={active} state={state} />
      </div>
    </footer>
  )
}
