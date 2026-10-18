import { BrainIcon, CheckCheckIcon, CheckIcon, XIcon } from "lucide-react"

import { eventTarget, toolType } from "@/backend/live/follow"
import { callLook } from "@/backend/live/visual"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { cn } from "@/lib/utils"

// A call on the canvas, coloured and iconed by callLook (backend/live/visual.js) from its tool's type and view:
// a chip while it runs, a row in the card's run once it answered.

const lookOf = (engine, call) => callLook({ ...call, type: toolType(engine, call.name) })

// One call in flight (activity.calls): a quest to a member, or a tool.
export function CallChip({ engine, call }) {
  const look = lookOf(engine, call)
  const target = eventTarget({ kind: call.kind ?? "tool", inputs: call.inputs ?? {} })
  return (
    <li
      data-call-kind={look.kind}
      title={`${call.name}${target ? ` · ${target}` : ""}`}
      className={cn("inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border bg-card px-2 text-[11px]", toneOf(look).border)}
    >
      <CallIcon look={look} className="size-3" />
      <span className="truncate">{call.kind === "agent" ? `quest → ${call.name}` : call.name}</span>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full motion-safe:animate-pulse", toneOf(look).dot)} />
    </li>
  )
}

// One call in flight as a row of the run (a near card): its icon, the call and what it touches, pulsing.
export function CallRow({ engine, call }) {
  const look = lookOf(engine, call)
  const target = eventTarget({ kind: call.kind ?? "tool", inputs: call.inputs ?? {} })
  return (
    <li data-step="call" data-call-kind={look.kind} className="flex min-w-0 items-center gap-1.5">
      <CallIcon look={look} className="size-3" />
      <span className={cn("min-w-0 flex-1 truncate", toneOf(look).text)}>
        {call.kind === "agent" ? `quest → ${call.name}` : call.name}
        {target ? <span className="text-muted-foreground"> · {target}</span> : null}
      </span>
      <span aria-label="running" className={cn("size-1.5 shrink-0 rounded-full motion-safe:animate-pulse", toneOf(look).dot)} />
    </li>
  )
}

// One step of the run (backend/live/follow.js runSteps): a call's result, a thought, a refused answer, the
// owner's guidance, the answer.
export function StepRow({ engine, step }) {
  if (step.step === "think")
    return (
      <li data-step="think" className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <BrainIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate italic">{step.text}</span>
      </li>
    )
  if (step.step === "answer")
    return (
      <li data-step="answer" className={cn("flex min-w-0 items-start gap-1.5", step.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-400")}>
        {step.ok ? <CheckCheckIcon aria-hidden className="mt-0.5 size-3 shrink-0" /> : <XIcon aria-hidden className="mt-0.5 size-3 shrink-0" />}
        <span className="line-clamp-2 break-words text-foreground">{step.text}</span>
      </li>
    )
  const look = lookOf(engine, step)
  const label =
    step.step === "gate" ? step.text
    : step.step === "guidance" ? `${step.from && step.from !== "owner" ? `${step.from}: ` : "you: "}${step.text}`
    : `${step.kind === "agent" ? `report from ${step.name}` : step.name}${eventTarget(step) ? ` · ${eventTarget(step)}` : ""}`
  return (
    <li data-step={step.step} data-call-kind={look.kind} className="flex min-w-0 items-center gap-1.5">
      <CallIcon look={look} className="size-3" />
      <span className={cn("min-w-0 flex-1 truncate", step.step === "gate" && toneOf(look).text)}>{label}</span>
      {step.step === "tool" &&
        (step.ok ? (
          <CheckIcon aria-label="answered" className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <XIcon aria-label="failed" className="size-3 shrink-0 text-red-600 dark:text-red-400" />
        ))}
    </li>
  )
}
