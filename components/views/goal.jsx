"use client"

import * as React from "react"
import { PauseIcon, PlayIcon, PlusIcon, SendIcon, TargetIcon, UnlockIcon, XIcon, ZapIcon } from "lucide-react"

import { goalCall, goalLedger, goalLine, goalPlan, goalPreview, goalSeries, goalWorkflows, ROUTE } from "@/backend/live/goal"
import { MicButton } from "@/components/chat/composer"
import { withDictation } from "@/components/chat/dictation-text"
import { useDesk } from "@/hooks/use-engines"
import { useSpeechInput } from "@/hooks/use-speech"
import { useNow } from "@/hooks/use-now"
import { nearStatusClasses } from "@/components/canvas/tap"
import { PreviewCard } from "@/components/preview/card"
import { Button } from "@/components/ui/button"
import { CallNote, ConfirmDelete, Options, SmButton, field, submitted, useOwnerCall } from "@/components/views/kit"
import { cn } from "@/lib/utils"

// The desk's standing goal (kernel builtin/goal.js; 2026-10-24 owner: "the desk will set a goal and will keep working
// towards the goal … all actions with feedback is to gain towards the goal"): closed, its status and its last step;
// open, the goal with its measure and target, the measure's values as a line, every run's progress (closer / same /
// further), the owner's feedback and what was done with it, the next run — and the owner's controls: set it, feedback,
// run now, pause / resume, how often, drop. The long-running elements (2026-10-24 owner: "the goal artifact will contain
// the elements for a long running process … the goal can be live artifact … configurable workflows"): the constraints,
// the milestones with who claimed each (the owner releases a stuck claim), the ledger of decisions, facts, dead ends and
// guesses (the owner adds a note or retires one), stalled, and the workflow each resume runs. Every request framed
// (2026-10-25, goal.frame): its outcome, what shows it done, the route its complexity took, how it ended. The live view
// (2026-10-25 owner: "the goal artifact will show the live goal, progress … live view as well"): the desk's preview
// beside it — closed, the item in the pane small; open, the pane whole (its pages, recordings, questions).

const TOWARD = { closer: "text-emerald-600 dark:text-emerald-400", same: "text-muted-foreground", further: "text-amber-600 dark:text-amber-400", unrelated: "text-muted-foreground" }
const MARK = { closer: "▲", same: "■", further: "▼", unrelated: "·" }
const STATUS = { active: "text-emerald-600 dark:text-emerald-400", paused: "text-amber-600 dark:text-amber-400", met: "text-sky-600 dark:text-sky-400", dropped: "text-muted-foreground" }
const CADENCES = [10, 30, 60, 120, 240, 1440]
const hm = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "")
const every = (m) => `every ${m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`}`
const cadences = (list) => list.map((m) => ({ value: m, label: every(m) }))

// A form's submit: the page stays, `fn` runs.
const useCall = (id) => useOwnerCall(goalCall, id, (r) => (r?.delivered ? `sent to ${r.keeper} (${r.delivered === "guided" ? "read at its next step" : "a run"})` : "done"))
const NOTE_KINDS = [["fact", "fact"], ["decision", "decision"], ["dead_end", "dead end"], ["guess", "guess"]].map(([value, label]) => ({ value, label }))
const RowButton = ({ icon: Icon, ...props }) => <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-10" {...props}><Icon /></Button>
const linkButton = "self-start text-[11px] text-muted-foreground underline underline-offset-2 pointer-coarse:min-h-10"

// Closed: what is being worked on now — the milestone claimed and by whom, and the last step's next.
function Working({ state }) {
  const claimed = goalPlan(state).items.filter((m) => m.claim && m.status !== "done")
  const last = (state?.entries ?? []).findLast((e) => e.kind === "progress")
  if (!claimed.length && !last) return null
  return (
    <span className="line-clamp-2 break-words text-[11px] text-muted-foreground">
      {claimed.map((m) => `${m.claim.by} on ${m.id}: ${m.text}`).join(" · ")}
      {claimed.length && last ? " · " : ""}
      {last ? `last: ${last.did}` : ""}
    </span>
  )
}

// The measure's values as a line (a number per progress entry).
function Trend({ series }) {
  if (series.length < 2) return null
  const w = 240
  const h = 40
  const vs = series.map((p) => p.value)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const y = (v) => (hi === lo ? h / 2 : h - 4 - ((v - lo) / (hi - lo)) * (h - 8))
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * (w - 8) + 4},${y(p.value)}`).join(" ")
  return (
    <figure className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full max-w-60" role="img" aria-label={`the measure from ${vs[0]} to ${vs.at(-1)} over ${vs.length} runs`}>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-500" />
      </svg>
      <figcaption className="whitespace-nowrap tabular-nums">{vs[0]} → {vs.at(-1)}</figcaption>
    </figure>
  )
}

