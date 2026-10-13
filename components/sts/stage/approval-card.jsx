"use client"

import { CheckIcon, HandIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function ApprovalCard({ state, model }) {
  const approval = state.approvals?.[0]
  if (!approval) return null
  const path = approval.inputs?.path
  return (
    <div className="animate-in fade-in-0 zoom-in-95 w-full max-w-md rounded-xl border border-amber-500/60 p-4">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
        <HandIcon className="size-4" />
        <span className="text-base">Approval needed</span>
      </div>
      <p className="mt-1 text-lg break-words">
        {approval.tool}
        {path ? <span className="text-muted-foreground"> · {path}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground">Say “yes” or “no”, or tap.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1 pointer-coarse:h-10" onClick={() => model.approve(approval.id, false)}>
          <XIcon /> Decline
        </Button>
        <Button className="flex-1 pointer-coarse:h-10" onClick={() => model.approve(approval.id, true)}>
          <CheckIcon /> Approve
        </Button>
      </div>
    </div>
  )
}
