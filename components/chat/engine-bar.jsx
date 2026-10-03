"use client"

import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { MemoryMenu } from "@/components/chat/memory-menu"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { describeActivity } from "@/backend/core/activity"
import { engineRegistry } from "@/backend/runtime/registry"
import { useEngineState, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

const statusDot = {
  running: "bg-emerald-500 animate-pulse",
  error: "bg-destructive",
}

// "assistant" -> "As", "assistant 2" -> "As2"
function bubbleLabel(name) {
  const [word, suffix = ""] = name.split(" ")
  return word.slice(0, 1).toUpperCase() + word.slice(1, 2) + suffix
}

// The engine's live status as a speech bubble above its icon. Text that
// doesn't fit scrolls (marquee); reduced-motion users get it truncated.
function StatusBubble({ text, tone }) {
  const clipRef = React.useRef(null)
  const textRef = React.useRef(null)
  const [overflow, setOverflow] = React.useState(false)

  React.useLayoutEffect(() => {
    setOverflow(textRef.current.offsetWidth > clipRef.current.clientWidth)
  }, [text])

  return (
    <div
      className={cn(
        "relative max-w-full rounded-full border bg-background px-2 py-0.5 text-[11px] leading-4",
        // Tail pointing down at the icon.
        "after:absolute after:-bottom-1 after:left-1/2 after:size-2 after:-translate-x-1/2 after:rotate-45 after:border-r after:border-b after:border-inherit after:bg-background",
        tone === "running" && "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
        tone === "error" && "border-destructive/60 text-destructive",
        tone === "idle" && "text-muted-foreground"
      )}
    >
      <div ref={clipRef} className="overflow-hidden">
        <div className={cn("flex w-max", overflow && "animate-marquee motion-reduce:animate-none")}>
          <span className={cn("whitespace-nowrap", overflow && "pr-4")}>
            <span ref={textRef}>{text}</span>
          </span>
          {overflow && (
            <span aria-hidden className="pr-4 whitespace-nowrap motion-reduce:hidden">
              {text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function EngineBubble({ engine, active, required }) {
  const { status, activity } = useEngineState(engine)
  const waiting = status !== "running" && activity?.phase === "waiting"
  const label = status === "running" || waiting ? describeActivity(activity) : status
  const tone = status === "running" || waiting ? "running" : status === "error" ? "error" : "idle"
  const bubbleText = status === "running" || waiting ? label : status === "error" ? "Error" : "Idle"

  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-2">
      <StatusBubble text={bubbleText} tone={tone} />
      <div className="group/engine relative">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => engineRegistry.select(engine.id)}
                aria-label={`${engine.name}, ${label}`}
                aria-pressed={active}
                data-engine-id={engine.id}
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-full border text-base transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              />
            }
          >
            {bubbleLabel(engine.name)}
            {statusDot[status] && (
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-background",
                  statusDot[status]
                )}
              />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {engine.name} · {label}
          </TooltipContent>
        </Tooltip>

        {/* Close: disposes the engine (aborts any in-flight request). Shown on
            the active bubble, on hover, and always on touch devices. The
            default agent's engine is required and has none. */}
        {!required && (
          <button
            type="button"
            onClick={() => engineRegistry.dispose(engine.id)}
            aria-label={`Close ${engine.name}`}
            className={cn(
              // Hit area grows outward (up/right) only, so it never covers the
              // bubble's center; hidden badges ignore pointer events entirely.
              "absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground transition-opacity outline-none after:absolute after:-top-2 after:-right-2 after:-bottom-1 after:-left-1 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
              active
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover/engine:pointer-events-auto group-hover/engine:opacity-100"
            )}
          >
            <XIcon className="size-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// Opens another engine from a defined agent (agents come only from agent.md).
function AddEngineMenu({ agents, disabled }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label="Open agent"
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Agents</DropdownMenuLabel>
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.name}
              onClick={() => engineRegistry.create(agent.name)}
              className="flex-col items-start gap-0.5"
            >
              <span>{agent.name}</span>
              <span className="text-xs text-muted-foreground">{agent.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EngineBar() {
  const { agents, engines, activeId, requiredId, status, error } = useEngines()
  const listRef = React.useRef(null)

  // Keep the active bubble visible when the row overflows (e.g. on phones).
  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-engine-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeId])

  return (
    <div className="flex shrink-0 items-end gap-2 border-b px-4 py-2">
      <div className="mb-1.5 shrink-0">
        <AddEngineMenu agents={agents} disabled={status !== "ready"} />
      </div>
      <div
        ref={listRef}
        className="flex min-w-0 items-end gap-1 overflow-x-auto p-1.5"
      >
        {status === "loading" && (
          <span className="text-sm text-muted-foreground">Loading agents…</span>
        )}
        {status === "error" && (
          <span className="text-sm text-destructive">Agents failed to load: {error}</span>
        )}
        {engines.map((engine) => (
          <EngineBubble
            key={engine.id}
            engine={engine}
            active={engine.id === activeId}
            required={engine.id === requiredId}
          />
        ))}
      </div>
      <div className="mb-1.5 ml-auto shrink-0">
        <MemoryMenu engine={engines.find((e) => e.id === activeId) ?? null} />
      </div>
    </div>
  )
}
