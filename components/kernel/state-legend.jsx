import { VISUAL_STATES } from "@/backend/live/visual"
import { TONE } from "@/components/views/agent-tone"
import { cn } from "@/lib/utils"

// The key to the state colours (VISUAL_STATES → TONE), under the home tree and over the canvas.
export const StateLegend = ({ className }) => (
  <ul className={cn("flex gap-x-3 text-[11px] text-muted-foreground", className)} aria-label="State colours">
    {VISUAL_STATES.map((s) => (
      <li key={s.id} className="flex items-center gap-1">
        <span aria-hidden className={cn("size-2 rounded-full", TONE[s.id].dot)} />
        {s.label}
      </li>
    ))}
  </ul>
)
