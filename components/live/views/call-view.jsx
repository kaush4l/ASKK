import { CallPanel } from "@/components/live/views/call-panel"
import { FileCall } from "@/components/live/views/file-call"
import { TerminalCall } from "@/components/live/views/terminal-call"

// The followed call, rendered by its tool's view.
export function CallView({ event, events, runs, onSelect }) {
  if (!event) return <p className="text-sm text-muted-foreground">Nothing selected.</p>
  if (event.view === "terminal") return <TerminalCall key={event.id} event={event} runs={runs} />
  if (event.view === "file") return <FileCall event={event} events={events} onSelect={onSelect} />
  return <CallPanel event={event} />
}
