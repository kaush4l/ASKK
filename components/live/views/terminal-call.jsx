import { runFor } from "@/backend/features/live/follow"
import { Badge } from "@/components/ui/badge"
import { exitBadge, Prompt, Screen } from "@/components/live/views/screen"

// Strips term.run's own first line ("$ cmd (in cwd) → exit …") from its output.
function splitTermOutput(output = "") {
  const [head, ...rest] = output.split("\n")
  return head.startsWith("$ ") ? { head, body: rest.join("\n") } : { head: null, body: output }
}

export function TerminalCall({ event, runs }) {
  const inputs = event.inputs ?? {}
  if (event.name !== "term.run") return <TermToolCall event={event} />
  // Live text: the host's stream of this run (all of it, as it prints), else
  // the call's own progress (engine state: its last 4K), else its final output.
  const run = runFor(event, runs)
  const done = event.state === "done"
  const { head, body } = done ? splitTermOutput(event.output) : { head: null, body: run?.text || event.progress?.text || "" }
  const exit = done ? head?.match(/→ exit (\d+)/)?.[1] : (event.progress?.data?.exit ?? (run?.done ? run.exit : null))
  return (
    <Screen
      title={
        <>
          <span>{event.agent}</span>
          <span className="font-mono break-all">~/{inputs.cwd && inputs.cwd !== "." ? inputs.cwd : ""}</span>
        </>
      }
      status={
        <>
          {event.state === "running" && (body ? "running" : "starting…")}
          {event.state === "approval" && "waiting for approval"}
          {exitBadge(exit)}
          {done && !event.ok && !head && <Badge variant="destructive">failed</Badge>}
        </>
      }
      footer={head}
      text={body || (done ? "(no output)" : "")}
      live={event.state === "running"}
    >
      <Prompt command={inputs.command} />
    </Screen>
  )
}

// term.start / ps / logs / stop: the call, then its answer, as terminal text.
function TermToolCall({ event }) {
  const inputs = event.inputs ?? {}
  const line = event.name === "term.start" ? `start ${inputs.name ? `[${inputs.name}] ` : ""}${inputs.command}` : `${event.name.slice(5)} ${inputs.id ?? ""}`
  return (
    <Screen
      title={<span>{event.agent}</span>}
      status={event.state === "done" ? (event.ok ? <Badge variant="secondary">ok</Badge> : <Badge variant="destructive">failed</Badge>) : event.state}
      text={event.state === "done" ? event.output : ""}
      live={event.state === "running"}
    >
      <span className="text-sky-400">● </span>
      <span>{line}</span>
      {"\n"}
    </Screen>
  )
}
