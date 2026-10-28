"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, MinusIcon } from "lucide-react"

import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/live/host"
import { SpeechCapability } from "@/components/models/speech-capability"
import { readConnection, setBrowserAgent } from "@/backend/browser/settings"
import { registry } from "@/backend/live/registry"
import { deskFromQuery } from "@/backend/live/desk"
import { BrowserAgentSetup } from "@/components/browser/browser-agent"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { browserStore } from "@/backend/browser/storage"
import { useEngines } from "@/hooks/use-engines"
import { withBase } from "@/backend/live/base-path"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { API_PREFIX, LIMITS, ROUTES } from "@/lib/config"
import { cn } from "@/lib/utils"
import { hm } from "@/backend/live/time"

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
        {[first.step, first.since && `since ${hm(first.since)}`, rest.length && `+${rest.length} agent${rest.length > 1 ? "s" : ""} (${rest.map((w) => w.agent).join(", ")})`]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  )
}

// Where the app runs: on this computer (host API) or browser only, and per
// host capability whether it is here or what stands in for it. When the
// server hosts several desks, the button names the desk and switches it.
// The last two folders of a path (the whole path is the hover title).
const shortPath = (p) => (p ? `…/${String(p).split("/").filter(Boolean).slice(-2).join("/")}` : "?")

export function HostStatus() {
  const [host, setHost] = React.useState(null)
  const [desks, setDesks] = React.useState(null)
  const [setup, setSetup] = React.useState(false) // the "run an agent in this browser" form, over a desk server
  const router = useRouter()
  // 2026-10-20: probed again when the desk this tab follows changes (the owner started or stopped an agent in this browser).
  const { status } = useEngines()
  React.useEffect(() => {
    detectHost().then((found) => {
      setHost(found)
      if (found.mode === "local")
        loadDesks().then((d) => {
          // 2026-10-26 (desk-param): a /live?desk=dev link shows that desk whatever the askk_desk cookie holds.
          const pick = d?.desks?.length ? deskFromQuery(window.location.search, d.desks, found.desk?.name ?? d.current) : null
          if (pick) switchDesk(pick)
          else setDesks(d)
        })
    })
  }, [status])
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
  const browser = host.mode === "browser" // the hosted version: a single agent in this tab (backend/browser/)
  const model = browser ? readConnection(browserStore()) : null
  const current = local && desks?.desks?.length ? (host.desk?.name ?? desks.current) : null // the server's desk: not while this tab runs its own
  const busy = !!desks?.desks?.find((d) => d.name === current)?.work?.length

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && refresh()}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 pointer-coarse:h-10" aria-label="Where ASKK is running" />
          }
        >
          <span className={cn("size-2 rounded-full", local || browser ? "bg-emerald-500" : "bg-amber-500", busy && "animate-pulse bg-sky-500")} />
          {current ?? (local ? "This computer" : browser ? "This browser" : "No desk")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          {current && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel title="Every desk keeps running; this picks the one you see">Desk</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={current} onValueChange={(name) => name !== current && switchDesk(name)}>
                  {desks.desks.map((desk) => (
                    <DropdownMenuRadioItem key={desk.name} value={desk.name} className="pointer-coarse:min-h-10">
                      <span className="flex min-w-0 flex-col" title={desk.description || undefined}>
                        <span>{desk.name}</span>
                        {desk.description && <span className="line-clamp-1 text-xs text-muted-foreground">{desk.description}</span>}
                        <DeskWork work={desk.work} />
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              {/* 2026-10-20: desks and tool code a run that read outside proposed (GET desks → proposals) — on Home. */}
              {desks.proposals > 0 && (
                <DropdownMenuItem className="text-amber-700 pointer-coarse:min-h-10 dark:text-amber-400" onClick={() => router.push(ROUTES.home)}>
                  {desks.proposals} proposal{desks.proposals === 1 ? " waits" : "s wait"} for you — on Home
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span className="text-sm text-foreground">{local ? "The desk runs on this computer" : browser ? "A single agent runs in this browser" : "No desk server answers here"}</span>
              <span className="font-normal break-all" title={local ? `Workspace: ${host.root}${host.runtime ? ` · State: ${host.runtime}` : ""}` : undefined}>
                {local
                  ? `Workspace: ${shortPath(host.root)}`
                  : browser
                    ? `Model: ${model?.model ?? "?"} at ${model ? new URL(model.base_url).host : "?"} (Change on the home page). Its notes and standing orders stay in this browser; the terminal, app previews and other desks need the desk server (bun run dev).`
                    : "Start the desk server from the repository (bun run dev) and open the address it prints — or run an agent in this browser from the home page."}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-2 text-sm">
            {HOST_CAPABILITIES.map((cap) => {
              const on = hasCapability(host, cap.id)
              const Mark = on ? CheckIcon : MinusIcon
              return (
                <li key={cap.id} className="flex gap-2">
                  <Mark className={cn("mt-0.5 size-4 shrink-0", on ? "text-emerald-500" : "text-muted-foreground")} aria-label={on ? "Available" : "Not available"} />
                  <span className={cn(!on && "text-muted-foreground")} title={on ? cap.label : `${cap.label} — ${local ? (cap.localOff ?? "Not on this server.") : "Needs the desk server."}`}>
                    {browser && cap.id === "team" ? "Agent in this tab" : (cap.short ?? cap.label)}
                  </span>
                </li>
              )
            })}
          </ul>
          {local && hasCapability(host, "speech") && <SpeechCapability className="border-t px-2 py-2" />}
          {/* 2026-10-20: the agent in this browser (backend/browser/) — over the desk server too, so its mode is tried on the
              live server, never on another one. */}
          {(local || (browser && host.server)) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {local ? (
                  <DropdownMenuItem className="pointer-coarse:min-h-10" onClick={() => setSetup(true)}>
                    Run an agent in this browser…
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="pointer-coarse:min-h-10"
                    onClick={async () => {
                      setBrowserAgent(browserStore(), false)
                      await registry.restart()
                    }}
                  >
                    Back to the desk server
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogTitle className="sr-only">Run an agent in this browser</DialogTitle>
          <DialogDescription className="sr-only">Name an OpenAI-compatible endpoint and a model; the agent runs in this tab.</DialogDescription>
          <BrowserAgentSetup className="border-0 p-0" onDone={() => setSetup(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
