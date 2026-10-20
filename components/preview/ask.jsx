"use client"

import * as React from "react"
import { SendIcon, XIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { askable, askPreview, askThread, contextLine, onKey, onLine } from "@/backend/live/preview"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useEngines, useEngineState } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The owner's side of the one preview pane (2026-10-17 owner: "I can ask follow up questions and agent can update
// visuals and answer me as well"): the questions asked about what is in the pane — the open ones, and the last answers
// (a click shows the item an answer points to) — and the ask box. A question goes with the item in the pane and what
// the owner pointed at (an element of a visual, or of a framed page); the keeper answers on the preview (guidance while
// it runs, else a new run — the host decides, companion/team/kernel-team.js) with preview.answer and a visual.

const RECENT = 3 // answered questions kept under the open ones

// Open questions and the recent answers, oldest first.
export function PreviewQuestions({ state, onShow }) {
  const all = askThread(state)
  const answered = all.filter((a) => !a.open).slice(-RECENT)
  const thread = all.filter((a) => a.open || answered.includes(a))
  if (!thread.length) return null
  return (
    <section aria-label="Questions on the preview" className="flex flex-col gap-2">
      {thread.map((a) => {
        const key = a.open ? null : onKey(state, a.answer.on)
        return (
          <div key={a.id} className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="break-words">
              <span className="text-[11px] text-muted-foreground">
                {a.id} · you{a.on ? ` on ${onLine(a.on)}` : ""}
                {a.context ? ` (${contextLine(a.context)})` : ""}
              </span>
              <br />
              {a.text}
            </p>
            {a.open ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">waiting for the answer…</p>
            ) : key ? (
              <button
                type="button"
                onClick={() => onShow(key)}
                className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-left hover:border-foreground/40 pointer-coarse:min-h-10"
                title={`Show ${onLine(a.answer.on)}`}
              >
                <span className="whitespace-pre-wrap break-words">{a.answer.text}</span>
                <span className="text-[11px] text-muted-foreground">
                  {a.answer.by ? `${a.answer.by} · ` : ""}show {onLine(a.answer.on)}
                </span>
              </button>
            ) : (
              <div className="rounded-md border px-2 py-1.5">
                <p className="whitespace-pre-wrap break-words">{a.answer.text}</p>
                {a.answer.by && <p className="mt-1 text-[11px] text-muted-foreground">{a.answer.by}</p>}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// The ask box: about the item in the pane (`item`: {kind, id, title}), with what the owner pointed at as a chip.
export function PreviewAsk({ artifact, item, pointed, onClearPoint }) {
  const state = artifact?.state
  const { engines } = useEngines()
  const keeperName = artifact?.holders?.[0] ?? null
  const keeper = engines.find((e) => e.name === keeperName) ?? null
  const keeperState = useEngineState(keeper)
  const [text, setText] = React.useState("")
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const box = React.useRef(null)
  const id = React.useId()
  React.useEffect(() => {
    if (!pointed) return
    if (pointed.text) setText((t) => t || pointed.text)
    box.current?.focus({ preventScroll: true })
  }, [pointed])
  const content = text.trim()
  const who = keeper?.name ?? keeperName ?? "the lead"
  const running = keeperState?.status === "running"

  if (!askable(state)) {
    return <p className="text-[11px] text-muted-foreground">This desk&apos;s preview takes questions once the desk server restarts on the new preview.</p>
  }

  async function submit(event) {
    event.preventDefault()
    if (!content || busy || !artifact?.id) return
    setBusy(true)
    setNote(null)
    try {
      const r = await askPreview(artifact.id, { text: content, on: item ? { kind: item.kind, id: item.id } : null, context: pointed?.context ?? null })
      setText("")
      onClearPoint()
      const name = r?.keeper ?? who
      setNote(r?.delivered === "guided" ? `${r?.ask?.id ?? "Asked"}: ${name} reads it at its next step and answers here.` : `${r?.ask?.id ?? "Asked"}: ${name} starts on it and answers here.`)
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Ask {who} about {item ? `“${item.title}”` : "the preview"}
        {running ? ` — ${describeActivity(keeperState?.activity) || "working"}; your question joins its run` : ""}
      </label>
      {pointed?.context && (
        <span className="flex w-fit max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
          <span className="truncate">pointing at {contextLine(pointed.context)}</span>
          <button type="button" onClick={onClearPoint} aria-label="Drop what you pointed at" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:text-foreground pointer-coarse:size-10">
            <XIcon className="size-3" />
          </button>
        </span>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          id={id}
          ref={box}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e)
          }}
          placeholder={item?.kind === "page" ? "What changed on this page?" : "Why does this step take longest?"}
          className="min-h-10 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className={cn("shrink-0 pointer-coarse:size-10")} aria-label="Ask about what is in the preview" disabled={!content || busy}>
          <SendIcon />
        </Button>
      </div>
      {note && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {note}
        </p>
      )}
    </form>
  )
}
