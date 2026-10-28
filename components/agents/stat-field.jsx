import { cn } from "@/lib/utils"

// A header field's classes: the value wraps at spaces and never mid-number ("53,302" stays whole at 375), its digits
// line up (tabular-nums). break-all cut "53,3 / 02" on a phone (2026-10-26 agents-narrow-numbers).
export function fieldClasses() {
  return { row: "flex min-w-0 gap-1", dd: "min-w-0 break-words tabular-nums text-foreground/80" }
}

// One label and its value in the agent page's header <dl>.
export function Field({ label, children, className }) {
  const cls = fieldClasses()
  return (
    <div className={cn(cls.row, className)}>
      <dt>{label}</dt>
      <dd className={cls.dd}>{children}</dd>
    </div>
  )
}
