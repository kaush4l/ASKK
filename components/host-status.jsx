"use client"

import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/platform/host"
import { withBase } from "@/backend/platform/base-path"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// The desks one server hosts (scripts/dev.js --desks): GET desks, or null
// when this server runs a single team.
async function loadDesks() {
  try {
    const response = await fetch(withBase("/__askk/desks"), { cache: "no-store" })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// Every desk keeps running on the server; switching only changes which one
// this browser shows (cookie askk_desk), so the page reloads onto it.
async function switchDesk(name) {
  const response = await fetch(withBase("/__askk/desks/select"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  if (response.ok) window.location.reload()
}

// Where the app runs: on this computer (host API) or browser only, and per
// host capability whether it is here or what stands in for it. When the
// server hosts several desks, the button names the desk and switches it.
export function HostStatus() {
  const [host, setHost] = React.useState(null)
  const [desks, setDesks] = React.useState(null)
  React.useEffect(() => {
    detectHost().then((found) => {
      setHost(found)
      if (found.mode === "local") loadDesks().then(setDesks)
    })
  }, [])
  if (!host) return null
  const local = host.mode === "local"
  const current = desks?.desks?.length ? (host.desk?.name ?? desks.current) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 pointer-coarse:h-10" aria-label="Where ASKK is running" />
        }
      >
        <span className={cn("size-2 rounded-full", local ? "bg-emerald-500" : "bg-amber-500")} />
        {current ?? (local ? "This computer" : "Browser only")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        {current && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Desk — every desk keeps running; this picks the one you see</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={current} onValueChange={(name) => name !== current && switchDesk(name)}>
                {desks.desks.map((desk) => (
                  <DropdownMenuRadioItem key={desk.name} value={desk.name} className="pointer-coarse:min-h-10">
                    <span className="flex flex-col">
                      <span>{desk.name}</span>
                      {desk.description && <span className="text-xs text-muted-foreground">{desk.description}</span>}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-sm text-foreground">{local ? "Running on this computer" : "Running in the browser only"}</span>
            <span className="font-normal break-all">
              {local
                ? `Workspace: ${host.root}${host.runtime ? ` · Runtime (memory, history): ${host.runtime}` : " · Memory: this browser"}`
                : "This version has no access to your computer. Run ASKK from source (bun run dev) for the full set."}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ul className="flex flex-col gap-2 p-2 text-sm">
          {HOST_CAPABILITIES.map((cap) => {
            const on = hasCapability(host, cap.id)
            return (
              <li key={cap.id} className="flex gap-2">
                {on ? (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-label="Available" />
                ) : (
                  <MinusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not available" />
                )}
                <span className="flex flex-col">
                  <span className={cn(!on && "text-muted-foreground")}>{cap.label}</span>
                  {!on && (
                    <span className="text-xs text-muted-foreground">
                      {local ? (cap.localOff ?? "Turned off (--read-only).") : (cap.fallback ?? "Not available in this version.")}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
