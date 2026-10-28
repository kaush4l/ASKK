"use client"

import * as React from "react"
import { CodeIcon, CornerDownRightIcon, FilmIcon, GitCompareIcon, MessageCircleQuestionIcon, PauseIcon, PlayIcon, SquareIcon, StepForwardIcon } from "lucide-react"

import { REPLAY_VIEWS, SURGEON_VIEWS, allViews, diffRows, flowRows, metricsVisual, runRows, sourceRows, statusOf, surgeonCall, timelineVisuals, tokensText, viewPair } from "@/backend/live/surgeon"
import { PreviewVisual } from "@/components/preview/visual"
import { MiniButton, Small, useOwnerCall } from "@/components/views/kit"
import { cn } from "@/lib/utils"

// The surgeon artifact (kernel builtin/surgeon.js; 2026-10-26 owner: "an LLM surgeon live artifact … pause it at steps
// to understand … like the intellij debug"): a model run under the debugger. The controls (Continue, Step into, Step
// over, Pause, Stop), where it stopped and why, the flow of debug points in forward order (a click sets or clears a
// breakpoint there), the frame's tensors (each one inspectable), the input it is reading, the run's metrics, and the
// views — drawn by the preview's renderer, two side by side to compare. Behaviour is the artifact's; this only calls it.
// 2026-10-26 owner ("visual code the last run and show me the live replay … relating between procedure and observation
// … change the code run the training"): the recorded runs (a click puts one on the timeline; two picked → their diff),
// the timeline (metrics and every point's |act| over the steps), Replay (a view across the run's snapshots, played
// frame by frame), Code (the procedure behind a point, from that run's copy), the diff of two runs, and Ask the desk
// about what the pane shows.

const TONE = { idle: "bg-muted-foreground/40", running: "bg-sky-500 animate-pulse", paused: "bg-amber-500", ended: "bg-muted-foreground", error: "bg-destructive", stale: "bg-destructive animate-pulse" }
const label = "text-[11px] uppercase tracking-wide text-muted-foreground"
const fmt = (v) => (v == null ? "·" : Math.abs(v) >= 100 || Number.isInteger(v) ? String(v) : Number(v).toPrecision(3))

function Controls({ tone, call, busy }) {
  const paused = tone === "paused"
  const live = paused || tone === "running"
  return (
    <div className="flex flex-wrap gap-1">
      <MiniButton disabled={busy || !paused} onClick={() => call("continue")} title="Run to the next breakpoint">
        <PlayIcon className="size-3" /> Continue
      </MiniButton>
      <MiniButton variant="outline" disabled={busy || !paused} onClick={() => call("step")} title="Stop at the next debug point">
        <CornerDownRightIcon className="size-3" /> Step into
      </MiniButton>
      <MiniButton variant="outline" disabled={busy || !paused} onClick={() => call("next")} title="Stop at the next step or token">
        <StepForwardIcon className="size-3" /> Step over
      </MiniButton>
      <MiniButton variant="outline" disabled={busy || tone !== "running"} onClick={() => call("pause")}>
        <PauseIcon className="size-3" /> Pause
      </MiniButton>
      <MiniButton variant="outline" disabled={busy || !live} onClick={() => call("stop")}>
        <SquareIcon className="size-3" /> Stop
      </MiniButton>
    </div>
  )
}

