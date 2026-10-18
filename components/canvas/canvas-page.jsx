"use client"

import * as React from "react"

import { fit, focus, nearZoom, zoomLevel } from "@/backend/live/camera"
import { layoutToFit, nodeRect, placeAt } from "@/backend/live/canvas-layout"
import { artifactsHeldBy, currentQuest } from "@/backend/live/desk"
import { followTarget, questsOut } from "@/backend/live/follow-target"
import { teamTree, treeNames } from "@/backend/live/team-tree"
import { VISUAL_STATES } from "@/backend/live/visual"
import { AgentNode } from "@/components/canvas/agent-node"
import { ArtifactNode } from "@/components/canvas/artifact-node"
import { DeskFrame } from "@/components/canvas/desk-frame"
import { Edges } from "@/components/canvas/edges"
import { Toolbar } from "@/components/canvas/toolbar"
import { useCamera } from "@/components/canvas/use-camera"
import { TONE } from "@/components/views/agent-tone"
import { useDesk, useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The desk on a canvas: every agent a node laid out from the desk's tree (backend/live/canvas-layout.js), its
// artifacts under it, a frame around each team and each desk mounted inside this one, a line from each lead to
// each member that pulses while a quest is out on it. Pan and zoom it (use-camera.js); the closer the camera, the
// more each agent shows (data-zoom-level: far | mid | near) — up close, its run as it happens. Follow (on until
// the owner moves the camera by hand) glides the camera to where the work is (backend/live/follow-target.js).
// Everything here reads the stores; nothing runs in the tab.

const ZOOM_STEP = 1.25
// Screen px the floating controls take along the top (toolbar) and bottom (follow line) edges: Fit keeps them clear.
const INSET = { top: 56, bottom: 40 }
const fitArea = (vp) => (vp.w && vp.h ? { w: vp.w, h: Math.max(1, vp.h - INSET.top - INSET.bottom) } : null)

// A dot grid that moves with the camera, its dots never closer than 18 px on screen (so it never greys the black).
function dots({ x, y, z }) {
  let step = 24 * z
  while (step < 18) step *= 4
  return {
    backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--foreground) 18%, transparent) 1px, transparent 1.5px)",
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${x}px ${y}px`,
  }
}

// What the artifacts look like to the layout (ids, views, owners, holders): it moves only when these change.
const artifactShape = (artifacts) =>
  Object.values(artifacts ?? {})
    .map((a) => `${a.id}|${a.view}|${a.owner}|${(a.holders ?? []).join(",")}`)
    .sort()
    .join(";")

function Legend({ className }) {
  return (
    <ul className={cn("flex gap-x-3 rounded-full border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur", className)} aria-label="State colours">
      {VISUAL_STATES.map((s) => (
        <li key={s.id} className="flex items-center gap-1">
          <span aria-hidden className={cn("size-2 rounded-full", TONE[s.id].dot)} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function DeskCanvas({ engines, states, desk, connecting }) {
  const byName = React.useMemo(() => new Map(engines.map((e, i) => [e.agent?.name ?? e.id, { engine: e, state: states[i] }])), [engines, states])
  const statesByName = React.useMemo(() => new Map([...byName].map(([name, { state }]) => [name, state])), [byName])
  const agents = React.useMemo(() => engines.map((e) => e.agent ?? { name: e.id }), [engines])
  const tree = React.useMemo(() => teamTree(agents, { root: agents[0]?.name, kernel: desk?.tree }), [agents, desk?.tree])

  const [follow, setFollow] = React.useState(true)
  const [focused, setFocused] = React.useState(null)

  const camera = useCamera({
    onManual: () => setFollow(false),
    onKey: (key) => {
      if (key === "0") fitAll()
      else if (key === "f") toggleFollow()
      else if (key === "Escape") setFocused(null)
      else return false
      return true
    },
  })
  const { ref, cam, viewport, set, glideTo, zoomBy } = camera
  const level = zoomLevel(cam.z)

  // The layout for this viewport's shape (a wide desk wraps its teams into columns on a tall screen); it moves
  // only when the tree, the artifacts' places or the viewport change.
  const artifacts = desk?.artifacts
  const artifactsRef = React.useRef(artifacts)
  artifactsRef.current = artifacts
  const shape = artifactShape(artifacts)
  const layout = React.useMemo(
    () => layoutToFit(tree, { artifacts: artifactsRef.current }, fitArea(viewport)),
    [tree, shape, viewport]
  )
  const holds = React.useMemo(() => new Map((tree ? treeNames(tree) : []).map((name) => [name, artifactsHeldBy(artifacts, name)])), [tree, artifacts])

  // Live: who the camera follows, which quests are out (lead → member), which artifacts are being worked.
  const target = React.useMemo(() => followTarget(tree, statesByName), [tree, statesByName])
  const quests = React.useMemo(() => {
    const out = new Map([...statesByName].map(([name, state]) => [name, questsOut(state)]))
    for (const node of layout.nodes) {
      if (node.kind !== "agent" || !node.parent) continue
      const q = currentQuest(statesByName.get(node.id))
      if (q?.active && q.from === node.parent) out.get(node.parent)?.add(node.id)
    }
    return out
  }, [statesByName, layout])
  const calling = React.useMemo(() => [...statesByName.values()].flatMap((s) => (s?.activity?.calls ?? []).map((c) => c.name)), [statesByName])

  // The latest layout and viewport for the callbacks the nodes hold (stable, so a camera move re-renders no node).
  const latest = React.useRef({})
  latest.current = { layout, viewport, glideTo }
  const cameraOn = (rect) => {
    const { viewport: vp } = latest.current
    return focus(rect, vp, nearZoom(rect, vp))
  }
  const onFocus = React.useCallback((name) => {
    const rect = nodeRect(latest.current.layout, name)
    if (!rect) return
    setFollow(false)
    setFocused(name)
    latest.current.glideTo(cameraOn(rect))
  }, [])
  const onFocusArtifact = React.useCallback((id) => {
    const rect = nodeRect(latest.current.layout, id, "artifact")
    if (!rect) return
    setFollow(false)
    latest.current.glideTo(cameraOn(rect))
  }, [])
  function fitAll() {
    setFollow(false)
    setFocused(null)
    glideTo(fit(layout.bounds, viewport, 32, INSET))
  }
  // One rule: Follow and a focused agent never hold together — Follow on clears the focus, a focus (a click)
  // turns Follow off, so does a hand on the camera.
  function toggleFollow() {
    const next = !follow
    setFollow(next)
    if (!next) return
    setFocused(null)
    const rect = target ? nodeRect(layout, target) : null
    glideTo(rect ? cameraOn(rect) : fit(layout.bounds, viewport, 32, INSET))
  }

  // First sight of a desk (or of a new shape of it): all of it. Then Follow glides in to the work (and on, whenever
  // the work moves).
  const fitted = React.useRef(null)
  const shown = `${tree?.name}|${layout.wrap}`
  React.useEffect(() => {
    if (!viewport.w || !viewport.h || !layout.nodes.length || fitted.current === shown) return
    fitted.current = shown
    set(fit(layout.bounds, viewport, 32, INSET))
  }, [viewport, layout, shown, set])

  const targetRect = target ? nodeRect(layout, target) : null
  const targetKey = targetRect ? `${target}@${targetRect.x},${targetRect.y}` : null
  const ready = viewport.w > 0 && viewport.h > 0
  React.useEffect(() => {
    if (!follow || !targetKey || !ready) return
    const rect = nodeRect(latest.current.layout, target)
    if (rect) glideTo(cameraOn(rect))
  }, [follow, targetKey, ready, glideTo])

  // Far and mid the cards are compact and the artifacts sit right under them (placeAt); near, the layout as is.
  const agentsLaid = React.useMemo(() => layout.nodes.filter((n) => n.kind === "agent"), [layout])
  const artifactsLaid = React.useMemo(() => layout.nodes.filter((n) => n.kind === "artifact").map((n) => placeAt(n, level)), [layout, level])

  return (
    <div data-canvas data-zoom-level={level} data-follow={follow ? "on" : "off"} data-follow-target={target ?? undefined} className="relative flex min-h-0 flex-1 overflow-hidden">
      <div
        ref={ref}
        role="region"
        aria-label="Desk canvas. Drag or scroll to pan, pinch or ctrl and scroll to zoom; + and − zoom, 0 fits the desk, arrows pan."
        className="absolute inset-0 cursor-grab touch-none overflow-hidden overscroll-none select-none active:cursor-grabbing"
        style={dots(cam)}
        onClick={(e) => {
          if (e.target === e.currentTarget || e.target.dataset?.layer != null) setFocused(null)
        }}
      >
        <div data-layer className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, "--canvas-z": cam.z }}>
          {layout.frames.map((f) => (
            <DeskFrame key={`${f.kind}:${f.lead}`} frame={f} level={level} />
          ))}
          <Edges edges={layout.edges} quests={quests} />
          {artifactsLaid.map((node) => (
            <ArtifactNode
              key={`artifact:${node.id}`}
              node={node}
              artifact={artifacts?.[node.id]}
              level={level}
              active={calling.some((name) => name.startsWith(`${node.id}.`))}
            />
          ))}
          {agentsLaid.map((node) => {
            const item = byName.get(node.id)
            return (
              <AgentNode
                key={`agent:${node.id}`}
                node={node}
                engine={item?.engine ?? null}
                state={item?.state ?? null}
                level={level}
                focused={focused === node.id}
                deskTitle={desk?.tree ? desk.title : null}
                holds={holds.get(node.id) ?? []}
                onFocus={onFocus}
                onFocusArtifact={onFocusArtifact}
              />
            )
          })}
        </div>
      </div>

      <Toolbar
        className="absolute top-3 right-3 z-10"
        zoom={Math.round(cam.z * 100)}
        follow={follow}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onReset={() => zoomBy(1 / cam.z)}
        onFit={fitAll}
        onFollow={toggleFollow}
      />
      <p className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground backdrop-blur" aria-live="polite">
        {follow ? (target ? `Following ${target}` : "Follow: waiting for work") : focused ? `Focused on ${focused}` : "Follow off"}
      </p>
      <Legend className="absolute right-3 bottom-3 z-10 hidden xl:flex" />
      {(connecting || !tree) && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">{connecting ? "Connecting to the desk…" : "No agents on this desk."}</p>
      )}
    </div>
  )
}

// No desk server answers here (capability `team` missing): how to start one.
function Offline() {
  return (
    <div className="mx-auto my-8 flex max-w-xl flex-col gap-2 rounded-xl border p-4 text-sm">
      <p>No desk is running here.</p>
      <p className="text-muted-foreground">
        The desk runs on your computer and this canvas follows it. Start it from the repository with{" "}
        <code className="font-mono text-foreground">bun run dev</code> (every desk in <code className="font-mono">custom/</code>) and open the address it prints.
      </p>
    </div>
  )
}

export function CanvasPage() {
  const { engines, requiredId, status, error } = useEngines()
  // The lead first: it is the root of the tree.
  const ordered = React.useMemo(() => [...engines].sort((a, b) => (a.id === requiredId ? -1 : b.id === requiredId ? 1 : 0)), [engines, requiredId])
  const states = useEngineStates(ordered)
  const desk = useDesk()

  if (status === "offline") return <Offline />
  if (status === "error") return <p className="p-8 text-center text-sm text-destructive">The desk failed to start: {error}</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Canvas</h1>
      <DeskCanvas engines={ordered} states={states} desk={desk} connecting={status !== "ready" && !ordered.length} />
    </div>
  )
}
