"use client"

import * as React from "react"
import Link from "next/link"

import { describeActivity } from "@/backend/live/activity"
import { pipelineCall, pipelineView, stageDetail, stepFile } from "@/backend/live/pipeline"
import { Markdown } from "@/components/views/markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEngines, useEngineState } from "@/hooks/use-engines"
import { agentHref } from "@/lib/nav"

// A desk's staged workflow (view "pipeline": a desk's own workflow artifact): each stage one research call —
// its status, time, and the web reads it made as they happen; the result it wrote (drawn as markdown, never HTML);
// what waits for the owner (learnings to accept or drop); the owner's Stop. Closed on a card: one line and a dot per
// stage; open: everything — the runtime view (2026-10-22 owner: "expand on workflow for a runtime view … follow the
// flow"): the workflow folder it ran from (settings, every step file and how it runs), and per stage what flowed in
// (state, earlier stages' data, code results, whole documents) and out, with the stage read whole on demand
// (document, data, code results, the prompt it was sent).

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

// The owner's Run (2026-10-22, phases): the flow with what it is for this time ({{request}} in its phases).
function RunBox({ calls, call, phases }) {
  const [text, setText] = React.useState("")
  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        call("run", "run", { request: text.trim() })
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={phases ? "What this run is for" : "Note for this run (optional)"}
        aria-label="Request for this run"
        className="h-8 min-w-0 flex-1 rounded border bg-transparent px-2 text-base sm:text-xs pointer-coarse:h-10"
      />
      <Button type="submit" size="xs" variant="outline" className="h-8 px-3 text-[11px] pointer-coarse:h-10" disabled={calls.run?.busy}>
        {calls.run?.busy ? "Starting…" : "Run"}
      </Button>
      {calls.run?.error && <span className="text-[11px] text-red-700 dark:text-red-400">{calls.run.error}</span>}
    </form>
  )
}

export function PipelineView({ id, state, expanded }) {
  const running = state?.status === "running"
  const now = useNow(running)
  const v = pipelineView(state, { now })
  const [calls, call] = useCalls(id)
  if (!v.stages.length && !v.result && !(expanded && v.config)) return <p className="mt-1 text-xs text-muted-foreground">no run yet today</p>

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
      {!running && id && <RunBox calls={calls} call={call} phases={(state?.config?.steps ?? []).some((x) => x.kind === "phase")} />}
      {state?.run?.request && <p className="text-[11px] break-words text-muted-foreground">request: {state.run.request}</p>}
      {v.run && (
        <p className="text-[11px] break-words text-muted-foreground">
          {v.run.id} · by {v.run.by} · {v.run.started} ET{v.run.from ? ` · from ${v.run.from}` : ""}
          {v.run.note ? ` · note: ${v.run.note}` : ""}
          {v.prompts && v.prompts !== "owner" ? ` · ${v.prompts}` : ""}
        </p>
      )}
      {v.report && (
        <section className="min-w-0 rounded-md border px-2 py-1.5" aria-label="Report">
          <p className="mb-1 text-[11px] text-muted-foreground">
            Report · {v.report.run} · {v.report.at} ET · filled by code from workflow/report.md
          </p>
          <Markdown text={v.report.text} />
        </section>
      )}
      {v.log.length > 0 && <LiveLog lines={v.log} running={running} />}
      {v.config && <WorkflowConfig id={id} config={v.config} open={!!expanded || !v.stages.length} />}
      {!v.stages.length && <p className="text-[11px] text-muted-foreground">no run yet today</p>}
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
                {s.agent && <StepAgent name={s.agent} refused={s.refused} />}
                {s.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{s.error}</p>}
                <StageFlow stage={s} id={id} />
                {s.head && <pre className="max-h-48 overflow-auto rounded-md border px-2 py-1 font-sans text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground">{s.head}</pre>}
              </div>
            </details>
          </li>
        ))}
      </ol>
      {v.theses && (v.theses.open.length > 0 || v.theses.closed.length > 0) && <Theses theses={v.theses} />}
      {v.calibration && <Calibration cal={v.calibration} />}
      {v.result && (
        <details open={!v.report} className="min-w-0 rounded-md border px-2 py-1.5">
          <summary className="min-h-7 cursor-pointer text-[11px] text-muted-foreground pointer-coarse:min-h-10">The card as the card stage wrote it</summary>
          {v.result.problems.length > 0 && <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-400">Unchecked: {v.result.problems.join("; ")}</p>}
          {v.result.gate && <p className="mb-1 text-[11px] break-words text-muted-foreground">{v.result.gate}</p>}
          <Markdown text={v.result.text} />
        </details>
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

// The workflow folder the run reads (closed unless there is no run yet): the settings and every step file in order.
function WorkflowConfig({ id, config, open }) {
  return (
    <details open={open} className="group min-w-0 rounded-md border px-2 py-1 text-xs">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-foreground/90">{config.folder}</span>
        <span className="text-muted-foreground">{config.error ? "does not load" : `${config.steps.length} steps in file order`}</span>
      </summary>
      {config.error && <p className="py-1 text-[11px] break-words text-red-700 dark:text-red-400">{config.error}</p>}
      {config.settings.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1 py-1">
          <span className="font-mono text-[11px] text-muted-foreground">00-workflow.md</span>
          {config.settings.map((x) => (
            <span key={x} className="rounded border px-1.5 text-[11px] text-muted-foreground">
              {x}
            </span>
          ))}
        </div>
      )}
      <ol className="flex min-w-0 flex-col gap-0.5 pb-1">
        {config.steps.map((x) => (
          <StepRow key={x.file ?? x.id} id={id} step={x} />
        ))}
      </ol>
    </details>
  )
}

// One step of the workflow folder: its line, and on a click the file as written — the prompt (markdown, its {{vars}} as
// the file has them), the ```data contract it must end with, and how it is wired (kind, what it waits on and reads, its
// tools, its check, its limits).
// A stage run by its own agent (kind agent: the workflow spawned it for the run): a link to its page — its thread, its
// tool calls, its model calls — with its live status and what it does now; "refused" counts its contract's gate.
function StepAgent({ name, refused }) {
  const { engines } = useEngines()
  const engine = engines.find((e) => e.name === name) ?? null
  const st = useEngineState(engine)
  const doing = st?.status === "running" && st?.activity ? describeActivity(st.activity) : ""
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px]">
      <Link href={agentHref(name)} className="inline-flex min-h-6 items-center rounded border px-1.5 font-mono text-sky-700 pointer-coarse:min-h-10 dark:text-sky-400">
        agent {name}
      </Link>
      <span className="text-muted-foreground">{engine ? (st?.status ?? "idle") : "not on the desk now"}</span>
      {doing ? <span className="min-w-0 truncate text-muted-foreground">· {doing}</span> : null}
      {refused > 0 && <span className="text-amber-600 dark:text-amber-300">· contract refused {refused}×</span>}
    </p>
  )
}

