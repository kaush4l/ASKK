"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ROUTES } from "@/lib/config"

// /chat moved into each agent's page (/agents?name=…): old links land there.
export function ChatRedirect() {
  const router = useRouter()
  React.useEffect(() => {
    router.replace(ROUTES.agents)
  }, [router])
  return <p className="p-6 text-sm text-muted-foreground">The chat lives on each agent's page now…</p>
}
