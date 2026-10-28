import { cn } from "@/lib/utils"

// The tablist's classes: one row that never wraps; a row wider than its column scrolls inside itself, not the page.
export function rowClasses() {
  return "flex flex-nowrap gap-1 overflow-x-auto"
}

// A tab trigger's classes: a 40px target below sm (phone first), dense from sm up; the open tab keeps its border.
// shrink-0 whitespace-nowrap keeps a label and its count whole on the one row.
export function tabClasses(selected) {
  return cn("shrink-0 whitespace-nowrap rounded-md border px-2.5 text-xs min-h-10 py-2.5 sm:min-h-0 sm:py-1", selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")
}

// A row of view tabs (the agent page's, the Live page's): [{id, label, count?}] — a count (given, not null) follows its
// label; `value` is the open tab, onPick(id) opens another.
export function TabRow({ tabs, value, onPick, label }) {
  return (
    <div role="tablist" aria-label={label} className={rowClasses()}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onPick(t.id)}
          className={tabClasses(value === t.id)}
        >
          {t.label}
          {t.count != null && <span className="ml-1 text-muted-foreground">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
