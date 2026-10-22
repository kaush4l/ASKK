"use client"

import * as React from "react"

import { pipelineCall, pipelineView } from "@/backend/live/pipeline"
import { Markdown } from "@/components/views/markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// A desk's staged workflow (view "pipeline": a desk's own workflow artifact): each stage one research call —
// its status, time, and the web reads it made as they happen; the result it wrote (drawn as markdown, never HTML);
// what waits for the owner (learnings to accept or drop); the owner's Stop. Closed on a card: one line and a dot per
// stage; open: everything.

const TONE = {
  running: "bg-emerald-500 motion-safe:animate-pulse",
  done: "bg-sky-500",
  reused: "bg-sky-500/40",
  failed: "bg-red-500",
  stopped: "bg-amber-500",
  interrupted: "bg-amber-500",
  skipped: "bg-muted-foreground/40",
  waiting: "border border-muted-foreground/50",
}

function useNow(active) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

// One owner call at a time per key: {busy, error}.
function useCalls(id) {
  const [calls, setCalls] = React.useState({})
  const call = React.useCallback(
    async (key, method, extra) => {
      setCalls((c) => ({ ...c, [key]: { busy: true, error: null } }))
      try {
        await pipelineCall(id, method, extra)
        setCalls((c) => ({ ...c, [key]: { busy: false, error: null } }))
      } catch (error) {
        setCalls((c) => ({ ...c, [key]: { busy: false, error: error?.message ?? String(error) } }))
      }
    },
    [id],
  )
  return [calls, call]
}

const Dot = ({ status, title }) => <span aria-hidden title={title} className={cn("inline-block size-2 shrink-0 rounded-full", TONE[status] ?? TONE.waiting)} />

