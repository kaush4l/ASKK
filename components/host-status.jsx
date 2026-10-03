"use client"

import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/platform/host"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// Where the app runs: on this computer (host API) or browser only, and per
// host capability whether it is here or what stands in for it.
export function HostStatus() {
  const [host, setHost] = React.useState(null)
  React.useEffect(() => {
    detectHost().then(setHost)
  }, [])
  if (!host) return null
  const local = host.mode === "local"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 pointer-coarse:h-10" aria-label="Where ASKK is running" />
        }
      >
        <span className={cn("size-2 rounded-full", local ? "bg-emerald-500" : "bg-amber-500")} />
        {local ? "This computer" : "Browser only"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="text-sm text-foreground">{local ? "Running on this computer" : "Running in the browser only"}</span>
            <span className="font-normal break-all">
              {local
                ? `Workspace: ${host.root}`
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
                      {local ? "Turned off (--read-only)." : (cap.fallback ?? "Not available in this version.")}
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
