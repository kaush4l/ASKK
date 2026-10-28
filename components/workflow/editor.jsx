"use client"

import * as React from "react"
import { CheckIcon, HistoryIcon, XIcon } from "lucide-react"

import { checkWorkflow, saveWorkflow, workflowSource, workflowVersion } from "@/backend/live/pipeline"
import { errorLine, phaseCards, phaseOffset } from "@/backend/live/workflow-view"
import { Button } from "@/components/ui/button"
import { MiniButton, Small, errorText, useBusy } from "@/components/views/kit"
import { cn } from "@/lib/utils"

import { FlowColumn } from "./flow"

// The workflow's file, edited from the viewer (2026-10-22 owner: "make the workflow configuration driven … editable can
// help me experiment different workflows and wording"): the file on the left; on the right the workflow it makes, checked
// by the desk as you type (a draft is parsed, never written) — its phases with what each reads and hands on, the ones
// this draft changes marked, or the reason it does not load and the line. Save writes it when it loads (the old text
// kept: Earlier versions brings one back); a run going keeps the steps it loaded.

const CHECK_MS = 450
const etStamp = (at) => new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

export function WorkflowEditor({ id, config, focus, onClose, onSaved }) {
  const [name, setName] = React.useState(null)
  const [src, setSrc] = React.useState({ busy: true, error: null, value: null })
  const [draft, setDraft] = React.useState("")
  const [check, setCheck] = React.useState({ busy: false, value: null })
  const save = useBusy()
  const [saved, setSaved] = React.useState(null) // what the last save or version load did
  const area = React.useRef(null)
  const placed = React.useRef(false)

  const load = React.useCallback(
    async (which) => {
      setSrc((s) => ({ ...s, busy: true, error: null }))
      try {
        const v = await workflowSource(id, which)
        setSrc({ busy: false, error: null, value: v })
        setName(v.name)
        setDraft(v.text)
        return v
      } catch (error) {
        setSrc({ busy: false, error: errorText(error), value: null })
        return null
      }
    },
    [id],
  )
  React.useEffect(() => {
    load(null)
  }, [load])

  // open at the phase the owner chose to edit
  React.useEffect(() => {
    const el = area.current
    if (placed.current || !el || !src.value || !focus) return
    placed.current = true
    const at = phaseOffset(src.value.text, focus)
    el.focus({ preventScroll: true })
    el.setSelectionRange(at, at)
    const lines = src.value.text.slice(0, at).split("\n").length - 1
    el.scrollTop = Math.max(0, (lines / Math.max(1, src.value.text.split("\n").length)) * el.scrollHeight - 24)
  }, [src.value, focus])

  // the draft checked by the desk a moment after each change
  React.useEffect(() => {
    if (!name || src.value == null) return
    let live = true
    setCheck((c) => ({ ...c, busy: true }))
    const timer = setTimeout(async () => {
      try {
        const value = await checkWorkflow(id, name, draft)
        if (live) setCheck({ busy: false, value })
      } catch (error) {
        if (live) setCheck({ busy: false, value: { ok: false, error: errorText(error) } })
      }
    }, CHECK_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id, name, draft, src.value])

  const dirty = src.value != null && draft !== src.value.text
  const result = check.value
  const line = result && !result.ok ? errorLine(result.error, draft) : null
  const now = new Map((config?.steps ?? []).map((s) => [s.id, s.rev]))
  const next = result?.ok ? result.config : null
  const cards = next ? phaseCards(next, []) : []
  const changed = new Set(cards.filter((c) => now.get(c.id) !== c.step?.rev).map((c) => c.id))
  const removed = [...now.keys()].filter((k) => next && !next.steps.some((s) => s.id === k))

  const goLine = (n) => {
    const el = area.current
    if (!el || !n) return
    const at = draft.split("\n").slice(0, n - 1).join("\n").length + (n > 1 ? 1 : 0)
    el.focus()
    el.setSelectionRange(at, at)
    el.scrollTop = Math.max(0, ((n - 1) / Math.max(1, draft.split("\n").length)) * el.scrollHeight - 24)
  }
  const onSave = () =>
    save.run(async () => {
      setSaved(null)
      const r = await saveWorkflow(id, name, draft, src.value.revision)
      await load(name)
      onSaved?.()
      setSaved(r.changed ? `Saved ${r.saved} — in force from the next run${r.next_run ? " (one is going: it keeps what it loaded)" : ""}.` : "No change to save.")
    })
  const onVersion = async (file) => {
    if (!file) return
    try {
      const v = await workflowVersion(id, file)
      setDraft(v.text)
      save.setError(null)
      setSaved(`Loaded the version from ${etStamp(v.at)} ET — Save to bring it back.`)
    } catch (error) {
      save.setError(errorText(error))
      setSaved(null)
    }
  }

  return (
    <section aria-label="Edit the workflow" className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5">
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-base text-foreground">Edit the workflow</h2>
        {src.value?.files?.length > 1 ? (
          <select aria-label="File" value={name ?? ""} onChange={(e) => (dirty && !window.confirm("Drop the changes to this file?") ? null : load(e.target.value))} className="h-8 max-w-full rounded border bg-transparent px-2 font-mono text-base sm:text-xs pointer-coarse:h-10">
            {src.value.files.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        ) : (
          name && <span className="font-mono text-xs text-muted-foreground">{name}</span>
        )}
        {dirty && <span className="rounded border border-amber-500/60 px-1.5 text-[11px] text-amber-700 dark:text-amber-400">unsaved</span>}
        {src.value?.versions?.length > 0 && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <HistoryIcon aria-hidden className="size-3.5" />
            <select aria-label="Earlier versions" value="" onChange={(e) => onVersion(e.target.value)} className="h-8 max-w-[12rem] rounded border bg-transparent px-1 text-base sm:text-xs pointer-coarse:h-10">
              <option value="">Earlier versions ({src.value.versions.length})</option>
              {src.value.versions.map((v) => (
                <option key={v.file} value={v.file}>{etStamp(v.at)} ET</option>
              ))}
            </select>
          </label>
        )}
        <Button type="button" size="icon" variant="ghost" className="ml-auto size-8 pointer-coarse:size-10" aria-label="Close the editor" onClick={() => (dirty && !window.confirm("Close and drop the unsaved changes?") ? null : onClose())}>
          <XIcon className="size-4" />
        </Button>
      </header>
      {src.error && <Small tone="error">{src.error}</Small>}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1">
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`The workflow file ${name ?? ""}`}
            spellCheck={false}
            disabled={src.busy && !src.value}
            className="h-[55svh] w-full min-w-0 resize-y rounded-md border bg-transparent px-2 py-1.5 font-mono text-base leading-5 sm:text-xs lg:h-[70svh]"
          />
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono">## id — title</span> a phase · <span className="font-mono">{"{{request}}"}</span> the run&apos;s request · <span className="font-mono">{"{{research.findings}}"}</span> a field an earlier phase reports · <span className="font-mono">### Output</span> its report&apos;s format
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs" aria-live="polite">
            {check.busy || !result ? (
              <span className="text-muted-foreground">Checking…</span>
            ) : result.ok ? (
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckIcon aria-hidden className="size-3.5" /> Loads — {next.steps.length} phases{Object.keys(next.vars ?? {}).length ? ` · run variables ${Object.keys(next.vars).join(", ")}` : ""}
                {next.settings?.board === false ? " · no shared board" : ""}
              </span>
            ) : (
              <span className="min-w-0 break-words text-red-700 dark:text-red-400">Does not load{line ? ` (line ${line})` : ""}: {result.error}</span>
            )}
            {line && <MiniButton variant="outline" className="h-7" onClick={() => goLine(line)}>Go to line {line}</MiniButton>}
          </div>
          {next && (changed.size > 0 || removed.length > 0) && (
            <Small tone="warn">
              {changed.size ? `This draft changes ${[...changed].join(", ")}` : ""}
              {changed.size && removed.length ? " · " : ""}
              {removed.length ? `removes ${removed.join(", ")}` : ""} — their outputs so far came from the old text.
            </Small>
          )}
          {next?.description && <Small className="whitespace-pre-line">{next.description}</Small>}
          <div className={cn("min-w-0 overflow-y-auto lg:max-h-[64svh]", !next && "opacity-50")}>{next ? <FlowColumn cards={cards} changed={changed} compactOnPhone={false} /> : <Small>The phases show here when the file loads.</Small>}</div>
        </div>
      </div>

      <footer className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="h-8 px-3 text-xs pointer-coarse:h-10" disabled={!dirty || save.busy || !result?.ok || check.busy} onClick={onSave} title={result && !result.ok ? "The file does not load — fix it first" : undefined}>
          {save.busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-3 text-xs pointer-coarse:h-10" disabled={!dirty || save.busy} onClick={() => setDraft(src.value.text)}>
          Undo changes
        </Button>
        {saved && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">{saved}</span>}
        {save.error && <Small tone="error" as="span" className="min-w-0">{save.error}</Small>}
      </footer>
    </section>
  )
}
