import { ExternalLinkIcon } from "lucide-react"

import { afterCallLabel, callArtifactId, questBrief } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { toneOf } from "@/components/views/call-look"
import { block, time } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { Badge } from "@/components/ui/badge"
import { ArtifactBlock } from "@/components/views/artifact"
import { cn } from "@/lib/utils"

// One call of the feed: who made it, its inputs (a quest's brief as requirement / ask / outcome), its result. A
// refused answer (kind gate) shows why the kernel refused it; guidance, the owner's note to the run in progress.
// It reads only the fields liveFeed (backend/live/follow.js) sets (2026-10-17: two lines read fields it never set and
// drew nothing; removed).
// Every field it shows goes through asText: a value the server sends as an object or list reads as JSON, never as a
// React child that blanks the page (2026-10-17: an object-valued url did).
const asText = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2))

export function CallPanel({ event, events = [], artifacts = {}, changes = null }) {
  if (event.kind === "gate" || event.kind === "compact") return <GatePanel event={event} />
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
      <AfterCall event={event} events={events} artifacts={artifacts} changes={changes} />
    </section>
  )
}

// 2026-10-23 owner ("the live follow showing the state after the tool call"): the artifact the call acted on, drawn by
// its view — the state this call left when no later call touched it, else the state now, saying how many came since.
function AfterCall({ event, events, artifacts, changes }) {
  const id = callArtifactId(event, artifacts)
  if (!id) return null
  const label = afterCallLabel(event, events, artifacts, changes?.get(id) ?? null)
  return (
    <div data-after-call={id} className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <ArtifactBlock artifact={artifacts[id]} expanded />
    </div>
  )
}

// A row that is no call (a refused answer, a compaction, the owner's guidance): its label, who and when, what it means, its text.
function NotePanel({ event, label, title, who, note }) {
  return (
    <section aria-label={label} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        {title}
        <span className="text-xs text-muted-foreground">
          {who} · {time(event.at)}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">{note}</p>
      <pre className={block}>{asText(event.output)}</pre>
    </section>
  )
}

const GatePanel = ({ event }) => (
  <NotePanel event={event} label="Refused answer" title={<span className={toneOf(callLook({ kind: event.kind === "compact" ? "compact" : "gate" })).text}>{asText(event.name)}</span>} who={asText(event.agent)} note={event.kind === "compact" ? "The prompt reached 90% of its budget: the run's older steps were folded into one summary; the request went on verbatim." : "The kernel did not take this answer; the agent went on working."} />
)

const GuidancePanel = ({ event }) => (
  <NotePanel event={event} label="Guidance" title={<span>Guidance to {asText(event.agent)}</span>} who={`from ${asText(event.from ?? "owner")}`} note={`A note for the run in progress: ${asText(event.agent)}'s next step reads it once, without a new run.`} />
)
