"use client"

import * as React from "react"
import Link from "next/link"
import { BugIcon, Maximize2Icon, XIcon } from "lucide-react"

import { fit, focus, zoomLevel } from "@/backend/live/camera"
import { compositionBoard, edgePath, sameBoard } from "@/backend/live/composition"
import { Toolbar } from "@/components/canvas/toolbar"
import { useCamera } from "@/components/canvas/use-camera"
import { ArtifactBig } from "@/components/kernel/desk-levels"
import { PromptMeter } from "@/components/kernel/prompt-meter"
import { Button } from "@/components/ui/button"
import { useAgent, useArtifact, useDesk, useEngines } from "@/hooks/use-engines"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// The desk's composition on a board you pan and zoom (backend/live/composition.js lays it out from the twins): how the
// desk is built and reaches this tab, every agent as its slots, every artifact, every workflow's steps. The board moves
// only when the desk's shape does (sameBoard); a card that shows something live — an agent's status, an artifact's
// brief — subscribes to that object alone. A click inspects a card and lights what it is joined to.

const LAYER = {
  config: "text-amber-600 dark:text-amber-400",
  build: "text-violet-600 dark:text-violet-400",
  kernel: "text-blue-600 dark:text-blue-400",
  host: "text-teal-600 dark:text-teal-400",
  stream: "text-rose-600 dark:text-rose-400",
  ui: "text-green-600 dark:text-green-400",
}
const STATUS = { running: "bg-blue-500 animate-pulse", error: "bg-red-500", idle: "bg-muted-foreground/40" }
// x: an agent holds an artifact; inst: an instance and its class (faint until a card is picked: there are many)
const DASH = { x: "6 6", inst: "2 6" }
const FAINT = { x: 0.5, inst: 0.18 }
const INSET = { top: 56, bottom: 16 }
const ZOOM_STEP = 1.25
const label = "font-mono text-[11px] uppercase tracking-wide"
const sameAgents = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

function AgentStatus({ name }) {
  const { state: status } = useAgent(name, (s) => s?.status ?? "idle")
  return <span title={status} className={cn("size-2 shrink-0 rounded-full", STATUS[status] ?? STATUS.idle)} />
}

function AgentMeter({ name }) {
  const { state: parts } = useAgent(name, (s) => s?.stats?.promptParts)
  return parts ? <PromptMeter parts={parts} /> : null
}

function ArtifactBrief({ id, fallback }) {
  return useArtifact(id)?.brief || fallback
}

const Card = React.memo(function Card({ node, far, lit, selected, dim, onSelect }) {
  const { ref } = node
  return (
    <button
      type="button"
      onClick={(e) => (e.stopPropagation(), onSelect(node.id))}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
      className={cn(
        "absolute flex flex-col gap-1 overflow-hidden rounded-xl border bg-card p-3 text-left transition-opacity",
        LAYER[node.layer],
        selected ? "border-current ring-2 ring-current/30" : "hover:border-current/60",
        dim && !lit && "opacity-20",
      )}
    >
      {!far && (
        <span className={cn("flex min-w-0 items-center gap-1.5", label)}>
          {ref?.agent ? <AgentStatus name={ref.agent} /> : <span className="size-1.5 shrink-0 rounded-sm bg-current" />}
          <span className="truncate">{node.tag}</span>
        </span>
      )}
      <span className={cn("truncate text-foreground", far ? "text-3xl" : "text-lg leading-tight")}>{node.title}</span>
      {!far && <span className="line-clamp-2 text-xs text-muted-foreground">{ref?.artifact ? <ArtifactBrief id={ref.artifact} fallback={node.sub} /> : node.sub}</span>}
    </button>
  )
})

