"use client"

import * as React from "react"

import { fit, focus, nearZoom, zoomLevel } from "@/backend/live/camera"
import { layoutDesk, layoutToFit, nodeRect, placeAt } from "@/backend/live/canvas-layout"
import { artifactsHeldBy, currentQuest, sameLayout } from "@/backend/live/desk"
import { followTarget, questsOut } from "@/backend/live/follow-target"
import { teamTree, treeNames } from "@/backend/live/team-tree"
import { AgentNode } from "@/components/canvas/agent-node"
import { ArtifactNode } from "@/components/canvas/artifact-node"
import { DeskFrame } from "@/components/canvas/desk-frame"
import { Edges } from "@/components/canvas/edges"
import { fitKey, glideTarget, openDue, refitDue } from "@/components/canvas/settle"
import { followLabel, followPillClasses, insetFor, toolbarClasses } from "@/components/canvas/tap"
import { Toolbar } from "@/components/canvas/toolbar"
import { useCamera } from "@/components/canvas/use-camera"
import { StateLegend } from "@/components/kernel/state-legend"
import { useDesk, useEngineStates, useEngines } from "@/hooks/use-engines"

// The desk on a canvas: every agent a node laid out from the desk's tree (backend/live/canvas-layout.js), its
// artifacts under it, a frame around each team and each desk mounted inside this one, a line from each lead to
// each member that pulses while a quest is out on it. Pan and zoom it (use-camera.js); the closer the camera, the
// more each agent shows (data-zoom-level: far | mid | near) — up close, its run as it happens. Follow (on until
// the owner moves the camera by hand) glides the camera to where the work is (backend/live/follow-target.js).
// Everything here reads the stores; nothing runs in the tab.

const ZOOM_STEP = 1.25
const NONE = []
// Fit keeps the floating controls clear (tap.js insetFor: the toolbar on top, or below sm at the bottom with the follow line).
const fitArea = (vp) => {
  const inset = insetFor(vp.w)
  return vp.w && vp.h ? { w: vp.w, h: Math.max(1, vp.h - inset.top - inset.bottom) } : null
}

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

