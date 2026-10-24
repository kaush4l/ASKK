"use client"

import * as React from "react"
import { BrushIcon, CheckIcon, ExternalLinkIcon, ImageIcon, MaximizeIcon, SquareIcon, StarIcon, Trash2Icon, WandSparklesIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"

import { uploadImage } from "@/backend/live/models"
import { bestImage, bigEnough, boxFrom, canEdit, imageUrl, lastCritique, lineage, marksText, nextZoom, placeOf, presetOptions, progress, studioCall } from "@/backend/live/studio"
import { ModelPanel } from "@/components/models/model-panel"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The studio (kernel builtin/studio.js; 2026-10-23 owner: "a live artifact where the input will be taken and the model
// will be used to generate the image … critiqued and improved based on either users' requirement, feedback, or even
// another LLM"): closed, the best image so far and its score; open, the goal and what done means, the prompt's versions
// (each with why it changed), every image live (progress while it runs, its score and verdict, what it was refined
// from), one image's critiques and lineage, and the owner's controls — set the goal (the agents take it from there),
// generate now, give feedback on an image (it goes to the agent that made it), refine from it, pick it, stop it.
// 2026-10-23 owner ("have interface for the user to mark, zoom or request additional changes … presets … the model
// should be configurable"): the image zooms (buttons, ctrl/⌘ + wheel, drag to pan); Mark draws numbered boxes, each with
// a note; Request change sends the feedback with the marks, the image with them drawn (the agent sees it) and a mask
// (white = repaint) — Edit marked areas runs the model's edit mode on just those areas when it takes a mask. The goal
// carries a preset (or "let the agent choose": the workflow compares and picks); the model and its options are the
// model panel's (models/image/<name>/model.md).
// 2026-10-24 owner ("for the studio, we want ability to delete images"): Delete on the image shown, and Select on the
// thumbnails to delete several — each asks once more; the host removes the PNG with the masks and marks drawn over it.

const VERDICT = { done: "text-emerald-600 dark:text-emerald-400", revise: "text-amber-600 dark:text-amber-400", discard: "text-destructive" }
const field = "w-full rounded-md border bg-background px-2 py-1.5 text-base md:text-sm"

function useCall(id) {
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState(null) // {ok, text}: what the call did, or why it was refused
  const call = async (method, extra, done) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await studioCall(id, method, extra)
      setNote({ ok: true, text: r?.deleted ? `deleted ${r.deleted.join(", ")}` : r?.delivered ? `sent to ${r.keeper} (${r.delivered === "guided" ? "added to its run" : "a new run"})` : r?.workflow ? `the ${r.workflow} workflow started: expand → preset → generate → critique → refine` : (r?.result ?? "done") })
      done?.()
      return true
    } catch (error) {
      setNote({ ok: false, text: error.message })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, note, call }
}

// A delete that asks once more: Delete → "Delete for good?" / Cancel.
function DeleteButton({ label = "Delete", confirm = "Delete for good?", busy, onConfirm, className }) {
  const [asking, setAsking] = React.useState(false)
  if (!asking)
    return (
      <Button size="sm" variant="ghost" className={cn("text-destructive pointer-coarse:h-10", className)} disabled={busy} onClick={() => setAsking(true)}>
        <Trash2Icon /> {label}
      </Button>
    )
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <Button size="sm" variant="destructive" className="pointer-coarse:h-10" disabled={busy} onClick={async () => (await onConfirm()) !== false && setAsking(false)}>
        <Trash2Icon /> {confirm}
      </Button>
      <Button size="sm" variant="ghost" className="pointer-coarse:h-10" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  )
}