export function PipelineView({ id, state, expanded }) {
  const running = state?.status === "running"
  const now = useNow(running)
  const v = pipelineView(state, { now })
  const [calls, call] = useCalls(id)
  if (!v.stages.length && !v.result) return <p className="mt-1 text-xs text-muted-foreground">no run yet today</p>

  const head = (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="flex items-center gap-0.5" aria-label={`stages: ${v.stages.map((s) => `${s.id} ${s.status}`).join(", ")}`}>
        {v.stages.map((s) => (
          <Dot key={s.id} status={s.status} title={`${s.n}. ${s.id}: ${s.status}${s.elapsed ? ` · ${s.elapsed}` : ""}`} />
        ))}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {v.status}
        {v.progress ? ` ${v.progress}` : ""}
        {v.run?.elapsed ? ` · ${v.run.elapsed}` : ""}
      </span>
      {v.result?.decision && <span className={cn("rounded border px-1.5 text-[11px] text-foreground")}>{v.result.decision}</span>}
      {v.pending.length > 0 && <span className="text-[11px] text-amber-700 dark:text-amber-400">{v.pending.length} waiting for you</span>}
      {running && (
        <Button
          type="button"
          variant="destructive"
          size="xs"
          className="ml-auto h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10"
          disabled={!id || calls.stop?.busy}
          onClick={() => call("stop", "stop")}
          title="Stop this run: its research calls end now"
        >
          {calls.stop?.busy ? "Stopping…" : "Stop"}
        </Button>
      )}
    </div>
  )
  if (!expanded) {
    const live = v.stages.find((s) => s.status === "running")
    return (
      <div className="min-w-0">
        {head}
        {live && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {live.n}. {live.title} · {live.elapsed} · {live.tools} web read{live.tools === 1 ? "" : "s"}
            {live.chips[0] ? ` · ${live.chips[0].label}` : ""}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {head}
      {calls.stop?.error && <p className="text-[11px] text-red-700 dark:text-red-400">Not stopped: {calls.stop.error}</p>}
      {v.run && (
        <p className="text-[11px] break-words text-muted-foreground">
          {v.run.id} · by {v.run.by} · {v.run.started} ET{v.run.from ? ` · from ${v.run.from}` : ""}
          {v.run.note ? ` · note: ${v.run.note}` : ""}
          {v.prompts && v.prompts !== "owner" ? ` · ${v.prompts}` : ""}
        </p>
      )}
      <ol className="flex min-w-0 flex-col gap-1">
        {v.stages.map((s) => (
          <li key={s.id} className="min-w-0 text-xs">
            <details className="group">
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
                <Dot status={s.status} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-foreground/90">
                    {s.n}. {s.id}
                  </span>{" "}
                  <span className="text-muted-foreground">{s.title}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {s.status === "running" ? s.elapsed : `${s.status}${s.elapsed ? ` · ${s.elapsed}` : ""}`}
                  {s.tools ? ` · ${s.tools}` : ""}
                </span>
              </summary>
              <div className="flex min-w-0 flex-col gap-1 py-1 pl-3.5">
                {(s.chips.length > 0 || s.more > 0) && (
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {s.chips.map((c, i) =>
                      c.href ? (
                        <a key={i} href={c.href} target="_blank" rel="noopener noreferrer" title={c.title} className="max-w-[14rem] truncate rounded border px-1.5 text-[11px] text-sky-700 dark:text-sky-400">
                          {c.label}
                        </a>
                      ) : (
                        <span key={i} title={c.title} className="max-w-[14rem] truncate rounded border border-dashed px-1.5 text-[11px] text-muted-foreground">
                          {c.kind === "search" ? "⌕ " : ""}
                          {c.label}
                        </span>
                      ),
                    )}
                    {s.more > 0 && <span className="text-[11px] text-muted-foreground">+{s.more}</span>}
                  </div>
                )}
                {s.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{s.error}</p>}
                {s.head && <pre className="max-h-48 overflow-auto rounded-md border px-2 py-1 font-sans text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground">{s.head}</pre>}
              </div>
            </details>
          </li>
        ))}
      </ol>
      {v.result && (
        <section className="min-w-0 rounded-md border px-2 py-1.5">
          {v.result.problems.length > 0 && <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-400">Unchecked: {v.result.problems.join("; ")}</p>}
          <Markdown text={v.result.text} />
        </section>
      )}
      {v.events.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          {v.events.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
      {v.pending.length > 0 && (
        <section className="flex min-w-0 flex-col gap-1 rounded-md border border-dashed px-2 py-1.5">
          <p className="text-[11px] text-muted-foreground">Proposed learnings · not in force until you accept them</p>
          {v.pending.map((l) => (
            <div key={l.id} className="flex min-w-0 flex-col gap-1 text-xs">
              <p className="break-words">
                <span className="font-mono text-muted-foreground">{l.id}</span> {l.text}
              </p>
              <p className="text-[11px] break-words text-muted-foreground">
                {l.evidence}
                {l.source ? ` · from ${l.source}` : ""}
              </p>
              <div className="flex gap-1.5">
                <Button type="button" size="xs" variant="outline" className="h-6 px-2 text-[11px] pointer-coarse:h-10" disabled={calls[l.id]?.busy} onClick={() => call(l.id, "accept", { learning: l.id })}>
                  Accept
                </Button>
                <Button type="button" size="xs" variant="ghost" className="h-6 px-2 text-[11px] pointer-coarse:h-10" disabled={calls[l.id]?.busy} onClick={() => call(l.id, "drop", { learning: l.id })}>
                  Drop
                </Button>
              </div>
              {calls[l.id]?.error && <p className="text-[11px] text-red-700 dark:text-red-400">{calls[l.id].error}</p>}
            </div>
          ))}
        </section>
      )}
      {v.note && (
        <p className="text-[11px] break-words text-muted-foreground">
          memory: {v.note.label}
          {v.note.mirrored === true ? " · mirrored to Notes" : typeof v.note.mirrored === "string" ? ` · not mirrored: ${v.note.mirrored}` : ""}
        </p>
      )}
    </div>
  )
}
