import { ago } from "@/backend/live/focus"
import { TONE } from "@/components/views/agent-tone"
import { initials } from "@/lib/engine-tone"
import { cn } from "@/lib/utils"

// An agent's face — its initials in a ring in its state colour, pulsing while it works, dashed while it waits — and the
// line under its bubble's words, as the home tree and the canvas both draw them. The sizes are theirs: `size` is the
// face's own (size-10), `ring` the pulse's (-inset-1 border-2), `inner` the ring's border and the initials' text.
export function Face({ name, status, size, ring, inner }) {
  const tone = TONE[status.tone] ?? TONE.idle
  return (
    <span className={cn("relative grid shrink-0 place-items-center", size)}>
      {tone.live && <span aria-hidden className={cn("absolute rounded-full opacity-50 motion-safe:animate-pulse", ring, tone.line)} />}
      <span className={cn("grid size-full place-items-center rounded-full bg-background transition-colors duration-500", inner, tone.line, tone.dashed && "border-dashed")}>{initials(name)}</span>
    </span>
  )
}

// What a bubble says under its words: when the agent reported, that it failed, or its last tool while it thinks.
export function bubbleFoot(status) {
  const tone = TONE[status.tone] ?? TONE.idle
  if (status.tone === "done") return { text: `reported ${status.at ? ago(status.at) : ""}`.trim(), className: tone.text }
  if (status.tone === "error") return { text: "error", className: tone.text }
  return status.detail ? { text: status.detail, className: "text-muted-foreground" } : null
}
