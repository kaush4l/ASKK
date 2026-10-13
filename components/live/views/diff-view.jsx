import { cn } from "@/lib/utils"

export function DiffView({ rows }) {
  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {rows.map((row, i) =>
        row.op === "…" ? (
          <div key={i} className="border-y border-dashed px-3 py-0.5 text-[11px] text-muted-foreground">
            ⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"}
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)] whitespace-pre-wrap break-words",
              row.op === "+" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              row.op === "-" && "bg-red-500/10 text-red-700 dark:text-red-300"
            )}
          >
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{row.a ?? ""}</span>
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{row.b ?? ""}</span>
            <span className="select-none">{row.op === " " ? "" : row.op}</span>
            <span>{row.text || " "}</span>
          </div>
        )
      )}
    </div>
  )
}
