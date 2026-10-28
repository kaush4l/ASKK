"use client"

import * as React from "react"
import { BotIcon, CheckIcon, ChevronRightIcon, ListPlusIcon, MessageCircleQuestionIcon, UserIcon, XIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { chatNote, olderLabel, queueProposal, threadItems } from "@/backend/live/agent"
import { eventTarget, questAsk, toolCall } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { shotSrc } from "@/backend/live/workbench"
import { duration } from "@/components/live/format"
import { TalkVisual } from "@/components/talk/talk-visual"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { cn } from "@/lib/utils"
import { Rewritten } from "@/components/input/rewritten"
import { SpeakButton } from "./speak-button"
import { bubbleClasses, capClasses, capEdge, stepLoadLabel } from "./thread-bubble"

// One agent's runs as a thread, from its kernel messages (companion/team/kernel-team.js): the request (the owner's,
// or a quest from the agent above, the schedule, a wake, Telegram), each step (its thought and calls), each call's
// result, answers the kernel refused (gate), the owner's guidance to the run in progress, and the answer. Calls, gates
// and guidance look as they do in the Live feed and on the canvas: callLook (backend/live/visual.js) by call kind.
// 2026-10-17: the owner's chats (team call `chat`: a question answered beside the run) as one compact Q/A row each;
// work an answer proposes waits for the owner's "Queue it" (amendment M1).

function Detail({ label, children, mono = false }) {
  return (
    <Collapsible className="text-xs text-muted-foreground">
      <CollapsibleTrigger className="flex min-h-8 items-center gap-1 hover:text-foreground [&[data-panel-open]>svg]:rotate-90">
        <ChevronRightIcon className="size-3 transition-transform" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("mt-1 max-h-80 overflow-auto border-l pl-3 whitespace-pre-wrap break-words", mono && "font-mono text-[11px] leading-relaxed")}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

// A call's result: the call kind's icon, one line saying whether it succeeded (a quest's report for a sub-agent) with
// a mark for it, the call it answers in one line (its inputs as the Live feed summarises them: eventTarget — a
// search's terms, a quest's ask, else the first input fields), output on demand. (2026-10-17: parallel web.search
// rows all read "web.search answered" and never said which query each one answered.)
function ToolEvent({ engine, message }) {
  const { name, kind, ok, output, view } = message
  const look = callLook(toolCall(engine, message))
  const target = eventTarget({ kind, inputs: message.inputs })
  return (
    <div data-call-kind={look.kind} data-ok={ok ? "true" : "false"} className="flex min-w-0 flex-col gap-1 pl-11 text-xs">
      <div className={cn("flex min-w-0 items-center gap-1.5", ok ? "text-muted-foreground" : "text-destructive")}>
        <CallIcon look={look} className="size-3.5" />
        <span className="min-w-0 break-words">
          {kind === "agent" ? `Report from ${name}` : `${name} ${ok ? "answered" : "failed"}`}
          {view && view !== "data" ? <span className="ml-1 rounded border px-1 text-[10px]">{view}</span> : null}
        </span>
        {ok ? <CheckIcon aria-label="answered" className="size-3 shrink-0" /> : <XIcon aria-label="failed" className="size-3 shrink-0" />}
        {message.ms != null && <span data-call-ms className="shrink-0 tabular-nums">{duration(message.ms)}</span>}
      </div>
      {target && (
        <p data-call-target title={target} className="min-w-0 truncate pl-5 font-mono text-[11px] text-muted-foreground">
          {kind === "agent" && questAsk(message.inputs) != null ? "ask: " : ""}
          {target}
        </p>
      )}
      {output && <Detail label={kind === "agent" ? "Report" : "Output"}>{output}</Detail>}
    </div>
  )
}

// A one-line note in the thread (a refused answer, a lifecycle event, a refresh): the call kind's icon, then the words.
function Note({ look, className, children, ...data }) {
  return (
    <div data-call-kind={look.kind} className={cn("flex items-start gap-1.5 pl-11 text-xs", className)} {...data}>
      <CallIcon look={look} className="mt-0.5 size-3.5" />
      {children}
    </div>
  )
}

// An answer the kernel refused (or a reply it could not take): the agent goes on.
const GATE = callLook({ kind: "gate" })
const GateEvent = ({ message }) => (
  <Note look={GATE} className={toneOf(GATE).text}>
    <span className="min-w-0 break-words">{message.content}</span>
  </Note>
)

// The prompt reached 90% of its budget and the run's older work was folded into one summary (kernel event compact).
const COMPACT = callLook({ kind: "compact" })
// 2026-10-23: the numbers themselves (row `compact`), not only the line — how full the prompt was, what it came to, what
// folded, and how (a model summary, else clipped in code).
const kChars = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n ?? 0))
function CompactEvent({ message }) {
  const c = message.compact
  const pct = c?.budget ? Math.round((c.before_chars / c.budget) * 100) : null
  return (
    <div data-call-kind={COMPACT.kind} className={cn("flex min-w-0 flex-col gap-1 pl-11 text-xs", toneOf(COMPACT).text)}>
      <div className="flex items-start gap-1.5">
        <CallIcon look={COMPACT} className="mt-0.5 size-3.5" />
        <span className="min-w-0 break-words">{c ? "Prompt compacted" : message.content}</span>
      </div>
      {c && (
        <div data-compact className="flex min-w-0 flex-wrap gap-1.5 pl-5 font-mono text-[11px] text-muted-foreground">
          {[
            `${kChars(c.before_chars)} → ${kChars(c.after_chars)} chars`,
            pct != null && `${pct}% of ${kChars(c.budget)}`,
            c.steps_folded > 0 && `${c.steps_folded} steps folded`,
            c.runs_folded > 0 && `${c.runs_folded} earlier runs folded`,
            `${c.mode === "model" ? "model summary" : "clipped in code"}${c.ms != null ? ` · ${duration(c.ms)}` : ""}`,
            c.n != null && `before step ${c.n}`,
          ].filter(Boolean).map((chip) => <span key={chip} className="rounded border px-1.5 tabular-nums">{chip}</span>)}
          {c.error && <span className="text-destructive">summary failed: {c.error}</span>}
        </div>
      )}
    </div>
  )
}

