"use client"

import * as React from "react"
import { CheckIcon, LoaderIcon, PlugIcon, PlusIcon, RotateCcwIcon, WandSparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { models, PROVIDERS, validKey } from "@/backend/models/catalog"
import { listModels } from "@/backend/models/llm"

const inputClass = "pointer-coarse:h-10 dark:bg-transparent"

// The draft as an object, or the parse error.
function parse(text) {
  try {
    const value = JSON.parse(text)
    return { value: value && typeof value === "object" && !Array.isArray(value) ? value : null, error: null }
  } catch (error) {
    return { value: null, error: error.message }
  }
}

// A catalogue key for a model id: "Qwen/Qwen3-8B" -> "qwen3-8b", unique in `taken`.
function keyFor(id, taken) {
  const base = String(id).split("/").pop().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "") || "model"
  let key = base
  for (let n = 2; taken.has(key) || !validKey(key); n++) key = `${base}-${n}`
  return key
}

// Test an endpoint: list its models, pick some, add them to the JSON draft
// with the same URL and key.
function Discover({ draft, onAdd }) {
  const id = React.useId()
  const seed = Object.values(draft?.models ?? {}).find((m) => m?.base_url) ?? {}
  const [endpoint, setEndpoint] = React.useState({
    provider: seed.provider ?? "openai",
    base_url: seed.base_url ?? "",
    api_key: seed.api_key ?? "",
  })
  const [found, setFound] = React.useState(null)
  const [picked, setPicked] = React.useState(new Set())
  const [state, setState] = React.useState({ loading: false, error: null })
  const set = (patch) => (setFound(null), setEndpoint({ ...endpoint, ...patch }))

  async function test() {
    setState({ loading: true, error: null })
    try {
      const list = await listModels(endpoint)
      setFound(list)
      setPicked(new Set())
      setState({ loading: false, error: list.length ? null : "The endpoint answered with no models." })
    } catch (error) {
      setFound(null)
      setState({ loading: false, error: error.message })
    }
  }

  const toggle = (modelId) =>
    setPicked((current) => {
      const next = new Set(current)
      next.has(modelId) ? next.delete(modelId) : next.add(modelId)
      return next
    })

  function add() {
    const chosen = found.filter((m) => picked.has(m.id))
    onAdd(
      chosen.map((m) => ({
        id: m.id,
        provider: endpoint.provider,
        base_url: endpoint.base_url.trim() || undefined,
        api_key: endpoint.api_key.trim() || undefined,
        context_length: m.contextLength ?? undefined,
      }))
    )
    setPicked(new Set())
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base">Discover models</h3>
        <p className="text-xs text-muted-foreground">
          Test an endpoint: it is asked for its models, and the ones you pick are added to the JSON above with this URL
          and key. Review, then save.
        </p>
      </div>
      <Tabs value={endpoint.provider} onValueChange={(provider) => set({ provider })}>
        <TabsList>
          {Object.entries(PROVIDERS).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="pointer-coarse:h-10">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className="text-xs text-muted-foreground">
            Base URL
          </label>
          <Input
            id={`${id}-url`}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={endpoint.base_url}
            placeholder={endpoint.provider === "anthropic" ? "https://api.anthropic.com" : "http://127.0.0.1:8080/v1"}
            onChange={(e) => set({ base_url: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-key`} className="text-xs text-muted-foreground">
            API key (optional)
          </label>
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            value={endpoint.api_key}
            onChange={(e) => set({ api_key: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={test} disabled={state.loading} className="pointer-coarse:h-10">
          {state.loading ? <LoaderIcon className="animate-spin" /> : <PlugIcon />}
          Test and list models
        </Button>
        {found?.length > 0 && (
          <span className="text-xs text-muted-foreground">
            <CheckIcon className="inline size-3.5 text-emerald-500" /> {found.length} model{found.length === 1 ? "" : "s"}{" "}
            available
          </span>
        )}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {found?.length > 0 && (
        <>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto">
            {found.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                aria-pressed={picked.has(m.id)}
                title={m.contextLength ? `Context window: ${m.contextLength.toLocaleString()} tokens` : undefined}
                className="rounded-full border px-2.5 py-1 text-xs break-all text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:text-foreground pointer-coarse:py-2"
              >
                {m.id}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={add} disabled={!picked.size} className="pointer-coarse:h-10">
              <PlusIcon /> Add {picked.size || ""} to JSON
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPicked(new Set(found.map((m) => m.id)))}
              className="pointer-coarse:h-10"
            >
              Select all
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// This browser's model catalogue as JSON: edit URLs, keys and entries
// directly; nothing is saved until it validates.
export function ModelsJson() {
  const id = React.useId()
  const [text, setText] = React.useState(() => models.savedJson())
  const [dirty, setDirty] = React.useState(false)
  const [message, setMessage] = React.useState(null) // { ok, text }

  // Follow saves made elsewhere (the form) while there are no unsaved edits.
  React.useEffect(
    () =>
      models.subscribe(() => {
        if (!dirty) setText(models.savedJson())
      }),
    [dirty]
  )

  const parsed = parse(text)
  const edit = (next) => (setText(next), setDirty(true), setMessage(null))

  function save() {
    try {
      models.replaceSaved(text)
      setText(models.savedJson())
      setDirty(false)
      setMessage({ ok: true, text: "Saved in this browser." })
    } catch (error) {
      setMessage({ ok: false, text: error.message })
    }
  }

  function revert() {
    setText(models.savedJson())
    setDirty(false)
    setMessage(null)
  }

  function addModels(entries) {
    const draft = parsed.value ?? { default: null, models: {} }
    const current = { default: draft.default ?? null, models: { ...(draft.models ?? {}) } }
    const taken = new Set([...Object.keys(current.models), ...models.getSnapshot().models.map((m) => m.key)])
    for (const entry of entries) {
      const key = keyFor(entry.id, taken)
      taken.add(key)
      current.models[key] = Object.fromEntries(Object.entries({ label: entry.id, ...entry }).filter(([, v]) => v !== undefined))
      current.default ??= key
    }
    edit(JSON.stringify(current, null, 2))
    setMessage({ ok: true, text: `Added ${entries.length} to the JSON. Save to use ${entries.length === 1 ? "it" : "them"}.` })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-json`} className="text-xs text-muted-foreground">
          This browser&apos;s models. Entries from <code>.env</code> or <code>models.json</code> are not shown here; an
          entry with the same key overrides them.
        </label>
        <Textarea
          id={`${id}-json`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!parsed.error}
          onChange={(e) => edit(e.target.value)}
          className="min-h-64 font-mono text-base leading-relaxed md:text-xs"
        />
        {parsed.error && <p className="text-xs text-destructive">{parsed.error}</p>}
        <p className="text-xs text-muted-foreground">
          Fields: label, provider (openai | anthropic | claude-cli | codex-cli | gemini-cli | apple), base_url, api_key, id, context_length, max_tokens. API keys are
          stored in plain text in this browser.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty || !!parsed.error} className="pointer-coarse:h-10">
          Save
        </Button>
        <Button
          variant="outline"
          onClick={() => parsed.value && edit(JSON.stringify(parsed.value, null, 2))}
          disabled={!parsed.value}
          className="pointer-coarse:h-10"
        >
          <WandSparklesIcon /> Format
        </Button>
        <Button variant="ghost" onClick={revert} disabled={!dirty} className="pointer-coarse:h-10">
          <RotateCcwIcon /> Revert
        </Button>
        {message && <p className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{message.text}</p>}
      </div>
      <Discover draft={parsed.value} onAdd={addModels} />
    </div>
  )
}
