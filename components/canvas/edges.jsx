import * as React from "react"

// The lines from each lead to each member (backend/live/canvas-layout.js edges), in the canvas's world layer:
// orthogonal paths that go round every box but their own two, rounded at the turns. Strokes keep their width at
// every zoom; a line pulses blue while the lead has a quest out on that member.

const RADIUS = 16

function pathOf(points) {
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [a, p, b] = [points[i - 1], points[i], points[i + 1]]
    const inLen = Math.hypot(p[0] - a[0], p[1] - a[1])
    const outLen = Math.hypot(b[0] - p[0], b[1] - p[1])
    const r = Math.min(RADIUS, inLen / 2, outLen / 2)
    const before = [p[0] - ((p[0] - a[0]) / inLen) * r, p[1] - ((p[1] - a[1]) / inLen) * r]
    const after = [p[0] + ((b[0] - p[0]) / outLen) * r, p[1] + ((b[1] - p[1]) / outLen) * r]
    d += `L${before[0]} ${before[1]}Q${p[0]} ${p[1]} ${after[0]} ${after[1]}`
  }
  const last = points.at(-1)
  return `${d}L${last[0]} ${last[1]}`
}

export const Edges = React.memo(function Edges({ edges, quests }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
      {edges.map((e) => {
        const quest = quests.get(e.from)?.has(e.to) ?? false
        return (
          <path
            key={`${e.from}>${e.to}`}
            data-edge={`${e.from}>${e.to}`}
            data-quest={quest || undefined}
            d={pathOf(e.points)}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={quest ? 3 : 1.5}
            strokeLinecap="round"
            className={quest ? "stroke-blue-500 motion-safe:animate-pulse" : "stroke-muted-foreground/50"}
          />
        )
      })}
    </svg>
  )
})
