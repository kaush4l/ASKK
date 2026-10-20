"use client"

import * as React from "react"

import { clockOf, everyLabel, intervalLabel, parsePlot, runnerCall, runnerCharts, runnerRows, startRunner, testRunner } from "@/backend/live/runners"
import { PALETTE } from "@/backend/live/visual-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// The runners view (an artifact with view "runners": code's live formulas, each calling the lead back when its condition
// holds — backend/live/runners.js has the shape). Closed on a card: one line per runner with its price sparkline; open:
// each runner's live chart (the price, its plotted values, the bars its condition turned true), where it stands, and the
// owner's controls — pause, resume, compute now, stop, remove — and a form to start or test one.

const TONE = {
  holds: "bg-emerald-500",
  near: "bg-amber-400",
  running: "bg-sky-500",
  warming: "bg-muted-foreground/50",
  paused: "bg-muted-foreground/40",
  done: "bg-muted-foreground/30",
  error: "bg-red-500",
}
const colorOf = (names) => (name) => PALETTE[Math.max(0, names.indexOf(name)) % PALETTE.length]
const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3))

export function RunnersView({ id, state, expanded }) {
  const rows = runnerRows(state)
  const [calls, call] = useRunnerCalls(id)
  if (!expanded) {
    if (!rows.length) return <p className="mt-1 text-xs text-muted-foreground">no runners</p>
    return (
      <ul className="mt-1 flex min-w-0 flex-col gap-0.5">
        {rows.slice(0, 5).map(({ r, s }) => (
          <li key={r.id} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE[s.tone])} />
            <span className="min-w-0 truncate font-mono text-foreground/90">{r.id}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{intervalLabel(r.interval)}</span>
            <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
              {s.word}
              {s.detail ? ` · ${s.detail}` : ""}
            </span>
            <Spark chart={r.chart} />
          </li>
        ))}
        {rows.length > 5 && <li className="text-[11px] text-muted-foreground">+{rows.length - 5} more</li>}
      </ul>
    )
  }
  return (
    <div className="@container mt-1 flex min-w-0 flex-col gap-2">
      <p className="text-[11px] break-words text-muted-foreground">
        {state?.poll?.at ? `quotes ${clockOf(state.poll.at)} ET · ${(state.poll.symbols ?? []).join(" ") || "none"}` : "no quote read yet"}
        {state?.poll?.error ? <span className="text-red-700 dark:text-red-400"> · {state.poll.error}</span> : null}
        {` · ${(state?.fired ?? []).filter((f) => f.kind === "fire").length} fired today`}
      </p>
      <NewRunner id={id} />
      {!rows.length && <p className="text-xs text-muted-foreground">no runners — start one above, or an agent does ({id}.start)</p>}
      <ul className="grid min-w-0 grid-cols-1 gap-2 @3xl:grid-cols-2">
        {rows.map(({ r, s }) => (
          <RunnerCard key={r.id} r={r} s={s} busy={calls[r.id]} onCall={(method) => call(method, r.id)} />
        ))}
      </ul>
    </div>
  )
}

