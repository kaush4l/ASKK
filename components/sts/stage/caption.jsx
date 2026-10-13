"use client"

import { describeActivity } from "@/backend/core/activity"
import { cn } from "@/lib/utils"

export function Caption({ state }) {
  const { phase, partial, speaking, lead, settings } = state
  if (speaking?.sentence) {
    const { sentence, word = 0 } = speaking
    const said = settings.voice === "browser" ? sentence.slice(0, word) : ""
    return (
      <p key={sentence} className="animate-in fade-in-0 slide-in-from-bottom-1 text-xl leading-snug duration-300 sm:text-2xl">
        <span>{said}</span>
        <span className={cn(said && "text-muted-foreground")}>{sentence.slice(said.length)}</span>
      </p>
    )
  }
  if (settings.listen === "wake" && (state.parts || state.armed)) {
    const { before = "", wake = "", command = null } = state.parts ?? {}
    const captured = state.armed ? state.command : null
    return (
      <p className="leading-snug">
        {before && !captured ? <span className="text-base text-muted-foreground sm:text-lg">{before}</span> : null}
        {wake ? <span className="text-xl text-fuchsia-600 sm:text-2xl dark:text-fuchsia-300">{wake} </span> : null}
        {captured != null || command != null ? (
          <span className="text-xl sm:text-2xl">
            {captured || command || <span className="text-muted-foreground">…</span>}
            <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-current" />
          </span>
        ) : null}
      </p>
    )
  }
  if (partial) {
    return (
      <p className="text-xl leading-snug sm:text-2xl">
        {partial}
        <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-current" />
      </p>
    )
  }
  if (phase === "working" && lead?.activity)
    return <p className="text-lg text-muted-foreground sm:text-xl">{describeActivity(lead.activity)}</p>
  return null
}