function SetGoal({ id, state, onDone }) {
  const { busy, note, call } = useCall(id)
  const [text, setText] = React.useState(state?.goal?.text ?? "")
  const [measure, setMeasure] = React.useState(state?.goal?.measure ?? "")
  const [target, setTarget] = React.useState(state?.goal?.target ?? "")
  const [constraints, setConstraints] = React.useState(state?.goal?.constraints ?? "")
  const [cadence, setCadence] = React.useState(String(state?.cadence_minutes ?? 60))
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={submitted(() => call("set", { text, measure, target: target || undefined, constraints: constraints || undefined, cadence_minutes: Number(cadence) }, onDone))}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="The goal, as an outcome — e.g. grow the paper account to $1,300" aria-label="Goal" className={field} />
      <input value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="How progress is measured — e.g. account value in $" aria-label="Measure" className={field} />
      <input value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="Never break (optional) — e.g. the public API, risk ≤ 10% a trade" aria-label="Constraints" className={field} />
      <div className="flex flex-wrap gap-2">
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target (optional)" aria-label="Target" className={cn(field, "min-w-0 flex-1")} />
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} aria-label="Resume every" className={cn(field, "h-10 w-auto")}><Options items={cadences(CADENCES)} /></select>
      </div>
      <SmButton type="submit" className="self-start" disabled={busy || !text.trim() || !measure.trim()}><TargetIcon /> {state?.goal ? "Set as the new goal" : "Set the goal"}</SmButton>
      <CallNote note={note} />
    </form>
  )
}

function Entry({ e }) {
  if (e.kind === "progress")
    return (
      <li className="flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-xs">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("tabular-nums", TOWARD[e.toward])}>{MARK[e.toward]} {e.toward}{e.value != null ? ` · ${e.value}` : ""}</span>
          <span className="text-[11px] text-muted-foreground">{e.by} · {hm(e.at)}</span>
        </span>
        <span className="break-words">{e.did}</span>
        <span className="break-words text-muted-foreground">→ {e.result}</span>
        {e.next && <span className="break-words text-[11px] text-muted-foreground">next: {e.next}</span>}
      </li>
    )
  if (e.kind === "owner")
    return (
      <li className="flex flex-col gap-0.5 rounded-md border border-dashed px-2 py-1.5 text-xs">
        <span className="text-[11px] text-muted-foreground">your feedback · {hm(e.at)} · {e.acted ? `acted on by ${e.acted}` : "not acted on yet"}</span>
        <span className="break-words">{e.text}</span>
      </li>
    )
  return <li className="px-2 text-[11px] text-muted-foreground">{hm(e.at)} · {e.by}: {e.text}</li>
}