function Flow({ rows, call, busy }) {
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-1">
      <p className={label}>Flow · click a point to set or clear a breakpoint</p>
      <div className="flex flex-wrap gap-1">
        {rows.map((r) => (
          <button
            key={r.point}
            type="button"
            disabled={busy}
            onClick={() => (r.breaks.length ? call("clear", { breakpoint: r.breaks[0] }) : call("break", { at: r.point }))}
            title={`${r.point}${r.absmean != null ? ` · |act| ${fmt(r.absmean)}` : ""}${r.breaks.length ? ` · breakpoint ${r.breaks.join(", ")}` : ""}`}
            className={cn("relative flex min-h-7 items-center gap-1 overflow-hidden rounded border px-1.5 font-mono text-[11px] pointer-coarse:min-h-10", r.paused ? "border-amber-500 text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
          >
            <span className="absolute inset-y-0 left-0 bg-sky-500/15" style={{ width: `${Math.round(r.share * 100)}%` }} aria-hidden />
            {r.breaks.length > 0 && <span className="relative size-2 shrink-0 rounded-full bg-destructive" aria-label="breakpoint" />}
            <span className="relative">{r.point}</span>
            {r.paused && <span className="relative">◀</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Frame({ frame, call, busy }) {
  const [view, setView] = React.useState("auto")
  if (!frame) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className={label}>
          Frame · {frame.kind}
          {frame.point ? ` ${frame.point}` : ""}
        </p>
        {frame.point && (
          <MiniButton variant="ghost" disabled={busy} onClick={() => call("source", { point: frame.point })} title="The code that produced this point">
            <CodeIcon className="size-3" /> Code
          </MiniButton>
        )}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          view
          <select value={view} onChange={(e) => setView(e.target.value)} className="rounded border bg-background px-1 py-0.5 text-base md:text-[11px]">
            {SURGEON_VIEWS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left font-mono text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="font-normal">tensor</th>
              <th className="font-normal">shape</th>
              <th className="font-normal">mean</th>
              <th className="font-normal">std</th>
              <th className="font-normal">min / max</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {frame.tensors.map((t) => (
              <tr key={t.name} className="border-t">
                <td className="py-0.5 pr-2 break-all">
                  {t.name}
                  {t.nan ? <span className="text-destructive"> NaN×{t.nan}</span> : null}
                </td>
                <td className="pr-2">[{(t.shape ?? []).join(",")}]</td>
                <td className="pr-2">{fmt(t.mean)}</td>
                <td className="pr-2">{fmt(t.std)}</td>
                <td className="pr-2">
                  {fmt(t.min)} / {fmt(t.max)}
                </td>
                <td className="text-right">
                  <MiniButton variant="ghost" disabled={busy} onClick={() => call("inspect", { target: t.name, view })}>
                    Inspect
                  </MiniButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Views({ state, compact = false }) {
  const views = allViews(state)
  const [picked, setPicked] = React.useState([])
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]))
  const shown = viewPair(state, picked)
  if (!views.length) return compact ? null : <Small>No views yet — inspect a tensor, or ask the desk for one.</Small>
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {!compact && (
        <div className="flex flex-wrap items-center gap-1">
          <p className={label}>Views · pick two to compare</p>
          {views.map((v) => (
            <button key={v.id} type="button" onClick={() => toggle(v.id)} title={v.replay ? `${v.title} · replay of ${v.run}` : `${v.title} · ${v.view ?? ""} of ${v.target ?? ""} at ${v.point ?? "step"} step ${v.step}`} className={cn("min-h-6 rounded border px-1.5 text-[11px] pointer-coarse:min-h-10", shown.some((s) => s.id === v.id) ? "border-foreground" : "text-muted-foreground")}>
              {v.replay ? "▶ " : ""}
              {v.id}
            </button>
          ))}
        </div>
      )}
      {!compact && !picked.length && state.compare?.note && <Small>{state.compare.note}</Small>}
      <div className={cn("grid min-w-0 gap-2", shown.length > 1 && !compact && "md:grid-cols-2")}>
        {(compact ? shown.slice(0, 1) : shown).map((v) => (
          <div key={v.id} className="min-w-0 rounded-md border p-2">
            <Small>
              {v.replay ? `replay ${v.id} of ${v.run} · ${v.point ?? "every block"} · ${v.step}` : `${v.id} · ${v.point ?? "step"} · ${v.phase} step ${v.step}`}
            </Small>
            {v.replay && v.lines?.length > 0 && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">numbers per step</summary>
                <div className="font-mono">{v.lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}</div>
              </details>
            )}
            {v.visual ? <PreviewVisual visual={v.visual} compact={compact} /> : <Small tone="error">{v.error ?? "not drawn here (an older view)"}</Small>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Ask({ call, busy }) {
  const [text, setText] = React.useState("")
  const send = async (e) => {
    e.preventDefault()
    if (text.trim() && (await call("ask", { text: text.trim() }))) setText("")
  }
  return (
    <form onSubmit={send} className="flex min-w-0 gap-1">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the desk about what this shows — why, what if, change the code…" className="min-h-8 min-w-0 flex-1 rounded border bg-background px-2 text-base md:text-xs pointer-coarse:min-h-10" />
      <MiniButton type="submit" disabled={busy || !text.trim()} title="The desk answers from the run: replay, code, diff">
        <MessageCircleQuestionIcon className="size-3" /> Ask
      </MiniButton>
    </form>
  )
}

function Runs({ state, call, busy }) {
  const rows = runRows(state)
  const [pick, setPick] = React.useState([])
  if (!rows.length) return null
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]))
  const [a, b] = [...pick].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className={label}>Recorded runs · click one for its timeline · tick two to diff</p>
        {pick.length === 2 && (
          <MiniButton variant="outline" disabled={busy} onClick={() => call("diff", { a, b })}>
            <GitCompareIcon className="size-3" /> Diff {a} → {b}
          </MiniButton>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.id} className={cn("flex min-w-0 items-center gap-2 rounded border px-1.5 py-0.5 text-[11px]", r.shown && "border-foreground")}>
            <input type="checkbox" checked={pick.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`pick ${r.id} to diff`} className="size-3.5 pointer-coarse:size-5" />
            <button type="button" disabled={busy} onClick={() => call("timeline", { run: r.id })} className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-left pointer-coarse:min-h-10" title={r.args}>
              <span className="font-mono">{r.id}</span>
              <span className="text-muted-foreground">
                {r.status}
                {r.current ? " · live" : ""} · step {r.step ?? "?"}/{r.total ?? "?"}
                {r.loss != null ? ` · loss ${fmt(r.loss)}` : ""}
                {r.val != null ? ` · val ${fmt(r.val)}` : ""} · {r.snaps} snaps{r.parent ? ` · after ${r.parent}` : ""}
              </span>
              {r.why && <span className="min-w-0 truncate">{r.why}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Timeline({ state, call, busy }) {
  const t = state?.timeline
  const { metrics, flow } = timelineVisuals(state)
  const points = t?.flow?.points ?? state?.runtime?.points ?? []
  const [view, setView] = React.useState("lens")
  const [at, setAt] = React.useState("")
  const [head, setHead] = React.useState("0")
  if (!t) return null
  const needsAt = view !== "lens"
  const sel = "rounded border bg-background px-1 py-0.5 text-base md:text-[11px]"
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border p-2">
      <p className={label}>
        Timeline · {t.run} · {t.status} · step {t.step}/{t.total ?? "?"} · {t.snaps.length} snapshots{t.parent ? ` · after ${t.parent}` : ""}
      </p>
      <div className={cn("grid min-w-0 gap-2", metrics && flow && "md:grid-cols-2")}>
        {metrics && <PreviewVisual visual={metrics} compact />}
        {flow && <PreviewVisual visual={flow} compact />}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        replay
        <select value={view} onChange={(e) => setView(e.target.value)} className={sel}>
          {REPLAY_VIEWS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        at
        <select value={at} onChange={(e) => setAt(e.target.value)} className={sel}>
          <option value="">{needsAt ? "a point…" : "every block"}</option>
          {points.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {view === "attn" && (
          <>
            head
            <input value={head} onChange={(e) => setHead(e.target.value.replace(/\D/g, "").slice(0, 2))} className={cn(sel, "w-10")} inputMode="numeric" aria-label="head" />
          </>
        )}
        <MiniButton disabled={busy || !t.snaps.length || (needsAt && !at)} onClick={() => call("replay", { run: t.run, view, ...(at ? { at } : {}), ...(view === "attn" ? { head } : {}) })} title="Draw this view across the run's snapshots, a frame per step">
          <FilmIcon className="size-3" /> Replay
        </MiniButton>
        <MiniButton variant="outline" disabled={busy || !at} onClick={() => call("source", { point: at, run: t.run })} title="The code behind this point, from the run's own copy">
          <CodeIcon className="size-3" /> Code
        </MiniButton>
      </div>
    </div>
  )
}

function Source({ state }) {
  const src = state?.source
  const rows = sourceRows(state)
  if (!src) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className={label}>
        Code · {src.point} ({src.cls}) · {src.run}&apos;s {src.file}
      </p>
      <pre className="overflow-x-auto rounded border p-1 font-mono text-[11px] leading-snug">
        {rows.map((r) => (
          <div key={r.n} className={cn(r.mark && "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
            <span className="inline-block w-8 pr-2 text-right text-muted-foreground select-none">{r.n}</span>
            {r.text}
          </div>
        ))}
      </pre>
      {src.call && (
        <Small className="font-mono">
          called at {src.call.file}:{src.call.line} — {src.call.text}
        </Small>
      )}
    </div>
  )
}

const DIFF_TONE = { add: "text-emerald-700 dark:text-emerald-400", del: "text-destructive", head: "text-muted-foreground", ctx: "" }

function Diff({ state }) {
  const d = state?.diff
  if (!d) return null
  const keys = [...new Set([...Object.keys(d.final?.a ?? {}), ...Object.keys(d.final?.b ?? {})])].filter((k) => k !== "lr")
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border p-2">
      <p className={label}>
        Diff · {d.a} → {d.b}
      </p>
      <Small className="font-mono">
        {d.args?.length ? `args ${d.args.join(", ")} · ` : ""}
        {keys.map((k) => `${k} ${fmt(d.final?.a?.[k])} → ${fmt(d.final?.b?.[k])}`).join(" · ")}
      </Small>
      {d.series && <PreviewVisual visual={d.series} compact />}
      {d.files.length ? (
        d.files.map((f) => (
          <div key={f.file} className="min-w-0">
            <Small className="font-mono">
              {f.file} +{f.added} −{f.removed}
            </Small>
            <pre className="overflow-x-auto rounded border p-1 font-mono text-[11px] leading-snug">
              {diffRows(f.diff).map((r, i) => (
                <div key={i} className={DIFF_TONE[r.tone]}>
                  {r.text || " "}
                </div>
              ))}
            </pre>
          </div>
        ))
      ) : (
        <Small>The code is the same — only the arguments changed.</Small>
      )}
    </div>
  )
}

export function SurgeonView({ id, state, expanded }) {
  const status = statusOf(state)
  const { busy, note, call } = useOwnerCall(surgeonCall, id, (r) => r?.text ?? r?.compare ?? (r?.delivered ? `asked ${r.keeper} — ${r.delivered === "guided" ? "added to its run" : "a new run"}` : "done"))
  const rt = state?.runtime
  const rows = flowRows(state)
  const metrics = metricsVisual(state)
  const text = tokensText(state)
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE[status.tone])} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm break-words">{status.text}</p>
          {status.reason && <Small>{status.reason}</Small>}
          {state?.session?.why && <Small>for: {state.session.why}</Small>}
        </div>
      </div>
      {state?.session && <Controls tone={status.tone} call={call} busy={busy} />}
      {note && (
        <Small tone={note.ok ? "muted" : "error"} className="font-mono break-words whitespace-pre-wrap">
          {note.text.length > 600 ? `${note.text.slice(0, 600)}…` : note.text}
        </Small>
      )}
      {expanded ? (
        <>
          <Ask call={call} busy={busy} />
          <Flow rows={rows} call={call} busy={busy} />
          {text && (
            <div className="min-w-0">
              <p className={label}>Input (sample 0)</p>
              <p className="rounded border p-1 font-mono text-[11px] break-all whitespace-pre-wrap">{text}</p>
            </div>
          )}
          {rt?.status === "paused" && <Frame frame={rt.frame} call={call} busy={busy} />}
          <Views state={state} />
          <Source state={state} />
          <Runs state={state} call={call} busy={busy} />
          <Timeline state={state} call={call} busy={busy} />
          <Diff state={state} />
          {metrics && (
            <div className="min-w-0">
              <p className={label}>Metrics</p>
              <PreviewVisual visual={metrics} compact />
            </div>
          )}
          {(rt?.breakpoints?.length > 0 || rt?.patches?.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {rt.breakpoints.map((b) => (
                <MiniButton key={b.id} variant="outline" disabled={busy} onClick={() => call("clear", { breakpoint: b.id })} title="Clear this breakpoint">
                  ● {b.id} {b.at}
                  {b.step != null ? ` @${b.step}` : ""}
                  {b.every ? ` every ${b.every}` : ""}
                  {b.nan ? " NaN" : ""} ✕
                </MiniButton>
              ))}
              {rt.patches.map((p) => (
                <MiniButton key={p.id} variant="outline" disabled={busy} onClick={() => call("unpatch", { patch: p.id })} title="Remove this patch">
                  ✂ {p.id} {p.kind} {Array.isArray(p.units) ? p.units.join(",") : p.units} at {p.at} ✕
                </MiniButton>
              ))}
            </div>
          )}
          {rt?.log?.length > 0 && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {rt.log.slice(-6).map((l, i) => (
                <p key={i} className="break-words">
                  {l}
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {rows.length > 0 && <Small className="font-mono">{rows.map((r) => `${r.paused ? "▶" : ""}${r.breaks.length ? "●" : ""}${r.point}`).join(" › ").slice(0, 220)}</Small>}
          {state?.runs?.length > 0 && <Small>{state.runs.length} recorded runs{state.replays?.length ? ` · ${state.replays.length} replays` : ""}</Small>}
          <Views state={state} compact />
        </>
      )}
    </div>
  )
}
