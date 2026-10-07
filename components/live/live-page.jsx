"use client"

import * as React from "react"
import {
  BotIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  FileIcon,
  FilePenIcon,
  FilePlusIcon,
  FileXIcon,
  FolderIcon,
  GlobeIcon,
  HandIcon,
  ListChecksIcon,
  LoaderIcon,
  MonitorIcon,
  PauseIcon,
  RadioIcon,
  SendIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"

import {
  beforeOf,
  captureBefore,
  eventTarget,
  isFileEvent,
  liveArtifacts,
  liveFeed,
  runFor,
  termRuns,
} from "@/backend/features/live/follow"
import { workspace } from "@/backend/features/filesystem/workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useEngineStates, useEngines } from "@/hooks/use-engines"
import { diffLines, diffStats } from "@/lib/line-diff"
import { cn } from "@/lib/utils"

const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "")

const VIEW_ICONS = {
  terminal: TerminalIcon,
  quest: BotIcon,
  web: GlobeIcon,
  browser: MonitorIcon,
  checklist: ListChecksIcon,
  schedule: CalendarClockIcon,
}

function toolIcon(event) {
  if (event.name === "fs.write") return FilePlusIcon
  if (event.name === "fs.delete") return FileXIcon
  if (event.view === "file") return isFileEvent(event) ? FilePenIcon : FileIcon
  return VIEW_ICONS[event.view] ?? WrenchIcon
}

function StateMark({ event, className }) {
  if (event.state === "running") return <LoaderIcon className={cn("size-3.5 shrink-0 animate-spin text-sky-500", className)} aria-label="Running" />
  if (event.state === "approval") return <HandIcon className={cn("size-3.5 shrink-0 text-amber-500", className)} aria-label="Waiting for approval" />
  if (event.skipped) return <CircleDotIcon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-label="Skipped" />
  return event.ok ? (
    <CheckIcon className={cn("size-3.5 shrink-0 text-emerald-500", className)} aria-label="Succeeded" />
  ) : (
    <XIcon className={cn("size-3.5 shrink-0 text-destructive", className)} aria-label="Failed" />
  )
}

const panel = "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border"
const block = "max-h-[40svh] overflow-auto rounded-md border p-3 font-mono text-[12px] whitespace-pre-wrap break-words"

// ── feed ────────────────────────────────────────────────────────────────

function FeedRow({ event, selected, onSelect }) {
  const Icon = toolIcon(event)
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-2 border-l-2 px-3 py-2 text-left text-xs hover:bg-muted/50 pointer-coarse:py-3",
        selected ? "border-l-primary bg-muted/40" : "border-l-transparent",
        !event.view && "opacity-60"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{event.name}</span>
          <span className="shrink-0 text-muted-foreground">· {event.agent}</span>
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{eventTarget(event)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StateMark event={event} />
        <span className="text-[10px] text-muted-foreground tabular-nums">{time(event.at)}</span>
      </span>
    </button>
  )
}

// ── terminal ────────────────────────────────────────────────────────────

// Strips term.run's own first line ("$ cmd (in cwd) → exit …") from its output.
function splitTermOutput(output = "") {
  const [head, ...rest] = output.split("\n")
  return head.startsWith("$ ") ? { head, body: rest.join("\n") } : { head: null, body: output }
}

function useStickToBottom(dep) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

