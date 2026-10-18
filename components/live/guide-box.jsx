"use client"

import * as React from "react"
import { CompassIcon, ListPlusIcon, MessageCircleQuestionIcon, SendIcon } from "lucide-react"

import { askChat } from "@/backend/live/agent"
import { ChatPair } from "@/components/agents/thread"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

// A message to the agent that made the call. Idle, it starts new work. Working, two ways: Guide — a note its next
// step reads, inside the run in progress (team call `guide`) — or Queue — new work it runs after the current run (a
// kernel agent runs one request at a time). Ask, idle or working (2026-10-17 owner: talk with the lead about what is
// there and what to check): a question answered here and now (team call `chat`), never a run; its run goes on.
export function GuideBox({ engine, state }) {
  const [text, setText] = React.useState("")
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [chat, setChat] = React.useState(null) // the last question asked here: {question, pending} → its outcome (askChat)
  if (!engine) return null
  const running = state?.status === "running"
  const content = text.trim()

  async function guide() {
    if (!content || busy) return
    setBusy(true)
    try {
      const { delivered } = (await engine.guide(content)) ?? {}
      if (delivered) {
        setText("")
        setNote(`Guidance for ${engine.name}: its next step reads it.`)
      } else setNote(`${engine.name} finished before your note arrived. Queue or send it as new work.`)
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }
  function queue() {
    if (!content) return
    engine.send(content)
    setNote(running ? `Queued for ${engine.name}: it runs after the current run.` : `Sent to ${engine.name}.`)
    setText("")
  }
  async function ask() {
    if (!content) return
    const question = content
    setText("")
    setNote(null)
    setChat({ question, pending: true })
    const outcome = await askChat(engine, question)
    if (outcome.error) setText((now) => now || question)
    setChat(outcome)
  }
  function submit(event) {
    event.preventDefault()
    if (running) guide()
    else queue()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-3">
      <label htmlFor="guide" className="text-xs text-muted-foreground">
        {running ? `Message ${engine.name}: guide this run (read at its next step), queue new work after it, or ask a question` : `Message ${engine.name} (idle: Send starts new work, Ask answers now)`}
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id="guide"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e)
          }}
          placeholder={running ? "A note for the run in progress" : "A message to this agent"}
          className="min-h-10 text-base md:text-sm"
        />
        {!running && (
          <Button type="submit" size="icon" className="pointer-coarse:size-10" aria-label="Send message" disabled={!content}>
            <SendIcon />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {running && (
          <>
            <Button type="submit" size="sm" className="pointer-coarse:h-10" disabled={!content || busy}>
              <CompassIcon /> Guide
            </Button>
            <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-10" disabled={!content} onClick={queue}>
              <ListPlusIcon /> Queue
            </Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-10" disabled={!content} onClick={ask} title="A question answered now; its run, if any, goes on">
          <MessageCircleQuestionIcon /> Ask
        </Button>
      </div>
      {chat && (
        <ChatPair
          engine={engine}
          question={chat.question}
          answer={chat.answer != null ? { content: chat.answer, guided: chat.guided, queued: chat.queued } : null}
          pending={!!chat.pending}
          error={chat.error}
          onDismiss={() => setChat(null)}
          className="text-xs"
        />
      )}
      {note && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {note}
        </p>
      )}
    </form>
  )
}
