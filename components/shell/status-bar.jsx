"use client"

import * as React from "react"
import { CpuIcon, ServerIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { describeActivity } from "@/backend/live/activity"
import { DESK_MODELS, setAgentModel, setDeskModel } from "@/backend/live/desk"
import { detectHost } from "@/backend/live/host"
import { registry } from "@/backend/live/registry"
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
import { useDesk, useDeskLog, useEngineState, useEngines } from "@/hooks/use-engines"
import { engineTone } from "@/lib/engine-tone"
import { ROUTES } from "@/lib/config"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"
import { footerClasses, hostParts, leftClasses, modelClasses, rightClasses, stripNameClasses } from "./strip-name"

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
  const p = hostParts(host)
  if (!p) return null
  const local = host.mode === "local"
  const browser = host.mode === "browser"
  return (
    <StatusItem
      title={p.title}
      aria-label={p.aria ?? p.title}
      tip={local ? <span className="break-all">{p.title}</span> : browser ? "A single agent runs in this tab against the model you named; the terminal and other desks need the desk server" : "No desk server answers here: start it with bun run dev, or run an agent in this browser"}
    >
      <ServerIcon aria-hidden className={p.icon} />
      <span className="max-w-32 truncate max-sm:hidden">{p.label}</span>
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
      title={`${engine.name}: ${tone.word}`}
      className={cn(stripNameClasses().item, active && "text-foreground")}
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
      <span className={stripNameClasses().name}>{engine.name}</span>
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
    <StatusItem tip={`${engine.name} · ${text}`} className={cn(stripNameClasses().running, stripNameClasses().activity)} aria-live="polite">
      <span className={stripNameClasses().runningText}>{text}</span>
    </StatusItem>
  )
}

// One radio row of the model menu: its name over a smaller line.
const ModelOption = ({ value, label, sub }) => (
  <DropdownMenuRadioItem value={value} className="pointer-coarse:min-h-10">
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{label}</span>
      <span className="truncate text-xs text-muted-foreground">{sub}</span>
    </span>
  </DropdownMenuRadioItem>
)
// One labelled radio group of the model menu; onPick(key) when another is picked.
const ModelGroup = ({ label, value, onPick, children }) => (
  <DropdownMenuGroup>
    <DropdownMenuLabel>{label}</DropdownMenuLabel>
    <DropdownMenuRadioGroup value={value} onValueChange={onPick}>{children}</DropdownMenuRadioGroup>
  </DropdownMenuGroup>
)
const ModelOptions = ({ models }) => models.map((m) => <ModelOption key={m.key} value={m.key} label={m.label || m.key} sub={`${m.provider} · ${m.id}`} />)

const seconds = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

// The selected agent's model, its model-call stats, and a menu to switch the desk's default model or set a custom
// model override on the selected agent (stored in its <agent>/<agent>.md frontmatter metadata).
function ModelItem({ engine, state }) {
  const desk = useDesk()
  if (!engine || !state) return null
  const models = desk?.models?.length ? desk.models : DESK_MODELS
  const deskDefault = desk?.defaultModel ?? "default"
  const override = engine.model ?? null
  const effectiveKey = override ?? deskDefault
  const effective = models.find((m) => m.key === effectiveKey) ?? { key: effectiveKey, label: effectiveKey, provider: "custom", id: effectiveKey }
  const agentChoices = models.some((m) => m.key === override) || !override ? models : [...models, { key: override, label: override, provider: "custom", id: override }]
  const stats = state.stats
  const tip = `${engine.name} · ${effective.label ?? effective.key}${override ? " (agent override)" : ` (desk default)`}${stats ? ` · ${stats.calls} call${stats.calls === 1 ? "" : "s"}, last ${seconds(stats.lastMs)}` : ""}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={tip}
            aria-label={`Model: ${effective.key}. Switch desk default model or ${engine.name} override`}
            className="flex h-full min-w-0 shrink-0 items-center gap-1.5 px-2 outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground pointer-coarse:min-w-10 pointer-coarse:justify-center"
          />
        }
      >
        <CpuIcon aria-hidden className={modelClasses().icon} />
        <span className={cn(modelClasses().label, override && "text-foreground")}>{effective.key}</span>
        {stats && <span className="tabular-nums max-md:hidden">{stats.calls}× · {seconds(stats.lastMs)}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <ModelGroup label="Desk default model" value={deskDefault} onPick={(key) => key && key !== deskDefault && setDeskModel(key).catch(() => {})}>
          <ModelOptions models={models} />
        </ModelGroup>
        <DropdownMenuSeparator />
        <ModelGroup label={`${engine.name} model (agent.md override)`} value={override ?? ""} onPick={(key) => (key || null) !== override && setAgentModel(engine.name, key || null).catch(() => {})}>
          <ModelOption value="" label={`Use desk default (${deskDefault})`} sub="Follows the desk's default model" />
          <ModelOptions models={agentChoices} />
        </ModelGroup>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-0.5 px-2 py-1.5 text-xs text-muted-foreground">
          {stats ? (
            <>
              <span>{stats.calls} model call{stats.calls === 1 ? "" : "s"} · last {seconds(stats.lastMs)} · avg {seconds(stats.avgMs)}</span>
              <span>last prompt {stats.promptChars?.toLocaleString()} chars · reply {stats.replyChars?.toLocaleString()} chars</span>
            </>
          ) : (
            <span>No model calls since the desk started.</span>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StatusBar() {
  const { engines, activeId, status } = useEngines()
  const active = engines.find((e) => e.id === activeId) ?? null
  const state = useEngineState(active)

  return (
    <footer
      aria-label="Status"
      className={cn(
        "box-content flex shrink-0 items-stretch justify-between gap-2 border-t pb-[env(safe-area-inset-bottom)] text-xs text-muted-foreground",
        footerClasses(),
      )}
    >
      <div className={leftClasses()}>
        <HostItem />
        {status === "connecting" && <StatusItem>Connecting to the desk…</StatusItem>}
        {status === "error" && <StatusItem className="text-destructive">The desk failed to start</StatusItem>}
        {engines.map((engine) => (
          <EngineItem key={engine.id} engine={engine} active={engine.id === activeId} />
        ))}
      </div>
      <div className={cn(rightClasses())}>
        <DeskLogItem />
        <ActivityItem engine={active} state={state} />
        <ModelItem engine={active} state={state} />
      </div>
    </footer>
  )
}
