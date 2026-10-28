"use client"

import * as React from "react"
import { ArrowDownIcon, CheckIcon, FileInputIcon, FileOutputIcon, GitCompareIcon, PencilLineIcon, PlayIcon, WorkflowIcon } from "lucide-react"

import { runSteps } from "@/backend/live/follow"
import { lastOutput, size, stageDetail, stepFile, varsView } from "@/backend/live/pipeline"
import { compareFields } from "@/backend/live/workflow-view"
import { Fold, MiniButton, Small } from "@/components/views/kit"
import { Markdown } from "@/components/views/markdown"
import { ShadowLine, StepAgent } from "@/components/views/pipeline"
import { cn } from "@/lib/utils"

import { Chip, KindIcon, StatusDot, tone } from "./flow"
import { useAgent } from "@/hooks/use-engines"

// One phase of the workflow (components/workflow/workflow-page.jsx), drawn as the process it is: INPUT (what it reads —
// each variable by value and where it came from), WORK (how it runs — its agent's loop live, its reads, the prompt as
// sent), OUTPUT (what it hands on — its report fields, its check, the whole answer; the run before, to compare after an
// edit). Read from the artifact on a change of its row (key), never polled.

// One owner read, run again when `key` changes; the value read for the same thing (the key's part before #) stays while
// the next one loads (no flicker), a stale answer is dropped.
export function useRead(read, key) {
  const [s, setS] = React.useState({ busy: false, error: null, value: null, key: null })
  const seq = React.useRef(0)
  React.useEffect(() => {
    if (!key || !read) return
    const n = ++seq.current
    setS((p) => ({ ...p, busy: true, error: null }))
    read()
      .then((value) => n === seq.current && setS({ busy: false, error: null, value, key }))
      .catch((error) => n === seq.current && setS((p) => ({ ...p, busy: false, error: error?.message ?? String(error) })))
  }, [key])
  const same = s.key && key && s.key.split("#")[0] === key.split("#")[0]
  return { ...s, value: same ? s.value : null }
}

function Pre({ text, className }) {
  return <pre className={cn("max-h-[50svh] overflow-auto rounded-md border px-2 py-1 font-mono text-[11px] leading-4 break-words whitespace-pre-wrap text-muted-foreground", className)}>{text}</pre>
}

// A section of the phase: its header (icon, name, a line of what it holds) and its body, set apart by its own border.
function Section({ icon: Icon, title, note, accent, children, action }) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5", accent)}>
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm text-foreground">{title}</h3>
        {note && <span className="min-w-0 text-[11px] break-words text-muted-foreground">{note}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      {children}
    </section>
  )
}

const Flow = () => <div className="flex justify-center text-muted-foreground" aria-hidden><ArrowDownIcon className="size-4" /></div>

export function PhaseDetail({ id, card, running, onEdit, onRunFrom, runBusy, editable }) {
  const ran = card.status !== "waiting" && card.status !== "skipped" && !!card.row
  const detail = useRead(ran ? () => stageDetail(id, card.id) : null, ran ? `${card.id}#${card.key}` : null)
  const pending = !["done", "reused"].includes(card.status)
  const [compare, setCompare] = React.useState(false)
  const wantLast = !!card.last && (pending || compare)
  const last = useRead(wantLast ? () => lastOutput(id, card.id) : null, wantLast ? `${card.id}#${card.last.run}` : null)
  const file = useRead(() => stepFile(id, card.id), `${card.id}#${card.step?.rev ?? "?"}`)
  const d = detail.value
  const t = tone(card.status)
  return (
    <article aria-label={`Phase ${card.id}`} className="flex min-w-0 flex-col gap-2">
      <header className={cn("flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5", t.card)}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusDot status={card.status} />
          <h2 className="min-w-0 text-lg break-words text-foreground"><span className="font-mono text-sm text-muted-foreground">{card.n ? `${card.n}. ` : ""}</span>{card.title}</h2>
          <span className={cn("rounded border px-1.5 text-[11px]", t.card, t.text)}>{card.status}</span>
          <span className="ml-auto flex shrink-0 gap-1">
            {editable && card.step && (
              <MiniButton variant="outline" className="h-7 gap-1" onClick={() => onEdit(card.id)} title="Edit this phase in the workflow file">
                <PencilLineIcon aria-hidden className="size-3" /> Edit
              </MiniButton>
            )}
            {!running && card.step && card.kind !== "code" && (
              <MiniButton variant="outline" className="h-7 gap-1" disabled={runBusy} onClick={() => onRunFrom(card.id)} title="Run this phase again and every phase after it; the ones before keep today's output">
                <PlayIcon aria-hidden className="size-3" /> Run from here
              </MiniButton>
            )}
          </span>
        </div>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground tabular-nums">
          <span className="font-mono">{card.id}</span>
          <span>·</span>
          <KindIcon label={card.how.label} />
          <span>
            {card.how.label}
            {card.how.detail ? ` ${card.how.detail}` : ""}
          </span>
          {card.step?.after?.length > 0 && <span>· after {card.step.after.join(", ")}</span>}
          {card.at && <span>· started {card.at} ET</span>}
          {card.elapsed && <span className={t.text}>· {card.elapsed}</span>}
          {card.run && <span>· run {card.run}</span>}
        </p>
        {card.edited && <Small tone="warn">The workflow file changed since this output — the next run uses the new wording.</Small>}
        {card.error && <Small tone="error">{card.error}</Small>}
        {detail.error && <Small tone="error">{detail.error}</Small>}
      </header>

      <Inputs card={card} detail={d} last={pending ? last.value : null} />
      <Flow />
      <Work card={card} detail={d} last={pending ? last.value : null} file={file.value} />
      <Flow />
      <Output card={card} detail={d} last={last} pending={pending} compare={compare} setCompare={setCompare} busy={detail.busy} />
    </article>
  )
}

