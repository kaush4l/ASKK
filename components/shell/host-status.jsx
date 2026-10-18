"use client"

import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/live/host"
import { withBase } from "@/backend/live/base-path"
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
import { API_PREFIX, LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

// The desks one server hosts (scripts/dev.js --desks): GET desks, or null
// when this server runs a single team.
async function loadDesks() {
  try {
    const response = await fetch(withBase(`${API_PREFIX}desks`), { cache: "no-store" })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// Every desk keeps running on the server; switching only changes which one
// this browser shows (cookie askk_desk), so the page reloads onto it.
async function switchDesk(name) {
  const response = await fetch(withBase(`${API_PREFIX}desks/select`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  if (response.ok) window.location.reload()
}

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null)

// The workflow a desk is running now (GET desks → work): the lead's run first, then the others.
function DeskWork({ work = [] }) {
  if (!work.length) return <span className="text-xs text-muted-foreground">Idle</span>
  const [first, ...rest] = [...work].sort((a, b) => Number(b.lead) - Number(a.lead))
  return (
    <span className="flex flex-col text-xs">
      <span className="line-clamp-2 text-sky-600 dark:text-sky-400">
        Running{first.lead ? "" : ` (${first.agent})`}: {first.run ?? "a run"}
      </span>
      <span className="text-muted-foreground">
        {[first.step, first.since && `since ${clock(first.since)}`, rest.length && `+${rest.length} agent${rest.length > 1 ? "s" : ""} (${rest.map((w) => w.agent).join(", ")})`]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  )
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
  // Each desk's running workflow: refreshed while the page is visible and whenever the menu opens.
  const refresh = React.useCallback(() => {
    if (host?.mode === "local" && document.visibilityState === "visible") loadDesks().then((d) => d && setDesks(d))
  }, [host])
  React.useEffect(() => {
    const timer = setInterval(refresh, LIMITS.ui.shell.hostRefreshMs)
    return () => clearInterval(timer)
  }, [refresh])
  if (!host) return null
  const local = host.mode === "local"
  const current = desks?.desks?.length ? (host.desk?.name ?? desks.current) : null
  const busy = !!desks?.desks?.find((d) => d.name === current)?.work?.length

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 pointer-coarse:h-10" aria-label="Where ASKK is running" />
        }
      >
        <span className={cn("size-2 rounded-full", local ? "bg-emerald-500" : "bg-amber-500", busy && "animate-pulse bg-sky-500")} />
        {current ?? (local ? "This computer" : "No desk")}
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
                      <DeskWork work={desk.work} />
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
            <span className="text-sm text-foreground">{local ? "The desk runs on this computer" : "No desk server answers here"}</span>
            <span className="font-normal break-all">
              {local
                ? `Workspace: ${host.root}${host.runtime ? ` · State: ${host.runtime}` : ""}`
                : "Start the desk server from the repository (bun run dev) and open the address it prints."}
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
                      {local ? (cap.localOff ?? "Not on this server.") : "Needs the desk server."}
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