function Thumb({ image, selected, onSelect, best, picking, picked }) {
  const url = imageUrl(image)
  const c = lastCritique(image)
  return (
    <button
      type="button"
      onClick={() => onSelect(image.id)}
      aria-pressed={picking ? picked : selected}
      aria-label={picking ? `${picked ? "Unselect" : "Select"} ${image.id}` : undefined}
      className={cn("relative flex aspect-square min-w-0 flex-col overflow-hidden rounded-md border text-left", !picking && selected && "ring-2 ring-primary", picking && picked && "ring-2 ring-destructive")}
      title={`${image.id} · ${image.status}${image.preset ? ` · ${image.preset}` : ""}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${image.id}: ${image.prompt?.slice(0, 80)}`} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center bg-muted/30 text-[10px] text-muted-foreground">{image.status === "running" ? `${image.step}/${image.steps}` : image.status}</span>
      )}
      {image.status === "running" && <span className="absolute inset-x-0 bottom-0 h-1 bg-sky-500 transition-[width] duration-500" style={{ width: `${progress(image) * 100}%` }} />}
      <span className="absolute left-1 top-1 flex gap-1 text-[10px]">
        {c && <span className={cn("rounded bg-background/80 px-1 tabular-nums", VERDICT[c.verdict])}>{c.score}</span>}
        {best && <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-label="the pick" />}
      </span>
      {["failed", "interrupted", "stopped"].includes(image.status) && <span className="absolute inset-x-0 bottom-0 bg-destructive/80 px-1 text-[10px] text-white">{image.status}</span>}
      {picking && (
        <span className={cn("absolute right-1 top-1 grid size-5 place-items-center rounded border bg-background/80", picked && "border-destructive bg-destructive text-white")}>
          {picked && <CheckIcon className="size-3.5" />}
        </span>
      )}
    </button>
  )
}

