"use client"

import * as React from "react"
import { SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

// A word to the agent that made the call: guidance on its work in progress
// (seen at its next step, nothing stops), or a new message when it is idle.
export function GuideBox({ engine, state }) {
  const [text, setText] = React.useState("")
  const [note, setNote] = React.useState(null)
  if (!engine) return null
  const running = state?.status === "running"
  async function submit(event) {
    event.preventDefault()
    const content = text.trim()
    if (!content) return
    try {
      if (running) {
        const result = await engine.guide(content)
        if (result?.delivered === false) {
          engine.send(content)
          setNote(`${engine.name} had finished; sent as a new message.`)
        } else setNote(`Guidance sent to ${engine.name}: it sees it at its next step.`)
      } else {
        engine.send(content)
        setNote(`Sent to ${engine.name}.`)
      }
      setText("")
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-3">
      <label htmlFor="guide" className="text-xs text-muted-foreground">
        {running ? `Guide ${engine.name} (seen at its next step, nothing stops)` : `Message ${engine.name} (idle: starts new work)`}
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
          placeholder={running ? "e.g. Use pathlib, not os.path; run the tests before the next file." : "A message to this agent"}
          className="min-h-10 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="pointer-coarse:size-10" aria-label={running ? "Send guidance" : "Send message"} disabled={!text.trim()}>
          <SendIcon />
        </Button>
      </div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </form>
  )
}