// The desk's own events (2026-10-23: kernel Desk spawn | dismiss | keep | proposal) in the thread of the agent that
// caused them: a helper made or let go, kept, or proposed — the tree changes, and the thread says when.
const LIFECYCLE = callLook({ kind: "spawn" })
function LifecycleEvent({ message }) {
  return (
    <Note look={LIFECYCLE} data-lifecycle={message.kind} className={cn("flex-wrap", toneOf(LIFECYCLE).text)}>
      <span className="min-w-0 break-words">{message.content}</span>
      {message.keep && <span className="rounded border px-1 text-[10px]">keep {message.keep}</span>}
      {message.team && message.team !== message.agent && <span className="rounded border px-1 text-[10px]">team {message.team}</span>}
      {message.goal && !String(message.content ?? "").includes(message.goal) && <span className="w-full pl-5 break-words text-muted-foreground">goal: {message.goal}</span>}
    </Note>
  )
}

// An artifact's refresh before a step failed — the step used its last state — or came back (2026-10-23, kernel event
// refresh; before, only the prompt said so).
const REFRESH = callLook({ type: "artifact" })
const RefreshEvent = ({ message }) => (
  <Note look={REFRESH} data-refresh={message.ok ? "ok" : "failed"} className={message.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}>
    <span className="min-w-0 break-words">{message.content}</span>
  </Note>
)