function Screen({ title, status, children, footer, text, live }) {
  const scroller = useStickToBottom(text)
  return (
    <section aria-label={typeof title === "string" ? title : "Terminal"} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-black text-zinc-100">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <TerminalIcon className="size-3.5" />
        {title}
        <span className="ml-auto flex items-center gap-1.5">{status}</span>
      </header>
      <div ref={scroller} className="min-h-32 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
        {children}
        {text}
        {live && <span className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-zinc-300" aria-hidden />}
      </div>
      {footer && <footer className="border-t border-zinc-800 px-3 py-1.5 font-mono text-[11px] break-all text-zinc-500">{footer}</footer>}
    </section>
  )
}

const exitBadge = (exit) => (exit == null ? null : <Badge variant={String(exit) === "0" ? "secondary" : "destructive"}>exit {exit}</Badge>)

function TerminalCall({ event, runs }) {
  const inputs = event.inputs ?? {}
  if (event.name !== "term.run") return <TermToolCall event={event} />
  // Live text: the host's stream of this run (all of it, as it prints), else
  // the call's own progress (engine state: its last 4K), else its final output.
  const run = runFor(event, runs)
  const done = event.state === "done"
  const { head, body } = done ? splitTermOutput(event.output) : { head: null, body: run?.text || event.progress?.text || "" }
  const exit = done ? head?.match(/→ exit (\d+)/)?.[1] : (event.progress?.data?.exit ?? (run?.done ? run.exit : null))
  return (
    <Screen
      title={
        <>
          <span>{event.agent}</span>
          <span className="font-mono break-all">~/{inputs.cwd && inputs.cwd !== "." ? inputs.cwd : ""}</span>
        </>
      }
      status={
        <>
          {event.state === "running" && (body ? "running" : "starting…")}
          {event.state === "approval" && "waiting for approval"}
          {exitBadge(exit)}
          {done && !event.ok && !head && <Badge variant="destructive">failed</Badge>}
        </>
      }
      footer={head}
      text={body || (done ? "(no output)" : "")}
      live={event.state === "running"}
    >
      <span className="text-emerald-400">$ </span>
      <span>{inputs.command}</span>
      {"\n"}
    </Screen>
  )
}

// term.start / ps / logs / stop: the call, then its answer, as terminal text.
function TermToolCall({ event }) {
  const inputs = event.inputs ?? {}
  const line = event.name === "term.start" ? `start ${inputs.name ? `[${inputs.name}] ` : ""}${inputs.command}` : `${event.name.slice(5)} ${inputs.id ?? ""}`
  return (
    <Screen
      title={<span>{event.agent}</span>}
      status={event.state === "done" ? (event.ok ? <Badge variant="secondary">ok</Badge> : <Badge variant="destructive">failed</Badge>) : event.state}
      text={event.state === "done" ? event.output : ""}
      live={event.state === "running"}
    >
      <span className="text-sky-400">● </span>
      <span>{line}</span>
      {"\n"}
    </Screen>
  )
}

// ── files ───────────────────────────────────────────────────────────────

const OPS = { "fs.write": "W", "fs.edit": "E", "fs.append": "A", "fs.delete": "D" }
const OP_COLOR = { "fs.write": "text-emerald-500", "fs.edit": "text-sky-500", "fs.append": "text-sky-500", "fs.delete": "text-destructive" }

// The latest change per path, from the feed.
function touchedFiles(events) {
  const latest = new Map()
  for (const event of events) if (isFileEvent(event) && event.inputs?.path) latest.set(event.inputs.path, event)
  return latest
}

// Paths → nested { dirs, files } for a small tree.
function pathTree(paths) {
  const root = { dirs: new Map(), files: [] }
  for (const path of [...paths].sort()) {
    const parts = path.split("/").filter(Boolean)
    let node = root
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] })
      node = node.dirs.get(dir)
    }
    node.files.push({ name: parts.at(-1), path })
  }
  return root
}

function FileRow({ name, path, depth, selected, touched, onOpen }) {
  return (
    <button
      type="button"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onOpen(path)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-muted/50 pointer-coarse:py-2.5",
        selected && "bg-muted/40 text-foreground",
        !touched && "text-muted-foreground"
      )}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", touched?.name === "fs.delete" && "line-through")}>{name}</span>
      {touched && <span className={cn("shrink-0 font-mono text-[10px]", OP_COLOR[touched.name])}>{OPS[touched.name]}</span>}
      {touched && <StateMark event={touched} className="size-3" />}
    </button>
  )
}

function DirRow({ name, depth }) {
  return (
    <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
      <FolderIcon className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </div>
  )
}

function PathTreeView({ node, depth = 0, selected, touched, onOpen }) {
  return (
    <>
      {[...node.dirs].map(([name, child]) => (
        <React.Fragment key={`d-${name}`}>
          <DirRow name={name} depth={depth} />
          <PathTreeView node={child} depth={depth + 1} selected={selected} touched={touched} onOpen={onOpen} />
        </React.Fragment>
      ))}
      {node.files.map(({ name, path }) => (
        <FileRow key={path} name={name} path={path} depth={depth} selected={path === selected} touched={touched.get(path)} onOpen={onOpen} />
      ))}
    </>
  )
}

