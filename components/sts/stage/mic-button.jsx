"use client"

import * as React from "react"
import { MicIcon, MicOffIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function MicButton({ state, model }) {
  const { listening, settings, phase } = state
  const push = listening && settings.listen !== "wake" && settings.mode === "push" && settings.asr === "mac"
  const holding = React.useRef(false)
  const down = (e) => {
    if (!push) return
    e.preventDefault()
    holding.current = true
    model.hold(true)
  }
  const up = () => {
    if (!holding.current) return
    holding.current = false
    model.hold(false)
  }
  return (
    <button
      type="button"
      onClick={() => !push && (listening ? model.stop() : model.start())}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      aria-pressed={listening}
      aria-label={push ? "Hold to talk" : listening ? "Stop listening" : "Start listening"}
      className={cn(
        "relative grid size-20 touch-none place-items-center rounded-full border-2 transition-all duration-300 outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-95",
        listening ? "border-sky-400 text-sky-600 dark:text-sky-300" : "border-border text-muted-foreground hover:text-foreground",
        phase === "hearing" && "scale-110 border-cyan-400 shadow-[0_0_40px_-6px] shadow-cyan-400/70",
      )}
    >
      {listening ? <MicIcon className="size-8" /> : <MicOffIcon className="size-8" />}
      {listening && phase === "listening" ? (
        <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/40 [animation-duration:2.4s]" />
      ) : null}
    </button>
  )
}
