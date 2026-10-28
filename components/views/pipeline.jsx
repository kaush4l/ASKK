"use client"

import * as React from "react"
import Link from "next/link"

import { describeActivity } from "@/backend/live/activity"
import { levelLine, pipelineCall } from "@/backend/live/pipeline"
import { Fold, MiniButton, Small, useKeyedCalls } from "@/components/views/kit"
import { Markdown } from "@/components/views/markdown"
import { cn } from "@/lib/utils"
import { agentHref } from "@/lib/nav"
import { hm } from "@/backend/live/time"
import { useAgent } from "@/hooks/use-engines"

// The workflow artifact's shared parts (view "pipeline"; the artifact itself is drawn by components/workflow/card.jsx —
// its live tile, and opened big the viewer, components/workflow/viewer.jsx): the owner calls the views use,
// a step agent's link, the run's live log, and the run's OUTCOME — what a desk's workflow produced beyond
// its phases: the report code filled, the checked result (a card), the watchers' events, learnings waiting for the
// owner (Accept / Drop), the theses it keeps across days, its calibration, the memory note.

// One owner call at a time per key: {busy, error}.
export function useCalls(id) {
  const [calls, act] = useKeyedCalls()
  return [calls, (key, method, extra) => act(key, () => pipelineCall(id, method, extra))]
}

// A stage run by its own agent (kind agent: the workflow spawned it for the run): a link to its page — its thread, its
// tool calls, its model calls — with its live status and what it does now; "refused" counts its contract's gate.
export function StepAgent({ name, refused }) {
  const { engine, state: st } = useAgent(name)
  const doing = st?.status === "running" && st?.activity ? describeActivity(st.activity) : ""
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px]">
      {engine ? (
        <Link href={agentHref(name)} className="inline-flex min-h-6 items-center rounded border px-1.5 font-mono text-sky-700 pointer-coarse:min-h-10 dark:text-sky-400">agent {name}</Link>
      ) : (
        <span className="inline-flex min-h-6 items-center rounded border border-dashed px-1.5 font-mono text-muted-foreground">agent {name}</span>
      )}
      {/* 2026-10-23 audit: a step agent is dismissed at the next run and not rebuilt after a restart — no dead link; where its
          runs are kept, and this stage's own prompt and answer (Work, Output) stand for it */}
      <span className="text-muted-foreground">{engine ? (st?.status ?? "idle") : `ended — its runs are kept in the desk's state/spawned/${name}/history.md; this stage's prompt and answer are below`}</span>
      {doing ? <span className="min-w-0 truncate text-muted-foreground">· {doing}</span> : null}
      {refused > 0 && <span className="text-amber-600 dark:text-amber-300">· contract refused {refused}×</span>}
    </p>
  )
}

