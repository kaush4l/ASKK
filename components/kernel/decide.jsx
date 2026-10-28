"use client"

import { Button } from "@/components/ui/button"
import { DECIDE_BTN } from "@/components/kernel/tap-classes"
import { useKeyedCalls } from "@/components/views/kit"

export { DECIDE_BTN }

// What waits for the owner's accept or drop (a helper's proposal, a held desk, a proposed tool): the call's busy state
// and its refusal. perform(method) makes the call ("accept" | "drop").
export function useDecision(perform) {
  const [calls, act] = useKeyedCalls()
  const c = calls.decision
  return [{ busy: c?.busy ? c.tag : null, error: c?.error ?? null }, (method) => act("decision", () => perform(method), method)]
}

const CHOICES = [
  ["accept", "outline", "Accept", "Accepting…"],
  ["drop", "ghost", "Drop", "Dropping…"],
]

// Accept / Drop, and under them what a refusal said. `what` names the thing for the screen reader; `disabled` holds
// both buttons (beside a call in flight).
export function Decide({ call, act, what, acceptTitle, dropTitle, disabled = false }) {
  const titles = { accept: acceptTitle, drop: dropTitle }
  return (
    <>
      <div className="mt-1 flex gap-1.5">
        {CHOICES.map(([method, variant, label, busyLabel]) => (
          <Button key={method} type="button" variant={variant} size="xs" className={DECIDE_BTN} disabled={disabled || !!call.busy} onClick={() => act(method)} aria-label={`${label} ${what}`} title={titles[method]}>
            {call.busy === method ? busyLabel : label}
          </Button>
        ))}
      </div>
      {call.error && <p className="w-full break-words text-[11px] text-red-700 dark:text-red-400">Not done: {call.error}</p>}
    </>
  )
}
