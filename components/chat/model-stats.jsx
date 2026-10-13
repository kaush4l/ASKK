"use client"

import { GaugeIcon } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTokens } from "@/backend/models/metrics"
import { cn } from "@/lib/utils"

// The active engine's model, generation speed, and context window use.
export function ModelStats({ engine, state }) {
  if (!engine || !state) return null
  const model = engine.model
  const modelName = model?.id ?? `${engine.agent.model ?? "default"} (not in catalogue)`
  const stats = state.stats
  const window = state.contextWindow ?? stats?.contextWindow ?? null
  const used = stats?.contextUsed ?? null
  const percent = used != null && window ? Math.min(100, (used / window) * 100) : null
  const approx = stats?.estimated ? "~" : ""
  const speed = stats?.tokensPerSecond != null ? `${approx}${stats.tokensPerSecond.toFixed(1)} tok/s` : "— tok/s"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`Model ${modelName}, ${speed}, context ${formatTokens(used)} of ${formatTokens(window)} tokens`}
            className="flex min-w-0 items-center gap-2 rounded-md text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        <GaugeIcon className={cn("size-3.5 shrink-0", stats?.live && "text-emerald-500")} />
        <span className={cn("max-w-32 truncate sm:max-w-48", !model && "text-destructive")}>{modelName}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 tabular-nums">{speed}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 tabular-nums">
          ctx {approx}
          {formatTokens(used)} / {formatTokens(window)}
        </span>
        {percent != null && <Progress value={percent} className="w-12 shrink-0" aria-label="Context window used" />}
      </TooltipTrigger>
      <TooltipContent side="top" className="flex flex-col gap-0.5 text-left">
        <span>
          {model ? `${model.key} · ${model.id}` : modelName}
        </span>
        {stats ? (
          <>
            <span>
              Prompt {stats.promptTokens.toLocaleString()} + output {stats.outputTokens.toLocaleString()} tokens
            </span>
            {stats.timeToFirstTokenMs != null && <span>First token after {(stats.timeToFirstTokenMs / 1000).toFixed(1)}s</span>}
            <span>{stats.estimated ? "Estimated (~4 characters per token)" : "Reported by the server"}</span>
          </>
        ) : (
          <span>No call yet</span>
        )}
        <span>Context window {window ? `${window.toLocaleString()} tokens` : "unknown"}</span>
      </TooltipContent>
    </Tooltip>
  )
}
