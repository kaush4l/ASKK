"use client"

import * as React from "react"

import { axisText, chartLayout, nearestPoints, newestChart, numberText } from "@/backend/live/chart"
import { cn } from "@/lib/utils"

// The charts artifact's view `chart` (backend/kernel/builtin/charts.js; 2026-10-17 owner: the observation desk's
// graphs): each chart as an SVG drawn from backend/live/chart.js's geometry — no chart library. Closed, the newest
// chart small (the card stays under 160px); open, every chart full width, with a readout under the pointer.
//   state: { charts: [{ id, title, kind: line | scatter | bar, x, y, file, by, series: [{name, points: [[x, y,
//   label?]]}], updatedAt, error }] }

// Series colours in fixed order (never cycled; a 9th series is drawn muted), stepped for each theme — the light steps
// read on white, the dark steps on the OLED black. Axes, ticks and text wear the theme's own tokens.
const PALETTE =
  "[--series-1:#2a78d6] [--series-2:#eb6834] [--series-3:#1baf7a] [--series-4:#eda100] [--series-5:#e87ba4] [--series-6:#008300] [--series-7:#6250d6] [--series-8:#e34948] " +
  "dark:[--series-1:#3987e5] dark:[--series-2:#d95926] dark:[--series-3:#199e70] dark:[--series-4:#c98500] dark:[--series-5:#d55181] dark:[--series-6:#008300] dark:[--series-7:#9085e9] dark:[--series-8:#e66767]"
const colour = (slot) => (slot ? `var(--series-${slot})` : "var(--muted-foreground)")

const HEIGHT = { compact: 80, full: 200 }
const FALLBACK_WIDTH = 320

// The box's width in CSS px, so the viewBox is 1:1 and ticks keep their size on a phone and a wide screen.
function useWidth() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(FALLBACK_WIDTH)
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function ChartView({ state, expanded }) {
  const charts = Array.isArray(state?.charts) ? state.charts : []
  if (!charts.length) return <p className="mt-1 text-xs text-muted-foreground">no charts yet</p>
  if (!expanded) {
    const chart = newestChart(charts)
    // one chart, its caption and one line (its legend, or its error): the closed card stays under 160px
    return (
      <div className={cn("mt-1 max-h-30 min-w-0 overflow-hidden", PALETTE)}>
        <OneChart chart={chart} compact more={charts.length - 1} />
      </div>
    )
  }
  return (
    <div className={cn("mt-1 flex min-w-0 flex-col gap-4", PALETTE)}>
      {charts.map((c) => (
        <OneChart key={c.id} chart={c} />
      ))}
    </div>
  )
}

