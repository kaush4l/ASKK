import { snapshotLabel, time } from "@/components/live/format"
import { cn } from "@/lib/utils"

const size = (n) => (n == null ? "?" : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

// live.compact (CompactArtifact.live()): each capped file — size against its
// cap, its last compaction (from → to, note), a failed check — and the dated
// folders moved out lately.
export function CompactView({ snapshot }) {
  const { items = [], moved = [], at } = snapshot?.data ?? {}
  return (
    <div className="flex flex-col gap-3 overflow-auto text-xs">
      <p className="text-[11px] text-muted-foreground">
        {snapshotLabel(snapshot)}
        {at ? ` · checked ${time(at)}` : ""}
      </p>
      {items.map(({ name, detail: f = {} }) => {
        const share = f.max ? Math.min(1, (f.size ?? 0) / f.max) : 0
        return (
          <div key={name} className="flex flex-col gap-1 rounded-md border p-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="min-w-0 break-all text-foreground">{name}</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {size(f.size)} / {size(f.max)}
              </span>
            </div>
            <div className="h-1 rounded bg-border">
              <div className={cn("h-1 rounded", share > 0.9 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${share * 100}%` }} />
            </div>
            {f.at && (
              <p className="text-muted-foreground">
                compacted {time(f.at)} · {size(f.from)} → {size(f.to)}
                {f.note ? ` · ${f.note}` : ""}
              </p>
            )}
            {f.error && <p className="text-destructive">{f.error}</p>}
          </div>
        )
      })}
      {!!moved.length && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm">Moved</h2>
          {moved.map((m) => (
            <p key={m} className="break-all text-muted-foreground">{m}</p>
          ))}
        </section>
      )}
    </div>
  )
}
