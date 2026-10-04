"use client"

import * as React from "react"

import { engineTone, initials } from "@/lib/engine-tone"
import { cn } from "@/lib/utils"

// The team as a constellation, and the welcome. One point of light appears
// where the lead sits and splits into every agent ("one mind that takes on
// many roles", soul.md): each drifts out to its place leaving a fading
// trail, then the team's links draw in. After that it is live: idle agents
// breathe, working ones ripple, waiting ones turn amber, and every quest out
// is a light travelling from the lead to the agent working on it.

const W = 400
const H = 200
const CENTER = { x: W / 2, y: H / 2 - 8 }

// The lead in the middle, the rest around it on an ellipse.
function layout(count) {
  const others = count - 1
  return Array.from({ length: count }, (_, i) => {
    if (i === 0 || others === 0) return CENTER
    const angle = ((200 + ((i - 1) * 360) / others) * Math.PI) / 180
    return { x: CENTER.x + 138 * Math.cos(angle), y: CENTER.y + 58 * Math.sin(angle) }
  })
}

const STROKE = {
  idle: "stroke-muted-foreground/50",
  running: "stroke-emerald-500",
  waiting: "stroke-amber-500",
  attention: "stroke-amber-500",
  error: "stroke-destructive",
}

function Node({ engine, state, at, arrived, instant, index, onOpen }) {
  const { tone, word } = engineTone(state)
  const approvals = state?.approvals?.length ?? 0
  const delay = `${0.35 + index * 0.12}s`
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${engine.name}: ${word}. Open its chat.`}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="cursor-pointer outline-none [&:focus-visible_circle.face]:stroke-ring"
      style={{
        transform: `translate(${arrived ? at.x : CENTER.x}px, ${arrived ? at.y : CENTER.y}px)`,
        transition: instant ? "none" : `transform 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${delay}, opacity 0.6s ease ${delay}`,
        opacity: arrived ? 1 : 0,
      }}
    >
      {tone === "idle" && (
        <circle r={24} className="fill-none stroke-muted-foreground/30 motion-safe:animate-breathe" strokeWidth={1} />
      )}
      {tone === "running" && (
        <circle r={18} className="fill-none stroke-emerald-500 motion-safe:animate-ripple" strokeWidth={1.5} />
      )}
      <circle
        r={18}
        className={cn("face fill-background transition-colors duration-500", STROKE[tone])}
        strokeWidth={1.5}
        strokeDasharray={tone === "waiting" ? "4 3" : undefined}
      />
      <text textAnchor="middle" dy="0.35em" className="fill-foreground text-[11px]">
        {initials(engine.name)}
      </text>
      <text y={33} textAnchor="middle" className="fill-foreground text-[11px]">
        {engine.name}
      </text>
      <text y={46} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {word.length > 28 ? `${word.slice(0, 27)}…` : word}
      </text>
      {approvals > 0 && (
        <g transform="translate(14,-14)">
          <circle r={7} className="fill-amber-500" />
          <text textAnchor="middle" dy="0.35em" className="fill-black text-[8px]">
            {approvals}
          </text>
        </g>
      )}
    </g>
  )
}

export function Constellation({ engines, states, onOpen, className }) {
  const [arrived, setArrived] = React.useState(false)
  const [instant, setInstant] = React.useState(false)
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setInstant(true)
      setArrived(true)
      return
    }
    // Two frames: the nodes render at the centre first, then move out.
    let second
    const first = requestAnimationFrame(() => (second = requestAnimationFrame(() => setArrived(true))))
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  const points = layout(engines.length)
  const lead = engines[0]
  const leadState = states[0]
  const questsTo = new Map((leadState?.quests ?? []).map((q) => [q.to, q]))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full overflow-visible", className)} role="group" aria-label="Your agents">
      {/* The first light, where the lead sits. */}
      <circle cx={CENTER.x} cy={CENTER.y} r={0} className="fill-foreground motion-safe:animate-spark" />

      {/* Trails from the split, fading once each agent has arrived. */}
      {points.slice(1).map((p, i) => (
        <line
          key={`trail-${engines[i + 1].id}`}
          x1={CENTER.x}
          y1={CENTER.y}
          x2={p.x}
          y2={p.y}
          pathLength={1}
          strokeDasharray="1"
          className="stroke-foreground/60 opacity-0 motion-safe:animate-fade-trail"
          style={{ animationDelay: `${0.35 + (i + 1) * 0.12}s` }}
          strokeWidth={1}
        />
      ))}

      {/* The team: links from the lead, drawn in after the split; live with quests. */}
      {points.slice(1).map((p, i) => {
        const engine = engines[i + 1]
        const quest = lead && questsTo.get(engine.agent.name)
        const path = `M${CENTER.x},${CENTER.y} L${p.x},${p.y}`
        return (
          <g key={`link-${engine.id}`}>
            <path
              d={path}
              pathLength={1}
              strokeDasharray="1"
              className={cn(
                "fill-none transition-colors duration-500 motion-safe:animate-draw",
                quest ? "stroke-emerald-500/70" : "stroke-border"
              )}
              style={{ animationDelay: `${1.4 + i * 0.12}s` }}
              strokeWidth={quest ? 1.5 : 1}
            />
            {quest && (
              <circle r={2.5} className="fill-emerald-400">
                <animateMotion dur="1.6s" repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
              </circle>
            )}
          </g>
        )
      })}

      {engines.map((engine, i) => (
        <Node
          key={engine.id}
          engine={engine}
          state={states[i]}
          at={points[i]}
          arrived={arrived}
          instant={instant}
          index={i}
          onOpen={() => onOpen(engine)}
        />
      ))}
    </svg>
  )
}
