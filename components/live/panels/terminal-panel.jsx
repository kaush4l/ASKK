import { Badge } from "@/components/ui/badge"
import { exitBadge, Prompt, Screen } from "@/components/live/views/screen"
import { TerminalCall } from "@/components/live/views/terminal-call"
import { LIMITS } from "@/lib/config"

// Background processes (term.start) and recent runs, from the host's stream.
export function TerminalView({ terminal, events, snapshot }) {
  const live = events.filter((e) => e.name === "term.run" && e.state !== "done")
  // Runs seen on the stream since this page opened, else the last runs the
  // terminal artifact published.
  const streamed = terminal.runs.filter((r) => r.done).slice(-LIMITS.ui.live.terminalRecentRuns).reverse()
  const published = (snapshot?.data?.runs ?? []).map((r) => ({ id: `${r.at}-${r.command}`, agent: r.agent, command: r.command, exit: r.exit, text: r.tail ?? "" })).reverse()
  const recent = streamed.length ? streamed : published
  const procs = [...terminal.procs].reverse()
  if (!terminal.available && !snapshot) return <p className="text-sm text-muted-foreground">This desk has no terminal.</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {live.map((event) => (
        <div key={event.id} className="flex min-h-48 flex-col">
          <TerminalCall event={event} runs={terminal.runs} />
        </div>
      ))}
      <section aria-label="Background processes" className="flex flex-col gap-2">
        <h2 className="text-sm">Background processes</h2>
        {!procs.length && <p className="text-xs text-muted-foreground">None running. Agents start servers with term.start.</p>}
        {procs.map((proc) => (
          <div key={proc.id} className="flex min-h-40 flex-col">
            <Screen
              title={
                <>
                  <span>{proc.name ?? proc.id}</span>
                  <span className="font-mono break-all">{proc.command}</span>
                </>
              }
              status={
                <>
                  {(proc.urls ?? []).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                      {u}
                    </a>
                  ))}
                  <Badge variant={proc.status === "running" ? "secondary" : "outline"}>{proc.status === "running" ? "running" : `exited ${proc.exit ?? ""}`}</Badge>
                </>
              }
              text={proc.text}
              live={proc.status === "running"}
            />
          </div>
        ))}
      </section>
      <section aria-label="Recent runs" className="flex flex-col gap-2">
        <h2 className="text-sm">Recent runs</h2>
        {!recent.length && <p className="text-xs text-muted-foreground">No runs yet.</p>}
        {recent.map((run) => (
          <div key={run.id} className="flex max-h-60 min-h-24 flex-col">
            <Screen title={<span>{run.agent}</span>} status={exitBadge(run.exit)} text={run.text}>
              <Prompt command={run.command} />
            </Screen>
          </div>
        ))}
      </section>
    </div>
  )
}