function Edges({ edges, byId, lit, far }) {
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
      <defs>
        <marker id="compose-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const { d, mid } = edgePath(byId.get(e.from), byId.get(e.to))
        const on = lit?.edges.has(i)
        return (
          <g key={i} className={cn(on ? "text-blue-500" : e.kind === "loop" ? "text-rose-500" : "text-muted-foreground", lit && !on && "opacity-10")}>
            <path d={d} fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 1.5} strokeDasharray={DASH[e.kind]} opacity={on ? 1 : (FAINT[e.kind] ?? 1)} markerEnd="url(#compose-arrow)" />
            {e.label && !far && (
              <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]" stroke="var(--background)" strokeWidth={5} paintOrder="stroke">
                {e.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Inspector({ node, near, onSelect, onOpen, onClose }) {
  return (
    <aside className="absolute inset-x-2 bottom-2 z-20 flex max-h-[58svh] flex-col gap-3 glass overflow-auto rounded-2xl border p-4 md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-96">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn(label, LAYER[node.layer])}>{node.tag}</span>
          <h2 className="text-2xl leading-tight">{node.title}</h2>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 pointer-coarse:size-10" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </div>
      {node.sub && <p className="text-sm">{node.sub}</p>}
      {node.details.length > 0 && (
        <dl className="grid gap-2 text-sm">
          {node.details.map(([k, v]) => (
            <div key={k}>
              <dt className={cn(label, "text-muted-foreground")}>{k}</dt>
              <dd className="whitespace-pre-line break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {node.ref?.agent && (
        <div className="flex flex-col gap-1.5">
          <span className={cn(label, "text-muted-foreground")}>Prompt</span>
          <AgentMeter name={node.ref.agent} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {node.ref?.agent && (
          <Button variant="outline" size="sm" className="pointer-coarse:h-10" nativeButton={false} render={<Link href={agentHref(node.ref.agent)} />}>
            <BugIcon /> Debug page
          </Button>
        )}
        {node.ref?.artifact && (
          <Button variant="outline" size="sm" className="pointer-coarse:h-10" onClick={(e) => onOpen(node.ref.artifact, e.currentTarget)}>
            <Maximize2Icon /> Open live view
          </Button>
        )}
      </div>
      {near.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={cn(label, "text-muted-foreground")}>Joined to</span>
          <div className="flex flex-wrap gap-1.5">
            {near.map(([n, dir]) => (
              <button key={n.id} type="button" onClick={() => onSelect(n.id, true)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted pointer-coarse:min-h-10">
                {dir} {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

function Board() {
  const agents = useEngines((r) => r.engines.map((e) => e.agent).filter(Boolean), sameAgents)
  const kernel = useDesk((d) => d, sameBoard)
  const board = React.useMemo(() => compositionBoard(agents, kernel), [agents, kernel])
  const byId = React.useMemo(() => new Map(board.nodes.map((n) => [n.id, n])), [board])
  const [selected, setSelected] = React.useState(null)
  const [open, setOpen] = React.useState(null)

  const { ref, cam, viewport, set, glideTo, zoomBy } = useCamera({
    onKey: (key) => (key === "0" ? (fitAll(), true) : key === "Escape" ? (setSelected(null), true) : false),
  })
  const far = zoomLevel(cam.z) === "far"
  const fitAll = () => glideTo(fit(board.bounds, viewport, 32, INSET))

  // First sight of the board, and of each new shape of it (an agent spawned, a workflow edited): all of it.
  const shape = `${board.bounds.w}x${board.bounds.h}`
  const fitted = React.useRef(null)
  React.useEffect(() => {
    if (!viewport.w || !viewport.h || fitted.current === shape) return
    fitted.current = shape
    set(fit(board.bounds, viewport, 32, INSET))
  }, [viewport, shape, board, set])

  const lit = React.useMemo(() => {
    if (!byId.has(selected)) return null
    const edges = new Set(), nodes = new Set([selected]), near = []
    board.edges.forEach((e, i) => {
      if (e.from !== selected && e.to !== selected) return
      const other = e.from === selected ? e.to : e.from
      edges.add(i)
      nodes.add(other)
      near.push([byId.get(other), e.from === selected ? "→" : "←"])
    })
    return { edges, nodes, near }
  }, [board, byId, selected])

  const latest = React.useRef({})
  latest.current = { byId, glideTo, viewport, z: cam.z }
  const onSelect = React.useCallback((id, glide = false) => {
    setSelected(id)
    const { byId, glideTo, viewport, z } = latest.current
    const n = byId.get(id)
    // centred in what the inspector leaves free: left of it on a wide screen, above its sheet on a phone
    const free = viewport.w >= 768 ? { w: viewport.w - 400, h: viewport.h } : { w: viewport.w, h: viewport.h * 0.42 }
    if (glide && n) glideTo(focus(n, free, Math.max(z, 0.8)))
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div
        ref={ref}
        role="region"
        aria-label="The desk's composition. Drag or scroll to pan, pinch or ctrl and scroll to zoom; 0 fits it."
        className="absolute inset-0 cursor-grab touch-none overflow-hidden overscroll-none select-none active:cursor-grabbing"
        style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--foreground) 16%, transparent) 1px, transparent 1.5px)", backgroundSize: `${Math.max(18, 24 * cam.z)}px ${Math.max(18, 24 * cam.z)}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
        onClick={() => setSelected(null)}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {board.frames.map((f) => (
            <section key={f.id} aria-label={f.title} className="absolute rounded-3xl border border-dashed" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
              <h2 className={cn("absolute top-5 left-8", far ? "text-6xl" : "text-3xl")}>{f.title}</h2>
              {!far && <p className="absolute top-14 left-8 text-sm text-muted-foreground">{f.says}</p>}
            </section>
          ))}
          <Edges edges={board.edges} byId={byId} lit={lit} far={far} />
          {board.nodes.map((n) => (
            <Card key={n.id} node={n} far={far} selected={selected === n.id} lit={lit?.nodes.has(n.id)} dim={!!lit} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <Toolbar className="absolute top-3 left-3 z-10" zoom={Math.round(cam.z * 100)} onZoomOut={() => zoomBy(1 / ZOOM_STEP)} onZoomIn={() => zoomBy(ZOOM_STEP)} onReset={() => zoomBy(1 / cam.z)} onFit={fitAll} />
      {lit && <Inspector node={byId.get(selected)} near={lit.near} onSelect={onSelect} onOpen={(id, from) => setOpen({ id, from })} onClose={() => setSelected(null)} />}
      <ArtifactBig id={open?.id} from={open?.from} open={!!open} onOpenChange={(v) => !v && setOpen(null)} />
    </div>
  )
}

export function ComposePage() {
  const status = useEngines((r) => r.status)
  if (status === "offline") return <p className="mx-auto my-8 max-w-xl rounded-xl border p-4 text-sm">No desk is running here. Start one from the repository with <code className="font-mono">bun run dev</code>; this board draws what it builds.</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Composition</h1>
      <Board />
    </div>
  )
}
