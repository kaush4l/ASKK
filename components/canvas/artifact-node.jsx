"use client"

import * as React from "react"

import { callLook } from "@/backend/live/visual"
import { ArtifactBlock } from "@/components/views/artifact"
import { cardTapClasses, midBriefClasses } from "@/components/canvas/tap"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { useArtifact } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// One artifact on the canvas, under the agent that keeps it (backend/live/canvas-layout.js): far, its id; mid, its
// id, title and brief; near, the artifact itself drawn by its view (ArtifactBlock). Lit while an agent runs one of
// its commands. Far and mid, the card is a button: a click, a tap or Enter opens it (onOpen: the camera glides near).

export const ArtifactNode = React.memo(function ArtifactNode({ node, level, active, onOpen }) {
  const artifact = useArtifact(node.id) // its own subscription: redrawn for its own patches only
  const look = callLook({ type: "artifact", view: artifact?.view ?? node.view })
  const style = { left: node.x, top: node.y, width: node.w, height: node.h }
  const ring = active ? cn(toneOf(look).border, "motion-safe:animate-pulse") : "border-border"
  const open = () => onOpen?.(node.id)
  const tap = {
    role: "button",
    tabIndex: 0,
    "aria-label": `Open ${node.id}`,
    onClick: (e) => {
      e.stopPropagation()
      open()
    },
    onKeyDown: (e) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      e.stopPropagation()
      open()
    },
  }
  const target = cn(cardTapClasses(), "outline-none focus-visible:ring-3 focus-visible:ring-ring/50")
  return (
    <div data-artifact={node.id} data-owner={node.owner} data-active={active || undefined} className="absolute" style={style}>
      {!artifact ? null : level === "near" ? (
        <div className={cn("size-full overflow-hidden rounded-lg bg-card [&>div]:h-full [&>div]:overflow-hidden", active && "ring-2 ring-violet-500/60")}>
          <ArtifactBlock artifact={artifact} expanded={false} />
        </div>
      ) : level === "mid" ? (
        <div {...tap} className={cn("flex size-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg border bg-card p-2.5", ring, target)}>
          <span className="flex min-w-0 items-center gap-1.5">
            <CallIcon look={look} className="size-3.5" />
            <span className="truncate font-mono text-xs">{artifact.id}</span>
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{artifact.title}</span>
          {artifact.brief && <p title={artifact.brief} className={midBriefClasses()}>{artifact.brief}</p>}
        </div>
      ) : (
        <div {...tap} className={cn("flex size-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border-2 bg-card px-4", ring, target)}>
          <CallIcon look={look} className="size-9" />
          <span className="line-clamp-2 font-mono text-xl leading-tight break-words">{artifact.id.replaceAll(".", ".\u200b")}</span>
        </div>
      )}
    </div>
  )
})
