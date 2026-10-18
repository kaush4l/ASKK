import { ExternalLinkIcon } from "lucide-react"

import { questBrief } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { toneOf } from "@/components/views/call-look"
import { block, time } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// One call of the feed: who made it, its inputs (a quest's brief as requirement / ask / outcome), its result. A
// refused answer (kind gate) shows why the kernel refused it; guidance, the owner's note to the run in progress.
// It reads only the fields liveFeed (backend/live/follow.js) sets (2026-10-17: two lines read fields it never set and
// drew nothing; removed).
// Every field it shows goes through asText: a value the server sends as an object or list reads as JSON, never as a
// React child that blanks the page (2026-10-17: an object-valued url did).
const asText = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2))

export function CallPanel({ event }) {
  if (event.kind === "gate") return <GatePanel event={event} />
  if (event.kind === "guidance") return <GuidancePanel event={event} />
  const quest = event.view === "quest" ? questBrief(event.inputs) : null
  // A link only for a text url (2026-10-17: an object-valued url was rendered as a React child and blanked /live).
  const url = typeof event.inputs?.url === "string" && event.inputs.url.trim() ? event.inputs.url.trim() : null
  return (
    <section aria-label="Tool call" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StateMark event={event} />
        <span>{event.kind === "agent" ? `Quest to ${asText(event.name)}` : asText(event.name)}</span>
        <span className="text-xs text-muted-foreground">
          from {asText(event.agent)} · {time(event.at)}
        </span>
        {typeof event.view === "string" && event.view && <Badge variant="outline">{event.view}</Badge>}
      </header>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs break-all text-sky-500 hover:underline">
          <ExternalLinkIcon className="size-3 shrink-0" />
          {url}
        </a>
      )}
      {quest ? <div className={block}>{quest}</div> : <pre className={block}>{JSON.stringify(event.inputs, null, 2)}</pre>}
      {event.state === "done" ? (
        <>
          <p className="text-xs text-muted-foreground">Result</p>
          <pre className={cn(block, !event.ok && "text-destructive")}>{asText(event.output) || "(empty)"}</pre>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Running…</p>
      )}
    </section>
  )
}

function GatePanel({ event }) {
  return (
    <section aria-label="Refused answer" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className={toneOf(callLook({ kind: "gate" })).text}>{asText(event.name)}</span>
        <span className="text-xs text-muted-foreground">
          {asText(event.agent)} · {time(event.at)}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">The kernel did not take this answer; the agent went on working.</p>
      <pre className={block}>{asText(event.output)}</pre>
    </section>
  )
}

function GuidancePanel({ event }) {
  return (
    <section aria-label="Guidance" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span>Guidance to {asText(event.agent)}</span>
        <span className="text-xs text-muted-foreground">
          from {asText(event.from ?? "owner")} · {time(event.at)}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">A note for the run in progress: {asText(event.agent)}'s next step reads it once, without a new run.</p>
      <pre className={block}>{asText(event.output)}</pre>
    </section>
  )
}
