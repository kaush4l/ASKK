"use client"

import * as React from "react"

import { beforeOf, isFileEvent } from "@/backend/features/live/follow"
import { PathTreeView } from "@/components/live/files/file-tree"
import { pathTree, touchedFiles } from "@/components/live/files/tree"
import { panel } from "@/components/live/format"
import { StateMark } from "@/components/live/state-mark"
import { DiffView } from "@/components/live/views/diff-view"
import { diffLines, diffStats } from "@/lib/line-diff"
import { LIMITS } from "@/lib/config"

// The path a file call touched: its state, the tool and the agent.
function FileHeader({ event, path, children }) {
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
      <StateMark event={event} />
      <span className="min-w-0 font-mono break-all">{path}</span>
      <span className="text-muted-foreground">
        · {event.name} · {event.agent}
      </span>
      {children}
    </header>
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
  const recorded = event.change
  if (recorded?.rows) {
    // Recorded by the tool as it wrote: the whole file, with its line numbers.
    rows = recorded.rows
    note = [recorded.created && "New file.", recorded.cut && `First ${recorded.rows.length} rows shown; ${recorded.cut} more not kept.`].filter(Boolean).join(" ") || null
  } else if (event.state !== "done" && event.name !== "fs.delete") {
    note = "Running — the diff shows when the write lands."
    rows = event.name === "fs.edit" ? diffLines(inputs.old ?? "", inputs.new ?? "", { context: LIMITS.ui.live.diffContextLines }) : null
  } else if (event.name === "fs.edit") {
    rows = diffLines(inputs.old ?? "", inputs.new ?? "", { context: LIMITS.ui.live.diffContextLines })
    note = "The replaced passage (fs.edit replaces one exact match)."
  } else if (event.name === "fs.append") {
    rows = (inputs.text ?? "").split("\n").map((text, i) => ({ op: "+", text, b: i + 1 }))
    note = "Added at the end of the file."
  } else if (event.name === "fs.write" && before !== undefined) {
    rows = diffLines(before?.text ?? "", inputs.text ?? "")
    if (!before) note = /^Updated/.test(event.output ?? "") ? "Earlier version not seen: the whole file is shown as written." : "New file."
    else if (before.source === "feed") note = "Compared with the team's previous write of this file."
  }
  const stats = recorded ? { added: recorded.added, removed: recorded.removed } : rows ? diffStats(rows) : null

  return (
    <section aria-label="File change" className={panel}>
      <FileHeader event={event} path={inputs.path}>
        {stats && (
          <span className="ml-auto font-mono">
            <span className="text-emerald-500">+{stats.added}</span> <span className="text-red-500">−{stats.removed}</span>
          </span>
        )}
      </FileHeader>
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
      <FileHeader event={event} path={event.inputs?.path || "."} />
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] whitespace-pre-wrap break-words">
        {event.state === "done" ? event.output || "(empty)" : "Reading…"}
      </pre>
    </section>
  )
}

export function FileCall({ event, events, onSelect }) {
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
