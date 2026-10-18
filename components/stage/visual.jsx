"use client"

import * as React from "react"
import { animate, stagger, svg } from "animejs"
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react"

import { cellColor, flowLayout, linePaths, matrixRange, paletteOf, scatterScales } from "@/backend/live/visual-layout"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// A visual an agent built for the owner (kernel builtin/visual.js), drawn and animated with anime.js (2026-10-17 owner:
// "the lead is able to build visuals … show me step by step or flow"). Every kind that unfolds — a flow's steps, a
// sequence, frames of a matrix / bars / scatter, tokens written one by one — has one clock: play / pause, step, a
// scrubber and a speed (0.25×–4×, default 0.5×: slow enough to follow). A clock at its last frame follows new frames as
// a file visual grows. A click on an element (a node, a cell, a token, a point) hands its context to the stage's ask box
// (onPoint), so the owner asks about exactly that. React sets an element's first look; anime moves it after.

const SPEEDS = [0.25, 0.5, 1, 2, 4]
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
const ms = (n) => (reduced() ? 0 : n)
const fmt = (v) => (v == null ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3))

export function StageVisual({ visual, onPoint = () => {}, compact = false }) {
  if (!visual) return null
  if (!visual.kind) return <p className="text-sm text-muted-foreground">{visual.error ? `The visual could not be read: ${visual.error}` : `Reading ${visual.file ?? "the visual"}…`}</p>
  const Body = BODIES[visual.kind]
  if (!Body) return <pre className="overflow-auto text-xs">{JSON.stringify(visual, null, 2)}</pre>
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {visual.title && <figcaption className={compact ? "text-sm" : "text-lg leading-tight"}>{visual.title}</figcaption>}
      <Body v={visual} onPoint={onPoint} compact={compact} />
      {visual.caption && <p className="text-xs text-muted-foreground">{visual.caption}</p>}
      {visual.error && <p className="text-xs text-amber-400">Last read failed: {visual.error}</p>}
    </figure>
  )
}

// ---- the clock -----------------------------------------------------------------------------------

function useClock(count, { auto = true, baseMs = 1000 } = {}) {
  const [i, setI] = React.useState(0)
  const [playing, setPlaying] = React.useState(auto && count > 1 && !reduced())
  const [speed, setSpeed] = React.useState(0.5)
  const last = React.useRef(count)
  React.useEffect(() => {
    // A file visual grew: a clock that sat on the last frame follows to the new last one.
    setI((x) => (x >= last.current - 1 && !playing ? count - 1 : Math.min(x, count - 1)))
    last.current = count
  }, [count]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!playing || count < 2) return
    const t = setInterval(() => setI((x) => Math.min(x + 1, count - 1)), baseMs / speed)
    return () => clearInterval(t)
  }, [playing, speed, count, baseMs])
  React.useEffect(() => {
    if (playing && i >= count - 1) setPlaying(false)
  }, [playing, i, count])
  const go = (n) => {
    setPlaying(false)
    setI(Math.max(0, Math.min(count - 1, n)))
  }
  const toggle = () => {
    if (!playing && i >= count - 1) setI(0)
    setPlaying((p) => !p)
  }
  return { i, go, playing, toggle, speed, setSpeed, count }
}

function ClockBar({ clock, label, unit = "frame" }) {
  if (clock.count < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-10" onClick={() => clock.go(clock.i - 1)} disabled={clock.i === 0} aria-label={`Previous ${unit}`}>
        <SkipBackIcon />
      </Button>
      <Button variant="outline" size="icon-sm" className="pointer-coarse:size-10" onClick={clock.toggle} aria-label={clock.playing ? "Pause" : "Play"}>
        {clock.playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-10" onClick={() => clock.go(clock.i + 1)} disabled={clock.i >= clock.count - 1} aria-label={`Next ${unit}`}>
        <SkipForwardIcon />
      </Button>
      <input
        type="range"
        min={0}
        max={clock.count - 1}
        value={clock.i}
        onChange={(e) => clock.go(Number(e.target.value))}
        aria-label={`${unit} ${clock.i + 1} of ${clock.count}`}
        className="h-10 min-w-24 flex-1 accent-fuchsia-500 md:h-6"
      />
      <span className="tabular-nums">
        {unit} {clock.i + 1}/{clock.count}
        {label ? ` · ${label}` : ""}
      </span>
      <select value={clock.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))} aria-label="Speed" className="h-10 rounded border bg-background px-1 text-base md:h-7 md:text-xs">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  )
}