const FROM_TONE = { run: "run", field: "field", report: "report", document: "document" }

// INPUT: what the phase reads. After a run, every variable its prompt was filled with, by value; before, the names its
// text uses (filled when it runs).
function Inputs({ card, detail, last }) {
  const vars = detail?.vars ?? last?.vars ?? null
  const unread = detail?.unread ?? last?.unread ?? null // files of the stage that did not parse (2026-10-23 audit)
  const from = detail?.vars ? "this run" : last?.vars ? `run ${last.run ?? "before"}` : null
  if (card.kind === "code") {
    return (
      <Section icon={FileInputIcon} title="Input" note="the desk's records — a code step reads no prompt">
        <Small>It reads what the desk keeps (its state, memory, live data) when it runs.</Small>
      </Section>
    )
  }
  const declared = [...card.reads.vars, ...card.reads.inputs]
  return (
    <Section icon={FileInputIcon} title="Input" note={vars ? `${vars.length} variables · ${from}` : declared.length ? `${declared.length} named in its text · filled when it runs` : "nothing named"}>
      {unread?.length > 0 && <Small tone="warn" className="dark:text-amber-300">did not read: {unread.join("; ")}</Small>}
      {vars ? (
        <VarRows vars={vars} />
      ) : declared.length ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {declared.map((v) => <Chip key={v.name} kind={FROM_TONE[v.kind] ?? "run"} title={v.from === "run" ? "a run variable" : `from ${v.from}`}>{`{{${v.name}}}`}</Chip>)}
        </div>
      ) : (
        <Small>Its text names no variables.</Small>
      )}
      <FlowLine flow={card.flow} />
      {!vars && <Small>{card.reads.board ? "It also reads the board: every earlier phase's whole report." : card.kind === "phase" || card.step?.own ? "No board: it reads only these." : ""}</Small>}
    </Section>
  )
}

// What flowed into the stage as it ran, by source with its size, the prompt it made, and what came out (2026-10-23: the
// stage's flow, computed by pipeline.js flowOf, was never drawn).
function FlowLine({ flow }) {
  if (!flow || (!flow.in?.length && !flow.prompt && !flow.out)) return null
  return (
    <div data-flow className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[10px] text-muted-foreground">
      {(flow.in ?? []).map((g) => <span key={g.kind} className="rounded border px-1.5" title={`from ${g.from.join(", ")}`}>{g.label} {size(g.chars)}</span>)}
      {flow.prompt && <span className="rounded border border-foreground/30 px-1.5">→ prompt {flow.prompt}</span>}
      {flow.out && (
        <span className="rounded border px-1.5">
          → out {flow.out.text}
          {flow.out.data?.length ? ` · data ${flow.out.data.join(", ")}` : ""}
          {flow.out.code?.length ? ` · code ${flow.out.code.join(", ")}` : ""}
        </span>
      )}
    </div>
  )
}

const VAR_TONE = { var: "border-border", output: "border-violet-500", document: "border-violet-500/60", input: "border-violet-500/50", state: "border-violet-500/50", carry: "border-violet-500", market: "border-sky-500", note: "border-violet-500/50", data: "border-sky-500/50", code: "border-emerald-500/50", gate: "border-amber-500", failed: "border-red-500", expect: "border-emerald-500", card_rows: "border-emerald-500", rules: "border-border", lessons: "border-border", owner_note: "border-amber-500/60" }