// The workspace tree the filesystem artifact publishes (entries with
// children). Folders start closed, except the ones holding files the team
// touched; a click opens or closes one.
function WorkspaceTreeView({ entries, parent = "", depth = 0, selected, touched, onOpen, open, onToggle }) {
  return entries.map((entry) => {
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.type === "omitted") return <div key={`o-${path}`} style={{ paddingLeft: `${depth * 12 + 8}px` }} className="py-1 text-[11px] text-muted-foreground">… {entry.omitted} more</div>
    if (entry.type === "dir") {
      const expanded = open.has(path)
      return (
        <React.Fragment key={`d-${path}`}>
          <button
            type="button"
            onClick={() => onToggle(path)}
            aria-expanded={expanded}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            className="flex w-full min-w-0 items-center gap-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50 pointer-coarse:py-2.5"
          >
            <FolderIcon className={cn("size-3.5 shrink-0", expanded && "text-foreground")} />
            <span className="truncate">
              {entry.name}
              {entry.skipped ? " …" : ""}
            </span>
          </button>
          {expanded && entry.children && (
            <WorkspaceTreeView entries={entry.children} parent={path} depth={depth + 1} selected={selected} touched={touched} onOpen={onOpen} open={open} onToggle={onToggle} />
          )}
        </React.Fragment>
      )
    }
    return <FileRow key={path} name={entry.name} path={path} depth={depth} selected={path === selected} touched={touched.get(path)} onOpen={onOpen} />
  })
}

// Every folder above a path: "a/b/c.py" -> ["a", "a/b"].
const ancestors = (path) => path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))

function DiffView({ rows }) {
  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {rows.map((row, i) =>
        row.op === "…" ? (
          <div key={i} className="border-y border-dashed px-3 py-0.5 text-[11px] text-muted-foreground">
            ⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"}
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)] whitespace-pre-wrap break-words",
              row.op === "+" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              row.op === "-" && "bg-red-500/10 text-red-700 dark:text-red-300"
            )}
          >
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{row.a ?? ""}</span>
            <span className="pr-2 text-right text-muted-foreground/60 select-none">{row.b ?? ""}</span>
            <span className="select-none">{row.op === " " ? "" : row.op}</span>
            <span>{row.text || " "}</span>
          </div>
        )
      )}
    </div>
  )
}

function FileChange({ event, events }) {
  const [before, setBefore] = React.useState(undefined)
  React.useEffect(() => {
    let live = true
    beforeOf(event, events).then((found) => live && setBefore(found))
    return () => {
      live = false
    }
  }, [event, events])

  const inputs = event.inputs ?? {}
  let rows = null
  let note = null
  if (event.name === "fs.edit") {
    rows = diffLines(inputs.old ?? "", inputs.new ?? "", { context: 2 })
    note = "The replaced passage (fs.edit replaces one exact match)."
  } else if (event.name === "fs.append") {
    rows = (inputs.text ?? "").split("\n").map((text, i) => ({ op: "+", text, b: i + 1 }))
    note = "Added at the end of the file."
  } else if (event.name === "fs.write" && before !== undefined) {
    rows = diffLines(before?.text ?? "", inputs.text ?? "")
    if (!before) note = /^Updated/.test(event.output ?? "") ? "Earlier version not seen: the whole file is shown as written." : "New file."
    else if (before.source === "feed") note = "Compared with the team's previous write of this file."
  }
  const stats = rows ? diffStats(rows) : null

  return (
    <section aria-label="File change" className={panel}>
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <StateMark event={event} />
        <span className="min-w-0 font-mono break-all">{inputs.path}</span>
        <span className="text-muted-foreground">
          · {event.name} · {event.agent}
        </span>
        {stats && (
          <span className="ml-auto font-mono">
            <span className="text-emerald-500">+{stats.added}</span> <span className="text-red-500">−{stats.removed}</span>
          </span>
        )}
      </header>
      {note && <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">{note}</p>}
      {event.name === "fs.delete" ? (
        <p className="p-3 text-sm text-destructive">Deleted{inputs.recursive ? " with everything in it" : ""}.</p>
      ) : rows ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <DiffView rows={rows} />
        </div>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">Reading the file…</p>
      )}
      {event.state === "done" && !event.ok && <p className="border-t px-3 py-2 text-xs break-words text-destructive">{event.output}</p>}
    </section>
  )
}