function StepRow({ id, step: x }) {
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState(x.kind === "code" ? "wiring" : "prompt")
  const [file, setFile] = React.useState({ busy: false, error: null, value: null })
  const toggle = async () => {
    setOpen((o) => !o)
    if (!id || file.value || file.busy) return
    setFile({ busy: true, error: null, value: null })
    try {
      setFile({ busy: false, error: null, value: await stepFile(id, x.id) })
    } catch (error) {
      setFile({ busy: false, error: error?.message ?? String(error), value: null })
    }
  }
  const f = file.value
  const tabs = [...(x.kind === "code" ? [] : [["prompt", "Prompt"], ["contract", "Contract"]]), ["wiring", "Wiring"]]
  const wiring = f
    ? [
        ["kind", f.kind === "code" ? `code: ${f.code}` : f.own ? `step agent ${f.step_agent}` : f.kind === "agent" ? `agent: ${f.agent}` : "research call"],
        ["title", f.title],
        ["after", f.after.join(", ") || "—"],
        ["reads", f.inputs.join(", ") || "—"],
        ["tools", f.tools.join(", ") || "—"],
        ["check", [f.check && `check ${f.check}`, f.schema && `schema ${f.schema}`, f.derive && `derive ${f.derive}`].filter(Boolean).join(" · ") || "—"],
        ...(f.kind === "research" ? [["limits", `${f.max_turns} turns · ${f.seconds}s · model ${f.model}`]] : []),
        ...(f.own ? [["loop", `≤ ${f.max_steps ?? 12} steps · ≥ ${f.min_calls ?? (f.tools.length ? 1 : 0)} tool calls · model ${f.model ?? "default"}${f.artifacts?.length ? ` · holds ${f.artifacts.join(", ")}` : ""}`]] : []),
        ...(f.from.length ? [["from", f.from.join("; ")]] : []),
      ]
    : []
  return (
    <li className="min-w-0 text-[11px]">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-6 w-full min-w-0 flex-wrap items-baseline gap-x-2 rounded text-left hover:bg-muted/40 pointer-coarse:min-h-10">
        <span className="font-mono text-foreground/90">{open ? "▾" : "▸"} {x.file}</span>
        <span className="text-muted-foreground">{x.kind}</span>
        <span className="text-muted-foreground">{x.runs}</span>
        {x.waits && <span className="text-muted-foreground">after {x.waits}</span>}
        {x.reads && <span className="text-sky-700 dark:text-sky-400">reads {x.reads}</span>}
        {x.contract && <span className="text-muted-foreground">{x.contract}</span>}
      </button>
      {open && (
        <div className="mt-1 mb-1.5 ml-3 flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1">
          {file.busy && <p className="text-muted-foreground">Reading {x.file}…</p>}
          {file.error && <p className="break-words text-red-700 dark:text-red-400">{file.error}</p>}
          {f && (
            <>
              <div role="tablist" className="flex flex-wrap gap-1">
                {tabs.map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("min-h-6 rounded px-1.5 pointer-coarse:min-h-10", tab === k ? "border text-foreground" : "text-muted-foreground")}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === "prompt" && (f.body ? <div className="max-h-[60svh] overflow-auto"><Markdown text={f.body} /></div> : <p className="text-muted-foreground">no prompt</p>)}
              {tab === "contract" && (f.example ? (
                <pre className="max-h-[60svh] overflow-auto font-mono leading-4 whitespace-pre-wrap break-words text-muted-foreground">{"```data\n" + JSON.stringify(f.example, null, 1) + "\n```"}</pre>
              ) : <p className="text-muted-foreground">{f.check ? `the whole document is checked by ${f.check}` : "no data contract"}</p>)}
              {tab === "wiring" && (
                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                  {wiring.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words text-foreground/90">{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

const FLOW_TONE = { carry: "border-violet-500", market: "border-sky-500", state: "border-violet-500/50", note: "border-violet-500/50", data: "border-sky-500/50", code: "border-emerald-500/50", document: "border-sky-500", gate: "border-amber-500", failed: "border-red-500", card_rows: "border-emerald-500" }

// What flowed into the stage and out of it, and the stage read whole on demand.
function StageFlow({ stage, id }) {
  const [open, setOpen] = React.useState(false)
  const [detail, setDetail] = React.useState({ busy: false, error: null, value: null })
  const [tab, setTab] = React.useState("text")
  const f = stage.flow
  const done = ["done", "reused", "failed"].includes(stage.status) || stage.kind === "code"
  const load = async () => {
    setOpen((o) => !o)
    if (detail.value || detail.busy) return
    setDetail({ busy: true, error: null, value: null })
    try {
      setDetail({ busy: false, error: null, value: await stageDetail(id, stage.id) })
    } catch (error) {
      setDetail({ busy: false, error: error?.message ?? String(error), value: null })
    }
  }
  const d = detail.value
  const tabs = d?.kind === "code" ? [["state", "record"]] : [["text", "document"], ["data", "data"], ["code", "code results"], ["prompt", "prompt"]]
  const body = !d ? null : d.kind === "code" ? d.state : tab === "text" ? d.text : tab === "prompt" ? d.prompt : d[tab] == null ? null : JSON.stringify(d[tab], null, 1)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {f && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">in{f.prompt ? ` (${f.prompt} chars)` : ""}:</span>
          {f.in.map((g) => (
            <span key={g.kind} title={`${g.label} from ${g.from.join(", ")}`} className={cn("max-w-[16rem] truncate rounded border px-1.5 text-muted-foreground", FLOW_TONE[g.kind])}>
              {g.label}
              {g.kind === "rules" || g.kind === "state" ? "" : ` · ${g.from.join(", ")}`}
            </span>
          ))}
        </div>
      )}
      {f?.out && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">out ({f.out.text} chars):</span>
          {f.out.data.length > 0 && <span className="max-w-full truncate rounded border border-sky-500/50 px-1.5 text-muted-foreground">data · {f.out.data.join(", ")}</span>}
          {f.out.code.length > 0 && <span className="max-w-full truncate rounded border border-emerald-500/50 px-1.5 text-muted-foreground">code · {f.out.code.join(", ")}</span>}
          {stage.gate && !stage.gate.ok && <span className="rounded border border-amber-500 px-1.5 text-amber-700 dark:text-amber-400">gate failed{stage.gate.retried ? " after a retry" : ""}</span>}
        </div>
      )}
      {done && id && (
        <div>
          <Button type="button" size="xs" variant="outline" className="h-6 px-2 text-[11px] pointer-coarse:h-10" aria-expanded={open} onClick={load}>
            {detail.busy ? "Reading…" : open ? "Close" : stage.kind === "code" ? `Read the ${stage.id}` : "Read the stage"}
          </Button>
        </div>
      )}
      {open && detail.error && <p className="text-[11px] break-words text-red-700 dark:text-red-400">{detail.error}</p>}
      {open && d && (
        <div className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1">
          <div role="tablist" className="flex flex-wrap gap-1">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={(d.kind === "code" ? "state" : tab) === k} onClick={() => setTab(k)} className={cn("min-h-6 rounded px-1.5 text-[11px] pointer-coarse:min-h-10", (d.kind === "code" ? "state" : tab) === k ? "border text-foreground" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
          {d.problems?.length > 0 && <p className="text-[11px] break-words text-amber-700 dark:text-amber-400">{d.problems.join("; ")}</p>}
          {body == null ? (
            <p className="text-[11px] text-muted-foreground">none</p>
          ) : tab === "text" && d.kind !== "code" ? (
            <div className="max-h-[60svh] overflow-auto">
              <Markdown text={body} />
            </div>
          ) : (
            <pre className="max-h-[60svh] overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap break-words text-muted-foreground">{body}</pre>
          )}
        </div>
      )}
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
      <p className="break-words text-muted-foreground">
        breaks on {t.falsify || "—"} · last: {t.last}
      </p>
      {t.touches?.length > 0 && <p className="break-words text-violet-700 dark:text-violet-400">touched today: {t.touches.join(" · ")}</p>}
    </li>
  )
  return (
    <section className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">Theses · kept across days, scored by code at the close · {theses.track}</p>
      {theses.open.length > 0 && <ul className="flex min-w-0 flex-col gap-1">{theses.open.map((t) => <Row key={t.id} t={t} />)}</ul>}
      {theses.closed.length > 0 && (
        <details className="min-w-0">
          <summary className="min-h-7 cursor-pointer text-[11px] text-muted-foreground pointer-coarse:min-h-10">{theses.closed.length} closed</summary>
          <ul className="flex min-w-0 flex-col gap-1 pt-1">{theses.closed.map((t) => <Row key={t.id} t={t} />)}</ul>
        </details>
      )}
    </section>
  )
}

// How often the desk's calls came true, from its own records (code recomputes it at every ledger): paper and real apart.
function Calibration({ cal }) {
  const Line = ({ r, strong }) => (
    <tr className={cn("tabular-nums", strong ? "text-foreground/90" : "text-muted-foreground")}>
      <td className="max-w-[9rem] truncate pr-2" title={r.label}>
        {r.label}
      </td>
      <td className="pr-2 text-right">{r.n}</td>
      <td className="pr-2 text-right">{r.rate}</td>
      <td className="pr-2 text-right">{r.mean_p}</td>
      <td className="pr-2 text-right">{r.gap}</td>
      <td className="text-right">
        {r.tp1}/{r.invalidated}
      </td>
    </tr>
  )
  return (
    <section className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-[11px]">
      <p className="text-muted-foreground">Calibration · how often the calls came true, from the desk's records · theses: {cal.theses}</p>
      {cal.books.map((b) => (
        <div key={b.name} className="min-w-0">
          <p className="text-foreground/90">
            {b.name}
            {b.empty ? <span className="text-muted-foreground"> · no scored prediction yet</span> : null}
          </p>
          {!b.empty && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[19rem]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pr-2 text-left font-normal" />
                    <th className="pr-2 text-right font-normal">n</th>
                    <th className="pr-2 text-right font-normal">hit</th>
                    <th className="pr-2 text-right font-normal">said p</th>
                    <th className="pr-2 text-right font-normal">gap</th>
                    <th className="text-right font-normal">tp1/inv</th>
                  </tr>
                </thead>
                <tbody>
                  <Line r={b.all} strong />
                  {b.groups.map((g) => (
                    <React.Fragment key={g.title}>
                      <tr>
                        <td colSpan={6} className="pt-1 text-muted-foreground/70">
                          by {g.title}
                        </td>
                      </tr>
                      {g.rows.map((r) => (
                        <Line key={`${g.title}-${r.label}`} r={r} />
                      ))}
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
function LiveLog({ lines, running }) {
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
