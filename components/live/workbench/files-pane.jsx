"use client"

import * as React from "react"
import { ChevronRightIcon, FolderTreeIcon } from "lucide-react"

import { fileMarks, treeRows, twinTree } from "@/backend/live/workbench"
import { Empty, PaneHeader } from "@/components/live/workbench/pane"
import { cn } from "@/lib/utils"

const MARK = {
  modified: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", label: "modified" },
  open: { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300", label: "open" },
  focus: { dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", label: "focus" },
}

// Files: the files twin's tree (the disk's while fs/watch is open: `live`), modified files marked, folders opening
// where the agents work. A click on a file opens its tab; on a folder, folds it.
export function FilesPane({ files, live, activePath, onOpen }) {
  const [toggled, setToggled] = React.useState(() => new Map())
  const root = files?.state?.root ?? ""
  const marks = React.useMemo(() => fileMarks(files), [files])
  const entries = React.useMemo(() => live?.entries ?? twinTree(files), [live?.entries, files])
  const rows = React.useMemo(() => treeRows(entries, { root, marks, toggled }), [entries, root, marks, toggled])
  const modified = files?.state?.modified?.length ?? 0

  return (
    <section aria-label="Files" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader icon={FolderTreeIcon} title="Files">
        <span className="min-w-0 truncate font-mono" title={root || "workspace"}>
          {root || "workspace"}
        </span>
        {modified > 0 && <span className="ml-auto shrink-0 text-amber-700 dark:text-amber-300">{modified} modified</span>}
        <span
          className={cn("shrink-0", modified > 0 ? "" : "ml-auto", live?.live ? "text-emerald-600 dark:text-emerald-400" : "")}
          title={live?.live ? "Watching the disk (fs/watch)" : (live?.error ?? "From the files artifact, refreshed at each agent step")}
        >
          {live?.live ? "live" : "twin"}
        </span>
      </PaneHeader>
      {!files && <Empty>This desk has no files artifact.</Empty>}
      {files && !rows.length && <Empty>No files under {root || "the workspace"} yet.</Empty>}
      <ul className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px]" aria-label="File tree">
        {rows.map((r) => {
          const mark = r.mark ? MARK[r.mark] : null
          return (
            <li key={r.path}>
              <button
                type="button"
                onClick={() => (r.dir ? setToggled((m) => new Map(m).set(r.path, !r.expanded)) : onOpen(r.path))}
                aria-expanded={r.dir ? r.expanded : undefined}
                aria-current={!r.dir && r.path === activePath ? "true" : undefined}
                title={r.path}
                style={{ paddingLeft: `${0.5 + r.depth * 0.75}rem` }}
                className={cn(
                  "flex min-h-7 w-full min-w-0 items-center gap-1 pr-2 text-left hover:bg-accent pointer-coarse:min-h-10",
                  r.dir ? "text-muted-foreground" : (mark?.text ?? "text-foreground/90"),
                  !r.dir && r.path === activePath && "border-l-2 border-l-primary"
                )}
              >
                {r.dir ? (
                  <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", r.expanded && "rotate-90")} aria-hidden />
                ) : (
                  <span className="w-3 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 truncate">
                  {r.name}
                  {r.dir ? "/" : ""}
                </span>
                {mark && <span className={cn("ml-auto size-1.5 shrink-0 rounded-full", mark.dot)} aria-label={mark.label} />}
                {r.dir && r.inside && !r.expanded && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500/60" aria-label="changes inside" />}
              </button>
            </li>
          )
        })}
        {files?.state?.truncated && <li className="px-2 py-1 text-[11px] text-muted-foreground">… more files than the tree lists</li>}
      </ul>
    </section>
  )
}
