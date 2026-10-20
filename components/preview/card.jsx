"use client"

import * as React from "react"

import { openAsks, pageView, previewItems, sessionOf, shownItem, visualSource } from "@/backend/live/preview"
import { stripAnsi } from "@/backend/live/term-lines"
import { consoleErrors, shotSrc } from "@/backend/live/workbench"
import { EnlargeButton, EnlargedPage, PreviewPane } from "@/components/live/workbench/preview-pane"
import { PreviewVisual } from "@/components/preview/visual"
import { useDesk } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The preview artifact's view `preview` in a card (components/views/artifact.jsx): closed, the item in the pane now,
// small — a visual compact, a page's screenshot, a terminal session's last lines — and how many of the owner's
// questions are open; open, the one preview pane whole (components/live/workbench/preview-pane.jsx), with its ask box,
// a page in it live by default. `fill`: the open pane fills its parent (the home's big view) instead of its own 75svh
// box. 2026-10-18 owner ("preview can enlarge to a web page"): a page's Enlarge, on the card too, puts the live page
// over the whole viewport (EnlargedPage).
export function PreviewCard({ artifact, state, expanded, fill = false }) {
  if (expanded) {
    return (
      <div className={cn("mt-1 flex min-h-0 flex-col overflow-hidden rounded-md border", fill ? "flex-1" : "h-[75svh] min-h-96")}>
        <PreviewPane artifact={artifact ?? { state }} />
      </div>
    )
  }
  return <PreviewThumb artifact={artifact} state={state} />
}

function PreviewThumb({ artifact, state }) {
  const desk = useDesk()
  const items = previewItems(state)
  const item = shownItem(state, { following: true })
  const open = openAsks(state)
  if (!item) return <p className="mt-1 text-xs text-muted-foreground">nothing in the preview yet</p>
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1 text-xs">
      <p className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden>
          ▶
        </span>
        <span className="min-w-0 truncate text-foreground">{item.title}</span>
        {items.length > 1 && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {items.findIndex((i) => i.key === item.key) + 1}/{items.length}
          </span>
        )}
      </p>
      <div className="max-h-40 min-w-0 overflow-hidden">
        <Small item={item} state={state} artifacts={desk?.artifacts} artifact={artifact} />
      </div>
      {item.entry?.says && <p className="line-clamp-2 break-words text-muted-foreground">{item.entry.says}</p>}
      {open > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          {open} question{open === 1 ? "" : "s"} open
        </p>
      )}
    </div>
  )
}

// The item small: what the card can show without the pane.
function Small({ item, state, artifacts, artifact }) {
  if (item.kind === "page") return <SmallPage page={item.page} view={pageView(state, item.id)} artifact={artifact} />
  const { type, ref } = visualSource(item.entry.visual)
  if (type === "terminal") {
    const session = sessionOf(artifacts, ref)
    const tail = (session?.tail ?? []).map((l) => stripAnsi(l)).slice(-4)
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate font-mono text-[11px]">$ {session?.command ?? ref}</p>
        {tail.length > 0 && <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-muted-foreground">{tail.join("\n")}</pre>}
      </div>
    )
  }
  return <PreviewVisual key={`${item.id}-${item.entry.at ?? ""}`} visual={item.entry.visual} compact />
}

// A page small: its address, its errors, Enlarge (the live page over the whole viewport), its last screenshot.
function SmallPage({ page: p, view, artifact }) {
  const [enlarged, setEnlarged] = React.useState(false)
  const src = shotSrc(p.shot)
  const errors = consoleErrors(p).count
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex min-w-0 items-center gap-1.5">
        <span className={cn("shrink-0", p.status === "open" ? "text-emerald-500" : "text-muted-foreground")}>●</span>
        <span className="min-w-0 truncate font-mono" title={p.url}>
          {p.url}
        </span>
        {errors > 0 && <span className="ml-auto shrink-0 text-[11px] text-red-500">{errors} error{errors === 1 ? "" : "s"}</span>}
        {p.url && <EnlargeButton onClick={() => setEnlarged(true)} className={cn("h-6 text-[11px]", errors > 0 ? "" : "ml-auto")} />}
      </p>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export)
        <img src={src} alt={`Screenshot of ${p.title || p.url}`} loading="lazy" className="h-auto max-h-32 max-w-full rounded-sm border object-contain object-left-top" />
      )}
      {p.url && <EnlargedPage page={p} view={view} open={enlarged} onOpenChange={setEnlarged} artifact={artifact?.id ? artifact : null} />}
    </div>
  )
}
