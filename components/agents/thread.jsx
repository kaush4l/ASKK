"use client"

import * as React from "react"
import { BotIcon, CheckIcon, ChevronRightIcon, ListPlusIcon, MessageCircleQuestionIcon, UserIcon, XIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { chatNote, queueProposal, threadItems } from "@/backend/live/agent"
import { eventTarget, questAsk, toolCall } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { shotSrc } from "@/backend/live/workbench"
import { TalkVisual } from "@/components/talk/talk-visual"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { cn } from "@/lib/utils"

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

// An answer the kernel refused (or a reply it could not take): the agent goes on.
const GATE = callLook({ kind: "gate" })
function GateEvent({ message }) {
  return (
    <div data-call-kind={GATE.kind} className={cn("flex items-start gap-1.5 pl-11 text-xs", toneOf(GATE).text)}>
      <CallIcon look={GATE} className="mt-0.5 size-3.5" />
      <span className="min-w-0 break-words">{message.content}</span>
    </div>
  )
}

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
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
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
          {(note || at) && (
            <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              {note && <span className="text-primary">{note}</span>}
              {at && <span className="tabular-nums">{new Date(at).toLocaleString()}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Message({ engine, message }) {
  if (message.role === "tool") return <ToolEvent engine={engine} message={message} />
  if (message.kind === "guidance") return <GuidanceEvent message={message} />
  if (message.action === "gate") return <GateEvent message={message} />
  const isUser = message.role === "user"
  const step = message.action === "tool"
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <Avatar className="size-8">
        <AvatarFallback>{isUser ? <UserIcon className="size-4" /> : <BotIcon className="size-4" />}</AvatarFallback>
      </Avatar>
      <div className={cn("flex max-w-[85%] min-w-0 flex-col gap-1.5 rounded-2xl px-4 py-2 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-muted", step && "bg-transparent border")}>
        {isUser && message.from && <span className="text-xs opacity-70">from {message.from}</span>}
        {step ? (
          <p className="font-mono text-xs break-all whitespace-pre-wrap">{message.content}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
        {message.images?.length > 0 && <SeenShots images={message.images} />}
        {message.error && <span className="text-xs text-destructive">{message.error}</span>}
        {message.at && <span className={cn("text-[10px] tabular-nums", isUser ? "opacity-60" : "text-muted-foreground")}>{new Date(message.at).toLocaleString()}</span>}
      </div>
    </div>
  )
}

// The screenshots this step's model call saw (2026-10-18 owner: "the screenshot will be included along with the next
// request … and I can also observe it"): each as the model got it, its caption under it; a click opens it whole.
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
export function Thread({ engine, messages, empty }) {
  const endRef = React.useRef(null)
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages])
  if (!messages.length) return <p className="py-12 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-col gap-4">
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