// Guidance for the run in progress (team call `guide`): no new run — the agent's next step reads it once.
const GUIDANCE = callLook({ kind: "guidance" })
function GuidanceEvent({ message }) {
  return (
    <div data-call-kind={GUIDANCE.kind} className="flex flex-row-reverse gap-3">
      <Avatar className="size-8">
        <AvatarFallback>
          <CallIcon look={GUIDANCE} className="size-4" />
        </AvatarFallback>
      </Avatar>
      <div className="flex max-w-[85%] min-w-0 flex-col gap-1 rounded-2xl border border-primary/60 px-4 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Guidance{message.from && message.from !== "owner" ? ` from ${message.from}` : ""} · read at the next step</span>
        <p className="max-h-[50svh] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words">{message.content}</p>
        {message.at && <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(message.at).toLocaleString()}</span>}
      </div>
    </div>
  )
}

// The work a chat answer proposed (2026-10-17, amendment M1: the host never starts a run from a chat): the owner starts
// it with one click — "Queue it" sends it as new work (queueProposal → engine.send: it runs now, or after the run in
// progress). taken: a later run request already says it (threadItems), so no second click is offered.
function ProposedWork({ engine, proposed, taken = false, onQueued }) {
  const [sent, setSent] = React.useState({ busy: false, sent: null, error: null })
  const done = taken || !!sent.sent
  async function queue() {
    if (sent.busy || done) return
    setSent({ busy: true, sent: null, error: null })
    const out = await queueProposal(engine, proposed)
    setSent({ busy: false, ...out })
    if (out.sent) onQueued?.(out.sent)
  }
  return (
    <div data-proposed className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <p className="min-w-0 flex-1 basis-48 break-words text-muted-foreground">
        <span className="text-foreground/80">Proposed work:</span> {proposed}
      </p>
      {done ? (
        <span className="text-primary">→ queued as new work{engine?.name ? ` for ${engine.name}` : ""}</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="pointer-coarse:h-10 pointer-coarse:px-3"
          disabled={sent.busy || !engine}
          onClick={queue}
          title={`Send this to ${engine?.name ?? "the agent"} as new work: it runs now, or after the run in progress`}
        >
          <ListPlusIcon /> {sent.busy ? "Queueing…" : "Queue it"}
        </Button>
      )}
      {sent.error && <p className="basis-full text-destructive">Not queued: {sent.error}</p>}
    </div>
  )
}