// A stage's A/B (shadow:, backend/live/pipeline.js shadowView): the same stage run beside it as the other kind — its
// status, time, its contract's verdict and how its ```data compares; never read downstream. A step-agent shadow links to
// its agent. compact: one line on the phase card.
const SHADOW_TONE = { running: "text-sky-700 dark:text-sky-400", done: "text-foreground/90", failed: "text-red-700 dark:text-red-400", stopped: "text-muted-foreground" }
export function ShadowLine({ shadow, compact = false }) {
  if (!shadow) return null
  const bits = [shadow.status, shadow.elapsed, shadow.turns ? `${shadow.turns} turns` : null, shadow.cost].filter(Boolean).join(" · ")
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[11px]" aria-label="A/B shadow">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        <span className="inline-flex min-h-6 items-center rounded border border-dashed px-1.5 font-mono text-muted-foreground" title="the same stage run beside it as the other kind, for comparison only — never read by the next stages">{shadow.label}</span>
        <span className={SHADOW_TONE[shadow.status] ?? SHADOW_TONE.done}>{bits}</span>
        {shadow.gate && <span className={shadow.gate === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-600 dark:text-amber-300"}>· contract {shadow.gate}</span>}
        {shadow.compare && <span className="min-w-0 truncate text-muted-foreground">· {shadow.compare}</span>}
      </p>
      {!compact && shadow.error && <p className="break-words text-red-700 dark:text-red-400">{shadow.error}</p>}
      {!compact && shadow.problems.length > 0 && <p className="break-words text-amber-600 dark:text-amber-300">{shadow.problems.join("; ")}</p>}
      {!compact && shadow.agent && <StepAgent name={shadow.agent} />}
      {!compact && shadow.file && <p className="min-w-0 truncate font-mono text-muted-foreground">{shadow.file}</p>}
    </div>
  )
}

const VERDICT = { open: "text-muted-foreground", confirmed: "text-emerald-700 dark:text-emerald-400", falsified: "text-red-700 dark:text-red-400", expired: "text-amber-700 dark:text-amber-400", closed: "text-muted-foreground" }

// The thesis record that carries across days: what is open and how code scored the ones that closed.
function Theses({ theses }) {
  const Row = ({ t }) => (
    <li className="min-w-0 text-[11px]">
      <p className="flex min-w-0 flex-wrap gap-x-2">
        <span className="font-mono text-foreground/90">{t.id}</span>
        <span className="text-foreground/90">{t.head}</span>
        <span className={VERDICT[t.status] ?? VERDICT.open}>{t.status}</span>
      </p>
      <p className="break-words text-muted-foreground">{t.claim}</p>
      <p className="break-words text-muted-foreground">breaks on {t.falsify || "—"} · last: {t.last}</p>
      {t.touches?.length > 0 && <p className="break-words text-violet-700 dark:text-violet-400">touched today: {t.touches.join(" · ")}</p>}
    </li>
  )
  return (
    <section className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">Theses · kept across days, scored by code at the close · {theses.track}</p>
      {theses.open.length > 0 && <ul className="flex min-w-0 flex-col gap-1">{theses.open.map((t) => <Row key={t.id} t={t} />)}</ul>}
      {theses.closed.length > 0 && (
        <Fold title={`${theses.closed.length} closed`}><ul className="flex min-w-0 flex-col gap-1 pt-1">{theses.closed.map((t) => <Row key={t.id} t={t} />)}</ul></Fold>
      )}
    </section>
  )
}

// How often the desk's calls came true, from its own records (code recomputes it at every ledger): paper and real apart.
function Calibration({ cal }) {
  const Line = ({ r, strong }) => (
    <tr className={cn("tabular-nums", strong ? "text-foreground/90" : "text-muted-foreground")}>
      <td className="max-w-[9rem] truncate pr-2" title={r.label}>{r.label}</td>
      {[r.n, r.rate, r.mean_p, r.gap].map((x, k) => <td key={k} className="pr-2 text-right">{x}</td>)}
      <td className="text-right">{r.tp1}/{r.invalidated}</td>
    </tr>
  )
  return (
    <section className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-[11px]">
      <p className="text-muted-foreground">
        Calibration · how often the calls came true, from the desk&apos;s records · theses: {cal.theses}
        {cal.at ? ` · read ${hm(cal.at)}` : ""}
      </p>
      {cal.books.map((b) => (
        <div key={b.name} className="min-w-0">
          <p className="text-foreground/90">{b.name}{b.empty ? <span className="text-muted-foreground"> · no scored prediction yet</span> : null}</p>
          {!b.empty && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[19rem]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pr-2 text-left font-normal" />
                    {["n", "hit", "said p", "gap"].map((h) => <th key={h} className="pr-2 text-right font-normal">{h}</th>)}
                    <th className="text-right font-normal">tp1/inv</th>
                  </tr>
                </thead>
                <tbody>
                  <Line r={b.all} strong />
                  {b.groups.map((g) => (
                    <React.Fragment key={g.title}>
                      <tr>
                        <td colSpan={6} className="pt-1 text-muted-foreground/70">by {g.title}</td>
                      </tr>
                      {g.rows.map((r) => <Line key={`${g.title}-${r.label}`} r={r} />)}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <p className="text-muted-foreground/70">a small n is not evidence</p>
    </section>
  )
}

const LOG_TONE = { error: "text-red-700 dark:text-red-400", gate: "text-amber-700 dark:text-amber-400", watch: "text-violet-700 dark:text-violet-400", market: "text-sky-700 dark:text-sky-400", stage: "text-foreground/80", run: "text-muted-foreground" }

// The workflow's live log, following the newest line while the run goes (unless the owner scrolled up to read).
export function LiveLog({ lines, running }) {
  const box = React.useRef(null)
  const pinned = React.useRef(true)
  React.useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <details open className="group min-w-0 rounded-md border px-2 py-1 text-[11px]">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-block size-1.5 rounded-full", running ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-muted-foreground/40")} aria-hidden />
        <span className="text-foreground/90">Live log</span>
        <span className="text-muted-foreground">{lines.length} lines today</span>
      </summary>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="max-h-56 overflow-y-auto pb-1 font-mono leading-4"
        role="log"
        aria-live="polite"
      >
        {lines.map((l, i) => (
          <p key={i} className="flex min-w-0 gap-2">
            <span className="shrink-0 tabular-nums text-muted-foreground/70">{l.time}</span>
            <span className={cn("min-w-0 break-words", LOG_TONE[l.kind] ?? LOG_TONE.run)}>{l.text}</span>
          </p>
        ))}
      </div>
    </details>
  )
}

// A closed fold of rows, "<title> · <count>"; none: nothing drawn.
const FoldList = ({ title, items, children }) =>
  items?.length > 0 ? (
    <Fold title={`${title} · ${items.length}`} className="rounded-md border px-2 py-1 text-[11px]">
      <ul className="flex min-w-0 flex-col gap-0.5 pb-1">{items.map(children)}</ul>
    </Fold>
  ) : null

// What the run produced beyond its phases (pipelineView `v`): the report code filled, the checked result, the watchers'
// events, learnings waiting for the owner (Accept / Drop: team call target artifact), the theses kept across days, the
// calibration, the memory note. Nothing to show: nothing drawn.
export function Outcome({ v, calls, call }) {
  const theses = v.theses && (v.theses.open.length > 0 || v.theses.closed.length > 0)
  if (!v.report && !v.result?.text && !v.events.length && !v.pending.length && !theses && !v.calibration && !v.note && !v.cardRest?.length && !v.memory && !v.learned && v.notified == null) return null
  return (
    <section aria-label="Outcome" className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5">
      <h3 className="text-sm text-foreground">Outcome</h3>
      {v.pending.length > 0 && (
        <section className="flex min-w-0 flex-col gap-1 rounded-md border border-dashed border-amber-500/60 px-2 py-1.5">
          <Small tone="warn">Proposed learnings · not in force until you accept them</Small>
          {v.pending.map((l) => (
            <div key={l.id} className="flex min-w-0 flex-col gap-1 text-xs">
              <p className="break-words"><span className="font-mono text-muted-foreground">{l.id}</span> {l.text}</p>
              <p className="text-[11px] break-words text-muted-foreground">{l.evidence}{l.source ? ` · from ${l.source}` : ""}</p>
              <div className="flex gap-1.5">
                {[["accept", "outline", "Accept"], ["drop", "ghost", "Drop"]].map(([method, variant, label]) => (
                  <MiniButton key={method} variant={variant} disabled={calls[l.id]?.busy} onClick={() => call(l.id, method, { learning: l.id })}>{label}</MiniButton>
                ))}
              </div>
              {calls[l.id]?.error && <Small tone="error">{calls[l.id].error}</Small>}
            </div>
          ))}
        </section>
      )}
      {v.report && <Fold open title={`Report · ${v.report.run} · ${v.report.at} ET · filled by code`} className="rounded-md border px-2 py-1.5"><Markdown text={v.report.text} /></Fold>}
      {v.result?.text && (
        <Fold open={!v.report} title={`The result${v.result.decision ? ` · ${v.result.decision}` : ""} — as its checked step${v.result.stage ? ` ${v.result.stage}` : ""} wrote it${v.result.at ? ` at ${v.result.at} ET` : ""}`} className="rounded-md border px-2 py-1.5">
          {v.result.problems.length > 0 && <Small tone="warn" className="mb-1">Unchecked: {v.result.problems.join("; ")}</Small>}
          {v.result.gate && <Small className="mb-1">{v.result.gate}</Small>}
          {/* 2026-10-23: what the desk's code expected the checked step to carry (decide()), and where the result is kept */}
          {v.result.expect && (
            <p data-result-expect className="mb-1 font-mono text-[10px] break-words text-muted-foreground">expected by code: {JSON.stringify(v.result.expect).slice(0, 600)}</p>
          )}
          {v.result.file && <p className="mb-1 font-mono text-[10px] break-all text-muted-foreground">{v.result.file}</p>}
          {/* 2026-10-23: the result's price levels (a desk's card: entry/stop/targets, alert levels), built and never drawn */}
          {v.result.levels.length > 0 && (
            <ul data-result-levels className="mb-1 flex flex-col gap-0.5 font-mono text-[11px] break-words text-muted-foreground">
              {v.result.levels.map((l, i) => <li key={i}>{levelLine(l)}</li>)}
            </ul>
          )}
          <Markdown text={v.result.text} />
        </Fold>
      )}
      {v.events.length > 0 && <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">{v.events.map((e, i) => <li key={i}>• {e}</li>)}</ul>}
      {theses && <Theses theses={v.theses} />}
      {v.calibration && <Calibration cal={v.calibration} />}
      {/* 2026-10-23 audit: the card's other fields and the desk's own counters */}
      <FoldList title="The card's other fields" items={v.cardRest}>
        {(f) => <li key={f.name} className="min-w-0 break-words"><span className="font-mono text-foreground/90">{f.name}</span> <span className="text-muted-foreground">{f.value}</span></li>}
      </FoldList>
      <FoldList title="Learning candidates" items={v.candidates}>
        {(c, i) => <li key={i} className="min-w-0 break-words">{c.text} {c.line && <span className="text-muted-foreground">· {c.line}</span>}</li>}
      </FoldList>
      {(v.memory || v.learned || v.notified != null) && (
        <Small>{[v.memory ? `record: ${v.memory}` : null, v.learned ? `learnings: ${v.learned}` : null, v.notified != null ? `watch notified ${v.notified}×` : null].filter(Boolean).join(" · ")}</Small>
      )}
      {v.note && (
        <Small>
          memory: {v.note.label}
          {v.note.mirrored === true ? " · mirrored to Notes" : typeof v.note.mirrored === "string" ? ` · not mirrored: ${v.note.mirrored}` : ""}
        </Small>
      )}
    </section>
  )
}