function Controls({ id, state, workflows }) {
  const { busy, note, call } = useCall(id)
  const [feedback, setFeedback] = React.useState("")
  const active = state.status === "active"
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={submitted(() => call("feedback", { text: feedback }, () => setFeedback("")))}
      >
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback on the goal — what to change, keep or try" aria-label="Feedback on the goal" className={cn(field, "min-w-0 flex-1")} />
        <SmButton type="submit" variant="outline" disabled={busy || !feedback.trim()}><SendIcon /> Send</SmButton>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        {active && (
          <>
            <SmButton variant="outline" disabled={busy} onClick={() => call("now")} title="The next run starts at once (when the keeper is idle)"><ZapIcon /> Run now</SmButton>
            <SmButton variant="ghost" disabled={busy} onClick={() => call("pause")}><PauseIcon /> Pause</SmButton>
          </>
        )}
        {["paused", "met"].includes(state.status) && <SmButton variant="outline" disabled={busy} onClick={() => call("resume")}><PlayIcon /> Resume</SmButton>}
        <select value={String(state.cadence_minutes)} onChange={(e) => call("cadence", { minutes: Number(e.target.value) })} aria-label="Resume every" className={cn(field, "h-9 w-auto pointer-coarse:h-10")} disabled={busy}>
          <Options items={cadences([...new Set([...CADENCES, state.cadence_minutes])].sort((a, b) => a - b))} />
        </select>
        {(workflows.length > 0 || state.workflow) && (
          <select value={state.workflow ?? ""} onChange={(e) => call("workflow", { workflow: e.target.value || "none" })} aria-label="Each resume runs" title="Each resume runs this workflow (its file says how), or one run of the keeper" className={cn(field, "h-9 w-auto pointer-coarse:h-10")} disabled={busy}>
            <option value="">resumes as one run</option>
            <Options items={[...new Set([...workflows, ...(state.workflow ? [state.workflow] : [])])].map((w) => ({ value: w, label: `through ${w}` }))} />
          </select>
        )}
        {state.status !== "dropped" && <ConfirmDelete label="Drop" confirm="Drop the goal?" busy={busy} onConfirm={() => call("drop")} />}
      </div>
      <CallNote note={note} />
    </div>
  )
}

// A feature request (2026-10-27, request-to-loop): the owner's words become an open milestone beside the others.
// 2026-10-27 request-voice: spoken too. The composer's mic sits beside Request, and the transcript goes after what was
// typed. Typing or Request releases dictation, and a tap on an off mic shows its reason under the field.
export function RequestForm({ id }) {
  const { busy, note, call } = useCall(id)
  const [text, setText] = React.useState("")
  const [micNote, setMicNote] = React.useState(null)
  const dictationBase = React.useRef("")
  const speech = useSpeechInput({ onText: (t) => setText(withDictation(dictationBase.current, t)) })
  return (
    <RequestRow
      text={text}
      busy={busy}
      note={note}
      micNote={micNote}
      speech={speech}
      onType={(value) => {
        if (speech.listening || speech.correcting) speech.release()
        setMicNote(null)
        setText(value)
      }}
      onMic={() => {
        if (!speech.listening) dictationBase.current = text.trimEnd()
        speech.toggle()
      }}
      onOffTap={setMicNote}
      onSubmit={() => {
        speech.release()
        dictationBase.current = ""
        call("request", { text }, () => setText(""))
      }}
    />
  )
}

// The request row, drawn from its props only (its test renders it with a known mic support).
export function RequestRow({ text, busy, note, micNote, speech, onType, onMic, onOffTap, onSubmit }) {
  return (
    <div className="flex flex-col gap-1">
      <form className="flex items-center gap-2" onSubmit={submitted(onSubmit)}>
        <input value={text} onChange={(e) => onType(e.target.value)} placeholder={speech.listening ? "Listening…" : "Feature request — what the desk should build next"} aria-label="Feature request" className={cn(field, "min-w-0 flex-1")} />
        <MicButton speech={speech} onToggle={onMic} onOffTap={onOffTap} disabled={busy} />
        <SmButton type="submit" variant="outline" disabled={busy || !text.trim()}><PlusIcon /> Request</SmButton>
      </form>
      {micNote && <p className="text-xs text-muted-foreground" aria-live="polite">{micNote}</p>}
      {speech.error && <p className="text-xs text-destructive">{speech.error}</p>}
      <CallNote note={note} />
    </div>
  )
}

