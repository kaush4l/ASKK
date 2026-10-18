"use client"

import * as React from "react"
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, Maximize2Icon, Minimize2Icon, PauseIcon, RadioIcon, SendIcon, XIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { askStage, askThread, bridgeMessage, contextLine, frameCheck, frameSrc, sceneMessage, shownScene, stageOf, stepScene } from "@/backend/live/stage"
import { shotSrc } from "@/backend/live/workbench"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDesk, useEngines, useEngineState } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// The stage (kernel builtin/stage.js, 2026-10-17 owner: "the lead shows me a rendering or a canvas to help me follow …
// interact with the agent and understand observations in visuals … as a story to follow"): the page the desk built,
// framed as it runs; the story over it — scenes in order, what each shows in the agent's words — and the owner's
// questions asked on it, answered by the agent on the stage. Following, the frame goes where the agent takes it
// (stage.go, a reply's scene); a pick of the owner's pauses that. The page talks over postMessage
// (backend/live/stage.js): it hears the scene, it says which view it shows and what the owner pointed at.
// Phone: the frame on top, the story and the questions under it.

const ICON_LINK = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10 [&_svg]:size-4"

export function StagePage() {
  const { status, engines, requiredId } = useEngines()
  const desk = useDesk()
  const stage = stageOf(desk?.artifacts)
  const keeperName = stage?.holders?.[0] ?? null
  const keeper = engines.find((e) => e.name === keeperName) ?? engines.find((e) => e.id === requiredId) ?? null
  const keeperState = useEngineState(keeper)
  const preview = Object.values(desk?.artifacts ?? {}).find((a) => a?.view === "preview") ?? null

  const [following, setFollowing] = React.useState(true)
  const [picked, setPicked] = React.useState(null)
  const [wide, setWide] = React.useState(false)
  const [pointed, setPointed] = React.useState(null) // {context, text} from the page: the ask box's chip
  const [pageView, setPageView] = React.useState(null) // {view, views} the page last said it shows

  if (status === "offline") return <Notice title="No desk server here">The stage needs the desk server: start it with <code>bun run dev</code> on the desk&apos;s computer, then open this page there.</Notice>
  if (!desk) return <Notice title="Stage">Connecting to the desk…</Notice>
  if (!stage) return <Notice title="No stage on this desk">The desk&apos;s lead keeps the stage (agent.md <code>artifacts: [stage]</code>), as the dev desk&apos;s does. Pick that desk in the header.</Notice>

  const state = stage.state ?? {}
  const scene = shownScene(state, { following, picked })
  const pick = (id) => {
    setPicked(id)
    setFollowing(false)
  }
  const follow = () => {
    setFollowing((f) => !f)
    setPicked(scene?.id ?? null)
  }
  const ask = <AskBox stage={stage} scene={scene} keeper={keeper} keeperState={keeperState} pointed={pointed} onClearPoint={() => setPointed(null)} />

  // Phone: the page grows and the shell scrolls (frame, then story); md and up: one screen, the story column scrolls.
  return (
    <div className="flex flex-1 flex-col gap-3 p-3 md:min-h-0 md:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl">Stage</h1>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{state.page?.title || state.page?.url || "no page yet"}</span>
        <KeeperMark engine={keeper} state={keeperState} />
        <div className="ml-auto flex items-center gap-2">
          {state.page?.url && (
            <Button variant="ghost" size="icon" className="hidden pointer-coarse:size-10 md:inline-flex" onClick={() => setWide((w) => !w)} aria-label={wide ? "Show the story beside the page" : "Give the page the whole width"}>
              {wide ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
          )}
          {state.page?.url && (
            <a href={frameSrc(state.page.url, scene)} target="_blank" rel="noreferrer" className={ICON_LINK} aria-label="Open the page in a new tab">
              <ExternalLinkIcon />
            </a>
          )}
          <Button variant={following ? "secondary" : "outline"} size="sm" className="pointer-coarse:h-10" onClick={follow} aria-pressed={following}>
            {following ? <RadioIcon className="text-emerald-500" /> : <PauseIcon />}
            {following ? "Following" : "Follow"}
          </Button>
        </div>
      </header>

      <div className={cn("grid gap-3 md:min-h-0 md:flex-1", !wide && "md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
        <section aria-label="The page on stage" className="flex min-h-[55svh] min-w-0 flex-col gap-2 md:min-h-0">
          <StageFrame key={state.page?.url ?? "none"} page={state.page} scene={scene} preview={preview} onAt={setPageView} onPoint={setPointed} />
          <SceneStrip scenes={state.scenes ?? []} current={state.current} shown={scene} onPick={pick} pageView={pageView} />
        </section>
        {!wide && (
          <aside aria-label="The story" className="flex min-w-0 flex-col gap-3 md:min-h-0 md:overflow-auto md:border-l md:pl-3">
            <SceneCard state={state} scene={scene} onPick={pick} />
            <Questions stage={stage} onPick={pick} />
            {ask}
          </aside>
        )}
      </div>
      {wide && ask}
    </div>
  )
}

function Notice({ title, children }) {
  return (
    <div className="flex flex-1 flex-col gap-2 p-4">
      <h1 className="text-xl">{title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

// The agent the owner's questions go to, and what it does now.
function KeeperMark({ engine, state }) {
  if (!engine) return null
  const running = state?.status === "running"
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2 shrink-0 rounded-full", running ? "animate-pulse bg-emerald-500 motion-reduce:animate-none" : "bg-muted-foreground/50")} aria-hidden />
      <span className="truncate">
        {engine.name}: {running ? describeActivity(state?.activity) || "working" : "idle"}
      </span>
    </span>
  )
}

// The page in a frame (keyed by its address: a new page starts fresh). A scene change reaches it as a message; a page
// that has not spoken the contract yet gets the scene's #view in its address instead (a hash and a message together
// race: a late hashchange would drop the params). Its own messages say which view it shows (onAt) and what the owner
// pointed at (onPoint). A tab on another device cannot reach the desk's localhost: it gets the preview's last
// screenshot of the page instead.
function StageFrame({ page, scene, preview, onAt, onPoint }) {
  const ref = React.useRef(null)
  const [here, setHere] = React.useState(null)
  const [heard, setHeard] = React.useState(false) // the page has spoken the stage's contract
  const [src, setSrc] = React.useState(() => frameSrc(page?.url, scene))
  React.useEffect(() => setHere(window.location.href), [])
  const check = page?.url && here ? frameCheck(page.url, here) : null
  const origin = React.useMemo(() => {
    try {
      return page?.url ? new URL(page.url).origin : null
    } catch {
      return null
    }
  }, [page?.url])

  // The scene, to the page: when it changes (not on every stream update) and once the page has loaded.
  const key = scene ? JSON.stringify([scene.id, scene.view, scene.params ?? null]) : null
  const latest = React.useRef(scene)
  latest.current = scene
  const post = React.useCallback(() => {
    if (latest.current && origin) ref.current?.contentWindow?.postMessage(sceneMessage(latest.current), origin)
  }, [origin])
  React.useEffect(() => {
    if (!key) return
    if (heard) post()
    else setSrc(frameSrc(page?.url, latest.current))
  }, [key, heard, post, page?.url])

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

  if (!page?.url) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No page on stage yet. The lead has one built (skill stage), checks it in the preview, then shows it here.
      </div>
    )
  }
  if (check && !check.ok) {
    const shot = previewShot(preview, page.url)
    return (
      <div className="flex flex-1 flex-col gap-2 overflow-auto rounded-lg border p-3 text-sm">
        <p className="text-muted-foreground">
          {check.reason}. {check.remote ? "Open the stage on that computer to see it live; this is the preview's last screenshot of it." : ""}
        </p>
        {shot && <img src={shot} alt={`The preview's last screenshot of ${page.title || page.url}`} className="w-full rounded border" />}
      </div>
    )
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      <iframe ref={ref} title={page.title || "The page on stage"} src={src ?? frameSrc(page.url, scene)} onLoad={post} sandbox="allow-scripts allow-same-origin allow-popups" className="min-h-[50svh] w-full flex-1 md:min-h-0" />
      {!heard && <p className="pointer-events-none absolute bottom-1 right-2 rounded bg-background/80 px-1.5 text-[10px] text-muted-foreground">the page does not talk to the stage yet</p>}
    </div>
  )
}

// The preview's newest screenshot of the page (the same address), for a tab that cannot frame it.
function previewShot(preview, url) {
  const key = (u) => String(u ?? "").split("#")[0].replace(/\/+$/, "").replace("//localhost:", "//127.0.0.1:")
  const page = (preview?.state?.pages ?? []).filter((p) => p.shot && key(p.url) === key(url)).at(-1)
  return page ? shotSrc(page.shot) : null
}

// The story's scenes as chapters under the frame: ▶ the one the agent took the owner to; a tap shows another.
function SceneStrip({ scenes, current, shown, onPick, pageView }) {
  if (!scenes.length) return null
  return (
    <nav aria-label="Scenes" className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {scenes.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          aria-current={s.id === shown?.id ? "step" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors pointer-coarse:h-10 motion-reduce:transition-none",
            s.id === shown?.id ? "border-foreground/60 text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="text-[10px] tabular-nums opacity-70">{i + 1}</span>
          {s.title}
          {s.id === current && (
            <span className="text-emerald-500" aria-label="where the agent took you">
              ▶
            </span>
          )}
        </button>
      ))}
      {pageView?.view && <span className="ml-auto shrink-0 pl-2 text-[10px] text-muted-foreground">page: #{pageView.view}</span>}
    </nav>
  )
}

// The scene in view: its title and what the agent says it shows, with its place in the story.
function SceneCard({ state, scene, onPick }) {
  const scenes = state.scenes ?? []
  if (!scene) return <p className="text-sm text-muted-foreground">No story yet: the lead writes it scene by scene (stage.scene) as the page shows the work.</p>
  const i = scenes.findIndex((s) => s.id === scene.id)
  const prev = stepScene(state, scene.id, -1)
  const next = stepScene(state, scene.id, 1)
  return (
    <article key={scene.id} className="flex flex-col gap-2 duration-300 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          Scene {i + 1} of {scenes.length}
        </span>
        {scene.by && <span>· by {scene.by}</span>}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-10" disabled={!prev} onClick={() => prev && onPick(prev.id)} aria-label="Previous scene">
            <ArrowLeftIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-10" disabled={!next} onClick={() => next && onPick(next.id)} aria-label="Next scene">
            <ArrowRightIcon />
          </Button>
        </div>
      </div>
      <h2 className="text-2xl leading-tight">{scene.title}</h2>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{scene.says}</p>
      {scene.params && (
        <p className="text-[11px] text-muted-foreground">
          #{scene.view} · {contextLine(scene.params)}
        </p>
      )}
    </article>
  )
}

// The owner's questions asked on the stage and the agent's answers, newest last; an answer's scene is one tap away.
function Questions({ stage, onPick }) {
  const thread = askThread(stage.state).slice(-12)
  if (!thread.length) return null
  return (
    <section aria-label="Questions on the stage" className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-xs text-muted-foreground">Questions</h3>
      {thread.map((a) => (
        <div key={a.id} className="flex flex-col gap-1 text-sm">
          <p className="break-words">
            <span className="text-muted-foreground">{a.id} · you</span>
            {a.scene && <span className="text-[11px] text-muted-foreground"> on {a.scene}</span>}
            {a.context && <span className="text-[11px] text-muted-foreground"> ({contextLine(a.context)})</span>}
            <br />
            {a.text}
          </p>
          {a.open ? (
            <p className="text-xs text-amber-400">waiting for the answer…</p>
          ) : (
            <div className="rounded-md border px-2 py-1.5">
              <p className="whitespace-pre-wrap break-words">{a.answer.text}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {a.answer.by && <span>{a.answer.by}</span>}
                {a.answer.scene && (
                  <button type="button" className="underline-offset-2 hover:underline pointer-coarse:min-h-10" onClick={() => onPick(a.answer.scene)}>
                    show scene {a.answer.scene}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

// A question about what is on stage: it goes with the scene in view and what the owner pointed at in the page; the
// keeper answers on the stage (guidance while it runs, else a new run — the host decides, kernel-team.js).
function AskBox({ stage, scene, keeper, keeperState, pointed, onClearPoint }) {
  const [text, setText] = React.useState("")
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const box = React.useRef(null)
  React.useEffect(() => {
    if (!pointed) return
    if (pointed.text) setText((t) => t || pointed.text)
    box.current?.focus()
  }, [pointed])
  const content = text.trim()
  const who = keeper?.name ?? "the lead"

  async function submit(event) {
    event.preventDefault()
    if (!content || busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await askStage(stage.id, { text: content, scene: scene?.id ?? null, context: pointed?.context ?? null })
      setText("")
      onClearPoint()
      setNote(r?.delivered === "guided" ? `${r.ask?.id ?? "Asked"}: ${who} reads it at its next step and answers here.` : `${r?.ask?.id ?? "Asked"}: ${who} starts on it and answers here.`)
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-3">
      <label htmlFor="stage-ask" className="text-xs text-muted-foreground">
        Ask {who} about {scene ? `“${scene.title}”` : "what is on stage"}
        {keeperState?.status === "running" ? " — it is working; your question joins its run" : ""}
      </label>
      {pointed?.context && (
        <span className="flex w-fit max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
          <span className="truncate">pointing at {contextLine(pointed.context)}</span>
          <button type="button" onClick={onClearPoint} aria-label="Drop what you pointed at" className="inline-flex items-center justify-center pointer-coarse:size-10">
            <XIcon className="size-3" />
          </button>
        </span>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          id="stage-ask"
          ref={box}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e)
          }}
          placeholder="Why does this head look back one token?"
          className="min-h-10 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="pointer-coarse:size-10" aria-label="Ask on the stage" disabled={!content || busy}>
          <SendIcon />
        </Button>
      </div>
      {note && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {note}
        </p>
      )}
    </form>
  )
}
