import { snapshotLabel } from "@/components/live/format"
import { cn } from "@/lib/utils"

// live.team (TeamArtifact.live()): the sub-agents this agent created — kept or
// task, working or idle, tools — and the ones ended lately.
export function TeamView({ snapshot }) {
  const items = snapshot?.data?.items ?? []
  const alive = items.filter((i) => !i.name.endsWith(" (ended)"))
  const ended = items.filter((i) => i.name.endsWith(" (ended)"))
  return (
    <div className="flex flex-col gap-3 overflow-auto text-xs">
      <p className="text-[11px] text-muted-foreground">{snapshotLabel(snapshot)}</p>
      {!alive.length && <p className="text-muted-foreground">No sub-agents alive. agent.spawn creates one.</p>}
      {alive.map(({ name, detail = {} }) => (
        <div key={name} className="flex flex-col gap-1 rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("size-2 rounded-full", detail.busy ? "bg-emerald-500" : "bg-muted-foreground/40")} />
            <span className="text-sm text-foreground">{name}</span>
            <span className="rounded border px-1 text-[10px] text-muted-foreground">{detail.keep ? "kept" : "task"}</span>
            <span className="text-muted-foreground">{detail.busy ? `working · ${detail.phase}` : `idle${detail.idle != null ? ` ${detail.idle} min` : ""}`}</span>
          </div>
          {!!detail.tools?.length && <p className="break-words text-muted-foreground">tools: {detail.tools.join(", ")}</p>}
        </div>
      ))}
      {!!ended.length && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm">Ended lately</h2>
          {ended.map(({ name, detail = {} }, i) => (
            <p key={`${name}-${i}`} className="break-words text-muted-foreground">
              <span className="text-foreground">{name.replace(" (ended)", "")}</span> · {detail.at ? new Date(detail.at).toLocaleTimeString() : ""} · {detail.reason}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
