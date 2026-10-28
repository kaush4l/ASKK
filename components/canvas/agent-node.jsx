"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLinkIcon } from "lucide-react"

import { CARD_H } from "@/backend/live/canvas-layout"
import { currentQuest } from "@/backend/live/desk"
import { runSteps } from "@/backend/live/follow"
import { spawnedLine } from "@/backend/live/spawned"
import { agentStatus } from "@/backend/live/team-tree"
import { VISUAL_STATES } from "@/backend/live/visual"
import { CallChip, CallRow, StepRow } from "@/components/canvas/call-chip"
import { agentBoxClasses } from "@/components/canvas/tap"
import { Face, bubbleFoot } from "@/components/kernel/agent-face"
import { ContractLine } from "@/components/kernel/contract-line"
import { PromptMeter } from "@/components/kernel/prompt-meter"
import { TONE } from "@/components/views/agent-tone"
import { useEngineState } from "@/hooks/use-engines"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// One agent on the canvas, drawn by how close the camera is (data-zoom-level on the canvas):
//   far  — its face (ring in its state colour, pulsing while it works) and its name
//   mid  — the card: face, name, title tag, speech bubble, a chip per call in flight
//   near — the card fills its box with the run: the request, the newest steps and the calls in flight, the
//          artifacts it holds (drawn by their views under it); a spawned helper's line (backend/live/spawned.js)
// It only reads the agent's state; a click focuses it (the camera glides to it), its page opens from the card.

const LABEL = Object.fromEntries(VISUAL_STATES.map((s) => [s.id, s.label]))
const ROWS = 5 // rows of the run a near card shows: the calls in flight (up to CALL_ROWS), then the newest steps
const CALL_ROWS = 3
const MID_CHIPS = 2 // chips a mid card shows; the bubble names every call, "+N" says how many more

// What it says: the status message, then when it reported, that it failed, or its last tool while it thinks.
function Bubble({ status, lines = 3 }) {
  const tone = TONE[status.tone] ?? TONE.idle
  const foot = bubbleFoot(status)
  return (
    <p data-bubble className={cn("relative rounded-lg border bg-card px-2 py-1 text-xs leading-snug transition-colors duration-500", tone.line)}>
      <span aria-hidden className={cn("absolute -top-[5px] left-4 size-2 rotate-45 border-t border-l bg-card", tone.line)} />
      <span className={cn("block break-words", lines === 2 ? "line-clamp-2" : "line-clamp-3", status.tone === "idle" && "text-muted-foreground")}>{status.message}</span>
      {foot && <span className={cn("block truncate text-[11px]", foot.className)}>{foot.text}</span>}
    </p>
  )
}

