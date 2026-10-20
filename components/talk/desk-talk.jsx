"use client"

import * as React from "react"
import { MessagesSquareIcon, SendIcon, XIcon } from "lucide-react"

import { contextLine } from "@/backend/live/preview"
import { latestId, openQuestions, replyTalk, seenTalk, talkTimeline, unreadCount } from "@/backend/live/talk"
import { ChatPair } from "@/components/agents/thread"
import { TalkVisual } from "@/components/talk/talk-visual"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// The talk with the desk (kernel builtin/talk.js, backend/live/talk.js; 2026-10-18 owner: "I want to talk with the desk
// to understand and guide the build. The desk should be able to talk with me too. The work and build can run in the
// background."): one timeline — what the agents tell you (talk.say) and ask you (talk.ask: pick an option or write a
// reply; it reaches the agent that asked as guidance while it runs, else as a run), and your questions to the lead with
// its answers (Ask in the box above: answered now, the run goes on). Newest at the bottom; read once shown (the
// artifact's `seen`, so every device agrees). Used by the home page under the lead's box and by the talk artifact's view.
//   talk: the talk artifact twin; engine: the lead (its chat answers, Queue it); leadMessages: the lead's state.messages

const time = (at) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function Reply({ talk, q, pointed = null, onClearPoint = () => {} }) {
  const [text, setText] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const id = React.useId()
  async function send(answer) {
    const content = String(answer ?? "").trim()
    if (!content || busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await replyTalk(talk.id, q.id, content, pointed?.context ?? null)
      setText("")
      onClearPoint()
      setNote(r?.delivered === "guided" ? `→ ${r?.keeper ?? q.from} reads it at its next step` : `→ ${r?.keeper ?? q.from} starts on it`)
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      {pointed?.context && (
        <span className="flex w-fit max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
          <span className="truncate">pointing at {contextLine(pointed.context)}</span>
          <button type="button" onClick={onClearPoint} aria-label="Drop what you pointed at" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:text-foreground pointer-coarse:size-10">
            <XIcon className="size-3" />
          </button>
        </span>
      )}
      {q.options?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <Button key={o} type="button" size="sm" variant="outline" className="h-auto min-h-8 max-w-full shrink justify-start whitespace-normal break-words py-1 text-left pointer-coarse:min-h-10" disabled={busy} onClick={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <label htmlFor={id} className="sr-only">
          Reply to {q.from}
        </label>
        <Textarea
          id={id}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send(text)
            }
          }}
          placeholder={q.options?.length ? "Or write your own reply…" : "Your reply…"}
          className="min-h-10 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="shrink-0 pointer-coarse:size-10" aria-label={`Reply to ${q.from}`} disabled={!text.trim() || busy}>
          <SendIcon />
        </Button>
      </form>
      {note && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  )
}

function DeskMessage({ talk, message: m, askedBy }) {
  const [pointed, setPointed] = React.useState(null) // what the owner clicked in the question's drawing
  if (m.kind === "reply") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] min-w-0 rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="text-[11px] opacity-80">
            You → {askedBy(m.re)} · re {m.re} · {time(m.at)}
          </p>
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          {m.context && <p className="text-[11px] opacity-80">pointing at {contextLine(m.context)}</p>}
        </div>
      </div>
    )
  }
  const ask = m.kind === "ask"
  const open = ask && m.status === "open"
  return (
    <div className={cn("min-w-0 rounded-2xl border px-3 py-2 text-sm", m.visual ? "w-full" : "max-w-[92%]", open && "border-primary")}>
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <span className="text-foreground/80">{m.from}</span>
        {ask && <span className={open ? "text-primary" : ""}>{open ? `asks you · ${m.id}` : `asked · ${m.id} · ${m.status}`}</span>}
        <span className="tabular-nums">{time(m.at)}</span>
      </p>
      <p className="whitespace-pre-wrap break-words">{m.text}</p>
      {m.visual && <TalkVisual visual={m.visual} onPoint={open ? (p) => setPointed(p?.context ? p : null) : null} />}
      {open && m.visual && <p className="pt-1 text-[11px] text-muted-foreground">Click a part of the drawing to point at it in your reply.</p>}
      {m.status === "dropped" && m.reason && <p className="text-[11px] text-muted-foreground">withdrawn: {m.reason}</p>}
      {open && <Reply talk={talk} q={m} pointed={pointed} onClearPoint={() => setPointed(null)} />}
    </div>
  )
}

export function DeskTalk({ talk, engine = null, leadMessages = [], className }) {
  const items = React.useMemo(() => talkTimeline(talk, leadMessages), [talk, leadMessages])
  const open = openQuestions(talk).length
  const unread = unreadCount(talk)
  const latest = latestId(talk)
  const list = React.useRef(null)
  const askedBy = (id) => talk?.state?.messages?.find((x) => x.id === id)?.from ?? "the desk"

  // Newest at the bottom: follow it as it comes.
  React.useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length])

  // Shown is read: the desk's messages up to the newest, once on screen a moment.
  React.useEffect(() => {
    if (!talk?.id || !latest || !unread) return
    const t = setTimeout(() => seenTalk(talk.id, latest).catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [talk?.id, latest, unread])

  if (!talk) return null
  return (
    <section className={cn("flex w-full min-w-0 flex-col gap-2 rounded-xl border px-3 py-2.5", className)} aria-label="Talk with the desk">
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessagesSquareIcon aria-hidden className="size-3.5" />
        <span className="text-foreground/80">Talk with the desk</span>
        {open > 0 && <span className="rounded-full border border-primary px-1.5 text-primary">{open} for you</span>}
        {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-primary-foreground">{unread} new</span>}
        <span className="ml-auto hidden sm:inline">the work goes on while you talk</span>
      </header>
      {items.length ? (
        <div ref={list} className="flex max-h-[28rem] min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
          {items.map((i) =>
            i.type === "desk" ? (
              <DeskMessage key={i.key} talk={talk} message={i.message} askedBy={askedBy} />
            ) : (
              <ChatPair key={i.key} engine={engine} question={i.question} answer={i.answer} taken={i.taken} />
            )
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing said yet. Ask the lead above; the desk writes here when it has a result or a question for you.</p>
      )}
    </section>
  )
}
