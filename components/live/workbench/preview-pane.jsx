"use client"

import * as React from "react"
import { ExternalLinkIcon } from "lucide-react"

import { canFrame, consoleErrors, shotSrc } from "@/backend/live/workbench"
import { clock, Empty, StatusDot } from "@/components/live/workbench/pane"
import { cn } from "@/lib/utils"

// A preview page (the preview artifact's twin): its url bar, the latest screenshot the agent took (a new shot is a
// new URL: /__askk/browser/shot?id&n), its console errors. "Live" frames the page itself instead (loopback pages only,
// never this UI): the owner sees it move; the agent still sees only its shots and text.
export function PreviewView({ page }) {
  const [live, setLive] = React.useState(false)
  const self = typeof window === "undefined" ? null : window.location.origin
  const frameable = canFrame(page.url, self)
  const src = shotSrc(page.shot)
  const errors = consoleErrors(page)
  const [broken, setBroken] = React.useState(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <StatusDot status={page.status} />
        <span className="min-w-0 flex-1 truncate rounded-md border px-2 font-mono leading-6 text-foreground/90" title={page.url}>
          {page.url}
        </span>
        {page.url && (
          <a href={page.url} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-10">
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
        <div role="group" aria-label="Show" className="flex shrink-0 gap-1">
          {[
            ["shot", false],
            ["live", true],
          ].map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={live === value}
              disabled={value && !frameable}
              title={value && !frameable ? "Only a page on this machine (localhost) can be framed" : undefined}
              onClick={() => setLive(value)}
              className={cn("rounded-md border px-2 leading-6 disabled:opacity-40 pointer-coarse:leading-10", live === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-2 px-2 py-1 text-[11px] text-muted-foreground">
        {page.title && <span className="min-w-0 truncate text-foreground/80">{page.title}</span>}
        <span>{page.status}</span>
        {page.by && <span>by {page.by}</span>}
        {page.shot && (
          <span>
            shot {page.shot.n} · {clock(page.shot.at)}
            {page.shot.width ? ` · ${page.shot.width}×${page.shot.height}` : ""}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {live && frameable ? (
          <iframe title={page.title || page.url} src={page.url} sandbox="allow-scripts allow-forms allow-same-origin" className="h-full min-h-80 w-full border-0 bg-white" />
        ) : src && broken !== src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export: no next/image)
          <img src={src} alt={`Screenshot of ${page.title || page.url}`} onError={() => setBroken(src)} className="mx-auto block h-auto max-w-full" />
        ) : (
          <Empty>{src ? "The screenshot could not be loaded." : "No screenshot yet: the agent takes one with each action on the page."}</Empty>
        )}
      </div>
      {errors.count > 0 && (
        <details className="max-h-40 shrink-0 overflow-auto border-t px-2 py-1 text-[11px]" open>
          <summary className="cursor-pointer text-red-700 dark:text-red-400">
            {errors.count} console error{errors.count === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
            {errors.lines.map((l, i) => (
              <li key={i} className="break-words text-red-700 dark:text-red-300">
                {l.at ? <span className="text-muted-foreground">{clock(l.at)} </span> : null}
                {String(l.text ?? "")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