// fs.read / fs.list / fs.open: what the agent looked at.
function FileLook({ event }) {
  return (
    <section aria-label="File read" className={panel}>
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <StateMark event={event} />
        <span className="min-w-0 font-mono break-all">{event.inputs?.path || "."}</span>
        <span className="text-muted-foreground">
          · {event.name} · {event.agent}
        </span>
      </header>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] whitespace-pre-wrap break-words">
        {event.state === "done" ? event.output || "(empty)" : "Reading…"}
      </pre>
    </section>
  )
}

function FileCall({ event, events, onSelect }) {
  const touched = React.useMemo(() => touchedFiles(events), [events])
  const tree = React.useMemo(() => pathTree(touched.keys()), [touched])
  if (!isFileEvent(event)) return <FileLook event={event} />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
      <nav aria-label="Files the team touched" className="max-h-48 shrink-0 overflow-auto rounded-lg border py-1 xl:max-h-none xl:w-56">
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">Files touched</p>
        <PathTreeView node={tree} selected={event.inputs?.path} touched={touched} onOpen={(path) => onSelect(touched.get(path).id)} />
      </nav>
      <FileChange key={event.id} event={event} events={events} />
    </div>
  )
}

// ── other calls ─────────────────────────────────────────────────────────

function CallPanel({ event }) {
  const quest = event.view === "quest" ? (event.inputs?.quest ?? event.inputs?.guidance) : null
  const url = event.inputs?.url
  return (
    <section aria-label="Tool call" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StateMark event={event} />
        <span>{event.kind === "agent" ? `Quest to ${event.name}` : event.name}</span>
        <span className="text-xs text-muted-foreground">
          from {event.agent} · {time(event.at)}
        </span>
        {!event.view && <Badge variant="outline">log only</Badge>}
      </header>
      {event.summary && <p className="text-sm break-words">{event.summary}</p>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs break-all text-sky-500 hover:underline">
          <ExternalLinkIcon className="size-3 shrink-0" />
          {url}
        </a>
      )}
      {quest ? <div className={block}>{quest}</div> : <pre className={block}>{JSON.stringify(event.inputs, null, 2)}</pre>}
      {event.progress?.text && event.state !== "done" && <pre className={block}>{event.progress.text}</pre>}
      {event.state === "done" ? (
        <>
          <p className="text-xs text-muted-foreground">Result</p>
          <pre className={cn(block, !event.ok && "text-destructive")}>{event.output || "(empty)"}</pre>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{event.state === "approval" ? "Waiting for the owner's approval in the chat." : "Running…"}</p>
      )}
    </section>
  )
}

function CallView({ event, events, runs, onSelect }) {
  if (!event) return <p className="text-sm text-muted-foreground">Nothing selected.</p>
  if (event.view === "terminal") return <TerminalCall key={event.id} event={event} runs={runs} />
  if (event.view === "file") return <FileCall event={event} events={events} onSelect={onSelect} />
  return <CallPanel event={event} />
}

// ── live artifacts ──────────────────────────────────────────────────────

