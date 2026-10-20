"use client"

import * as React from "react"

import { fetchModels, PRESETS, readConnection, saveConnection, setBrowserAgent } from "@/backend/browser/settings"
import { browserStore } from "@/backend/browser/storage"
import { detectHost } from "@/backend/live/host"
import { registry } from "@/backend/live/registry"
import { useEngines } from "@/hooks/use-engines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// The hosted version's own agent (2026-10-20 owner: "the hosted version can use API calls to local host or OpenAI
// compatible endpoints in order to run a default chat system"): with no desk server on this origin, the owner names an
// OpenAI-compatible endpoint and a model, and a single long-running agent runs in this tab (backend/browser/) — the same
// pages follow it. BrowserAgentSetup: the form (home page, offline); BrowserAgentBar: what runs here and its model
// (home page, browser mode), with Change and Stop.

const field = "h-10 text-base md:h-8 md:text-sm" // ≥16px on phones (no iOS zoom), 40px touch targets

export function BrowserAgentSetup({ className, onDone }) {
  const store = React.useMemo(() => browserStore(), [])
  const saved = React.useMemo(() => readConnection(store), [store])
  const [preset, setPreset] = React.useState(saved?.preset ?? "ollama")
  const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS.at(-1)
  const [baseUrl, setBaseUrl] = React.useState(saved?.base_url ?? chosen.base_url)
  const [apiKey, setApiKey] = React.useState(saved?.api_key ?? "")
  const [model, setModel] = React.useState(saved?.model ?? "")
  const [models, setModels] = React.useState([])
  const [note, setNote] = React.useState(null) // {kind: error | ok, text}
  const [busy, setBusy] = React.useState(false)

  const pick = (p) => {
    setPreset(p.id)
    if (p.base_url) setBaseUrl(p.base_url)
    setModels([])
    setNote(null)
  }
  const list = async () => {
    setBusy(true)
    setNote(null)
    try {
      const ids = await fetchModels({ base_url: baseUrl, api_key: apiKey })
      setModels(ids)
      if (ids.length && !ids.includes(model)) setModel(ids[0])
      setNote({ kind: "ok", text: ids.length ? `${ids.length} model${ids.length === 1 ? "" : "s"} on ${new URL(baseUrl).host}` : "the endpoint lists no models: type the model's id" })
    } catch (error) {
      setNote({ kind: "error", text: `${error.message} — ${chosen.note}` })
    } finally {
      setBusy(false)
    }
  }
  const start = async (event) => {
    event.preventDefault()
    try {
      saveConnection(store, { base_url: baseUrl, api_key: apiKey, model, preset })
      await registry.restart()
      onDone?.()
    } catch (error) {
      setNote({ kind: "error", text: error.message })
    }
  }

  return (
    <form onSubmit={start} className={cn("mx-auto flex w-full max-w-xl flex-col gap-3 rounded-xl border p-4 text-sm", className)}>
      <div>
        <p className="text-base">Run an agent in this browser</p>
        <p className="text-muted-foreground">
          One long-running agent in this tab: it calls the model you name, makes helpers for bigger work, and keeps its notes and standing orders in this browser. The terminal, app previews and other desks need the desk server (<code className="font-mono">bun run dev</code>).
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Endpoint">
        {PRESETS.map((p) => (
          <Button key={p.id} type="button" size="sm" variant={p.id === preset ? "default" : "outline"} role="radio" aria-checked={p.id === preset} className="pointer-coarse:min-h-10" onClick={() => pick(p)}>
            {p.label}
          </Button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{chosen.note}</p>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-muted-foreground">Base URL (OpenAI-compatible)</span>
        <Input className={field} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" inputMode="url" autoComplete="off" spellCheck={false} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-muted-foreground">API key {chosen.key ? "(needed)" : "(optional)"} — kept in this browser, sent only to that endpoint</span>
        <Input className={field} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12px] text-muted-foreground">Model</span>
          <Input className={field} value={model} onChange={(e) => setModel(e.target.value)} list="askk-browser-models" placeholder="llama3.1" autoComplete="off" spellCheck={false} required />
          <datalist id="askk-browser-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <Button type="button" variant="outline" className="h-10 md:h-8" onClick={list} disabled={busy || !baseUrl}>
          {busy ? "Fetching…" : "Fetch models"}
        </Button>
      </div>
      {note && <p className={cn("break-words text-[12px]", note.kind === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{note.text}</p>}
      <div className="flex justify-end">
        <Button type="submit" className="h-10 md:h-8" disabled={!baseUrl || !model}>
          Start the agent
        </Button>
      </div>
    </form>
  )
}

// What runs in this tab: the model, Change (the form again) and Stop (the tab follows the desk server again, or none;
// the model stays saved for the next Start).
export function BrowserAgentBar({ className }) {
  const [mode, setMode] = React.useState(null)
  const [editing, setEditing] = React.useState(false)
  const store = React.useMemo(() => browserStore(), [])
  const { status } = useEngines() // probed again when the tab's desk changes (Start, Stop, the header's switch)
  React.useEffect(() => {
    let live = true
    detectHost().then((h) => live && setMode(h?.mode ?? null))
    return () => {
      live = false
    }
  }, [status])
  if (mode !== "browser") return null
  const c = readConnection(store)
  if (editing) return <BrowserAgentSetup className={className} onDone={() => setEditing(false)} />
  return (
    <div className={cn("mx-auto flex w-full max-w-xl flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] text-muted-foreground", className)}>
      <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Running in this browser · <span className="font-mono text-foreground">{c?.model ?? "?"}</span> at {c ? new URL(c.base_url).host : "?"}
      </span>
      <Button size="sm" variant="ghost" className="pointer-coarse:min-h-10" onClick={() => setEditing(true)}>
        Change
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="pointer-coarse:min-h-10"
        onClick={async () => {
          setBrowserAgent(store, false)
          await registry.restart()
          setMode(null)
        }}
      >
        Stop
      </Button>
    </div>
  )
}