function VarRows({ vars }) {
  const rows = varsView(vars)
  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} className={cn("min-w-0 border-l-2 pl-2", VAR_TONE[r.kind] ?? "border-border")}>
          <details className="min-w-0">
            <summary className="flex min-h-7 min-w-0 cursor-pointer list-none flex-wrap items-baseline gap-x-2 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-xs text-foreground/90">{r.name}</span>
              <span className="text-[11px] text-muted-foreground">{r.from && r.from !== r.name ? `from ${r.from}` : r.label} · {r.size}{r.clipped ? " (clipped)" : ""}</span>
              <span className={cn("min-w-0 basis-full truncate text-[11px]", r.missing ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{r.preview || (r.empty ? "(none)" : "")}</span>
            </summary>
            {r.text &&
              (r.markdown ? (
                <div className="max-h-[50svh] min-w-0 overflow-auto py-1"><Markdown text={r.text} /></div>
              ) : (
                <Pre text={r.text} className="my-1" />
              ))}
          </details>
        </li>
      ))}
    </ul>
  )
}

const STEP_TONE = { tool: "text-foreground/80", think: "text-muted-foreground", gate: "text-amber-700 dark:text-amber-400", answer: "text-sky-700 dark:text-sky-400", guidance: "text-violet-700 dark:text-violet-400", compact: "text-muted-foreground", lifecycle: "text-pink-700 dark:text-pink-300", refresh: "text-amber-700 dark:text-amber-400" }
const STEP_MARK = { think: "thinks", gate: "refused", answer: "answers", guidance: "owner", compact: "compacts", lifecycle: "helper", refresh: "refresh" }

// The agent's loop inside the phase, newest last: each call (✓ / ✕), thought, refusal and the answer as it comes.
function AgentLoop({ name, live }) {
  const { state: st } = useAgent(name)
  const { steps, hidden } = runSteps(st, { limit: live ? 10 : 6 })
  if (!steps.length) return null
  return (
    <ol className="flex min-w-0 flex-col gap-0.5 text-[11px]" aria-label={`${name}'s loop`}>
      {hidden > 0 && <li className="text-muted-foreground">… {hidden} earlier steps</li>}
      {steps.map((s, i) => (
        <li key={s.id ?? `${s.step}-${i}`} className={cn("flex min-w-0 gap-1.5", STEP_TONE[s.step])}>
          <span className="w-16 shrink-0 truncate font-mono">{s.step === "tool" ? `${s.ok ? "✓" : "✕"} ${s.name.split(".").pop()}` : STEP_MARK[s.step] ?? s.step}</span>
          <span className="min-w-0 truncate">{s.step === "tool" ? `${s.name} — ${s.text.replace(/\s+/g, " ").slice(0, 200)}` : s.text.replace(/\s+/g, " ").slice(0, 220)}</span>
        </li>
      ))}
    </ol>
  )
}

