"use client"

import * as React from "react"
import { DownloadIcon, PlayIcon, PlusIcon, RotateCcwIcon } from "lucide-react"

import { KIND_LABEL, loadModels, modelCall, optionRows, statusOf } from "@/backend/live/models"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The model panel (2026-10-23 owner: "In the panel I want the ability to choose the model, their parameters can be
// written in the md file that will be placed in the same folder … such that we change them and the state survives a
// restart"): for one kind (stt, tts, image) the models in models/<kind>/, the one in use, its options — each change
// written into its model.md by the host — and the catalogue to add more (install and start them from here). Used by the
// voice settings (stt, tts) and the studio (image).

const input = "h-9 rounded-md border bg-background px-2 text-base md:text-sm"

function Option({ row, onSet, busy }) {
  const id = React.useId()
  const set = (v) => onSet(row.name, v)
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="flex items-center gap-1 text-xs">
        <span className={cn(row.changed ? "text-foreground" : "text-muted-foreground")}>{row.name}</span>
        {row.changed && (
          <button type="button" onClick={() => set(null)} disabled={busy} className="grid size-5 place-items-center text-muted-foreground hover:text-foreground pointer-coarse:size-10" aria-label={`Reset ${row.name} to ${row.def}`} title={`back to ${row.def}`}>
            <RotateCcwIcon className="size-3" />
          </button>
        )}
      </label>
      {row.type === "bool" ? (
        <input id={id} type="checkbox" checked={!!row.value} disabled={busy} onChange={(e) => set(e.target.checked)} className="size-5 accent-foreground" />
      ) : row.type === "choice" ? (
        <select id={id} value={String(row.value ?? "")} disabled={busy} onChange={(e) => set(e.target.value)} className={input}>
          {row.choices.map((c) => (
            <option key={String(c)} value={String(c)}>
              {String(c)}
            </option>
          ))}
        </select>
      ) : row.type === "number" ? (
        <NumberField id={id} row={row} busy={busy} onCommit={set} />
      ) : (
        <TextField id={id} row={row} busy={busy} onCommit={set} />
      )}
      {row.about && <span className="text-[11px] text-muted-foreground">{row.about}</span>}
    </div>
  )
}

// a field saved when it is left or Enter is pressed — never per keystroke (each save rewrites the md file)
function NumberField({ id, row, busy, onCommit }) {
  const [v, setV] = React.useState(String(row.value ?? ""))
  React.useEffect(() => setV(String(row.value ?? "")), [row.value])
  const commit = () => v !== String(row.value ?? "") && onCommit(v === "" ? null : Number(v))
  return <input id={id} type="number" inputMode="decimal" min={row.min} max={row.max} step={row.step ?? "any"} value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={cn(input, "w-28")} />
}
function TextField({ id, row, busy, onCommit }) {
  const [v, setV] = React.useState(String(row.value ?? ""))
  React.useEffect(() => setV(String(row.value ?? "")), [row.value])
  const commit = () => v !== String(row.value ?? "") && onCommit(v)
  return <input id={id} value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={input} />
}

export function ModelPanel({ kind, onChange }) {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const refresh = React.useCallback(async () => {
    try {
      setData(await loadModels())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])
  React.useEffect(() => {
    refresh()
  }, [refresh])
  const k = data?.kinds?.[kind]
  const installing = k?.models.some((m) => m.installing)
  // an install runs in the background: look again until it ends
  React.useEffect(() => {
    if (!installing) return
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [installing, refresh])
  const act = async (action, body, said) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await modelCall(action, { kind, ...body })
      setNote({ ok: true, text: typeof said === "function" ? said(r) : said })
      await refresh()
      onChange?.()
    } catch (e) {
      setNote({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }
  if (error) return <p className="text-xs text-destructive">Models not read: {error}</p>
  if (!k) return <p className="text-xs text-muted-foreground">Reading the models…</p>
  const model = k.models.find((m) => m.name === k.selected) ?? null
  const status = statusOf(model)
  const toAdd = k.catalog.filter((c) => !c.added)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-muted-foreground">
          {KIND_LABEL[kind]}
          <select value={k.selected ?? ""} disabled={busy} onChange={(e) => act("select", { name: e.target.value }, (r) => `${r.model.title} in use`)} className={cn(input, "w-full text-foreground")}>
            {k.models.map((m) => (
              <option key={m.name} value={m.name} disabled={!m.ok}>
                {m.title}
                {statusOf(m) === "ready" ? "" : ` (${statusOf(m)})`}
              </option>
            ))}
          </select>
        </label>
        {model?.missing?.length > 0 && model.install && (
          <Button size="sm" variant="outline" className="mt-4 pointer-coarse:h-10" disabled={busy || model.installing} onClick={() => act("install", { name: model.name }, "installing — the desk log shows when it is done")}>
            <DownloadIcon /> {model.installing ? "Installing…" : "Install"}
          </Button>
        )}
        {model?.engine === "openai" && !model.missing?.length && (
          <Button size="sm" variant="outline" className="mt-4 pointer-coarse:h-10" disabled={busy} onClick={() => act("start", { name: model.name }, (r) => `server answers at ${r.url ?? "its url"}`)} title="Start its server now (else on first use)">
            <PlayIcon /> Start
          </Button>
        )}
      </div>
      {model && (
        <p className="text-[11px] text-muted-foreground">
          <span className={cn(status === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{status}</span>
          {model.about ? ` · ${model.about}` : ""}
          {model.weights ? ` · weights: ${model.weights}` : ""}
          {model.accepts?.length ? ` · accepts ${model.accepts.join(", ")}` : ""}
        </p>
      )}
      {model && optionRows(model).length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {optionRows(model).map((row) => (
            <Option key={row.name} row={row} busy={busy} onSet={(name, v) => act("set", { name: model.name, values: { [name]: v } }, `${name} ${v === null ? "back to its default" : `= ${v}`} — saved in ${model.name}/model.md`)} />
          ))}
        </div>
      )}
      {model && <p className="break-all text-[11px] text-muted-foreground">{model.file}</p>}
      {toAdd.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Add a model ({toAdd.length} in the catalogue)</summary>
          <ul className="mt-1 flex flex-col gap-1.5">
            {toAdd.map((c) => (
              <li key={c.name} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block">{c.title}</span>
                  <span className="block text-muted-foreground">{c.about}</span>
                </span>
                <Button size="sm" variant="ghost" className="pointer-coarse:h-10" disabled={busy} onClick={() => act("add", { name: c.name }, `${c.title} added to models/${kind}/${c.name}/`)}>
                  <PlusIcon /> Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {note && <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</p>}
    </div>
  )
}
