import { meterOf } from "@/backend/live/prompt-meter"
import { cn } from "@/lib/utils"

// The context meter (backend/live/prompt-meter.js): the agent's newest prompt as one stacked bar, a segment per
// element (soul, you, tools, each artifact, request, …), and a legend of its three largest parts. Draws only.
const SHADES = ["bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-cyan-500", "bg-lime-500", "bg-fuchsia-500", "bg-orange-500", "bg-teal-500"]
const kChars = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString())

export function PromptMeter({ parts, className }) {
  const meter = meterOf(parts)
  if (!meter) return null
  const shade = (i) => SHADES[i % SHADES.length]
  const legend = meter.legend.map((s) => ({ ...s, i: meter.segments.indexOf(s) }))
  return (
    <figure data-prompt-meter className={cn("flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground", className)}>
      <div role="img" aria-label={`Prompt ${meter.total.toLocaleString()} chars: ${meter.legend.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(", ")}`} className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {meter.segments.map((s, i) => (
          <span key={i} title={`${s.label}: ${s.chars.toLocaleString()} chars`} className={shade(i)} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <figcaption className="flex min-w-0 flex-wrap gap-x-2">
        <span className="tabular-nums">{kChars(meter.total)} chars</span>
        {legend.map((s) => (
          <span key={s.i} className="flex min-w-0 items-center gap-1">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", shade(s.i))} />
            <span className="truncate">{s.label}</span>
            <span className="tabular-nums">{Math.round(s.pct)}%</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