// The run inside a near card: the request, then — scrolling inside the card when it is long (data-canvas-scroll:
// the wheel and a finger scroll it, not the camera) — the newest steps and every artifact the agent holds.
function Run({ engine, state, calls, holds, onFocusArtifact }) {
  const quest = currentQuest(state)
  const running = calls.slice(0, CALL_ROWS)
  const { steps, hidden } = runSteps(state, { limit: ROWS - running.length })
  return (
    <section data-run aria-label="Current run" className="flex min-h-0 flex-1 flex-col gap-1.5 border-t pt-2 text-[10px] leading-snug">
      {quest ? (
        <div data-step="request" className="min-w-0 shrink-0">
          <span className="text-[9px] tracking-wide text-muted-foreground uppercase">
            {quest.active ? "Working on" : "Last request"} · from {quest.from}
          </span>
          <p className="line-clamp-3 break-words">{quest.text}</p>
        </div>
      ) : (
        <p data-step="request" className="shrink-0 text-muted-foreground">No request yet.</p>
      )}
      <div data-canvas-scroll className="-mr-1.5 flex min-h-0 flex-1 touch-pan-y flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1.5 [scrollbar-width:thin]">
        <ol aria-label="Steps" className="flex shrink-0 flex-col gap-1">
          {hidden > 0 && <li className="text-muted-foreground">{hidden} earlier step{hidden === 1 ? "" : "s"}</li>}
          {steps.map((step) => (
            <StepRow key={step.id} engine={engine} step={step} />
          ))}
          {running.map((call, i) => (
            <CallRow key={`${call.name}-${i}`} engine={engine} call={call} />
          ))}
          {calls.length > running.length && <li className="text-muted-foreground">+{calls.length - running.length} more calls running</li>}
          {!steps.length && !running.length && quest && <li className="text-muted-foreground">No steps yet.</li>}
        </ol>
        {holds.length > 0 && (
          <div className="shrink-0 border-t pt-1.5">
            <p className="mb-1 text-[9px] tracking-wide text-muted-foreground uppercase">
              Holds {holds.length} artifact{holds.length === 1 ? "" : "s"}
            </p>
            <ul aria-label="Artifacts it holds" className="flex flex-wrap gap-1">
              {holds.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFocusArtifact(a.id)
                    }}
                    title={a.title}
                    className="rounded border px-1 font-mono text-[9px] leading-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {a.id}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

export const AgentNode = React.memo(function AgentNode({ node, engine, level, focused, deskTitle, holds, onFocus, onFocusArtifact }) {
  const state = useEngineState(engine) // its own subscription: another agent's step never redraws this card
  const name = node.id
  const status = agentStatus(state, engine?.agent)
  const tone = TONE[status.tone] ?? TONE.idle
  const tag = node.depth === 0 ? deskTitle ?? "lead" : node.title && node.title.toLowerCase() !== name.toLowerCase() ? node.title : null
  const calls = state?.activity?.calls ?? []
  const label = `${name}: ${LABEL[status.tone] ?? status.tone}, ${status.message}`
  const spawned = level === "near" ? spawnedLine(engine) : null // a helper: by whom, for what, how long it stays
  const focus = () => onFocus(name)
  const hit = agentBoxClasses() // the box lets taps through to the artifacts lifted under it; only the card takes them

  return (
    <div
      data-agent={name}
      data-tone={status.tone}
      data-focused={focused || undefined}
      className={hit.box}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      {level === "far" ? (
        <button
          type="button"
          onClick={focus}
          aria-label={`${label}. Focus it.`}
          style={{ height: CARD_H.far }}
          className={cn(hit.card, "flex w-full flex-col items-center overflow-hidden pt-4 outline-none focus-visible:[&>span:first-child]:ring-8 focus-visible:[&>span:first-child]:ring-ring/50")}
        >
          <Face name={name} status={status} size="size-24" ring="-inset-3 border-4" inner="border-[6px] text-4xl" />
          <span className={cn("mt-4 max-w-full truncate rounded-lg bg-background px-2 text-4xl", focused && "underline decoration-4 underline-offset-8")}>{name}</span>
          {tag && <span className="mt-1 max-w-full truncate rounded bg-background px-2 text-xl tracking-wide text-muted-foreground uppercase">{tag}</span>}
        </button>
      ) : (
        <div
          onClick={focus}
          style={{ height: CARD_H[level] }}
          className={cn(
            hit.card,
            "flex min-h-0 flex-col gap-2 overflow-hidden rounded-2xl border-2 bg-card p-3 transition-colors duration-500",
            tone.line,
            tone.dashed && "border-dashed",
            focused && "ring-4 ring-ring/40"
          )}
        >
          <header className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                focus()
              }}
              aria-label={`${label}. Focus it.`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Face name={name} status={status} size="size-10" ring="-inset-1 border-2" inner="border-2 text-sm" />
              <span className="flex min-w-0 flex-col">
                <span className={cn("truncate leading-tight", level === "near" ? "text-sm" : "text-base")}>{name}</span>
                {level === "near" ? (
                  <span className={cn("truncate text-[10px]", tone.text)}>{status.message}</span>
                ) : (
                  tag && <span className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">{tag}</span>
                )}
              </span>
            </button>
            {(level === "near" || focused) && (
              <Link
                href={agentHref(name)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open ${name}'s page`}
                title={`Open ${name}'s page`}
                className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-10"
              >
                <ExternalLinkIcon className="size-4" />
              </Link>
            )}
          </header>
          {spawned && (
            <p data-spawned title={spawned} className="line-clamp-2 shrink-0 break-words text-[10px] leading-snug text-muted-foreground">
              {spawned}
            </p>
          )}
          {state?.stats?.promptParts && <PromptMeter parts={state.stats.promptParts} className="shrink-0" />}
          {state?.stats?.contract && <ContractLine contract={state.stats.contract} className="shrink-0" />}
          {level === "mid" && <Bubble status={status} lines={2} />}
          {level === "mid" && calls.length > 0 && (
            <ul aria-label="Calls in flight" className="flex min-w-0 flex-wrap gap-1">
              {calls.slice(0, MID_CHIPS).map((call, i) => (
                <CallChip key={`${call.name}-${i}`} engine={engine} call={call} />
              ))}
              {calls.length > MID_CHIPS && <li className="self-center text-[11px] text-muted-foreground">+{calls.length - MID_CHIPS} more</li>}
            </ul>
          )}
          {level === "near" && <Run engine={engine} state={state} calls={calls} holds={holds} onFocusArtifact={onFocusArtifact} />}
        </div>
      )}
    </div>
  )
})