// The milestones: done, claimed (by whom, since when — the owner may release a stuck claim) and open.
function Plan({ id, state }) {
  const { busy, note, call } = useCall(id)
  const plan = goalPlan(state)
  if (!plan.total) return null
  return (
    <section className="flex flex-col gap-1" aria-label="Milestones">
      <h4 className="text-xs text-muted-foreground">Milestones · {plan.done}/{plan.total} done{plan.claimed ? ` · ${plan.claimed} claimed` : ""}</h4>
      <ul className="flex flex-col gap-1">
        {plan.items.map((m) => (
          <li key={m.id} className={cn("flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs", m.status === "done" && "opacity-70")}>
            <span aria-hidden className={cn("mt-px tabular-nums", m.status === "done" ? "text-emerald-600 dark:text-emerald-400" : m.claim ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
              {m.status === "done" ? "✓" : m.claim ? "◐" : "○"}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="break-words"><span className="text-muted-foreground">{m.id}</span> {m.text}</span>
              {m.requested && <span className="text-[11px] text-sky-600 dark:text-sky-400">requested by owner</span>}
              {(m.check ?? (m.requested ? "to plan" : null)) && <span className="break-words text-[11px] text-muted-foreground">check: {m.check ?? "to plan"}</span>}
              {m.status === "done" && m.evidence && <span className="break-words text-[11px] text-muted-foreground">✓ {m.evidence}</span>}
              {m.claim && <span className="text-[11px] text-amber-600 dark:text-amber-400">claimed by {m.claim.by} · {hm(m.claim.at)}</span>}
            </span>
            {m.claim && (
              <RowButton icon={UnlockIcon} disabled={busy} onClick={() => call("release", { milestone: m.id })} title={`Release ${m.id}: another agent may take it`} aria-label={`Release ${m.id}`} />
            )}
          </li>
        ))}
      </ul>
      <CallNote note={note} quiet />
    </section>
  )
}

// The ledger: what the work learnt, decided and ruled out — kept across runs and compactions.
function Ledger({ id, state }) {
  const { busy, note, call } = useCall(id)
  const [kind, setKind] = React.useState("fact")
  const [text, setText] = React.useState("")
  const [forgetting, setForgetting] = React.useState(null)
  const [why, setWhy] = React.useState("")
  const groups = goalLedger(state)
  return (
    <section className="flex flex-col gap-1" aria-label="Ledger">
      <h4 className="text-xs text-muted-foreground">Ledger · kept across runs and compactions</h4>
      {groups.map((g) => (
        <div key={g.kind} className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">{g.label}</span>
          <ul className="flex flex-col gap-0.5">
            {g.notes.map((l) => (
              <li key={l.id} className="flex items-start gap-1 text-xs">
                <span className="min-w-0 flex-1 break-words">
                  {l.text}
                  {l.evidence && <span className="text-muted-foreground"> — {l.evidence}</span>}
                  <span className="text-[11px] text-muted-foreground"> · {l.by}</span>
                </span>
                {forgetting === l.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={submitted(() => call("forget", { note: l.id, why }, () => (setForgetting(null), setWhy(""))))}
                  >
                    <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="why it no longer holds" aria-label="Why" className={cn(field, "w-40")} autoFocus />
                    <SmButton type="submit" variant="ghost" disabled={busy || !why.trim()}>Forget</SmButton>
                  </form>
                ) : (
                  <RowButton icon={XIcon} onClick={() => setForgetting(l.id)} title="Retire this note" aria-label={`Retire ${l.id}`} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={submitted(() => call("note", { kind, text }, () => setText("")))}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of note" className={cn(field, "h-10 w-auto")}><Options items={NOTE_KINDS} /></select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Something every later run should know" aria-label="Note" className={cn(field, "min-w-0 flex-1")} />
        <SmButton type="submit" variant="outline" disabled={busy || !text.trim()}><PlusIcon /> Note</SmButton>
      </form>
      <CallNote note={note} quiet />
    </section>
  )
}

const FRAMED = { working: "text-sky-600 dark:text-sky-400", answered: "text-emerald-600 dark:text-emerald-400", failed: "text-destructive", interrupted: "text-amber-600 dark:text-amber-400" }

function Frames({ frames }) {
  if (!frames?.length) return null
  return (
    <section aria-label="Requests framed as goals, newest first" className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests as goals</p>
      <ol className="flex flex-col gap-1.5">
        {[...frames].reverse().map((f) => (
          <li key={f.id} className="flex flex-col gap-0.5 border-l-2 pl-2 text-xs">
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              <span title={ROUTE[f.route]?.says} className="text-foreground/80">{ROUTE[f.route]?.label ?? f.route}</span>
              <span className={FRAMED[f.status]}>{f.status}</span>
              <span>{f.agent} · {hm(f.at)}</span>
            </span>
            <span className="text-sm break-words">{f.intent}</span>
            <span className="break-words text-muted-foreground">done when: {f.done}{f.why ? ` · ${f.why}` : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function GoalView({ id, state, expanded }) {
  const desk = useDesk()
  const workflows = goalWorkflows(desk?.artifacts)
  const now = useNow(30000)
  const [editing, setEditing] = React.useState(false)
  const g = state?.goal
  const framed = state?.frames?.at(-1)
  const live = goalPreview(desk?.artifacts)
  if (!expanded)
    return (
      <div className="mt-1 flex flex-col gap-0.5 text-xs">
        {g ? (
          <>
            <span className="line-clamp-2 break-words">{g.text}</span>
            <span title={goalLine(state, now)} className={cn("text-[11px]", nearStatusClasses(), STATUS[state.status] ?? "text-muted-foreground")}>{goalLine(state, now)}</span>
            <Working state={state} />
            {live && <PreviewCard artifact={live} state={live.state} />}
          </>
        ) : framed ? (
          <>
            <span className="line-clamp-2 break-words">{framed.intent}</span>
            <span className={cn("text-[11px]", FRAMED[framed.status])}>{ROUTE[framed.route]?.label ?? framed.route} · {framed.status}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No standing goal — open to set one</span>
        )}
      </div>
    )
  const entries = [...(state?.entries ?? [])].reverse()
  return (
    <div className="mt-1 flex flex-col gap-3">
      {g && !editing ? (
        <section className="flex flex-col gap-1">
          <p className={cn("text-xs", STATUS[state.status])}>{goalLine(state, now)}</p>
          <p className="text-sm break-words">{g.text}</p>
          <p className="text-xs text-muted-foreground">
            measure: {g.measure}
            {g.target ? ` · target: ${g.target}` : ""} · set by {g.by} {hm(g.at)}
            {state.keeper ? ` · kept by ${state.keeper}` : ""}
          </p>
          {g.constraints && <p className="text-xs break-words">never break: {g.constraints}</p>}
          {(state.stall ?? 0) >= 3 && <p className="text-xs text-amber-600 dark:text-amber-400">Stalled: {state.stall} runs in a row did not move the measure closer — the next run replans first.</p>}
          {state.workflow && <p className="text-xs text-muted-foreground">each resume runs the workflow {state.workflow}{state.flow_run ? " — running now" : ""}</p>}
          {state.next && <p className="text-xs">next: {state.next}</p>}
          <Trend series={goalSeries(state)} />
          <button type="button" className={linkButton} onClick={() => setEditing(true)}>Change the goal</button>
        </section>
      ) : (
        <section className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">A standing goal: the desk keeps working toward it on its own — every run says what it did toward it, and the next run starts from there.</p>
          <SetGoal id={id} state={state} onDone={() => setEditing(false)} />
          {editing && <button type="button" className={linkButton} onClick={() => setEditing(false)}>Cancel</button>}
        </section>
      )}
      {/* 2026-10-27 request-reach: the request sits right under the goal, before the Live view, so it is reachable at 375px. */}
      {g && <RequestForm id={id} />}
      {g && live && (
        <section aria-label="Live view" className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Live view</p>
          <PreviewCard artifact={live} state={live.state} expanded />
        </section>
      )}
      {g && <Controls id={id} state={state} workflows={workflows} />}
      {g && <Plan id={id} state={state} />}
      {g && <Ledger id={id} state={state} />}
      <Frames frames={state?.frames} />
      {entries.length > 0 && <ol aria-label="Progress toward the goal, newest first" className="flex flex-col gap-1.5">{entries.map((e) => <Entry key={e.id} e={e} />)}</ol>}
    </div>
  )
}
