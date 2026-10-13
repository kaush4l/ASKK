"use client"

import * as React from "react"
import { BotIcon } from "lucide-react"

import { TeamStrip } from "@/components/sts/timeline/team-strip"
import { Turn } from "@/components/sts/timeline/turn"

// The conversation: what you said, what it did, what it answered.
export function Timeline({ state }) {
  const endRef = React.useRef(null)
  const count = state.turns.length
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [count])
  return (
    <section className="flex min-h-[50svh] min-w-0 flex-1 flex-col lg:min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <h2 className="text-lg">Conversation</h2>
        <span className="ml-auto text-xs text-muted-foreground">{count} events</span>
      </div>
      <TeamStrip />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {count === 0 ? (
          <p className="pt-8 text-center text-sm text-muted-foreground">
            What you say goes to the lead. Its progress is spoken as it works, then its answer.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {state.turns.map((turn) => (
              <Turn key={turn.id} turn={turn} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </section>
  )
}
