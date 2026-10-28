"use client"

import * as React from "react"
import { LoaderIcon, SquareIcon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { detectHost, hasCapability } from "@/backend/live/host"
import { playAnswer } from "@/backend/live/speak"
import { PHONE_TAP } from "@/lib/tap-target"
import { cn } from "@/lib/utils"
import { speakLook, speakText } from "./speak-look"

const ICONS = { speak: Volume2Icon, busy: LoaderIcon, stop: SquareIcon, off: VolumeXIcon }

// The speaker on an answer (voice-out, 2026-10-27): the host speaks the text (kernel speech.say's path, backend/live/speak.js);
// a second click stops. Off (VolumeX, disabled) where the host has no capability "speech" (macOS only).
export function SpeakButton({ text, className }) {
  const [speech, setSpeech] = React.useState(null)
  const [state, setState] = React.useState("idle")
  const [error, setError] = React.useState(null)
  const run = React.useRef(null)
  React.useEffect(() => {
    let on = true
    detectHost().then((h) => on && setSpeech(hasCapability(h, "speech")), () => on && setSpeech(false))
    return () => ((on = false), run.current?.abort())
  }, [])
  if (!text?.trim()) return null
  const look = speakLook({ state, speech, error })
  const Icon = ICONS[look.icon]
  const click = () => {
    if (state === "loading" || state === "playing") return run.current?.abort()
    const ctl = new AbortController()
    run.current = ctl
    setError(null)
    setState("loading")
    playAnswer(speakText(text), { signal: ctl.signal, onPlay: () => setState("playing") }).then(
      () => setState("idle"),
      (e) => (ctl.signal.aborted ? setState("idle") : (setError(e?.message ?? String(e)), setState("failed"))),
    )
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <button type="button" data-speak onClick={click} disabled={look.disabled} aria-label={look.label} title={look.title} className={cn("-my-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground disabled:opacity-40 pointer-coarse:size-10", PHONE_TAP)}>
        <Icon className={cn("size-3.5", look.icon === "busy" && "motion-safe:animate-spin")} />
      </button>
      {look.line && <span className="min-w-0 truncate text-xs text-destructive" title={look.title}>{look.line}</span>}
    </span>
  )
}