function OneChart({ chart, compact = false, more = 0 }) {
  const [ref, width] = useWidth()
  const height = compact ? HEIGHT.compact : HEIGHT.full
  const layout = React.useMemo(() => chartLayout(chart, { width, height }), [chart, width, height])
  const [hover, setHover] = React.useState(null) // the pointer's x in the viewBox
  const near = hover == null ? [] : nearestPoints(layout, hover)
  const axis = axisText(chart)
  const title = chart?.title || chart?.id || "chart"
  const label = `${title}${axis ? ` (${axis})` : ""}: ${layout.series.map((s) => `${s.name} ${s.n} points${s.last ? `, last ${numberText(s.last[1])}` : ""}`).join("; ") || "no points"}`

  const track = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) setHover(((event.clientX - box.left) * layout.width) / box.width)
  }

  return (
    <figure className="flex min-w-0 flex-col gap-0.5">
      <figcaption className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="min-w-0 truncate text-foreground/90">{title}</span>
        {axis && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{axis}</span>}
        {!compact && chart?.kind && chart.kind !== "line" && <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">{chart.kind}</span>}
        {more > 0 && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">+{more} more</span>}
      </figcaption>
      <div ref={ref} className="min-w-0">
        {layout.empty ? (
          <p className="flex items-center justify-center rounded-sm border border-dashed text-[11px] text-muted-foreground" style={{ height: compact ? 48 : 96 }}>
            {chart?.error ? "no points" : "no points yet"}
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width="100%"
            height={layout.height}
            role="img"
            aria-label={label}
            className="block touch-pan-y overflow-visible"
            onPointerMove={compact ? undefined : track}
            onPointerDown={compact ? undefined : track}
            onPointerLeave={compact ? undefined : () => setHover(null)}
          >
            <title>{label}</title>
            <Axes layout={layout} />
            {layout.series.map((s) => (
              <Marks key={`${s.name}-${s.slot}`} kind={layout.kind} series={s} compact={compact} />
            ))}
            {near.length > 0 && <Crosshair layout={layout} near={near} />}
          </svg>
        )}
      </div>
      {!compact && <Readout chart={chart} near={near} />}
      {!(compact && chart?.error) && <Legend layout={layout} compact={compact} />}
      {chart?.error && <p className={cn("text-[11px] text-destructive", compact ? "truncate" : "break-words")} title={chart.error}>{chart.error}</p>}
      {!compact && (chart?.file || chart?.by) && (
        <p className="break-all font-mono text-[10px] text-muted-foreground">
          {chart.file}
          {chart.by ? ` · by ${chart.by}` : ""}
          {chart.updatedAt ? ` · ${new Date(chart.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
          {layout.clipped ? ` · the newest ${layout.series[0]?.bars.length ?? 0} bars (${layout.clipped} older not drawn)` : ""}
        </p>
      )}
    </figure>
  )
}

// Recessive frame: a hairline at the y range's min and max, the zero line when it is inside, min/max tick text.
function Axes({ layout }) {
  const { plot, yTicks, xTicks, baseline } = layout
  return (
    <g className="font-mono" fontSize={10} fill="var(--muted-foreground)">
      {yTicks.map((t) => (
        <line key={`g${t.py}`} x1={plot.left} x2={plot.right} y1={t.py} y2={t.py} stroke="var(--border)" strokeWidth={1} />
      ))}
      {baseline != null && <line x1={plot.left} x2={plot.right} y1={baseline} y2={baseline} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />}
      {yTicks.map((t, i) => (
        <text key={`y${i}`} x={plot.left - 4} y={t.py} textAnchor="end" dominantBaseline={i === 0 ? "auto" : "hanging"} className="tabular-nums">
          {t.text}
        </text>
      ))}
      {xTicks.map((t, i) => (
        <text key={`x${i}`} x={t.px} y={layout.height - 3} textAnchor={t.anchor} className="tabular-nums">
          {t.text}
        </text>
      ))}
    </g>
  )
}

function Marks({ kind, series: s, compact }) {
  const stroke = colour(s.slot)
  if (kind === "bar")
    return (
      <g fill={stroke}>
        {s.bars.map((b, i) => (
          <rect key={i} x={b.px} y={b.py} width={b.w} height={b.h} rx={Math.min(2, b.w / 2)} />
        ))}
      </g>
    )
  if (kind === "scatter")
    return (
      <g fill={stroke}>
        {s.points.map((p, i) => (
          <circle key={i} cx={p.px} cy={p.py} r={compact ? 1.75 : 2.5} />
        ))}
      </g>
    )
  return <path d={s.d} fill="none" stroke={stroke} strokeWidth={compact ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.slot ? undefined : "4 3"} />
}

function Crosshair({ layout, near }) {
  const px = near[0].px
  return (
    <g pointerEvents="none">
      <line x1={px} x2={px} y1={layout.plot.top} y2={layout.plot.bottom} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1} />
      {layout.kind !== "bar" &&
        near.map((p) => <circle key={p.name} cx={p.px} cy={p.py} r={3.5} fill={colour(p.slot)} stroke="var(--background)" strokeWidth={1.5} />)}
    </g>
  )
}

// What the pointer is on: its x (the label when the point carries one) and each series' value there.
function Readout({ chart, near }) {
  if (!near.length) return <p className="min-h-4 text-[11px] text-muted-foreground">{"Point at or tap the chart for its values"}</p>
  const x = near[0]
  return (
    <p className="flex min-h-4 min-w-0 flex-wrap gap-x-3 text-[11px] tabular-nums" aria-live="polite">
      <span className="text-muted-foreground">
        {chart?.x || "row"} {x.label ?? numberText(x.x)}
      </span>
      {near.map((p) => (
        <span key={p.name} className="flex items-center gap-1">
          <Swatch slot={p.slot} />
          <span className="text-muted-foreground">{p.name}</span> {numberText(p.y)}
        </span>
      ))}
    </p>
  )
}

const Swatch = ({ slot, kind = "line" }) => (
  <span aria-hidden className={cn("inline-block shrink-0", kind === "line" ? "h-0.5 w-2.5 rounded-full" : kind === "scatter" ? "size-1.5 rounded-full" : "size-2 rounded-[2px]")} style={{ background: colour(slot) }} />
)

// Every series by name (identity is never colour alone) with its last value.
function Legend({ layout, compact }) {
  const series = layout.series
  if (!series.length) return null
  const shown = compact ? series.slice(0, 3) : series
  return (
    <ul className={cn("flex min-w-0 gap-x-3 gap-y-0.5 text-[11px]", compact ? "overflow-hidden whitespace-nowrap" : "flex-wrap")} aria-label="Series">
      {shown.map((s) => (
        <li key={`${s.name}-${s.slot}`} className="flex min-w-0 items-center gap-1">
          <Swatch slot={s.slot} kind={layout.kind} />
          <span className="min-w-0 truncate text-foreground/80">{s.name}</span>
          {s.last && <span className="shrink-0 text-muted-foreground tabular-nums">{numberText(s.last[1])}</span>}
        </li>
      ))}
      {compact && series.length > shown.length && <li className="shrink-0 text-muted-foreground">+{series.length - shown.length}</li>}
    </ul>
  )
}
