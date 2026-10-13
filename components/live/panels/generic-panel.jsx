import { block, snapshotLabel } from "@/components/live/format"

// Any live artifact without a panel of its own: a list view as rows, else its
// data as text or JSON — nothing an engine publishes stays invisible.
export function GenericView({ snapshot }) {
  const data = snapshot?.data
  const items = Array.isArray(data?.items) ? data.items : null
  return (
    <div className="flex flex-col gap-2 overflow-auto text-xs">
      <p className="text-[11px] text-muted-foreground">
        {snapshotLabel(snapshot)} · {snapshot?.view ?? "data"}
      </p>
      {items ? (
        items.map((item, i) => (
          <div key={item.name ?? i} className="break-words">
            <span className="text-foreground">{item.name ?? `#${i + 1}`}</span>
            {item.detail != null && <span className="text-muted-foreground"> — {typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail)}</span>}
          </div>
        ))
      ) : (
        <pre className={block}>{typeof data === "string" ? data : JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  )
}
