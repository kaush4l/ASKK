"use client"

import * as React from "react"
import { ChevronLeftIcon, FileIcon, FilePlusIcon, FolderIcon, LinkIcon, LoaderIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { workspace } from "@/backend/features/filesystem/workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const ICONS = { dir: FolderIcon, link: LinkIcon }

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const parentOf = (path) => path.split("/").slice(0, -1).join("/")
const childOf = (dir, name) => (dir ? `${dir}/${name}` : name)

// Path as clickable segments: workspace / a / b.
function PathBar({ rootName, path, onOpen }) {
  const parts = path ? path.split("/") : []
  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <button type="button" onClick={() => onOpen("")} className="rounded px-1 hover:bg-muted pointer-coarse:py-2">
        {rootName}
      </button>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <span className="text-muted-foreground">/</span>
          <button
            type="button"
            onClick={() => onOpen(parts.slice(0, i + 1).join("/"))}
            className="rounded px-1 break-all hover:bg-muted pointer-coarse:py-2"
          >
            {part}
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}

// One file: read, or edit and save (a save checks the revision that was read).
function FileView({ file, writable, onClose, onSave, onDelete }) {
  const [draft, setDraft] = React.useState(null) // text while editing
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(null)
  const editable = writable && !file.binary && !file.truncated

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(file, draft)
      setDraft(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${file.path}? This cannot be undone.`)) return
    setError(null)
    try {
      await onDelete(file)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section className="flex min-h-[60svh] min-w-0 flex-col rounded-lg border md:min-h-0" aria-label={`File ${file.path}`}>
      <header className="flex items-center gap-2 border-b p-2">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to folder" className="md:hidden pointer-coarse:size-10">
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
        {writable && draft === null && (
          <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={`Delete ${file.path}`} className="text-destructive pointer-coarse:size-10">
            <Trash2Icon />
          </Button>
        )}
        {editable && draft === null && (
          <Button variant="outline" size="sm" onClick={() => setDraft(file.text)} className="pointer-coarse:h-10">
            <PencilIcon /> Edit
          </Button>
        )}
        {draft !== null && (
          <>
            <Button variant="ghost" size="sm" onClick={() => (setDraft(null), setError(null))} className="pointer-coarse:h-10">
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || draft === file.text} className="pointer-coarse:h-10">
              {saving && <LoaderIcon className="animate-spin" />} Save
            </Button>
          </>
        )}
      </header>
      {error && <p className="border-b p-2 text-xs text-destructive">{error}</p>}
      {draft !== null ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label={`Edit ${file.path}`}
          className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-base leading-relaxed focus-visible:ring-0 md:text-xs dark:bg-transparent"
        />
      ) : file.binary ? (
        <p className="p-4 text-sm text-muted-foreground">Binary file — not shown.</p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">{file.text}</pre>
      )}
      {file.truncated && <p className="border-t p-2 text-xs text-muted-foreground">Showing the first 1 MB (read-only).</p>}
    </section>
  )
}

// New file in the current folder.
function NewFile({ dir, onCreate, onCancel }) {
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState(null)
  async function create(event) {
    event.preventDefault()
    try {
      await onCreate(childOf(dir, name.trim()))
    } catch (e) {
      setError(e.message)
    }
  }
  return (
    <form onSubmit={create} className="flex flex-col gap-2 border-b p-2">
      <div className="flex gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="notes.md or src/app.js"
          aria-label="New file name"
          className="min-w-0 font-mono pointer-coarse:h-10 dark:bg-transparent"
        />
        <Button type="submit" disabled={!name.trim()} className="pointer-coarse:h-10">
          Create
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="pointer-coarse:h-10">
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}

// Browse and edit the workspace: the folder the companion runs in (local
// mode), or the browser workspace (static build).
export function FilesPage() {
  const [ws, setWs] = React.useState(null)
  const [dir, setDir] = React.useState(null) // { path, entries }
  const [file, setFile] = React.useState(null)
  const [creating, setCreating] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    workspace().then(setWs)
  }, [])

  const open = React.useCallback(
    async (path) => {
      if (!ws) return
      setLoading(true)
      setError(null)
      try {
        setDir(await ws.list(path))
        setFile(null)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    },
    [ws]
  )

  React.useEffect(() => {
    if (ws) open("")
  }, [ws, open])

  async function view(path) {
    setError(null)
    try {
      setFile(await ws.read(path))
    } catch (e) {
      setError(e.message)
    }
  }

  async function save(current, text) {
    await ws.write(current.path, text, { revision: current.revision })
    setFile(await ws.read(current.path))
    setDir(await ws.list(dir.path))
  }

  async function remove(current) {
    await ws.remove(current.path, { revision: current.revision })
    setFile(null)
    setDir(await ws.list(dir.path))
  }

  async function create(path) {
    const result = await ws.write(path, "", { revision: null })
    setCreating(false)
    setDir(await ws.list(parentOf(result.path)))
    setFile(await ws.read(result.path))
  }

  const rootName = ws?.kind === "host" ? (ws.label.split(/[\\/]/).filter(Boolean).at(-1) ?? ws.label) : "workspace"

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl">Files</h1>
          {ws && <Badge variant="outline">{ws.kind === "host" ? "This computer" : "Browser"}</Badge>}
        </div>
        <p className={cn("text-sm text-muted-foreground", ws?.kind === "host" ? "break-all" : "break-words")}>
          {!ws
            ? "Opening the workspace…"
            : ws.kind === "host"
              ? `${ws.label} · ${ws.writable ? "read + write" : "read-only"}`
              : "Stored in this browser (OPFS). Run ASKK from source (bun run dev) to work on your own folder."}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {ws && dir && (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
          <section
            aria-label="Folder"
            className={cn("flex min-h-0 min-w-0 flex-col rounded-lg border", file && "hidden md:flex")}
          >
            <header className="flex items-center gap-2 border-b p-2">
              {dir.path && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => open(parentOf(dir.path))}
                  aria-label="Up one folder"
                  className="pointer-coarse:size-10"
                >
                  <ChevronLeftIcon />
                </Button>
              )}
              <PathBar rootName={rootName} path={dir.path} onOpen={open} />
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {loading && <LoaderIcon className="size-4 animate-spin text-muted-foreground" />}
                {ws.writable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCreating(true)}
                    aria-label="New file"
                    className="pointer-coarse:size-10"
                  >
                    <FilePlusIcon />
                  </Button>
                )}
              </span>
            </header>
            {creating && <NewFile dir={dir.path} onCreate={create} onCancel={() => setCreating(false)} />}
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {dir.entries.length === 0 && <li className="p-2 text-sm text-muted-foreground">Empty folder</li>}
              {dir.entries.map((entry) => {
                const Icon = ICONS[entry.type] ?? FileIcon
                const path = childOf(dir.path, entry.name)
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => (entry.type === "dir" ? open(path) : view(path))}
                      aria-current={file?.path === path || undefined}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:bg-muted pointer-coarse:min-h-10"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.type === "file" && (
                        <span className="shrink-0 text-xs text-muted-foreground">{formatSize(entry.size)}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {file ? (
            <FileView
              key={`${file.path}:${file.revision}`}
              file={file}
              writable={ws.writable}
              onClose={() => setFile(null)}
              onSave={save}
              onDelete={remove}
            />
          ) : (
            <div className="hidden items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground md:flex">
              Pick a file to read it
            </div>
          )}
        </div>
      )}
    </div>
  )
}