// WORK: how the phase runs — its agent and loop (live while it runs), its web reads, the prompt it was sent.
function Work({ card, detail, last, file }) {
  const running = card.status === "running"
  const sent = detail?.prompt ?? last?.prompt ?? null
  const stats = [card.turns ? `${card.turns} turns` : null, card.tools ? `${card.tools} calls` : null, card.cost, card.elapsed].filter(Boolean).join(" · ")
  return (
    <Section icon={WorkflowIcon} title="Work" note={[`${card.how.label}${card.how.detail ? ` ${card.how.detail}` : ""}`, stats].filter(Boolean).join(" · ")} accent={running ? "border-emerald-500/60" : undefined}>
      {card.kind === "code" ? (
        <Small>The desk&apos;s code {file?.code ? <code className="font-mono">{file.code}</code> : null} runs — no model call.</Small>
      ) : (
        <>
          {card.agent && <StepAgent name={card.agent} refused={card.row?.refused ?? 0} />}
          {/* live only: once it settles, the same agent may already run a later phase (its thread is on its page) */}
          {card.agent && running && <AgentLoop name={card.agent} live />}
          <ShadowLine shadow={card.row?.shadow} />
          {card.row?.chips?.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-1">
              {card.row.chips.map((c, i) =>
                c.href ? (
                  <a key={i} href={c.href} target="_blank" rel="noopener noreferrer" title={c.title} className="max-w-[14rem] truncate rounded border px-1.5 text-[11px] text-sky-700 dark:text-sky-400">
                    {c.label}
                  </a>
                ) : (
                  <span key={i} title={c.title} className="max-w-[14rem] truncate rounded border border-dashed px-1.5 text-[11px] text-muted-foreground">⌕ {c.label}</span>
                ),
              )}
              {card.row.more > 0 && <span className="text-[11px] text-muted-foreground">+{card.row.more}</span>}
            </div>
          )}
          {/* 2026-10-23 audit: the step's own limits and the report format its file asks for (config twin) */}
          {(card.step?.min_calls != null || card.step?.max_steps != null || card.step?.status) && (
            <Small>
              {[card.step.max_steps != null ? `≤ ${card.step.max_steps} steps` : null, card.step.min_calls != null ? `≥ ${card.step.min_calls} calls before it answers` : null, card.step.status ? `status ${card.step.status}` : null].filter(Boolean).join(" · ")}
            </Small>
          )}
          {card.step?.output && <Fold title="The report's format (### Output)"><Pre text={card.step.output} /></Fold>}
          {!card.agent && running && <Small className="text-emerald-700 dark:text-emerald-400">Working — {card.tools ? `${card.tools} reads so far` : "no reads yet"}.</Small>}
          {!running && card.status === "waiting" && <Small>Not run yet{card.step?.after?.length ? ` — it starts when ${card.step.after.join(" and ")} ${card.step.after.length > 1 ? "settle" : "settles"}` : ""}.</Small>}
          <Fold title={sent ? `The prompt as sent${detail?.prompt ? "" : ` in run ${last?.run ?? "before"}`} · ${sent.length.toLocaleString()} chars` : file?.body ? "The prompt's template (its {{variables}} are filled at the run)" : "No prompt yet"}>
            {(sent || file?.body) && <Pre text={sent ?? file.body} className="mt-1" />}
            {/* 2026-10-23 audit: the ```data block the step must end with (its schema's example) */}
            {file?.example && (
              <>
                <Small className="mt-1">The data block it must end with:</Small>
                <Pre text={typeof file.example === "string" ? file.example : JSON.stringify(file.example, null, 1)} className="mt-1" />
              </>
            )}
          </Fold>
        </>
      )}
    </Section>
  )
}

// OUTPUT: what the phase hands on. Its report fields (each {{phase.field}} for later phases), its check, the whole
// answer; while it waits or runs again, the run before's (labelled); after a run, that one beside this one.
function Output({ card, detail, last, pending, compare, setCompare, busy }) {
  const fields = card.hands.filter((h) => card.step?.report?.includes(h.field)).map((h) => h.field)
  const showLast = pending && last.value
  const d = showLast ? last.value : detail
  const gate = card.gate
  const note = card.status === "running" ? "being written" : pending ? (showLast ? `this run has not reached it — showing run ${last.value.run ?? card.last?.run}` : "not run yet") : card.status === "reused" ? `reused from run ${card.run ?? "earlier today"}` : null
  const canCompare = !pending && !!card.last && card.kind !== "code"
  return (
    <Section
      icon={FileOutputIcon}
      title="Output"
      note={[fields.length ? `hands on ${fields.map((f) => `${card.id}.${f}`).join(", ")}` : card.hands[0]?.field, note].filter(Boolean).join(" · ")}
      accent={card.status === "done" ? "border-sky-500/40" : card.status === "failed" ? "border-red-500/50" : undefined}
      action={
        canCompare && (
          <MiniButton variant={compare ? "outline" : "ghost"} aria-pressed={compare} className="h-7 gap-1" onClick={() => setCompare((x) => !x)} title="This run's output beside the run before's">
            <GitCompareIcon aria-hidden className="size-3" /> {compare ? "Comparing" : `Compare with ${card.last.run ?? "before"}`}
          </MiniButton>
        )
      }
    >
      {gate && (gate.ok ? <Small className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckIcon aria-hidden className="size-3" /> checked{gate.retried ? " (after a retry)" : ""}</Small> : <Problems problems={d?.problems?.length ? d.problems : gate.problems} />)}
      {compare && canCompare ? (
        <Compare fields={fields} now={detail} before={last} lastEdited={card.lastEdited} />
      ) : d ? (
        <Answer d={d} fields={fields} dim={!!showLast} />
      ) : busy || last.busy ? (
        <Small>Reading…</Small>
      ) : (
        <Small>{card.status === "running" ? "It shows here when the phase ends." : card.status === "waiting" ? "Nothing yet." : "No output."}</Small>
      )}
    </Section>
  )
}

