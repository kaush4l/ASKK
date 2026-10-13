"use client"

import * as React from "react"
import { FileIcon, FolderIcon } from "lucide-react"

import { OP_COLOR, OPS } from "@/components/live/files/tree"
import { StateMark } from "@/components/live/state-mark"
import { cn } from "@/lib/utils"

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

export function PathTreeView({ node, depth = 0, selected, touched, onOpen }) {
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
export function WorkspaceTreeView({ entries, parent = "", depth = 0, selected, touched, onOpen, open, onToggle }) {
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
