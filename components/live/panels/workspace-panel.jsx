"use client"

import * as React from "react"

import { workspace } from "@/backend/features/filesystem/workspace"
import { PathTreeView, WorkspaceTreeView } from "@/components/live/files/file-tree"
import { ancestors, pathTree, touchedFiles } from "@/components/live/files/tree"
import { panel, snapshotLabel, time } from "@/components/live/format"

// The workspace as the filesystem artifact last published it, the files the
// team changed marked, and the file you pick read fresh.
export function WorkspaceView({ snapshot, shared, events, onSelect }) {
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
          {data ? `Workspace · ${snapshotLabel(snapshot)}` : "Files touched"}
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