// The workspace as the filesystem artifact last published it, the files the
// team changed marked, and the file you pick read fresh.
function WorkspaceView({ snapshot, shared, events, onSelect }) {
  const touched = React.useMemo(() => touchedFiles(events), [events])
  const [path, setPath] = React.useState(null)
  const [toggled, setToggled] = React.useState(() => new Map()) // folder -> open (the owner's clicks)
  const open = React.useMemo(() => {
    const set = new Set([...touched.keys()].flatMap(ancestors))
    if (path) ancestors(path).forEach((dir) => set.add(dir))
    for (const [dir, isOpen] of toggled) isOpen ? set.add(dir) : set.delete(dir)
    return set
  }, [touched, toggled, path])
  const toggle = (dir) => setToggled((m) => new Map(m).set(dir, !open.has(dir)))
  // The workspace tree leaves shared/ to the shared artifact: put it back.
  const entries = React.useMemo(() => {
    const tree = snapshot?.data?.tree ?? []
    const sharedTree = shared?.data?.tree
    if (!sharedTree || tree.some((e) => e.type === "dir" && e.name === shared.data.folder)) return tree
    return [...tree, { type: "dir", name: shared.data.folder || "shared", children: sharedTree }]
  }, [snapshot, shared])
  const [file, setFile] = React.useState(null)
  const version = `${snapshot?.version}-${shared?.version}`
  const latest = touched.get(path)

  React.useEffect(() => {
    if (!path) return
    let live = true
    workspace()
      .then((ws) => ws.read(path))
      .then((read) => live && setFile(read))
      .catch((error) => live && setFile({ error: error.message }))
    return () => {
      live = false
    }
  }, [path, version, latest?.id])

  const data = snapshot?.data
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
      <nav aria-label="Workspace" className="max-h-64 shrink-0 overflow-auto rounded-lg border py-1 xl:max-h-none xl:w-64">
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          {data ? `Workspace · ${snapshot.agent} · v${snapshot.version} · ${time(snapshot.at)}` : "Files touched"}
        </p>
        {data?.error && <p className="px-2 text-xs text-destructive">{data.error}</p>}
        {data ? (
          <WorkspaceTreeView entries={entries} selected={path} touched={touched} onOpen={setPath} open={open} onToggle={toggle} />
        ) : (
          <PathTreeView node={pathTree(touched.keys())} selected={path} touched={touched} onOpen={setPath} />
        )}
      </nav>
      <section aria-label="File" className={panel}>
        {!path ? (
          <p className="p-3 text-xs text-muted-foreground">Pick a file. Files the team changed are marked W (written), E (edited), A (appended), D (deleted).</p>
        ) : (
          <>
            <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
              <span className="min-w-0 font-mono break-all">{path}</span>
              {latest && (
                <button type="button" className="ml-auto text-sky-500 hover:underline" onClick={() => onSelect(latest.id)}>
                  last change: {latest.name} by {latest.agent} at {time(latest.at)}
                </button>
              )}
            </header>
            <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] whitespace-pre-wrap break-words">
              {file?.error ?? (file?.binary ? "(binary file)" : (file?.text ?? "Reading…"))}
            </pre>
          </>
        )}
      </section>
    </div>
  )
}

// Background processes (term.start) and recent runs, from the host's stream.
function TerminalView({ terminal, events, snapshot }) {
  const live = events.filter((e) => e.name === "term.run" && e.state !== "done")
  // Runs seen on the stream since this page opened, else the last runs the
  // terminal artifact published.
  const streamed = terminal.runs.filter((r) => r.done).slice(-5).reverse()
  const published = (snapshot?.data?.runs ?? []).map((r) => ({ id: `${r.at}-${r.command}`, agent: r.agent, command: r.command, exit: r.exit, text: r.tail ?? "" })).reverse()
  const recent = streamed.length ? streamed : published
  const procs = [...terminal.procs].reverse()
  if (!terminal.available && !snapshot) return <p className="text-sm text-muted-foreground">This desk has no terminal.</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {live.map((event) => (
        <div key={event.id} className="flex min-h-48 flex-col">
          <TerminalCall event={event} runs={terminal.runs} />
        </div>
      ))}
      <section aria-label="Background processes" className="flex flex-col gap-2">
        <h2 className="text-sm">Background processes</h2>
        {!procs.length && <p className="text-xs text-muted-foreground">None running. Agents start servers with term.start.</p>}
        {procs.map((proc) => (
          <div key={proc.id} className="flex min-h-40 flex-col">
            <Screen
              title={
                <>
                  <span>{proc.name ?? proc.id}</span>
                  <span className="font-mono break-all">{proc.command}</span>
                </>
              }
              status={
                <>
                  {(proc.urls ?? []).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                      {u}
                    </a>
                  ))}
                  <Badge variant={proc.status === "running" ? "secondary" : "outline"}>{proc.status === "running" ? "running" : `exited ${proc.exit ?? ""}`}</Badge>
                </>
              }
              text={proc.text}
              live={proc.status === "running"}
            />
          </div>
        ))}
      </section>
      <section aria-label="Recent runs" className="flex flex-col gap-2">
        <h2 className="text-sm">Recent runs</h2>
        {!recent.length && <p className="text-xs text-muted-foreground">No runs yet.</p>}
        {recent.map((run) => (
          <div key={run.id} className="flex max-h-60 min-h-24 flex-col">
            <Screen title={<span>{run.agent}</span>} status={exitBadge(run.exit)} text={run.text}>
              <span className="text-emerald-400">$ </span>
              <span>{run.command}</span>
              {"\n"}
            </Screen>
          </div>
        ))}
      </section>
    </div>
  )
}

