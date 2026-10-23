"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { ROUTES } from "@/lib/config"
import { workflowHref } from "@/lib/nav"

// `/workflow?id=<workflow>` — an old link. A workflow lives on the dashboard now (2026-10-22 owner: "The workflow is
// currently a navigation. But I want the workflow UI in the dashboard page itself. There on expanding the workflow card,
// show this view"): this sends the tab there with that card opened big (components/workflow/card.jsx → viewer.jsx).
export function WorkflowPage() {
  const params = useSearchParams()
  const router = useRouter()
  const id = params.get("id")
  React.useEffect(() => {
    router.replace(id ? workflowHref(id) : ROUTES.home)
  }, [id, router])
  return <p className="px-4 py-4 text-sm text-muted-foreground">Workflows are on the dashboard — opening it…</p>
}