// An owner chat (kind chat): the question and the agent's answer as one compact row — no run started (ChatPair also
// draws the inline answer under the home page's and the Live page's Ask). pending: asked, no answer yet. Under the
// answer: "→ added to the run as guidance" when its GUIDE: line reached the run, else the work it proposed with
// "Queue it" (taken: already queued; onQueued(text) once the owner queued it here).
//   question / answer: { content, from?, at?, guided?, proposed? } (thread rows; chatAnswer for an askChat outcome),
//   or plain text
export function ChatPair({ engine, question, answer, pending = false, error = null, taken = false, onQueued, onDismiss, className }) {
  const q = typeof question === "string" ? { content: question } : question
  const a = typeof answer === "string" ? { content: answer } : answer
  const note = a ? chatNote(a) : null
  const at = a?.at ?? q?.at
  return (
    <div data-chat className={cn("flex min-w-0 flex-col gap-1 rounded-xl border border-dashed px-3 py-2 text-sm", className)} aria-live="polite">
      <div className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
        <MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <span className="text-foreground/80">{q?.from && q.from !== "owner" ? q.from : "You"} asked:</span> {q?.content ?? "(question not kept)"}
        </p>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss the answer" className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground pointer-coarse:size-10">
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      {pending && <p className="pl-5 text-xs text-muted-foreground motion-safe:animate-pulse">{engine?.name ?? "The agent"} is reading the desk to answer… its run goes on.</p>}
      {error && <p className="pl-5 text-xs text-destructive">Not answered: {error}</p>}
      {a && (
        <div className="flex min-w-0 flex-col gap-1 pl-5">
          <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words">
            {engine?.name && <span className="text-xs text-muted-foreground">{engine.name}: </span>}
            {a.content || "(no answer)"}
          </p>
          {(a.visual || a.visualError) && <TalkVisual visual={a.visual} error={a.visualError} />}
          {a.proposed && <ProposedWork engine={engine} proposed={a.proposed} taken={taken} onQueued={onQueued} />}
          {(note || at || a.content) && (
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {a.content && <SpeakButton text={a.content} />}
              {note && <span className="text-primary">{note}</span>}
              {at && <span className="tabular-nums">{new Date(at).toLocaleString()}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// A message's text never grows past half the viewport (2026-10-22 owner, a workflow step agent's thread: "Limit the size
// to a view point and make the internal content scroll area"): a step's 70k-char request or its long answer scrolls inside
// its bubble, so the thread stays a list of turns.
// 2026-10-26 bubble-scroll-fade: while more text waits below, the bottom fades (capClasses); at its end, or when it fits,
// the edge is plain. Capped measures itself (capEdge) on render, on resize and as it scrolls.
function Capped({ className, children, ...props }) {
  const ref = React.useRef(null)
  const [edge, setEdge] = React.useState({ overflowing: false, atEnd: true })
  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = capEdge(el)
    setEdge((e) => (e.overflowing === next.overflowing && e.atEnd === next.atEnd ? e : next))
  }, [])
  React.useLayoutEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, children])
  return <p ref={ref} onScroll={measure} className={cn(className, capClasses(edge))} {...props}>{children}</p>
}

// A step the snapshot sent cut (snapshot-steps-lean): one 40px control that loads the whole row through the agent call `older`.
// 2026-10-26 full-step-failed-note: a load that resolves false or rejects says "Not loaded…" beside the button, which
// stays enabled so the owner can try again.
function FullStep({ engine, id }) {
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const load = () => {
    setFailed(false)
    setLoading(true)
    Promise.resolve()
      .then(() => engine.loadStep(id))
      .then((ok) => { if (ok === false) setFailed(true) })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }
  const label = stepLoadLabel({ loading })
  const note = stepLoadLabel({ failed: true })
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button variant="outline" size="xs" className="min-h-10 self-start" disabled={loading || !engine?.loadStep} onClick={load}>
        {label.text}
      </Button>
      {failed && !loading && <span role="status" className={cn("text-xs", note.className)}>{note.text}</span>}
    </div>
  )
}

function Message({ engine, message }) {
  if (message.role === "tool") return <ToolEvent engine={engine} message={message} />
  if (message.kind === "guidance") return <GuidanceEvent message={message} />
  if (message.action === "gate") return <GateEvent message={message} />
  if (message.action === "compact") return <CompactEvent message={message} />
  if (message.action === "lifecycle") return <LifecycleEvent message={message} />
  if (message.action === "refresh") return <RefreshEvent message={message} />
  const isUser = message.role === "user"
  const step = message.action === "tool"
  const cls = bubbleClasses({ isUser, step })
  return (
    <div className={cls.row}>
      <Avatar className={cls.avatar}>
        <AvatarFallback>{isUser ? <UserIcon className="size-4" /> : <BotIcon className="size-4" />}</AvatarFallback>
      </Avatar>
      <div className={cn("flex max-w-[85%] min-w-0 flex-col gap-1.5 rounded-2xl px-4 py-2 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-muted", step && "bg-transparent border")}>
        {isUser && message.from && <span className="text-xs opacity-70">from {message.from}</span>}
        <Capped className={cls.text}>{message.content}</Capped>
        {step && message.contentCut && <FullStep engine={engine} id={message.id} />}
        {isUser && message.original && <Rewritten original={message.original} rewrite={message.rewrite} />}
        {step && message.answer != null && <Capped data-step-answer className="border-l-2 border-amber-500/60 pl-2 text-xs break-words whitespace-pre-wrap">answer written beside its calls: {message.answer}</Capped>}
        {message.route && <RouteChip route={message.route} />}
        {message.images?.length > 0 && <SeenShots images={message.images} />}
        {message.flags?.length > 0 && (
          <span data-answer-flags className="text-xs text-amber-700 dark:text-amber-300">
            Went through with open gates (after the retries): {message.flags.join("; ")}
          </span>
        )}
        {message.error && <span className="text-xs text-destructive">{message.error}</span>}
        {!isUser && !step && message.content && <SpeakButton text={message.content} className="self-start text-[11px] text-muted-foreground" />}
        {message.at && (
          <span className={cn("text-[10px] tabular-nums", isUser ? "opacity-60" : "text-muted-foreground")}>
            {new Date(message.at).toLocaleString()}
            {step && message.n != null ? <span data-step-n> · step {message.n}</span> : null}
            {step && message.ms != null ? <span data-step-ms> · model {duration(message.ms)}</span> : null}
          </span>
        )}
      </div>
    </div>
  )
}

// The screenshots this step's model call saw (2026-10-18 owner: "the screenshot will be included along with the next
// request … and I can also observe it"): each as the model got it, its caption under it; a click opens it whole.
// 2026-10-27 step router (docs/jepa-router.md): what the router predicted for this step — acted (no model call)
// or shadow (recorded beside the model's own choice, agreeing or not).
function RouteChip({ route }) {
  const tools = route.predicted?.join(", ")
  const text = route.acted ? `script route · ${tools}` : route.mode === "script" ? `router shadow · ${tools} · ${route.agree ? "agrees" : "differs"}` : "router · big"
  return <div className="mt-1 text-xs text-muted-foreground">{text}{route.p != null ? ` · p ${Number(route.p).toFixed(2)}` : ""}</div>
}

function SeenShots({ images }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {images.map((img, i) => {
        const src = shotSrc(img)
        return (
          <figure key={`${img.page ?? ""}-${img.n ?? i}`} className="flex max-w-full min-w-0 flex-col gap-0.5 sm:max-w-80">
            {src ? (
              <a href={src} target="_blank" rel="noreferrer" aria-label={`Open screenshot ${img.n ?? ""} the model saw`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export) */}
                <img src={src} alt={img.caption || "a screenshot the model saw"} loading="lazy" className="h-auto max-h-48 w-full rounded-md border object-contain object-left-top" />
              </a>
            ) : null}
            <figcaption className="text-[10px] break-words text-muted-foreground">model saw: {img.caption || `screenshot ${img.n ?? ""}`}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}

// What the agent does right now, while it works (also while it waits for its sub-agents' reports).
export function ActivityLine({ engine, activity }) {
  if (!activity || activity.phase === "idle") return null
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
      <span className="min-w-0 truncate">
        {engine.name} · {describeActivity(activity)}
      </span>
    </div>
  )
}

// engine: the agent (its tool specs give each call's type, as in the Live feed).
// The rows the snapshot left out (snapshot-thread-tail): one button that loads them through the agent call `older`.
function OlderRows({ engine, skipped }) {
  const [loading, setLoading] = React.useState(false)
  const label = olderLabel(skipped)
  if (!label) return null
  const load = () => {
    setLoading(true)
    engine.loadOlder().catch(() => {}).finally(() => setLoading(false))
  }
  return (
    <Button variant="outline" size="sm" className="min-h-10 self-center sm:min-h-8" disabled={loading} onClick={load}>
      {loading ? "Loading…" : label}
    </Button>
  )
}

// skipped: the rows before these the snapshot left out (state.messagesSkipped).
export function Thread({ engine, messages, empty, skipped = 0 }) {
  const endRef = React.useRef(null)
  const last = messages.at(-1)
  // the newest row, not every change: older rows put before the thread keep the reader where they are
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [last])
  if (!messages.length) return <p className="py-12 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-col gap-4">
      <OlderRows engine={engine} skipped={skipped} />
      {threadItems(messages).map((item, i) =>
        item.type === "chat" ? (
          <ChatPair key={item.id ?? `chat-${i}`} engine={engine} question={item.question} answer={item.answer} taken={item.taken} className="self-stretch sm:mx-11" />
        ) : (
          <Message key={item.message.id ?? i} engine={engine} message={item.message} />
        )
      )}
      <div ref={endRef} />
    </div>
  )
}