function ChecklistView({ snapshot }) {
  const data = snapshot?.data
  if (!data) return <p className="text-sm text-muted-foreground">No checklist on this desk.</p>
  const group = (title, items) =>
    items.length ? (
      <section className="flex flex-col gap-1">
        <h2 className="text-sm">{title}</h2>
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-2 text-xs">
            <span className={cn("font-mono", item.status === "ticked" ? "text-emerald-500" : item.status === "skipped" ? "text-muted-foreground" : "")}>
              {item.status === "ticked" ? "[x]" : item.status === "skipped" ? "[-]" : "[ ]"}
            </span>
            <span className="min-w-0 break-words">
              <span className="text-foreground">{item.id}</span>: {item.text}
              {item.note && <span className="text-muted-foreground"> — {item.note}</span>}
            </span>
          </div>
        ))}
      </section>
    ) : null
  return (
    <div className="flex flex-col gap-4 overflow-auto">
      <p className="text-[11px] text-muted-foreground">
        {snapshot.agent} · v{snapshot.version} · {time(snapshot.at)}
      </p>
      {group("This run", data.run)}
      {group(`Today${data.day ? ` (${data.day})` : ""}`, data.today)}
    </div>
  )
}

function ListView({ snapshot }) {
  const items = snapshot?.data?.items ?? []
  return (
    <div className="flex flex-col gap-1 overflow-auto text-xs">
      <p className="text-[11px] text-muted-foreground">
        {snapshot.agent} · v{snapshot.version} · {time(snapshot.at)}
      </p>
      {!items.length && <p className="text-muted-foreground">Empty.</p>}
      {items.map((item) => (
        <div key={item.name} className="break-words">
          <span className="text-foreground">{item.name}</span>
          {item.detail && <span className="text-muted-foreground"> — {JSON.stringify(item.detail)}</span>}
        </div>
      ))}
    </div>
  )
}

// ── guide ───────────────────────────────────────────────────────────────

// A word to the agent that made the call: guidance on its work in progress
// (seen at its next step, nothing stops), or a new message when it is idle.
function GuideBox({ engine, state }) {
  const [text, setText] = React.useState("")
  const [note, setNote] = React.useState(null)
  if (!engine) return null
  const running = state?.status === "running"
  async function submit(event) {
    event.preventDefault()
    const content = text.trim()
    if (!content) return
    try {
      if (running) {
        const result = await engine.guide(content)
        if (result?.delivered === false) {
          engine.send(content)
          setNote(`${engine.name} had finished; sent as a new message.`)
        } else setNote(`Guidance sent to ${engine.name}: it sees it at its next step.`)
      } else {
        engine.send(content)
        setNote(`Sent to ${engine.name}.`)
      }
      setText("")
    } catch (error) {
      setNote(`Not sent: ${error.message}`)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-3">
      <label htmlFor="guide" className="text-xs text-muted-foreground">
        {running ? `Guide ${engine.name} (seen at its next step, nothing stops)` : `Message ${engine.name} (idle: starts new work)`}
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id="guide"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e)
          }}
          placeholder={running ? "e.g. Use pathlib, not os.path; run the tests before the next file." : "A message to this agent"}
          className="min-h-10 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="pointer-coarse:size-10" aria-label={running ? "Send guidance" : "Send message"} disabled={!text.trim()}>
          <SendIcon />
        </Button>
      </div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </form>
  )
}

// ── page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "call", label: "Call" },
  { id: "files", label: "Files" },
  { id: "terminal", label: "Terminal" },
  { id: "checklist", label: "Checklist" },
]