// The image, zoomable, with the owner's marks over it: drag to draw a box while marking, else drag to pan when zoomed.
function ImageStage({ image, url, marks, setMarks, marking, zoom, setZoom }) {
  const frame = React.useRef(null)
  const drag = React.useRef(null)
  const [draft, setDraft] = React.useState(null)
  const at = (e) => {
    const r = frame.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const scroller = () => frame.current?.parentElement
  const down = (e) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = marking ? { mark: at(e) } : { pan: { x: e.clientX, y: e.clientY, left: scroller().scrollLeft, top: scroller().scrollTop } }
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    if (d.mark) setDraft(boxFrom(d.mark, at(e)))
    else if (zoom > 1) {
      scroller().scrollLeft = d.pan.left - (e.clientX - d.pan.x)
      scroller().scrollTop = d.pan.top - (e.clientY - d.pan.y)
    }
  }
  const up = (e) => {
    const d = drag.current
    drag.current = null
    if (!d?.mark) return
    const box = boxFrom(d.mark, at(e))
    setDraft(null)
    if (bigEnough(box)) setMarks((m) => [...m, { ...box, note: "" }].slice(0, 12))
  }
  const wheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    setZoom((z) => nextZoom(z, e.deltaY < 0 ? 1 : -1))
  }
  return (
    <div className="max-h-[65svh] overflow-auto rounded-md border bg-muted/10" onWheel={wheel}>
      <div
        ref={frame}
        className={cn("relative mx-auto select-none", marking || zoom > 1 ? "touch-none" : "", marking ? "cursor-crosshair" : zoom > 1 ? "cursor-grab" : "")}
        style={{ width: `${zoom * 100}%`, aspectRatio: `${image.width} / ${image.height}`, maxWidth: zoom === 1 ? `calc(65svh * ${image.width / image.height})` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => ((drag.current = null), setDraft(null))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={image.prompt} draggable={false} className="pointer-events-none size-full object-contain" />
        {[...marks, ...(draft ? [{ ...draft, draft: true }] : [])].map((m, i) => (
          <span key={i} className={cn("pointer-events-none absolute border-2", m.draft ? "border-dashed border-sky-400" : "border-rose-500")} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
            {!m.draft && <span className="absolute -top-5 left-0 rounded bg-rose-500 px-1 text-[11px] text-white">{i + 1}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// The image with the marks drawn (numbered, for the agent's eyes) and the mask (white where they are), as PNG data.
async function drawMarks(url, marks) {
  const img = new Image()
  img.src = url
  await img.decode()
  const { naturalWidth: w, naturalHeight: h } = img
  const paint = (draw) => {
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    draw(c.getContext("2d"))
    return c.toDataURL("image/png")
  }
  const line = Math.max(3, Math.round(w / 200))
  const tag = Math.round(w / 22)
  const marked = paint((g) => {
    g.drawImage(img, 0, 0)
    g.lineWidth = line
    g.font = `${Math.round(tag * 0.8)}px sans-serif`
    marks.forEach((m, i) => {
      g.strokeStyle = "#f43f5e"
      g.strokeRect(m.x * w, m.y * h, m.w * w, m.h * h)
      const top = Math.max(0, m.y * h - tag)
      g.fillStyle = "#f43f5e"
      g.fillRect(m.x * w, top, g.measureText(String(i + 1)).width + line * 4, tag)
      g.fillStyle = "#fff"
      g.fillText(String(i + 1), m.x * w + line * 2, top + tag * 0.8)
    })
  })
  const mask = paint((g) => {
    g.fillStyle = "#000"
    g.fillRect(0, 0, w, h)
    g.fillStyle = "#fff"
    for (const m of marks) g.fillRect(m.x * w, m.y * h, m.w * w, m.h * h)
  })
  return { marked, mask }
}

function Detail({ id, state, image }) {
  const { busy, note, call } = useCall(id)
  const [feedback, setFeedback] = React.useState("")
  const [strength, setStrength] = React.useState(0.5)
  const [zoom, setZoom] = React.useState(1)
  const [marking, setMarking] = React.useState(false)
  const [marks, setMarks] = React.useState([])
  const [sending, setSending] = React.useState(null) // the marks on their way (uploaded first), or why they were not sent
  const url = imageUrl(image)
  const chain = lineage(state, image.id)
  const live = ["queued", "running"].includes(image.status)
  const maskable = canEdit(state, "mask")
  const maker = image.by === "owner" ? "the studio's agent" : image.by
  const text = () => feedback.trim() || (marks.length ? `Change the marked areas: ${marksText(marks)}` : "")
  // the marks go with the call: the marked image (the agent sees it) and the mask, uploaded first
  const withMarks = async (then) => {
    if (!marks.length) return then({})
    setSending("uploading the marks…")
    try {
      const { marked, mask } = await drawMarks(url, marks)
      const said = marksText(marks)
      const [a, b] = await Promise.all([uploadImage({ kind: "marked", data: marked, from: image.id, note: said }), uploadImage({ kind: "mask", data: mask, from: image.id, note: said })])
      // the marks stay when the call is refused (audit 20: they were cleared either way)
      const ok = await then({ marks, marked: a.job.id, mask: b.job.id })
      setSending(null)
      if (!ok) return
      setMarks([])
      setMarking(false)
    } catch (error) {
      setSending(`marks not sent: ${error.message}`)
    }
  }
  return (
    <section aria-label={`Image ${image.id}`} className="flex flex-col gap-2">
      {url ? (
        <>
          <ImageStage image={image} url={url} marks={marks} setMarks={setMarks} marking={marking} zoom={zoom} setZoom={setZoom} />
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Button size="icon" variant="ghost" className="size-9 pointer-coarse:size-10" onClick={() => setZoom((z) => nextZoom(z, -1))} disabled={zoom <= 1} aria-label="Zoom out">
              <ZoomOutIcon />
            </Button>
            <span className="w-10 text-center tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="ghost" className="size-9 pointer-coarse:size-10" onClick={() => setZoom((z) => nextZoom(z, 1))} disabled={zoom >= 4} aria-label="Zoom in">
              <ZoomInIcon />
            </Button>
            <Button size="icon" variant="ghost" className="size-9 pointer-coarse:size-10" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Fit">
              <MaximizeIcon />
            </Button>
            <Button size="sm" variant={marking ? "secondary" : "outline"} className={cn("pointer-coarse:h-10", marking && "border-rose-500 text-rose-600 dark:text-rose-400")} onClick={() => setMarking((m) => !m)} aria-pressed={marking}>
              <BrushIcon /> {marking ? "Marking: drag boxes" : "Mark"}
            </Button>
            {marks.length > 0 && (
              <Button size="sm" variant="ghost" className="pointer-coarse:h-10" onClick={() => setMarks([])}>
                <Trash2Icon /> Clear {marks.length}
              </Button>
            )}
            <a href={url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLinkIcon className="size-3.5" /> full size
            </a>
          </div>
          {marks.length > 0 && (
            <ol className="flex flex-col gap-1">
              {marks.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-rose-500 text-[11px] text-white">{i + 1}</span>
                  <span className="w-24 shrink-0 text-muted-foreground">{placeOf(m)}</span>
                  <input value={m.note} onChange={(e) => setMarks((all) => all.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder="what should change here" aria-label={`Note for mark ${i + 1}`} className={cn(field, "py-1")} />
                  <button type="button" onClick={() => setMarks((all) => all.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center text-muted-foreground hover:text-destructive pointer-coarse:size-10" aria-label={`Remove mark ${i + 1}`}>
                    <Trash2Icon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-md border text-sm text-muted-foreground">
          <ImageIcon className="size-5" />
          {image.status === "running" ? `step ${image.step}/${image.steps}` : image.status}
          {image.status === "running" && (
            <span className="h-1 w-1/2 overflow-hidden rounded bg-muted">
              <span className="block h-full bg-sky-500 transition-[width] duration-500" style={{ width: `${progress(image) * 100}%` }} />
            </span>
          )}
          {image.error && <span className="max-w-md px-3 text-center text-xs text-destructive">{image.error}</span>}
        </div>
      )}
      <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground/80">{image.id}</span>
        <span>{image.v ? `prompt v${image.v}` : "own prompt"}</span>
        {image.preset && <span>preset {image.preset}</span>}
        {image.mode === "edit" && <span>edit{image.mask ? " under a mask" : image.auto_mask ? ` · repaint “${image.auto_mask}”` : ""}</span>}
        <span>seed {image.seed}</span>
        <span>
          {image.width}×{image.height} · {image.steps} steps
        </span>
        {image.ms ? <span>{Math.round(image.ms / 1000)} s</span> : null}
        <span>by {image.by}</span>
      </p>
      {chain.length > 1 && <p className="text-[11px] text-muted-foreground">refined: {chain.map((x) => `${x.id}${x.strength ? `@${x.strength}` : ""}`).join(" → ")}</p>}
      <p className="whitespace-pre-wrap break-words text-xs">{image.prompt}</p>
      {image.sent && image.sent !== image.prompt && <p className="break-words text-[11px] text-muted-foreground">sent with the preset: {image.sent}</p>}
      {image.negative && <p className="text-xs text-muted-foreground">without: {image.negative}</p>}
      {image.critiques?.map((c, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-md border px-2 py-1.5 text-xs">
          <p className="flex flex-wrap items-center gap-x-2">
            <span>{c.by}</span>
            <span className={cn("tabular-nums", VERDICT[c.verdict])}>
              {c.score}/10 · {c.verdict}
            </span>
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(c.scores ?? {}).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <span className="text-muted-foreground">{k}</span>
                <span className="inline-block h-1 w-10 overflow-hidden rounded bg-muted">
                  <span className="block h-full bg-foreground/60" style={{ width: `${v * 10}%` }} />
                </span>
                <span className="tabular-nums">{v}</span>
              </span>
            ))}
          </div>
          <p className="break-words text-muted-foreground">{c.notes}</p>
          {c.next && <p className="break-words">→ {c.next}</p>}
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor={`fb-${image.id}`}>
          Request a change (goes to {maker}
          {marks.length ? `, with ${marks.length} mark${marks.length === 1 ? "" : "s"}` : ""}) — Mark points at areas
        </label>
        <textarea id={`fb-${image.id}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} className={field} placeholder={marks.length ? "say what to do there, e.g. Add a small red bird standing on the snow · Replace the moon with a crescent" : "e.g. the sky is too busy; warmer window light"} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="pointer-coarse:h-10" disabled={busy || sending === "uploading the marks…" || !text()} onClick={() => withMarks((extra) => call("feedback", { image: image.id, text: text(), ...extra }, () => setFeedback("")))}>
            Request change
          </Button>
          {maskable && marks.length > 0 && (
            <Button size="sm" variant="outline" className="pointer-coarse:h-10" disabled={busy || !feedback.trim() || image.status !== "done"} onClick={() => withMarks((extra) => call("generate", { prompt: feedback.trim(), from: image.id, mask: extra.mask }, () => setFeedback("")))} title="Repaint only the marked areas now, no agent (the model's edit mode under a mask)">
              <BrushIcon /> Edit marked areas
            </Button>
          )}
          <Button size="sm" variant="outline" className="pointer-coarse:h-10" disabled={busy || image.status !== "done"} onClick={() => call("generate", { prompt: feedback.trim() ? `${image.prompt}. ${feedback.trim()}` : image.prompt, from: image.id, strength })}>
            <WandSparklesIcon /> Refine from it
          </Button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            strength
            <input type="range" min={0.1} max={0.9} step={0.1} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Refine strength" className="w-20 accent-foreground" />
            <span className="tabular-nums">{strength}</span>
          </label>
          <Button size="sm" variant="ghost" className="pointer-coarse:h-10" disabled={busy || image.status !== "done"} onClick={() => call("pick", { image: image.id })}>
            <StarIcon /> Pick
          </Button>
          {live && (
            <Button size="sm" variant="ghost" className="text-destructive pointer-coarse:h-10" disabled={busy} onClick={() => call("stop", { image: image.id })}>
              <SquareIcon /> Stop
            </Button>
          )}
          <DeleteButton busy={busy} confirm={live ? "Stop and delete?" : "Delete for good?"} onConfirm={() => call("delete", { image: image.id })} />
        </div>
        {sending && <p className={cn("text-xs", sending.startsWith("marks not") ? "text-destructive" : "text-muted-foreground")}>{sending}</p>}
        {note && <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</p>}
      </div>
    </section>
  )
}

function GoalForm({ id, state }) {
  const { busy, note, call } = useCall(id)
  const [goal, setGoal] = React.useState("")
  const [criteria, setCriteria] = React.useState("")
  const [preset, setPreset] = React.useState("auto")
  const options = presetOptions(state, { auto: true })
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        call("goal", { goal, criteria, preset }, () => (setGoal(""), setCriteria("")))
      }}
    >
      <label className="text-xs text-muted-foreground" htmlFor={`${id}-goal`}>
        {state?.goal ? "A new goal (the agent optimises the prompt, settles the preset, generates, critiques and refines until it is met)" : "What should the image be? (the agent expands it, settles the preset, generates, critiques and refines)"}
      </label>
      <textarea id={`${id}-goal`} value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} className={field} placeholder="e.g. a book cover: a lighthouse on a basalt cliff at dusk, room for the title at the top" />
      <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2} className={field} aria-label="What done means" placeholder={"What done means, one per line (optional)\ne.g. warm window light\nclear sky in the top third"} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Preset" className="h-9 max-w-full rounded-md border bg-background px-1 text-base md:text-xs" title={options.find((o) => o.value === preset)?.hint ?? "the workflow settles it: yours, or the one that looks better on quick drafts"}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" className="pointer-coarse:h-10" disabled={busy || !goal.trim()}>
          Start
        </Button>
        {note && <span className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</span>}
      </div>
    </form>
  )
}

function QuickGenerate({ id, state }) {
  const { busy, note, call } = useCall(id)
  const [prompt, setPrompt] = React.useState("")
  const [size, setSize] = React.useState("1024x1024")
  const [steps, setSteps] = React.useState(20)
  const [seed, setSeed] = React.useState("")
  const [preset, setPreset] = React.useState("none")
  const [w, h] = size.split("x").map(Number)
  const shaped = preset !== "none" // a preset sets its own size and steps
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        call("generate", { prompt, preset, ...(shaped ? {} : { width: w, height: h, steps }), seed: seed === "" ? null : Number(seed) })
      }}
    >
      <label className="text-xs text-muted-foreground" htmlFor={`${id}-prompt`}>
        Generate now, no agent (your prompt as written, with the preset if you choose one)
      </label>
      <textarea id={`${id}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={field} placeholder="a prompt for the image model" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Preset" className="h-9 max-w-full rounded-md border bg-background px-1 text-base md:text-xs">
          {presetOptions(state).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value)} disabled={shaped} aria-label="Size" className="h-9 rounded-md border bg-background px-1 text-base disabled:opacity-50 md:text-xs">
          {["768x768", "1024x1024", "1344x768", "768x1344", "1536x1024"].map((s) => (
            <option key={s} value={s}>
              {s.replace("x", "×")}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-muted-foreground">
          steps
          <input type="number" min={1} max={80} value={steps} disabled={shaped} onChange={(e) => setSteps(Number(e.target.value))} className="h-9 w-16 rounded-md border bg-background px-1 text-base disabled:opacity-50 md:text-xs" />
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">
          seed
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="random" className="h-9 w-24 rounded-md border bg-background px-1 text-base md:text-xs" />
        </label>
        <Button type="submit" size="sm" className="pointer-coarse:h-10" disabled={busy || !prompt.trim()}>
          Generate
        </Button>
        {note && <span className={cn(note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</span>}
      </div>
    </form>
  )
}

export function StudioView({ id, state, expanded }) {
  const images = state?.images ?? []
  const best = bestImage(state)
  const [selected, setSelected] = React.useState(null)
  const [picking, setPicking] = React.useState(false) // choosing images to delete
  const [chosen, setChosen] = React.useState([])
  const bulk = useCall(id)
  const toggle = (iid) => setChosen((c) => (c.includes(iid) ? c.filter((x) => x !== iid) : [...c, iid]))
  const endPicking = () => (setPicking(false), setChosen([]))
  const shown = images.find((i) => i.id === selected) ?? images.find((i) => ["running", "queued"].includes(i.status)) ?? best
  if (!expanded) {
    const url = imageUrl(best)
    const c = lastCritique(best)
    return (
      <div className="mt-1 flex items-center gap-2 text-xs">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={best.prompt?.slice(0, 80)} className="size-16 rounded object-cover" />
        ) : (
          <span className="grid size-16 place-items-center rounded border text-muted-foreground">
            <ImageIcon className="size-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 break-words">{state?.goal?.text ?? "No goal yet: open it to start one."}</span>
          {c && (
            <span className={cn("tabular-nums", VERDICT[c.verdict])}>
              {c.score}/10 {c.verdict}
            </span>
          )}
        </span>
      </div>
    )
  }
  return (
    <div className="mt-1 flex flex-col gap-3">
      <section aria-label="Goal" className="flex flex-col gap-1">
        {state?.goal ? (
          <>
            <p className="text-sm">{state.goal.text}</p>
            {state.criteria?.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {state.criteria.map((c) => (
                  <li key={c} className="rounded border px-1.5 py-0.5">
                    {c}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              preset: {state.preset ? `${state.preset.name} — ${state.preset.why}` : state.goal.preset && state.goal.preset !== "auto" ? `${state.goal.preset} asked` : "not settled yet (the agent compares and picks)"}
            </p>
          </>
        ) : null}
        <GoalForm id={id} state={state} />
      </section>
      {state?.prompts?.length > 0 && (
        <details className="text-xs" open={state.prompts.length <= 2}>
          <summary className="cursor-pointer text-muted-foreground">Prompt versions ({state.prompts.length}) — how the prompt was optimised</summary>
          <ol className="mt-1 flex flex-col gap-1.5">
            {[...state.prompts].reverse().map((p) => (
              <li key={p.v} className="rounded-md border px-2 py-1.5">
                <p className="text-muted-foreground">
                  v{p.v} · {p.by} · {p.why}
                </p>
                <p className="whitespace-pre-wrap break-words">{p.text}</p>
                {p.negative && <p className="text-muted-foreground">without: {p.negative}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        {shown ? <Detail key={shown.id} id={id} state={state} image={shown} /> : <p className="text-sm text-muted-foreground">No images yet.</p>}
        {images.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {picking ? (
                <>
                  <span className="text-muted-foreground">{chosen.length} selected</span>
                  <Button size="sm" variant="ghost" className="pointer-coarse:h-10" onClick={() => setChosen(chosen.length === images.length ? [] : images.map((i) => i.id))}>
                    {chosen.length === images.length ? "None" : "All"}
                  </Button>
                  {chosen.length > 0 && <DeleteButton busy={bulk.busy} label={`Delete ${chosen.length}`} confirm={`Delete ${chosen.length} for good?`} onConfirm={() => bulk.call("delete", { images: chosen }, endPicking)} />}
                  <Button size="sm" variant="ghost" className="pointer-coarse:h-10" onClick={endPicking}>
                    Done
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" className="pointer-coarse:h-10" onClick={() => setPicking(true)}>
                  <CheckIcon /> Select
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 content-start gap-1.5 sm:grid-cols-4 lg:grid-cols-3">
              {images.map((i) => (
                <Thumb key={i.id} image={i} selected={i.id === shown?.id} onSelect={picking ? toggle : setSelected} best={state?.picked?.image === i.id} picking={picking} picked={chosen.includes(i.id)} />
              ))}
            </div>
            {bulk.note && <p className={cn("text-xs", bulk.note.ok ? "text-muted-foreground" : "text-destructive")}>{bulk.note.text}</p>}
          </div>
        )}
      </div>
      {state?.feedback?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Your feedback ({state.feedback.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {[...state.feedback].reverse().map((f) => (
              <li key={f.id}>
                <span className="text-muted-foreground">
                  {f.id}
                  {f.image ? ` on ${f.image}` : ""}:
                </span>{" "}
                {f.text}
                {f.marks?.length ? <span className="text-muted-foreground"> · {f.marks.length} mark{f.marks.length === 1 ? "" : "s"}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      <QuickGenerate id={id} state={state} />
      <details className="rounded-md border px-2 py-1.5 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Model: {state?.model?.title ?? "…"}
          {state?.model?.accepts?.length ? ` — takes ${state.model.accepts.filter((a) => a !== "prompt").join(", ")}` : ""}
          {state?.preset ? ` · preset in use: ${state.preset.name}` : ""}
        </summary>
        <div className="mt-2">
          <ModelPanel kind="image" />
        </div>
        {state?.presets?.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            {state.presets.map((p) => (
              <li key={p.name}>
                <span className="text-foreground/80">{p.title}</span>
                {p.size ? ` · ${p.size}` : ""} — {p.when}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
