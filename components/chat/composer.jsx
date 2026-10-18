"use client"

import * as React from "react"
import { ArrowUpIcon, CompassIcon, ListPlusIcon, MessageCircleQuestionIcon, MicIcon, MicOffIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSpeechInput } from "@/hooks/use-speech"
import { cn } from "@/lib/utils"

// The message box: a textarea with live dictation, send, and stop while the
// engine runs. Shared by the agent page and the dashboard. Controlled: the
// parent owns the text. With onGuide, a running agent can still be messaged:
// Guide (Enter) is a note its next step reads, Queue is new work after the run.
// With onAsk (2026-10-17 owner: talk with the lead about what is there and what
// to check), Ask is a question answered now, idle or running, never a run: a
// button beside Send (idle) or Guide and Queue (running) — Enter keeps its meaning.

// Live dictation into the message box. Disabled, with the reason, where the
// browser cannot transcribe speech.
function MicButton({ speech, onToggle, disabled }) {
  const { support, listening } = speech
  if (!support) return null
  const unavailable = !support.supported
  const label = unavailable ? support.reason : listening ? "Stop dictation" : "Dictate (live transcription)"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant={listening ? "destructive" : "ghost"}
            className={cn("rounded-full pointer-coarse:size-10", listening && "animate-pulse")}
            onClick={onToggle}
            disabled={unavailable || disabled}
            aria-label={label}
            aria-pressed={listening}
          />
        }
      >
        {unavailable ? <MicOffIcon /> : <MicIcon />}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Composer({
  value,
  onChange,
  onSend, // (text) => void; the box is cleared after
  onGuide, // (text) => void, while running: a note for the run in progress (beside Queue = onSend)
  onAsk, // (text) => void, idle or running: a question answered now (team call `chat`) — the run, if any, goes on
  onStop,
  running = false,
  disabled = false,
  placeholder,
  label = "Message",
  above, // rendered above the status lines (e.g. approvals)
  className,
}) {
  // Dictation goes after whatever was typed before it started.
  const dictationBase = React.useRef("")
  const speech = useSpeechInput({
    onText: (text) => onChange(dictationBase.current ? `${dictationBase.current} ${text}`.trimEnd() : text),
  })
  function toggleDictation() {
    if (!speech.listening) dictationBase.current = value.trimEnd()
    speech.toggle()
  }

  const guiding = running && !!onGuide
  // mode: "guide" (a running agent's next step reads it), "send" (new work; queued while it runs) or "ask" (a
  // question answered now, never a run).
  function send(mode = guiding ? "guide" : "send") {
    const text = value.trim()
    if (!text || disabled) return
    if (mode === "ask" ? !onAsk : running && !guiding) return
    speech.release()
    dictationBase.current = ""
    onChange("")
    if (mode === "ask") onAsk(text)
    else if (mode === "guide") onGuide(text)
    else onSend(text)
  }

  function onKeyDown(event) {
    // Enter sends, Shift+Enter inserts a newline; ignore IME composition.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      {above}
      {speech.error && <p className="px-1 pb-2 text-xs text-destructive">{speech.error}</p>}
      {speech.correctionError && <p className="px-1 pb-2 text-xs text-destructive">{speech.correctionError}</p>}
      {(speech.listening || speech.correcting) && (
        <p className="px-1 pb-2 text-xs text-muted-foreground" aria-live="polite">
          {speech.correcting ? "Punctuating…" : "Listening · punctuation is added after each pause"}
        </p>
      )}
      <div className="relative">
        <Textarea
          value={value}
          onChange={(event) => {
            // Typing takes over from dictation.
            if (speech.listening || speech.correcting) speech.release()
            onChange(event.target.value)
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={speech.listening ? "Listening…" : placeholder}
          aria-label={label}
          className="max-h-48 min-h-12 resize-none pr-22 pointer-coarse:pr-24 dark:bg-transparent"
        />
        <div className="absolute right-12 bottom-2 pointer-coarse:right-14">
          <MicButton speech={speech} onToggle={toggleDictation} disabled={disabled} />
        </div>
        {running && onStop ? (
          <Button
            type="button"
            size="icon"
            className="absolute right-2 bottom-2 rounded-full pointer-coarse:size-10"
            onClick={onStop}
            aria-label="Stop"
          >
            <SquareIcon className="fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="absolute right-2 bottom-2 rounded-full pointer-coarse:size-10"
            disabled={!value.trim() || disabled || running}
            aria-label="Send"
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
      {(guiding || onAsk) && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <span className="mr-auto min-w-0 text-xs text-muted-foreground">
            {guiding ? "Guide: read at its next step · Queue: runs after this run" : "Send: new work"}
            {onAsk ? " · Ask: answered now, no run" : ""}
          </span>
          {guiding && (
            <>
              <Button type="submit" size="sm" className="pointer-coarse:h-10" disabled={!value.trim() || disabled}>
                <CompassIcon /> Guide
              </Button>
              <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-10" disabled={!value.trim() || disabled} onClick={() => send("send")}>
                <ListPlusIcon /> Queue
              </Button>
            </>
          )}
          {onAsk && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-coarse:h-10"
              disabled={!value.trim() || disabled}
              onClick={() => send("ask")}
              title="A question answered now from what the agent sees; its run, if any, goes on"
            >
              <MessageCircleQuestionIcon /> Ask
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