// The canvas reads the tree and the artifacts' layout (ids, views, owners, holders: an artifact's state alone never moves
// it), and every state for follow, the quest lines and the lit artifacts; each node subscribes to its own agent or
// artifact (AgentNode, ArtifactNode), so a step or a patch redraws that node and the lines, not every card.
function DeskCanvas({ engines, connecting }) {
  const states = useEngineStates(engines)
  const statesByName = React.useMemo(() => new Map(engines.map((e, i) => [e.agent?.name ?? e.id, states[i]])), [engines, states])
  const enginesByName = React.useMemo(() => new Map(engines.map((e) => [e.agent?.name ?? e.id, e])), [engines])
  const kernelTree = useDesk((d) => d?.tree)
  const deskTitle = useDesk((d) => (d?.tree ? d.title : null))
  const artifacts = useDesk((d) => d?.artifacts, sameLayout)
  const agents = React.useMemo(() => engines.map((e) => e.agent ?? { name: e.id }), [engines])
  const tree = React.useMemo(() => teamTree(agents, { root: agents[0]?.name, kernel: kernelTree }), [agents, kernelTree])

  const [follow, setFollow] = React.useState(true)
  const [focused, setFocused] = React.useState(null)
  const [opened, setOpened] = React.useState(null) // the artifact a tap or click opened (Fit, Follow or a hand clears it)
  const held = React.useRef(false) // the owner's first Fit, open, Follow, pan or zoom holds the camera (settle.js refitDue)

  const camera = useCamera({
    onManual: () => {
      held.current = true
      setFollow(false)
      setOpened(null)
    },
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

  // The layout for this viewport's shape (a wide desk wraps its teams into columns on a tall screen). The wrap is
  // picked once per desk and viewport size (settle.js fitKey); a live artifact change moves cards, never flips it.
  const shown = fitKey({ tree, viewport })
  const picked = React.useRef({ key: null, wrap: undefined })
  if (refitDue({ fitted: picked.current.key, shown, held: held.current })) {
    picked.current = { key: shown, wrap: layoutToFit(tree, { artifacts }, fitArea(viewport)).wrap }
  }
  const wrap = picked.current.wrap
  const layout = React.useMemo(() => layoutDesk(tree, { artifacts, wrap }), [tree, artifacts, wrap])
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
  latest.current = { layout, viewport, glideTo, cam, opened }
  const cameraOn = (rect) => {
    const { viewport: vp } = latest.current
    return focus(rect, vp, nearZoom(rect, vp))
  }
  // A click on an agent (focused) or an artifact: Follow off, the camera to it.
  const focusOn = (id, kind) => {
    const rect = nodeRect(latest.current.layout, id, kind)
    if (!rect) return
    held.current = true
    setFollow(false)
    if (!kind) setFocused(id)
    setOpened(kind === "artifact" ? id : null)
    const to = cameraOn(rect)
    // A repeat open of the card already shown, the camera on it (a tap and its click), never re-glides (settle.js openDue).
    if (kind === "artifact" && !openDue({ opened: latest.current.opened, id, cam: latest.current.cam, to })) return
    latest.current.glideTo(to)
  }
  const onFocus = React.useCallback((name) => focusOn(name), []) // eslint-disable-line react-hooks/exhaustive-deps
  const onFocusArtifact = React.useCallback((id) => focusOn(id, "artifact"), []) // eslint-disable-line react-hooks/exhaustive-deps
  function fitAll() {
    held.current = true
    setFollow(false)
    setFocused(null)
    setOpened(null)
    glideTo(fit(layout.bounds, viewport, 32, insetFor(viewport.w)))
  }
  // One rule: Follow and a focused agent never hold together — Follow on clears the focus, a focus (a click)
  // turns Follow off, so does a hand on the camera.
  function toggleFollow() {
    const next = !follow
    held.current = true
    setFollow(next)
    if (!next) return
    setFocused(null)
    const rect = target ? nodeRect(layout, target) : null
    // An opened card with no work to follow stays shown, never glided away to Fit (settle.js glideTarget).
    const to = glideTarget({ opened, rect: rect && cameraOn(rect), fitTo: fit(layout.bounds, viewport, 32, insetFor(viewport.w)) })
    if (!to) return
    setOpened(null)
    glideTo(to)
  }

  // First sight of a desk (or of a new viewport size, until the owner holds the camera: settle.js refitDue): all of
  // it. Then Follow glides in to the work (and on, whenever the work moves).
  const fitted = React.useRef(null)
  React.useEffect(() => {
    if (!viewport.w || !viewport.h || !layout.nodes.length) return
    if (!refitDue({ fitted: fitted.current, shown, held: held.current })) return
    fitted.current = shown
    set(fit(layout.bounds, viewport, 32, insetFor(viewport.w)))
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
              level={level}
              active={calling.some((name) => name.startsWith(`${node.id}.`))}
              onOpen={onFocusArtifact}
            />
          ))}
          {agentsLaid.map((node) => (
            <AgentNode
              key={`agent:${node.id}`}
              node={node}
              engine={enginesByName.get(node.id) ?? null}
              level={level}
              focused={focused === node.id}
              deskTitle={deskTitle}
              holds={holds.get(node.id) ?? NONE}
              onFocus={onFocus}
              onFocusArtifact={onFocusArtifact}
            />
          ))}
        </div>
      </div>

      <Toolbar
        className={toolbarClasses()}
        zoom={Math.round(cam.z * 100)}
        follow={follow}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onReset={() => zoomBy(1 / cam.z)}
        onFit={fitAll}
        onFollow={toggleFollow}
      />
      <p className={followPillClasses()} aria-live="polite">
        {followLabel({ follow, target, focused, opened })}
      </p>
      <StateLegend className="absolute right-3 bottom-3 z-10 glass hidden rounded-full border px-3 py-1 xl:flex" />
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
  const { engines, status, error } = useEngines()

  if (status === "offline") return <Offline />
  if (status === "error") return <p className="p-8 text-center text-sm text-destructive">The desk failed to start: {error}</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Canvas</h1>
      <DeskCanvas engines={engines} connecting={status !== "ready" && !engines.length} />
    </div>
  )
}