// Every tool call of the team as it happens, beside the chat rather than in
// it. Left: the calls (UI-renderable ones; "All" adds the log-only ones).
// Right: the followed call, rendered by its tool's `view` (a live terminal,
// a file diff, the quest…), and the live artifacts the engines publish
// (workspace files, terminal with its background servers, checklist). Below:
// guide the agent that made the call, without stopping it.
export function LivePage() {
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  const all = React.useMemo(() => liveFeed(engines, states), [engines, states])
  const artifacts = React.useMemo(() => liveArtifacts(engines, states), [engines, states])
  const terminal = React.useSyncExternalStore(termRuns.subscribe, termRuns.getSnapshot, termRuns.getSnapshot)
  const [following, setFollowing] = React.useState(true)
  const [chosen, setChosen] = React.useState(null)
  const [everything, setEverything] = React.useState(false)
  const [tab, setTab] = React.useState("call")

  const events = React.useMemo(() => (everything ? all : all.filter((e) => e.view)), [all, everything])
  const hidden = all.length - events.length

  // Following: the newest call in progress, else the newest call.
  const followed = events.findLast((e) => e.state !== "done") ?? events.at(-1) ?? null
  const selected = following ? followed : (all.find((e) => e.id === chosen) ?? followed)

  React.useEffect(() => {
    for (const event of all) captureBefore(event)
  }, [all])

  const select = React.useCallback((id) => {
    setChosen(id)
    setFollowing(false)
    setTab("call")
  }, [])

  const listRef = React.useRef(null)
  React.useEffect(() => {
    if (following && listRef.current) listRef.current.scrollTop = 0
  }, [following, events.length])

  const running = all.filter((e) => e.state !== "done").length
  const newestFirst = React.useMemo(() => [...events].reverse(), [events])
  const guideIndex = engines.findIndex((e) => e.id === selected?.engineId)
  const guideEngine = engines[guideIndex] ?? engines.find((e) => states[engines.indexOf(e)]?.status === "running") ?? engines[0]
  const guideState = states[engines.indexOf(guideEngine)]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl">Live follow</h1>
        <span className="text-xs text-muted-foreground">
          {events.length} call{events.length === 1 ? "" : "s"}
          {running ? ` · ${running} in progress` : ""}
          {terminal.available ? ` · terminal ${terminal.connected ? "live" : "reconnecting"}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() => setEverything((e) => !e)}
            aria-pressed={everything}
            title="Log-only calls are the ones whose tool declares no view"
          >
            {everything ? "All calls" : `Renderable${hidden ? ` · ${hidden} log-only hidden` : ""}`}
          </Button>
          <Button
            variant={following ? "secondary" : "outline"}
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() => {
              setFollowing((f) => !f)
              setTab("call")
            }}
            aria-pressed={following}
          >
            {following ? <RadioIcon className="text-emerald-500" /> : <PauseIcon />}
            {following ? "Following" : "Follow"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav ref={listRef} aria-label="Tool calls" className="max-h-56 overflow-auto rounded-lg border md:max-h-none">
          {!newestFirst.length && (
            <p className="p-3 text-xs text-muted-foreground">No calls yet. When an agent runs a command, writes a file or hands out a quest, it shows here as it happens.</p>
          )}
          {newestFirst.map((event) => (
            <FeedRow key={event.id} event={event} selected={event.id === selected?.id} onSelect={select} />
          ))}
        </nav>
        <div className="flex min-h-[60svh] min-w-0 flex-col gap-3 md:min-h-0">
          <div role="tablist" aria-label="Live views" className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs pointer-coarse:py-2.5",
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                {t.id === "terminal" && terminal.procs.some((p) => p.status === "running") && <span className="ml-1 text-emerald-500">●</span>}
                {t.id === "files" && artifacts.filesystem && <span className="ml-1 text-muted-foreground">v{artifacts.filesystem.version}</span>}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "call" && <CallView event={selected} events={all} runs={terminal.runs} onSelect={select} />}
            {tab === "files" && <WorkspaceView snapshot={artifacts.filesystem} shared={artifacts.shared} events={all} onSelect={select} />}
            {tab === "terminal" && <TerminalView terminal={terminal} events={all} snapshot={artifacts.terminal} />}
            {tab === "checklist" &&
              (artifacts.checklist ? (
                <ChecklistView snapshot={artifacts.checklist} />
              ) : artifacts.skills ? (
                <ListView snapshot={artifacts.skills} />
              ) : (
                <p className="text-sm text-muted-foreground">No checklist on this desk.</p>
              ))}
          </div>
          <GuideBox engine={guideEngine} state={guideState} />
        </div>
      </div>
    </div>
  )
}