// One output: its report fields as rows (field → value), its ```data, then the whole answer.
function Answer({ d, fields, dim }) {
  if (d.kind === "code") return d.state ? <Pre text={d.state} /> : <Small>No record.</Small>
  const report = d.report ?? {}
  const has = fields.filter((f) => report[f] != null)
  const missing = d.report ? fields.filter((f) => report[f] == null) : []
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", dim && "opacity-70")}>
      {has.length > 0 && (
        <dl className="flex min-w-0 flex-col gap-1.5">
          {has.map((f) => (
            <div key={f} className="min-w-0 border-l-2 border-sky-500/60 pl-2">
              <dt className="font-mono text-[11px] text-sky-700 dark:text-sky-300">{f}</dt>
              <dd className="min-w-0 text-sm"><Markdown text={report[f]} /></dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && d.text && <Small tone="warn">Not in the answer: {missing.join(", ")}</Small>}
      {d.data && <DataRows data={d.data} />}
      {d.code && <Fold title={`code results · ${Object.keys(d.code).join(", ")}`}><Pre text={JSON.stringify(d.code, null, 1)} /></Fold>}
      {d.text ? (
        <Fold open={!has.length && !d.data} title={`The whole answer · ${d.text.length.toLocaleString()} chars`}>
          <div className="max-h-[60svh] min-w-0 overflow-auto pt-1"><Markdown text={d.text} /></div>
        </Fold>
      ) : (
        !has.length && <Small>No document.</Small>
      )}
      {d.file && <p className="font-mono text-[10px] break-all text-muted-foreground">{d.file}</p>}
    </div>
  )
}

// The check's problems (2026-10-23): the stage's detail has them all, the twin row only its first 8 — every one drawn,
// the ones past 8 behind a toggle.
function Problems({ problems = [] }) {
  const head = problems.slice(0, 8)
  const rest = problems.slice(8)
  return (
    <Small as="div" tone="warn" className="min-w-0">
      <ul className="flex min-w-0 flex-col gap-0.5">{head.map((p, n) => <li key={n}>⚠ {p}</li>)}</ul>
      {rest.length > 0 && <Fold title={`+${rest.length} more problems`}><ul className="flex min-w-0 flex-col gap-0.5">{rest.map((p, n) => <li key={n}>⚠ {p}</li>)}</ul></Fold>}
    </Small>
  )
}

// A ```data block's top-level fields, one row each; a nested one opens.
function DataRows({ data }) {
  const entries = Object.entries(data ?? {})
  return (
    <Fold open title={`data · ${entries.length} fields`}>
      <dl className="grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]">
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="truncate font-mono text-sky-700 dark:text-sky-300">{k}</dt>
            <dd className="min-w-0 truncate text-muted-foreground" title={typeof v === "string" ? v : JSON.stringify(v)}>
              {v == null ? "null" : typeof v === "string" ? v : JSON.stringify(v)}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </Fold>
  )
}

// This run's output beside the run before's: field by field (a changed one marked), else the two answers.
function Compare({ fields, now, before, lastEdited }) {
  if (before.busy && !before.value) return <Small>Reading the run before…</Small>
  if (before.error) return <Small tone="error">{before.error}</Small>
  const b = before.value
  if (!b || !now) return null
  const head = (
    <Small>
      run {b.run ?? "before"} → this run{lastEdited ? " · the workflow file changed in between" : ""}
    </Small>
  )
  if (fields.length) {
    const rows = compareFields(fields, now.report, b.report)
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {head}
        {rows.map((r) => (
          <div key={r.field} className={cn("min-w-0 rounded-md border px-2 py-1", r.same ? "border-border" : "border-amber-500/50")}>
            <p className="font-mono text-[11px] text-sky-700 dark:text-sky-300">
              {r.field} {r.same ? <span className="text-muted-foreground">· same</span> : <span className="text-amber-700 dark:text-amber-400">· changed</span>}
            </p>
            <div className="grid min-w-0 gap-2 md:grid-cols-2">
              <div className="min-w-0 text-[11px] text-muted-foreground"><p className="text-[10px] tracking-wide uppercase">before</p><Markdown text={r.before ?? "—"} /></div>
              <div className="min-w-0 text-sm"><p className="text-[10px] tracking-wide text-muted-foreground uppercase">now</p><Markdown text={r.now ?? "—"} /></div>
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {head}
      <div className="grid min-w-0 gap-2 md:grid-cols-2">
        <div className="max-h-[50svh] min-w-0 overflow-auto rounded-md border px-2 py-1 text-muted-foreground"><Markdown text={b.text ?? b.state ?? "—"} /></div>
        <div className="max-h-[50svh] min-w-0 overflow-auto rounded-md border px-2 py-1"><Markdown text={now.text ?? now.state ?? "—"} /></div>
      </div>
    </div>
  )
}