function RunnerCard({ r, s, busy, onCall }) {
  const names = Object.keys(r.plot ?? {})
  const color = colorOf(names)
  const running = r.status === "running"
  const fires = (r.fires ?? []).slice(-4)
  return (
    <li className="min-w-0 rounded-md border px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE[s.tone])} />
        <span className="min-w-0 truncate font-mono text-sm text-foreground">{r.id}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {r.symbol} · {intervalLabel(r.interval)} · {r.source} · {everyLabel(r.every)}
          {r.until ? ` · until ${r.until}` : ""}
        </span>
        <span className={cn("shrink-0 rounded-sm border px-1 text-[11px]", s.tone === "holds" && "border-emerald-500/60 text-emerald-600 dark:text-emerald-400", s.tone === "near" && "border-amber-400/60 text-amber-600 dark:text-amber-300", s.tone === "error" && "border-red-500/60 text-red-700 dark:text-red-400")}>{s.word}</span>
        {s.detail && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{s.detail}</span>}
      </div>
      <p className="mt-1 font-mono text-[11px] break-words text-foreground/80">
        when {r.when}{" "}
        <span className="text-muted-foreground">
          → {r.then}
          {r.repeat === "edge" ? " each time" : " once"}
          {r.warn ? ` · heads-up ${r.warn} bars ahead` : ""}
        </span>
      </p>
      {r.why && <p className="text-[11px] break-words text-muted-foreground">{r.why}</p>}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
        <span className="text-foreground">{fmt(r.last?.price)}</span>
        {names.map((n) => (
          <span key={n} style={{ color: color(n) }}>
            {n} {fmt(r.last?.values?.[n])}
          </span>
        ))}
        {r.last?.at && <span className="text-muted-foreground">computed {clockOf(r.last.at)} ET</span>}
        <span className="text-muted-foreground">[{r.set_by}]</span>
      </div>
      <Chart chart={r.chart} color={color} />
      {fires.length > 0 && <p className="text-[11px] break-words text-muted-foreground">{fires.map((f) => `${f.kind === "warn" ? "heads-up" : "fired"} ${clockOf(f.at)} @${fmt(f.price)}`).join(" · ")}</p>}
      {r.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{r.error}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {running ? <Control label="Pause" busy={busy} onClick={() => onCall("pause")} /> : <Control label="Resume" busy={busy} onClick={() => onCall("resume")} />}
        {running && <Control label="Compute now" busy={busy} onClick={() => onCall("now")} />}
        {running && <Control label="Stop" busy={busy} onClick={() => onCall("stop")} variant="destructive" />}
        <Control label="Remove" busy={busy} onClick={() => onCall("remove")} variant="ghost" />
      </div>
      {busy?.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{busy.error}</p>}
    </li>
  )
}

function Control({ label, busy, onClick, variant = "outline" }) {
  return (
    <Button type="button" size="xs" variant={variant} className="h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10" disabled={!!busy?.busy} onClick={onClick}>
      {label}
    </Button>
  )
}

// The live chart: the price (the bar forming at the right), the plotted values on its scale, the others under it, the
// bars the condition turned true (dashed), the last price.
function Chart({ chart, color }) {
  const g = React.useMemo(() => runnerCharts(chart, { width: 360, height: 130, lowerHeight: 46 }), [chart])
  if (!g) return <p className="mt-1 text-[11px] text-muted-foreground">no bars yet</p>
  return (
    <figure className="mt-1 min-w-0">
      <svg viewBox={`0 0 ${g.width} ${g.height}`} className="h-auto w-full" role="img" aria-label={`price ${chart.interval ?? ""} ${chart.source ?? ""}`}>
        {g.marks.map((m, k) => (
          <line key={k} x1={m.x} x2={m.x} y1={0} y2={g.height} strokeDasharray="3 3" className="stroke-amber-400/80" />
        ))}
        <path d={g.price.d} fill="none" strokeWidth="1.5" className="stroke-foreground" />
        {g.over.map((s) => (
          <path key={s.name} d={s.d} fill="none" strokeWidth="1.2" stroke={color(s.name)} />
        ))}
        <circle cx={g.price.last.x} cy={g.price.last.y} r="2.5" className="fill-foreground" />
        <text x={4} y={11} className="fill-muted-foreground text-[9px]">
          {fmt(g.price.ys[1])}
        </text>
        <text x={4} y={g.height - 4} className="fill-muted-foreground text-[9px]">
          {fmt(g.price.ys[0])}
        </text>
      </svg>
      {g.lower && (
        <svg viewBox={`0 0 ${g.width} ${g.lower.height}`} className="h-auto w-full border-t border-dashed" role="img" aria-label="indicators on their own scale">
          {g.lower.series.map((s) => (
            <path key={s.name} d={s.d} fill="none" strokeWidth="1.2" stroke={color(s.name)} />
          ))}
          <text x={4} y={10} className="fill-muted-foreground text-[9px]">
            {fmt(g.lower.ys[1])}
          </text>
          <text x={4} y={g.lower.height - 3} className="fill-muted-foreground text-[9px]">
            {fmt(g.lower.ys[0])}
          </text>
        </svg>
      )}
      <figcaption className="flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{g.first}</span>
        <span>
          {chart.interval} · {chart.source === "quotes" ? "live quotes" : "broker bars"}
        </span>
        <span>{g.last}</span>
      </figcaption>
    </figure>
  )
}

function Spark({ chart }) {
  const g = React.useMemo(() => runnerCharts(chart, { width: 64, height: 18, pad: 1 }), [chart])
  if (!g) return null
  return (
    <svg viewBox="0 0 64 18" className="h-[18px] w-16 shrink-0" aria-hidden>
      <path d={g.price.d} fill="none" strokeWidth="1" className="stroke-foreground/70" />
    </svg>
  )
}

// Per runner {busy, error} while the owner's call is out.
function useRunnerCalls(id) {
  const [calls, setCalls] = React.useState({})
  const call = React.useCallback(
    async (method, runner) => {
      setCalls((c) => ({ ...c, [runner]: { busy: true, error: null } }))
      try {
        await runnerCall(id, method, runner)
        setCalls((c) => ({ ...c, [runner]: { busy: false, error: null } }))
      } catch (error) {
        setCalls((c) => ({ ...c, [runner]: { busy: false, error: error?.message ?? String(error) } }))
      }
    },
    [id],
  )
  return [calls, call]
}

const FIELDS = [
  ["id", "id", "my-runner"],
  ["symbol", "symbol", "ABC"],
  ["interval", "bar size", "5m"],
  ["every", "computes", "bar | tick | 1m"],
  ["source", "source", "auto | quotes | bars"],
  ["warn", "heads-up bars", "2"],
]

// The owner starts or tests a runner: the same spec the agents give <id>.start.
function NewRunner({ id }) {
  const [form, setForm] = React.useState({ id: "", symbol: "", interval: "5m", every: "bar", source: "", warn: "", when: "", plot: "", then: "wake", repeat: "once" })
  const [out, setOut] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const spec = () => ({ ...form, source: form.source && form.source !== "auto" ? form.source : undefined, warn: form.warn || undefined, plot: parsePlot(form.plot) })
  const run = async (kind) => {
    setBusy(true)
    setOut(null)
    try {
      const v = kind === "test" ? await testRunner(id, spec()) : await startRunner(id, spec())
      const values = Object.entries(v.values ?? {}).map(([k, x]) => `${k} ${x}`).join(", ")
      setOut({ ok: true, text: kind === "test" ? `holds ${v.holds} · ${v.bars} bars · price ${v.price}${values ? ` · ${values}` : ""}${v.proximity?.gap > 0 ? ` · ${v.proximity.gap} to go` : ""} · turned true ${v.times_turned_true}× ${(v.turned_true ?? []).slice(-3).join(", ")}` : `started: ${v.runner}` })
    } catch (error) {
      setOut({ ok: false, text: error?.message ?? String(error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="group rounded-md border px-2 py-1">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
        Start or test a runner
      </summary>
      <form
        className="mt-1 flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          run("start")
        }}
      >
        <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-3">
          {FIELDS.map(([k, text, ph]) => (
            <label key={k} className="flex min-w-0 flex-col text-[11px] text-muted-foreground">
              {text}
              <Input value={form[k]} onChange={set(k)} placeholder={ph} className="h-8 text-base md:text-xs pointer-coarse:h-10" />
            </label>
          ))}
        </div>
        <label className="flex flex-col text-[11px] text-muted-foreground">
          when (the condition)
          <Input value={form.when} onChange={set("when")} placeholder="cross_above(close, vwap()) and rsi(close, 14) < 70" className="h-8 font-mono text-base md:text-xs pointer-coarse:h-10" />
        </label>
        <label className="flex flex-col text-[11px] text-muted-foreground">
          plot (name=formula; …)
          <Input value={form.plot} onChange={set("plot")} placeholder="vwap=vwap(); ema9=ema(close, 9)" className="h-8 font-mono text-base md:text-xs pointer-coarse:h-10" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <select value={form.then} onChange={set("then")} className="h-8 rounded-md border bg-background px-1 text-base md:text-xs pointer-coarse:h-10" aria-label="then">
            <option value="wake">wake the lead</option>
            <option value="log">log only</option>
          </select>
          <select value={form.repeat} onChange={set("repeat")} className="h-8 rounded-md border bg-background px-1 text-base md:text-xs pointer-coarse:h-10" aria-label="repeat">
            <option value="once">once</option>
            <option value="edge">each time</option>
          </select>
          <Button type="submit" size="xs" className="h-8 px-3 text-xs pointer-coarse:h-10" disabled={busy || !form.id || !form.when}>
            Start
          </Button>
          <Button type="button" size="xs" variant="outline" className="h-8 px-3 text-xs pointer-coarse:h-10" disabled={busy || !form.when} onClick={() => run("test")}>
            Test
          </Button>
        </div>
        {out && <p className={cn("text-[11px] break-words", out.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-400")}>{out.text}</p>}
      </form>
    </details>
  )
}
