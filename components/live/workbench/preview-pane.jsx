"use client"

import * as React from "react"
import { AppWindowIcon, ChevronLeftIcon, ExternalLinkIcon, Maximize2Icon, PauseIcon, RadioIcon, RotateCwIcon, ShapesIcon, TerminalIcon, XIcon } from "lucide-react"

import { backPreview, bindLine, bridgeMessage, currentRef, enlargeOf, frameCheck, frameSrc, frameStep, itemKey, openAsks, openPreview, pageMode, pageView, paramsText, previewItems, rerunPreview, sessionOf, shownItem, trailOf, viewMessage, visualSource } from "@/backend/live/preview"
import { consoleErrors, shotSrc } from "@/backend/live/workbench"
import { clock, Empty, StatusDot } from "@/components/live/workbench/pane"
import { SessionView } from "@/components/live/workbench/terminal-pane"
import { PreviewAsk, PreviewQuestions } from "@/components/preview/ask"
import { PreviewVisual } from "@/components/preview/visual"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useDesk } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The one preview pane (2026-10-17 owner: "There will be need for only one preview pane because the goal is for the
// user and agent to communicate the idea more freely … the agent can draw charts or visualizations to show the flow. I
// can ask follow up questions and agent can update visuals and answer me as well"): the preview artifact's twin
// (kernel builtin/preview.js, backend/live/preview.js) — a strip of its items, pages and visuals, the one the agents put
// in the pane marked; the item itself: a page (its shot, the live frame, its console), a visual (components/preview/
// visual.jsx), a terminal session's live output; what the agent says it shows; the
// owner's questions and the ask box. Following, the pane goes where the agents put it (`current`, each revision); a
// pick of the owner's pauses that. Used by the Live workbench (its follow is the page's) and by the preview's card
// opened big (its own follow). An old twin (pages only) still shows its pages.
// 2026-10-17 (drill-down, bound scripts): an element with a link opens it (openPreview: the kernel puts that visual in
// the pane with its params, the item there on the trail) — the pane goes with it; a breadcrumb of the trail with Back
// (backPreview); a bound visual says what script makes it, how its last run went, with Re-run (rerunPreview); its chip
// in the strip pulses while the script runs.
// 2026-10-18 owner ("preview can enlarge to a web page"; the charts artifact is gone — a training run's live dashboard
// is a page here): a page shows live by default where it can be framed, and Enlarge puts the live page over the whole
// viewport (EnlargedPage).

const ICONS = { page: AppWindowIcon, spec: ShapesIcon, file: ShapesIcon, terminal: TerminalIcon, none: ShapesIcon }

// The pane's own follow, when no page drives it: following → the current item; a pick pauses on it.
function useOwnFollow(state) {
  const [following, setFollowing] = React.useState(true)
  const [picked, setPicked] = React.useState(null)
  const key = shownItem(state, { following, picked })?.key ?? null
  return {
    following,
    key,
    pick(k) {
      setPicked(k)
      setFollowing(false)
    },
    toggle() {
      setPicked(key)
      setFollowing((f) => !f)
    },
  }
}

// artifact: the preview twin {id, holders, state}; artifacts: the desk's (for a {terminal} item; default the
// desk's own); follow: {following, key, pick(key)} when a page drives the follow (the Live workbench), else its own.
export function PreviewPane({ artifact, artifacts = null, follow = null, className }) {
  const desk = useDesk()
  const all = artifacts ?? desk?.artifacts ?? {}
  const state = artifact?.state ?? {}
  const own = useOwnFollow(state)
  const f = follow ?? own
  const items = previewItems(state)
  const item = items.find((i) => i.key === f.key) ?? shownItem(state, { following: true })
  const current = itemKey(currentRef(state))
  const [pointed, setPointed] = React.useState(null) // {context, text}: the ask box's chip
  const [pageAt, setPageAt] = React.useState(null) // {view, views} the framed page last said it shows
  const [nav, setNav] = React.useState(null) // {busy, error}: an open / back / rerun on its way
  React.useEffect(() => {
    setPointed(null)
    setPageAt(null)
  }, [item?.key])
  const crumbs = trailOf(state)
  // The owner's own call: the pane shows where it lands (a paused follow too); its error stays one line under the trail.
  const act = async (call, to = null) => {
    if (!artifact?.id) return
    setNav({ busy: true, error: null })
    try {
      const r = await call()
      const at = to ?? (r?.current ? itemKey(r.current) : null)
      if (at) f.pick(at)
      setNav(null)
    } catch (e) {
      setNav({ busy: false, error: String(e?.message ?? e) })
    }
  }
  const onOpen = (link) => act(() => openPreview(artifact.id, link), itemKey({ kind: "visual", id: link.id }))
  const back = (steps = 1) =>
    act(async () => {
      let r = null
      for (let k = 0; k < steps; k++) r = await backPreview(artifact.id)
      return r
    })
  const rerun = (id) => act(() => rerunPreview(artifact.id, id), itemKey({ kind: "visual", id }))

  return (
    <section aria-label="Preview" className={cn("@container flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <ItemStrip items={items} shown={item?.key} current={current} onPick={f.pick} pageAt={pageAt} open={openAsks(state)} follow={follow ? null : own} />
      <div className="flex min-h-0 flex-1 flex-col @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="flex min-h-64 min-w-0 flex-1 flex-col @3xl:min-h-0">
          <Trail crumbs={crumbs} nav={nav} onBack={back} />
          <ItemBody key={item?.key ?? "none"} item={item} state={state} artifacts={all} onAt={setPageAt} onPoint={setPointed} onOpen={artifact?.id ? onOpen : null} artifact={artifact} onShow={f.pick} />
        </div>
        <aside aria-label="What it shows, and your questions" className="flex max-h-[45%] min-h-0 min-w-0 shrink-0 flex-col gap-3 overflow-auto border-t p-2 @3xl:max-h-none @3xl:border-t-0 @3xl:border-l">
          <Says item={item} onRerun={artifact?.id ? rerun : null} busy={!!nav?.busy} />
          <PreviewQuestions state={state} onShow={f.pick} />
          <PreviewAsk artifact={artifact} item={item} pointed={pointed} onClearPoint={() => setPointed(null)} />
        </aside>
      </div>
    </section>
  )
}

// The preview's items as chips: ▶ the one the agents put in the pane; a tap shows another (and pauses the follow).
function ItemStrip({ items, shown, current, onPick, pageAt, open, follow }) {
  const stripRef = React.useRef(null)
  const activeRef = React.useRef(null)
  // The shown chip scrolled into the strip by hand (scrollIntoView would scroll the page too).
  React.useEffect(() => {
    const strip = stripRef.current
    const el = activeRef.current
    if (!strip || !el) return
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth
  }, [shown])
  return (
    <div className="flex min-h-9 min-w-0 shrink-0 items-center gap-1 border-b px-1">
      <nav ref={stripRef} aria-label="Preview items" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:thin]">
        {!items.length && <span className="px-1 text-xs text-muted-foreground">no pages or visuals yet</span>}
        {items.map((i) => {
          const Icon = ICONS[i.source] ?? ShapesIcon
          return (
            <button
              key={i.key}
              ref={i.key === shown ? activeRef : undefined}
              type="button"
              onClick={() => onPick(i.key)}
              aria-current={i.key === shown ? "true" : undefined}
              title={i.kind === "page" ? i.page.url : `${i.title} (${i.source})`}
              className={cn(
                "flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors pointer-coarse:h-10 motion-reduce:transition-none",
                i.key === shown ? "border-foreground/60 text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{i.title}</span>
              {i.kind === "page" && <StatusDot status={i.page.status} />}
              {i.entry?.bind?.running && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-500 motion-reduce:animate-none" aria-label="its script runs" />}
              {i.entry?.bind && !i.entry.bind.running && i.entry.bind.error && <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label="its script failed" />}
              {i.key === current && (
                <span className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="where the agents put the pane">
                  ▶
                </span>
              )}
            </button>
          )
        })}
      </nav>
      {pageAt?.view && <span className="hidden shrink-0 px-1 text-[10px] text-muted-foreground @md:inline">page: #{pageAt.view}</span>}
      {open > 0 && (
        <span className="shrink-0 rounded-full border border-amber-500/60 px-1.5 text-[11px] leading-5 text-amber-700 tabular-nums dark:text-amber-300" title={`${open} question${open === 1 ? "" : "s"} waiting for an answer`}>
          {open} open
        </span>
      )}
      {follow && (
        <Button variant={follow.following ? "secondary" : "outline"} size="sm" className="h-7 shrink-0 pointer-coarse:h-10" onClick={follow.toggle} aria-pressed={follow.following}>
          {follow.following ? <RadioIcon className="text-emerald-500" /> : <PauseIcon />}
          {follow.following ? "Following" : "Follow"}
        </Button>
      )}
    </div>
  )
}

// The item itself, drawn by its kind.
function ItemBody({ item, state, artifacts, onAt, onPoint, onOpen = null, artifact = null, onShow = null }) {
  if (!item) return <Empty>Nothing in the preview yet. The agents open the app&apos;s pages here (preview.open) and draw visuals to explain the work (preview.show).</Empty>
  if (item.kind === "page") return <PreviewView page={item.page} view={pageView(state, item.id)} onAt={onAt} onPoint={onPoint} artifact={artifact} onShow={onShow} />
  const entry = item.entry
  const { type, ref } = visualSource(entry.visual)
  if (type === "terminal") {
    const session = sessionOf(artifacts, ref)
    return <SessionView key={session?.id ?? ref} session={session ?? { id: ref, command: ref, status: null }} />
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {/* a redraw (the same id) starts the visual fresh; a file visual read again keeps its clock (pitfall: it follows) */}
      {/* new params (a drill-down) are a new visual: the clock starts again */}
      <PreviewVisual key={`${item.id}-${entry.at ?? ""}-${paramsText(entry.params)}`} visual={entry.visual} onPoint={onPoint} onOpen={onOpen} />
      {type === "none" && <p className="text-sm text-muted-foreground">Nothing to draw for this visual.</p>}
      {entry.error && !entry.visual?.error && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{entry.error}</p>}
    </div>
  )
}

// What the agent says the item shows (a visual's `says`), who drew it, when; its params; the script it is bound to.
function Says({ item, onRerun = null, busy = false }) {
  const says = item?.entry?.says ?? item?.page?.says ?? ""
  if (!item) return null
  const by = item.entry?.by ?? item.page?.by
  const at = item.entry?.at ?? item.page?.at
  const params = paramsText(item.entry?.params)
  return (
    <div key={item.key} className="flex flex-col gap-1 duration-300 animate-in fade-in motion-reduce:animate-none">
      <h3 className="text-lg leading-tight break-words">{item.title}</h3>
      {params && <p className="w-fit max-w-full truncate rounded-full border px-2 font-mono text-[11px] leading-5 text-muted-foreground">{params}</p>}
      {says && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{says}</p>}
      <p className="text-[11px] text-muted-foreground">
        {item.kind === "page" ? "page" : item.source === "spec" ? item.entry.visual?.kind : item.source}
        {item.entry?.visual?.file ? ` · ${item.entry.visual.file}` : ""}
        {by ? ` · by ${by}` : ""}
        {at ? ` · ${clock(at)}` : ""}
      </p>
      <Bound id={item.id} bind={item.entry?.bind} onRerun={onRerun} busy={busy} />
    </div>
  )
}

// "bound: python -B arch.py … ← llm/architecture/** · ran 12:03 exit 0 (2.1 s)" and Re-run.
const TONE = { running: "text-sky-700 dark:text-sky-300", waiting: "text-amber-700 dark:text-amber-300", failed: "text-destructive", ok: "text-muted-foreground", idle: "text-muted-foreground" }
function Bound({ id, bind, onRerun, busy }) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!bind?.running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [bind?.running])
  const line = bindLine(bind, now)
  if (!line) return null
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-[11px]">
      <p className="min-w-0 break-words">
        <span className="text-muted-foreground">bound: </span>
        <span className="font-mono">{line.command}</span>
        <span className="text-muted-foreground"> ← {line.watch.join(", ")}</span>
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 flex-1 break-words tabular-nums", TONE[line.tone])}>{line.text}</span>
        {onRerun && (
          <Button variant="outline" size="sm" className="h-7 shrink-0 pointer-coarse:h-10" disabled={busy || bind.running} onClick={() => onRerun(id)}>
            <RotateCwIcon className={cn(bind.running && "animate-spin motion-reduce:animate-none")} />
            Re-run
          </Button>
        )}
      </div>
      {line.error && <p className="break-words font-mono text-destructive">{line.error}</p>}
    </div>
  )
}

// Where the owner drilled from: the trail, the item in the pane last, Back (a crumb: back to it).
function Trail({ crumbs, nav, onBack }) {
  if (!crumbs.length && !nav?.error) return null
  return (
    <div className="flex min-w-0 shrink-0 flex-col border-b">
      {crumbs.length > 0 && (
        <nav aria-label="Drill-down trail" className="flex min-h-9 min-w-0 items-center gap-1 px-1">
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 pointer-coarse:h-10 pointer-coarse:min-w-10" onClick={() => onBack(1)} disabled={nav?.busy} aria-label="Back">
            <ChevronLeftIcon />
            <span className="hidden @md:inline">Back</span>
          </Button>
          <ol className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs [scrollbar-width:thin]">
            {crumbs.map((c, k) => (
              <li key={`${c.key}-${k}`} className="flex shrink-0 items-center gap-0.5">
                {k > 0 && <span className="text-muted-foreground" aria-hidden>›</span>}
                {c.current ? (
                  <span aria-current="location" className="max-w-48 truncate px-1 text-foreground">
                    {c.label}
                  </span>
                ) : (
                  <button type="button" disabled={nav?.busy} onClick={() => onBack(crumbs.length - 1 - k)} className="max-w-40 truncate rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-10">
                    {c.label}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {nav?.error && <p className="px-2 pb-1 text-[11px] break-words text-destructive">{nav.error}</p>}
    </div>
  )
}

// A page (the preview's twin): its url bar, the latest screenshot the agent took (a new shot is a new URL:
// /__askk/browser/shot?id&n), its console errors — or "live", the page itself framed (a page on the desk's computer
// only, never this UI): the owner sees it move and can point at it; the agent still sees only its shots and text. Live
// is the default where the page can be framed (pageMode). A tab on another device gets the shot and says why. Enlarge
// (2026-10-18 owner: "preview can enlarge to a web page"): the page over the whole viewport (EnlargedPage); the pane
// keeps no second frame of it meanwhile.
export function PreviewView({ page, view = null, onAt = () => {}, onPoint = () => {}, artifact = null, onShow = null }) {
  const [here, setHere] = React.useState(null)
  React.useEffect(() => setHere(window.location.href), [])
  const check = here && page.url ? frameCheck(page.url, here) : null
  const frameable = !!check?.ok && page.status !== "closed"
  const [mode, setMode] = React.useState(null) // null: live where it can be framed, else the shot
  const live = pageMode({ mode, frameable }) === "live"
  const [enlarged, setEnlarged] = React.useState(false)
  const src = shotSrc(page.shot)
  const errors = consoleErrors(page)
  const [broken, setBroken] = React.useState(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <StatusDot status={page.status} />
        <span className="min-w-0 flex-1 truncate rounded-md border px-2 font-mono leading-6 text-foreground/90" title={page.url}>
          {frameSrc(page.url, view)}
        </span>
        {page.url && (
          <a href={frameSrc(page.url, view)} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-10">
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
        {page.url && <EnlargeButton onClick={() => setEnlarged(true)} />}
        <div role="group" aria-label="Show" className="flex shrink-0 gap-1">
          {["shot", "live"].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={live === (m === "live")}
              disabled={m === "live" && !frameable}
              title={m === "live" && !frameable ? (check?.reason ? `Not framed: ${check.reason}` : "Only an open page on the desk's computer can be framed") : undefined}
              onClick={() => setMode(m)}
              className={cn("rounded-md border px-2 leading-6 disabled:opacity-40 pointer-coarse:leading-10", live === (m === "live") ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {m}
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
        {check?.remote && <span className="basis-full">{check.reason}: the agent&apos;s last screenshot of it.</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {enlarged ? (
          <Empty>The page is enlarged over the whole screen.</Empty>
        ) : live ? (
          <LiveFrame key={page.url} page={page} view={view} onAt={onAt} onPoint={onPoint} />
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
      {page.url && <EnlargedPage page={page} view={view} open={enlarged} onOpenChange={setEnlarged} onAt={onAt} onPoint={onPoint} artifact={artifact} onShow={onShow} />}
    </div>
  )
}

// The control that enlarges a page (the pane's url bar, the preview card's thumb).
export function EnlargeButton({ onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      title="Enlarge: the live page over the whole screen"
      className={cn("flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-10 pointer-coarse:min-w-10", className)}
    >
      <Maximize2Icon className="size-3.5" aria-hidden />
      Enlarge
    </button>
  )
}

// A page enlarged to the whole viewport (2026-10-18 owner: "preview can enlarge to a web page" — the training run's live
// dashboard is the preview): the live page framed over the page bridge where it can be (backend/live/preview.js
// enlargeOf), else its last screenshot and why; its title, a link to open it in a new tab, and Close (Esc too). A dialog
// of its own, so it opens over the home card's dialog or sheet as well (base-ui nests them); 100dvh, no side scroll.
// With the preview `artifact` (2026-10-18 owner: "I want to ask questions about layers and architecture"): the owner
// asks from the enlarged page too — what they point at in the page (the bridge's ask) is the chip of an Ask box beside
// it (below on a phone), with the open questions and recent answers; an answer that shows another item closes it.
export function EnlargedPage({ page, view = null, open, onOpenChange, onAt = () => {}, onPoint = () => {}, artifact = null, onShow = null }) {
  const [pointed, setPointed] = React.useState(null)
  const point = React.useCallback(
    (p) => {
      setPointed(p)
      onPoint(p)
    },
    [onPoint],
  )
  const asks = !!artifact?.id
  const [here, setHere] = React.useState(null)
  React.useEffect(() => setHere(window.location.href), [])
  const big = enlargeOf(page, { here, view })
  const shot = shotSrc(page?.shot)
  if (!big) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 sm:max-w-none">
        <div className="flex min-h-11 min-w-0 shrink-0 items-center gap-2 border-b px-2 pt-[env(safe-area-inset-top)]">
          <StatusDot status={page.status} />
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="truncate text-sm">{big.title}</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]" title={big.href}>
              {big.href}
            </DialogDescription>
          </div>
          <a href={big.href} target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" className="flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-10 pointer-coarse:min-w-10">
            <ExternalLinkIcon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">New tab</span>
          </a>
          <Button variant="ghost" size="icon" className="shrink-0 pointer-coarse:size-10" onClick={() => onOpenChange(false)} aria-label="Close the enlarged page">
            <XIcon />
          </Button>
        </div>
        {big.reason && <p className="shrink-0 border-b px-2 py-1 text-[11px] break-words text-muted-foreground">{big.reason}</p>}
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", asks && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]")}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto pb-[env(safe-area-inset-bottom)]">
            {big.live ? (
              <LiveFrame key={page.url} page={page} view={view} onAt={onAt} onPoint={point} className="min-h-0" />
            ) : shot ? (
              // eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export: no next/image)
              <img src={shot} alt={`Screenshot of ${big.title}`} className="mx-auto block h-auto max-w-full" />
            ) : (
              <Empty>No screenshot yet: the agent takes one with each action on the page.</Empty>
            )}
          </div>
          {asks && (
            <aside aria-label="Your questions about this page" className="flex max-h-[40%] min-h-0 min-w-0 shrink-0 flex-col gap-3 overflow-auto border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:max-h-none md:border-t-0 md:border-l">
              <PreviewQuestions
                state={artifact.state}
                onShow={(key) => {
                  onOpenChange(false)
                  onShow?.(key)
                }}
              />
              <PreviewAsk artifact={artifact} item={{ kind: "page", id: String(page.id), title: page.title || big.title }} pointed={pointed} onClearPoint={() => setPointed(null)} />
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// The page in a frame (keyed by its address: a new page starts fresh). The view the agents put it at (preview.focus
// {id, view}) reaches it only when that view changes, never on every stream update: by message once the page has spoken
// the bridge, before that by the frame's #view (backend/live/preview.js frameStep — a hash and a message together
// race: a late hashchange would drop the view's params). Its own messages say which view it shows (onAt) and what the
// owner pointed at (onPoint → the ask box's chip).
function LiveFrame({ page, view, onAt, onPoint, className }) {
  const ref = React.useRef(null)
  const [heard, setHeard] = React.useState(false) // the page has spoken the bridge
  const [src, setSrc] = React.useState(() => frameSrc(page.url, view))
  const delivered = React.useRef(view) // the view the frame was last given (the first src carries it)
  const latest = React.useRef(view)
  latest.current = view
  const origin = React.useMemo(() => {
    try {
      return new URL(page.url).origin
    } catch {
      return null
    }
  }, [page.url])
  const post = React.useCallback(() => {
    if (latest.current && origin) ref.current?.contentWindow?.postMessage(viewMessage({ view: latest.current, title: page.title }), origin)
  }, [origin, page.title])

  React.useEffect(() => {
    const step = frameStep({ key: view, last: delivered.current, heard })
    if (!step) return
    delivered.current = view
    if (step === "post") post()
    else setSrc(frameSrc(page.url, view))
  }, [view, heard, post, page.url])

  React.useEffect(() => {
    if (!origin) return
    const onMessage = (event) => {
      const m = bridgeMessage(event, { frame: ref.current?.contentWindow, origin })
      if (!m) return
      setHeard(true)
      if (m.type === "at") onAt({ view: m.view, views: m.views })
      else onPoint({ context: m.context, text: m.text })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [origin, onAt, onPoint])

  return <iframe ref={ref} title={page.title || page.url} src={src ?? page.url} onLoad={post} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" className={cn("min-h-80 w-full flex-1 border-0 bg-white", className)} />
}