// ---- flow: a graph played step by step along its order -------------------------------------------

function FlowBody({ v, onPoint, compact }) {
  const perCol = React.useMemo(() => {
    const counts = new Map()
    for (const n of v.nodes) counts.set(n.group ?? "", (counts.get(n.group ?? "") ?? 0) + 1)
    return v.nodes.some((n) => n.group != null) ? Math.max(...counts.values()) : Math.min(v.nodes.length, 6)
  }, [v])
  const down = v.direction === "down"
  const W = compact ? 420 : 720
  const H = Math.max(compact ? 200 : 240, perCol * (compact ? 52 : 64) + 40)
  const layout = React.useMemo(() => flowLayout(v, { width: down ? H : W, height: down ? W : H, pad: 56 }), [v, W, H, down])
  const pos = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout])
  const clock = useClock(layout.order.length, { baseMs: 1100 })
  const ref = React.useRef(null)
  const lit = new Set(layout.order.slice(0, clock.i + 1))
  const current = layout.order[clock.i]

  React.useEffect(() => {
    const root = ref.current
    if (!root) return
    const a = animate(root.querySelectorAll("[data-node]"), { opacity: [0, 1], scale: [0.6, 1], delay: stagger(45), duration: ms(500), ease: "outBack" })
    const b = animate(svg.createDrawable(root.querySelectorAll("[data-edge]")), { draw: ["0 0", "0 1"], delay: stagger(30, { start: 150 }), duration: ms(700), ease: "inOutSine" })
    return () => {
      a.revert()
      b.revert()
    }
  }, [layout])

  // The current step: its node pulses and a dot runs along each edge into it from a node already lit.
  React.useEffect(() => {
    const root = ref.current
    if (!root || !current) return
    const node = root.querySelector(`[data-node="${CSS.escape(current)}"]`)
    const runs = []
    if (node) runs.push(animate(node, { scale: [1, 1.14, 1], duration: ms(700), ease: "inOutQuad" }))
    v.edges.forEach((e, k) => {
      if (e.to !== current || !lit.has(e.from)) return
      const path = root.querySelector(`[data-edge-index="${k}"]`)
      const dot = root.querySelector(`[data-dot="${k}"]`)
      if (!path || !dot) return
      dot.style.opacity = "1"
      runs.push(animate(dot, { ...svg.createMotionPath(path), duration: ms(800), ease: "inOutSine", onComplete: () => (dot.style.opacity = "0") }))
    })
    return () => runs.forEach((r) => r.pause())
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  const box = (n) => Math.max(64, Math.min(160, (n.label?.length ?? 4) * 7.2 + 20))
  const [vw, vh] = down ? [H, W] : [W, H]
  return (
    <div className="flex flex-col gap-2">
      <svg ref={ref} viewBox={`0 0 ${vw} ${vh}`} className="h-auto w-full" role="img" aria-label={v.title || "flow"}>
        {layout.edges.map((e, k) => {
          const p = pos.get(e.from)
          const q = pos.get(e.to)
          const on = lit.has(e.from) && lit.has(e.to)
          return (
            <g key={`${e.from}-${e.to}-${k}`}>
              <path data-edge data-edge-index={k} d={e.path} fill="none" className={cn("transition-colors duration-500", on ? "stroke-fuchsia-400" : "stroke-muted-foreground/40")} strokeWidth={e.weight != null ? 1 + 3 * Math.min(1, Math.abs(e.weight)) : 1.5} />
              {e.label && (
                <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {e.label}
                </text>
              )}
              <circle data-dot={k} r={4} className="fill-fuchsia-300" style={{ opacity: 0 }} />
            </g>
          )
        })}
        {layout.nodes.map((n) => {
          const w = box(n)
          const on = lit.has(n.id)
          return (
            <g
              key={n.id}
              data-node={n.id}
              transform={`translate(${n.x} ${n.y})`}
              style={{ transformBox: "fill-box", transformOrigin: "center", cursor: "pointer" }}
              onClick={() => onPoint({ context: { visual: "flow", node: n.id, label: n.label } })}
            >
              <title>{[n.label, n.note, n.value != null ? `value ${n.value}` : ""].filter(Boolean).join(" — ")}</title>
              <rect x={-w / 2} y={-16} width={w} height={32} rx={8} className={cn("transition-colors duration-500", n.id === current ? "fill-fuchsia-500/30 stroke-fuchsia-300" : on ? "fill-fuchsia-500/10 stroke-fuchsia-400/80" : "fill-background stroke-muted-foreground/50")} strokeWidth={1.5} />
              <text textAnchor="middle" dy="0.35em" className="fill-foreground text-[12px]">
                {n.label}
              </text>
              {n.value != null && (
                <text textAnchor="middle" y={28} className="fill-muted-foreground text-[10px]">
                  {fmt(n.value)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ClockBar clock={clock} unit="step" label={pos.get(current)?.label} />
      {pos.get(current)?.note && <p className="text-xs text-muted-foreground">{pos.get(current).note}</p>}
    </div>
  )
}

// ---- steps: a sequence revealed one at a time ---------------------------------------------------

function StepsBody({ v, onPoint }) {
  const clock = useClock(v.steps.length, { baseMs: 1400 })
  const ref = React.useRef(null)
  React.useEffect(() => {
    const el = ref.current?.querySelector(`[data-step="${clock.i}"]`)
    if (!el) return
    const a = animate(el, { opacity: [0, 1], translateX: [-10, 0], duration: ms(450), ease: "outQuad" })
    return () => a.pause()
  }, [clock.i])
  return (
    <div className="flex flex-col gap-2">
      <ol ref={ref} className="flex flex-col gap-1.5">
        {v.steps.slice(0, clock.i + 1).map((s, k) => (
          <li key={k} data-step={k}>
            <button
              type="button"
              onClick={() => onPoint({ context: { visual: "steps", step: k + 1, title: s.title } })}
              className={cn("flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left pointer-coarse:min-h-10", k === clock.i ? "border-fuchsia-400/70" : "opacity-80")}
            >
              <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{k + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{s.title}</span>
                {s.detail && <span className="block text-xs text-muted-foreground">{s.detail}</span>}
              </span>
              {s.value && <span className="shrink-0 rounded-full border px-2 text-xs tabular-nums">{s.value}</span>}
            </button>
          </li>
        ))}
      </ol>
      <ClockBar clock={clock} unit="step" />
    </div>
  )
}

// ---- matrix: a heatmap, replayed by frame on one colour scale ------------------------------------

function MatrixBody({ v, onPoint, compact }) {
  const range = React.useMemo(() => matrixRange(v), [v])
  const R = v.frames[0].values.length
  const C = v.frames[0].values[0].length
  const clock = useClock(v.frames.length, { baseMs: 900 })
  const cell = Math.max(4, Math.min(compact ? 18 : 28, Math.floor((compact ? 360 : 560) / Math.max(R, C))))
  const lw = v.rows ? 64 : 4
  const lh = v.cols ? 44 : 4
  const ref = React.useRef(null)
  const first = React.useMemo(() => v.frames[0].values.flat().map((x) => cellColor(x, range, v.diverging)), [v, range])

  React.useEffect(() => {
    const cells = ref.current?.querySelectorAll("[data-cell]")
    if (!cells?.length) return
    const a = animate(cells, { opacity: [0, 1], delay: stagger(Math.max(1, 400 / (R * C)), { grid: [R, C], from: "center" }), duration: ms(350) })
    return () => a.revert()
  }, [v, R, C])
  React.useEffect(() => {
    const cells = ref.current?.querySelectorAll("[data-cell]")
    if (!cells?.length) return
    const flat = v.frames[clock.i].values.flat()
    const a = animate(cells, { fill: (_, k) => cellColor(flat[k], range, v.diverging), duration: ms(380), ease: "outQuad" })
    return () => a.pause()
  }, [clock.i, v, range])

  const frame = v.frames[clock.i]
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-auto">
        <svg ref={ref} viewBox={`0 0 ${lw + C * cell} ${lh + R * cell}`} className="h-auto w-full max-w-[720px]" role="img" aria-label={v.title || "matrix"}>
          {v.cols?.map((c, j) => (
            <text key={`c${j}`} transform={`translate(${lw + j * cell + cell / 2} ${lh - 4}) rotate(-50)`} className="fill-muted-foreground text-[9px]">
              {c}
            </text>
          ))}
          {v.rows?.map((r, i) => (
            <text key={`r${i}`} x={lw - 4} y={lh + i * cell + cell / 2} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[9px]">
              {r}
            </text>
          ))}
          {frame.values.map((row, i) =>
            row.map((_, j) => (
              <rect
                key={`${i}-${j}`}
                data-cell
                x={lw + j * cell}
                y={lh + i * cell}
                width={cell - (cell > 6 ? 1 : 0)}
                height={cell - (cell > 6 ? 1 : 0)}
                fill={first[i * C + j]}
                className="cursor-pointer hover:stroke-foreground"
                onClick={() => onPoint({ context: { visual: "matrix", row: v.rows?.[i] ?? i, col: v.cols?.[j] ?? j, value: frame.values[i][j], ...(frame.label ? { frame: frame.label } : {}) } })}
              >
                <title>{`${v.rows?.[i] ?? i} × ${v.cols?.[j] ?? j}: ${fmt(frame.values[i][j])}${v.unit ? ` ${v.unit}` : ""}`}</title>
              </rect>
            )),
          )}
        </svg>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="tabular-nums">{fmt(range[0])}</span>
        <span className="h-2 w-28 rounded" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => cellColor(range[0] + t * (range[1] - range[0]), range, v.diverging)).join(",")})` }} />
        <span className="tabular-nums">{fmt(range[1])}</span>
        {v.unit && <span>{v.unit}</span>}
      </div>
      <ClockBar clock={clock} label={frame.label} />
    </div>
  )
}

// ---- line: series drawn in, marks where something happened --------------------------------------

function LineBody({ v, onPoint, compact }) {
  const W = compact ? 420 : 720
  const H = compact ? 220 : 300
  const L = React.useMemo(() => linePaths(v, { width: W, height: H, pad: 44 }), [v, W, H])
  const color = React.useMemo(() => paletteOf(v.series.map((s) => s.name)), [v])
  const ref = React.useRef(null)
  const shape = v.series.length
  React.useEffect(() => {
    const paths = ref.current?.querySelectorAll("[data-series]")
    if (!paths?.length) return
    const a = animate(svg.createDrawable(paths), { draw: ["0 0", "0 1"], delay: stagger(150), duration: ms(1200), ease: "inOutSine" })
    return () => a.revert()
  }, [shape])
  return (
    <div className="flex flex-col gap-2">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={v.title || "line chart"}>
        <line x1={44} x2={W - 22} y1={H - 44} y2={H - 44} className="stroke-muted-foreground/40" />
        <line x1={44} x2={44} y1={22} y2={H - 44} className="stroke-muted-foreground/40" />
        <text x={40} y={26} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {fmt(L.ys[1])}
        </text>
        <text x={40} y={H - 44} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {fmt(L.ys[0])}
        </text>
        <text x={44} y={H - 28} className="fill-muted-foreground text-[10px]">
          {fmt(L.xs[0])}
        </text>
        <text x={W - 22} y={H - 28} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {fmt(L.xs[1])}
          {v.x ? ` ${v.x}` : ""}
        </text>
        {v.y && (
          <text x={48} y={14} className="fill-muted-foreground text-[10px]">
            {v.y}
          </text>
        )}
        {L.marks.map((m, k) => (
          <g key={`m${k}`}>
            <line x1={m.px} x2={m.px} y1={22} y2={H - 44} strokeDasharray="3 3" className="stroke-amber-400/70" />
            <text x={m.px + 3} y={32 + (k % 3) * 11} className="fill-amber-400 text-[10px]">
              {m.label}
            </text>
          </g>
        ))}
        {L.series.map((s) => (
          <path key={s.name} data-series d={s.d} fill="none" stroke={color(s.name)} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {L.series.map(
          (s) =>
            s.end && (
              <circle key={`e-${s.name}`} cx={s.end[0]} cy={s.end[1]} r={4} fill={color(s.name)} className="cursor-pointer" onClick={() => onPoint({ context: { visual: "line", series: s.name, x: s.last[0], y: s.last[1] } })}>
                <title>{`${s.name}: ${fmt(s.last[1])} at ${fmt(s.last[0])}`}</title>
              </circle>
            ),
        )}
      </svg>
      <Legend names={v.series.map((s) => [s.name, s.points.filter((p) => p[1] != null).at(-1)?.[1]])} color={color} />
    </div>
  )
}

function Legend({ names, color }) {
  if (names.length < 2) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {names.map(([n, last]) => (
        <span key={n} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: color(n) }} />
          {n}
          {last != null && <span className="tabular-nums text-muted-foreground">{fmt(last)}</span>}
        </span>
      ))}
    </div>
  )
}

// ---- bars: values that grow into place, replayed by frame ----------------------------------------

function BarsBody({ v, onPoint }) {
  const clock = useClock(v.frames.length, { baseMs: 1000 })
  const max = React.useMemo(() => Math.max(1e-9, ...v.frames.flatMap((f) => f.bars.map((b) => Math.abs(b.value ?? 0)))), [v])
  const labels = React.useMemo(() => [...new Set(v.frames.flatMap((f) => f.bars.map((b) => b.label)))], [v])
  const ref = React.useRef(null)
  const frame = v.frames[clock.i]
  React.useEffect(() => {
    const bars = ref.current?.querySelectorAll("[data-bar]")
    if (!bars?.length) return
    const byLabel = new Map(frame.bars.map((b) => [b.label, b.value ?? 0]))
    const a = animate(bars, { width: (el) => `${(100 * Math.abs(byLabel.get(el.dataset.bar) ?? 0)) / max}%`, duration: ms(500), delay: stagger(25), ease: "outCubic" })
    return () => a.pause()
  }, [frame, max])
  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="flex flex-col gap-1">
        {labels.map((label) => {
          const b = frame.bars.find((x) => x.label === label)
          return (
            <button key={label} type="button" onClick={() => onPoint({ context: { visual: "bars", label, value: b?.value ?? null, ...(frame.label ? { frame: frame.label } : {}) } })} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-left text-xs pointer-coarse:min-h-10" title={b?.note}>
              <span className="truncate">{label}</span>
              <span className="h-3 overflow-hidden rounded bg-muted/40">
                <span data-bar={label} className={cn("block h-full rounded", (b?.value ?? 0) < 0 ? "bg-sky-500" : "bg-fuchsia-500")} style={{ width: 0 }} />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {fmt(b?.value)}
                {v.unit ?? ""}
              </span>
            </button>
          )
        })}
      </div>
      <ClockBar clock={clock} label={frame.label} />
    </div>
  )
}

// ---- tokens: text written one token at a time, each with what it could have been ----------------

function TokensBody({ v, onPoint }) {
  const clock = useClock(v.tokens.length, { baseMs: 700 })
  const [picked, setPicked] = React.useState(null)
  const ref = React.useRef(null)
  const shown = picked != null && picked <= clock.i ? picked : clock.i
  const t = v.tokens[shown]
  React.useEffect(() => {
    const el = ref.current?.querySelector(`[data-token="${clock.i}"]`)
    if (!el) return
    const a = animate(el, { opacity: [0, 1], translateY: [6, 0], duration: ms(300), ease: "outQuad" })
    return () => a.pause()
  }, [clock.i])
  React.useEffect(() => {
    const bars = ref.current?.querySelectorAll("[data-top]")
    if (!bars?.length) return
    const a = animate(bars, { width: (el) => `${100 * Number(el.dataset.top)}%`, duration: ms(400), delay: stagger(30), ease: "outCubic" })
    return () => a.pause()
  }, [shown])
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
        {v.prompt && <span className="text-muted-foreground">{v.prompt}</span>}
        {v.tokens.slice(0, clock.i + 1).map((tok, k) => (
          <button
            key={k}
            type="button"
            data-token={k}
            onClick={() => {
              setPicked(k)
              onPoint({ context: { visual: "tokens", token: k + 1, text: tok.text, ...(tok.p != null ? { p: tok.p } : {}) } })
            }}
            className={cn("rounded px-px transition-colors", k === shown ? "bg-fuchsia-500/30" : tok.p != null && tok.p < 0.3 ? "text-amber-300" : "hover:bg-muted")}
            title={tok.p != null ? `p ${fmt(tok.p)}${tok.entropy != null ? ` · entropy ${fmt(tok.entropy)}` : ""}` : undefined}
          >
            {tok.text}
          </button>
        ))}
      </p>
      {t?.top?.length > 0 && (
        <div className="flex flex-col gap-1" key={shown}>
          <p className="text-xs text-muted-foreground">
            token {shown + 1}: “{t.text}”{t.p != null ? ` · p ${fmt(t.p)}` : ""}
            {t.entropy != null ? ` · entropy ${fmt(t.entropy)}` : ""} — what the model weighed
          </p>
          {t.top.map(([text, p], k) => (
            <div key={k} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
              <span className={cn("truncate", text === t.text && "text-fuchsia-300")}>{JSON.stringify(text)}</span>
              <span className="h-2.5 overflow-hidden rounded bg-muted/40">
                <span data-top={p ?? 0} className={cn("block h-full rounded", text === t.text ? "bg-fuchsia-500" : "bg-muted-foreground/60")} style={{ width: 0 }} />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">{fmt(p)}</span>
            </div>
          ))}
        </div>
      )}
      <ClockBar clock={clock} unit="token" />
    </div>
  )
}

// ---- scatter: points that move between frames on one map (latent space, layer by layer) ----------

function ScatterBody({ v, onPoint, compact }) {
  const W = compact ? 420 : 640
  const H = compact ? 260 : 380
  const { sx, sy } = React.useMemo(() => scatterScales(v, { width: W, height: H }), [v, W, H])
  const clock = useClock(v.frames.length, { baseMs: 1100 })
  const color = React.useMemo(() => paletteOf(v.frames.flatMap((f) => f.points.map((p) => p.group ?? ""))), [v])
  const ref = React.useRef(null)
  const frame = v.frames[clock.i]
  const first = v.frames[0].points
  React.useEffect(() => {
    const dots = ref.current?.querySelectorAll("[data-pt]")
    const labels = ref.current?.querySelectorAll("[data-lb]")
    if (!dots?.length) return
    const at = (k) => frame.points[k] ?? frame.points.at(-1)
    const a = animate(dots, { cx: (_, k) => sx(at(k)?.x ?? 0), cy: (_, k) => sy(at(k)?.y ?? 0), duration: ms(650), ease: "inOutCubic" })
    const b = labels?.length ? animate(labels, { x: (el) => sx(at(Number(el.dataset.lb))?.x ?? 0) + 6, y: (el) => sy(at(Number(el.dataset.lb))?.y ?? 0) - 6, duration: ms(650), ease: "inOutCubic" }) : null
    return () => {
      a.pause()
      b?.pause()
    }
  }, [frame, sx, sy])
  return (
    <div className="flex flex-col gap-2">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={v.title || "scatter"}>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={6} className="fill-none stroke-muted-foreground/20" />
        {v.trails &&
          first.map((_, k) => (
            <polyline
              key={`t${k}`}
              points={v.frames
                .slice(0, clock.i + 1)
                .map((f) => f.points[k])
                .filter(Boolean)
                .map((p) => `${sx(p.x ?? 0).toFixed(1)},${sy(p.y ?? 0).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={color(first[k].group ?? "")}
              strokeOpacity={0.35}
              strokeWidth={1.2}
            />
          ))}
        {first.map((p, k) => (
          <circle key={k} data-pt cx={sx(p.x ?? 0)} cy={sy(p.y ?? 0)} r={first.length > 400 ? 2.5 : 5} fill={color(p.group ?? "")} fillOpacity={0.85} className="cursor-pointer" onClick={() => onPoint({ context: { visual: "scatter", point: frame.points[k]?.label ?? k, ...(frame.points[k]?.group ? { group: frame.points[k].group } : {}), ...(frame.label ? { frame: frame.label } : {}) } })}>
            <title>{[frame.points[k]?.label, frame.points[k]?.group].filter(Boolean).join(" · ") || `point ${k}`}</title>
          </circle>
        ))}
        {first.length <= 60 &&
          first.map((p, k) =>
            p.label ? (
              <text key={`l${k}`} data-lb={k} x={sx(p.x ?? 0) + 6} y={sy(p.y ?? 0) - 6} className="pointer-events-none fill-foreground text-[11px]">
                {frame.points[k]?.label ?? p.label}
              </text>
            ) : null,
          )}
        {(v.x || v.y) && (
          <text x={8} y={H - 8} className="fill-muted-foreground text-[10px]">
            {[v.x, v.y].filter(Boolean).join(" × ")}
          </text>
        )}
      </svg>
      <ClockBar clock={clock} label={frame.label} />
    </div>
  )
}

// ---- compare: two or three ideas side by side ----------------------------------------------------

function CompareBody({ v, onPoint }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("grid gap-3", v.sides.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {v.sides.map((s, k) => (
          <section key={k} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
            <h3 className="text-lg leading-tight">{s.title}</h3>
            {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
            <StageVisual visual={s.visual} compact onPoint={({ context, text }) => onPoint({ context: { side: s.title, ...(context ?? {}) }, text })} />
          </section>
        ))}
      </div>
      {v.verdict && <p className="rounded-md border border-fuchsia-500/40 px-3 py-2 text-sm">{v.verdict}</p>}
    </div>
  )
}

const BODIES = { flow: FlowBody, steps: StepsBody, matrix: MatrixBody, line: LineBody, bars: BarsBody, tokens: TokensBody, scatter: ScatterBody, compare: CompareBody }
