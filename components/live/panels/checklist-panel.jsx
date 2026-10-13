import { snapshotLabel } from "@/components/live/format"
import { cn } from "@/lib/utils"

export function ChecklistView({ snapshot }) {
  const data = snapshot?.data
  if (!data) return <p className="text-sm text-muted-foreground">No checklist on this desk.</p>
  const group = (title, items) =>
    items.length ? (
      <section className="flex flex-col gap-1">
        <h2 className="text-sm">{title}</h2>
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-2 text-xs">
            <span className={cn("font-mono", item.status === "ticked" ? "text-emerald-500" : item.status === "skipped" ? "text-muted-foreground" : "")}>
              {item.status === "ticked" ? "[x]" : item.status === "skipped" ? "[-]" : "[ ]"}
            </span>
            <span className="min-w-0 break-words">
              <span className="text-foreground">{item.id}</span>: {item.text}
              {item.note && <span className="text-muted-foreground"> — {item.note}</span>}
            </span>
          </div>
        ))}
      </section>
    ) : null
  return (
    <div className="flex flex-col gap-4 overflow-auto">
      <p className="text-[11px] text-muted-foreground">
        {snapshotLabel(snapshot)}
      </p>
      {group("This run", data.run)}
      {group(`Today${data.day ? ` (${data.day})` : ""}`, data.today)}
    </div>
  )
}

