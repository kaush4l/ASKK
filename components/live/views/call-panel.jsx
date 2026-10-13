import { ExternalLinkIcon } from "lucide-react"

import { block, time } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function CallPanel({ event }) {
  const quest = event.view === "quest" ? (event.inputs?.quest ?? event.inputs?.guidance) : null
  const url = event.inputs?.url
  return (
    <section aria-label="Tool call" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StateMark event={event} />
        <span>{event.kind === "agent" ? `Quest to ${event.name}` : event.name}</span>
        <span className="text-xs text-muted-foreground">
          from {event.agent} · {time(event.at)}
        </span>
        {!event.view && <Badge variant="outline">log only</Badge>}
      </header>
      {event.summary && <p className="text-sm break-words">{event.summary}</p>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs break-all text-sky-500 hover:underline">
          <ExternalLinkIcon className="size-3 shrink-0" />
          {url}
        </a>
      )}
      {quest ? <div className={block}>{quest}</div> : <pre className={block}>{JSON.stringify(event.inputs, null, 2)}</pre>}
      {event.progress?.text && event.state !== "done" && <pre className={block}>{event.progress.text}</pre>}
      {event.state === "done" ? (
        <>
          <p className="text-xs text-muted-foreground">Result</p>
          <pre className={cn(block, !event.ok && "text-destructive")}>{event.output || "(empty)"}</pre>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{event.state === "approval" ? "Waiting for the owner's approval in the chat." : "Running…"}</p>
      )}
    </section>
  )
}
