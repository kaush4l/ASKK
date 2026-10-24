"use client"

import * as React from "react"

import { loadModels, speechLines } from "@/backend/live/models"
import { cn } from "@/lib/utils"

// The desk's speech capability as it really is (2026-10-24 owner: "The desk capabilities for STT and TTS should not be
// placeholders. Show the options for both. The default model will always be on device ones"): speech to text and text
// to speech, each with the model in use and the others in models/ — chosen and tuned in the voice settings' model panel.
// Used by the header's host menu and the home page's workspace card.
export function SpeechCapability({ className }) {
  const [lines, setLines] = React.useState(null)
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    let live = true
    loadModels()
      .then((d) => live && setLines(speechLines(d)))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])
  if (error) return <p className={cn("text-xs text-destructive", className)}>Speech models not read: {error}</p>
  if (!lines) return <p className={cn("text-xs text-muted-foreground", className)}>Reading the speech models…</p>
  return (
    <ul className={cn("flex flex-col gap-1 text-xs", className)} aria-label="Speech models">
      {lines.map((l) => (
        <li key={l.kind} className="min-w-0">
          <span className="text-muted-foreground">{l.label}: </span>
          {l.inUse ? (
            <span className={l.inUse.status === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} title={l.inUse.status}>
              {l.inUse.title} (in use{l.inUse.status === "ready" ? "" : `, ${l.inUse.status}`})
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">none chosen</span>
          )}
          {l.others.length > 0 && (
            <span className="text-muted-foreground">
              {" · also "}
              {l.others.map((o, i) => (
                <span key={o.name} title={o.status}>
                  {i ? ", " : ""}
                  {o.title}
                  {o.status === "ready" ? "" : " (not installed)"}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
