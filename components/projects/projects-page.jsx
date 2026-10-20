"use client"

// Projects (2026-10-17 owner: "I can load a new project location and the agent can work on the project"): load a folder
// of yours from anywhere on this computer into the desk — it becomes projects/<name>/ in the desk's workspace, its
// .agents/ folder (ignored by its git) holds what the agents set up for it, and the lead gets its first-setup run
// (skill project-setup). The list: every loaded project, set up or not, its folder in Files, set up again, unload.
// Behaviour lives in the host (companion/capabilities/projects.js) and backend/live/projects.js; this page draws it.

import * as React from "react"
import Link from "next/link"
import { FolderGit2Icon, FolderOpenIcon, LoaderIcon, RefreshCwIcon, XIcon } from "lucide-react"

import { detectHost, hasCapability } from "@/backend/live/host"
import { listProjects, loadNote, loadProject, projectState, unloadProject } from "@/backend/live/projects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ROUTES } from "@/lib/config"
import { cn } from "@/lib/utils"

const TONE = { ok: "text-emerald-500", wait: "text-amber-500", error: "text-destructive" }
const REFRESH_MS = 8000 // the list again while the page is open (a setup run writes .agents/project.md)

function LoadForm({ onLoaded, disabled }) {
  const [path, setPath] = React.useState("")
  const [name, setName] = React.useState("")
  const [setup, setSetup] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)

  async function submit(event) {
    event.preventDefault()
    if (!path.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await loadProject({ path: path.trim(), name: name.trim() || undefined, setup })
      setPath("")
      setName("")
      onLoaded(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Load a project">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">Load a project</h2>
        <p className="text-sm text-muted-foreground">
          A folder of yours anywhere on this computer. The desk works on it as <code>projects/&lt;name&gt;/</code>; what its agents set
          up for it goes in its <code>.agents/</code> folder, which git ignores. Your files change only when you ask.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          Folder
          <Input
            id="project-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/code/my-app"
            autoComplete="off"
            spellCheck={false}
            className="text-base md:text-sm pointer-coarse:h-10"
            disabled={disabled || busy}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          Name (optional)
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="from the folder"
            autoComplete="off"
            spellCheck={false}
            className="text-base md:text-sm pointer-coarse:h-10"
            disabled={disabled || busy}
          />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={setup} onChange={(e) => setSetup(e.target.checked)} className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5" disabled={disabled || busy} />
        <span>Set it up now: the lead reads the project, writes its notes, starts its live preview and tells you what it found.</span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button type="submit" disabled={disabled || busy || !path.trim()} className="pointer-coarse:h-10">
          {busy ? <LoaderIcon className="animate-spin" /> : <FolderGit2Icon />}
          Load
        </Button>
      </div>
    </form>
  )
}

function ProjectRow({ project, writable, onSetup, onUnload }) {
  const state = projectState(project)
  const [busy, setBusy] = React.useState(null) // "setup" | "unload"
  const run = async (what, fn) => {
    setBusy(what)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base">{project.name}</span>
        <span className={cn("text-xs", TONE[state.tone])}>● {state.label}</span>
        {project.source === "config" && <Badge variant="outline">main.js</Badge>}
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">{project.path}</p>
      <p className="text-xs text-muted-foreground">
        in the workspace: <code>{project.workspace}/</code>
        {project.at ? ` · loaded ${new Date(project.at).toLocaleString()}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`${ROUTES.files}?path=${encodeURIComponent(project.workspace)}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[0.8rem] hover:bg-muted pointer-coarse:h-10 [&_svg]:size-3.5"
        >
          <FolderOpenIcon />
          Files
        </Link>
        {writable && !project.missing && (
          <Button variant="outline" size="sm" className="pointer-coarse:h-10" disabled={!!busy} onClick={() => run("setup", onSetup)}>
            {busy === "setup" ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />}
            {project.setup ? "Set up again" : "Set up"}
          </Button>
        )}
        {writable && project.source !== "config" && (
          <Button
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-10"
            disabled={!!busy}
            onClick={() => {
              if (window.confirm(`Unload ${project.name}? The desk forgets it; ${project.path} and its .agents/ folder stay as they are.`)) run("unload", onUnload)
            }}
          >
            {busy === "unload" ? <LoaderIcon className="animate-spin" /> : <XIcon />}
            Unload
          </Button>
        )}
      </div>
    </li>
  )
}

export function ProjectsPage() {
  const [host, setHost] = React.useState(undefined) // undefined: checking
  const [list, setList] = React.useState(null)
  const [note, setNote] = React.useState(null)
  const [error, setError] = React.useState(null)

  const enabled = hasCapability(host, "projects")
  const writable = enabled && hasCapability(host, "fs.write")

  const refresh = React.useCallback(async () => {
    try {
      setList((await listProjects()).projects)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  React.useEffect(() => {
    detectHost().then(setHost)
  }, [])
  React.useEffect(() => {
    if (!enabled) return
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [enabled, refresh])

  const loaded = (result) => {
    setNote(loadNote(result))
    refresh()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">Projects</h1>
        <p className="text-sm text-muted-foreground">
          {host === undefined
            ? "Asking the desk…"
            : host?.mode !== "local"
              ? "No desk server answers here: start it with bun run dev to load a project."
              : enabled
                ? `${host.desk?.name ?? "This desk"} works on these besides its own projects.`
                : `${host.desk?.name ?? "This desk"} loads no projects (its main.js has no projects): pick the dev desk in the header.`}
        </p>
      </div>

      {enabled && <LoadForm onLoaded={loaded} disabled={!writable} />}
      {note && (
        <p className="text-sm" role="status">
          {note}{" "}
          {note.includes("Home") && (
            <Link href={ROUTES.home} className="underline underline-offset-4">
              Open Home
            </Link>
          )}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {enabled && list && (
        <section aria-label="Loaded projects" className="flex flex-col gap-2">
          <h2 className="text-lg">Loaded</h2>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((p) => (
                <ProjectRow
                  key={p.name}
                  project={p}
                  writable={writable}
                  onSetup={async () => loaded(await loadProject({ path: p.path, setup: true }))}
                  onUnload={async () => {
                    await unloadProject(p.name).catch((e) => setError(e.message))
                    setNote(null)
                    refresh()
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
