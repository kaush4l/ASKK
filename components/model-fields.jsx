"use client"

import * as React from "react"
import { ListIcon, LoaderIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { listModels } from "@/backend/models/llm"
import { LOCAL_PROVIDERS, PROVIDERS } from "@/backend/models/catalog"

function Row({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

const inputClass = "pointer-coarse:h-10 dark:bg-transparent"

// Edit one model connection. Load lists the server's models to pick from.
export function ModelFields({ value, onChange }) {
  const id = React.useId()
  const [models, setModels] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)
  const set = (patch) => onChange({ ...value, ...patch })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setModels(await listModels(value))
    } catch (e) {
      setModels(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const number = (raw) => (raw === "" ? "" : Math.max(0, Math.floor(Number(raw))) || "")
  const known = models?.find((m) => m.id === value.id)
  const onThisMachine = value.provider in LOCAL_PROVIDERS // no URL or key: the host runs it

  return (
    <div className="flex flex-col gap-4">
      <Row id={`${id}-provider`} label="Endpoint type">
        <Tabs
          id={`${id}-provider`}
          value={value.provider}
          onValueChange={(provider) => (setModels(null), set({ provider }))}
        >
          <TabsList className="h-auto flex-wrap">
            {Object.entries(PROVIDERS).map(([key, label]) => (
              <TabsTrigger key={key} value={key} className="pointer-coarse:h-10">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Row>

      {onThisMachine ? (
        <p className="text-xs text-muted-foreground">
          Runs on this Mac through ASKK (local mode only), signed in as you. Load lists its models.
        </p>
      ) : (
        <>
          <Row id={`${id}-url`} label="Base URL">
            <Input
              id={`${id}-url`}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value.base_url ?? ""}
              placeholder={value.provider === "anthropic" ? "https://api.anthropic.com" : "http://127.0.0.1:8873/v1"}
              onChange={(e) => (setModels(null), set({ base_url: e.target.value }))}
              className={inputClass}
            />
          </Row>

          <Row id={`${id}-key`} label="API key" hint="Stored in plain text in this browser. Leave empty for local servers.">
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              value={value.api_key ?? ""}
              onChange={(e) => set({ api_key: e.target.value })}
              className={inputClass}
            />
          </Row>
        </>
      )}

      <Row
        id={`${id}-model`}
        label="Model"
        hint={known ? `Context window: ${known.contextLength?.toLocaleString() ?? "not reported"} tokens` : null}
      >
        <div className="flex gap-2">
          <Input
            id={`${id}-model`}
            list={`${id}-models`}
            autoComplete="off"
            spellCheck={false}
            value={value.id ?? ""}
            onChange={(e) => set({ id: e.target.value })}
            className={inputClass}
          />
          <Button type="button" variant="outline" onClick={load} disabled={loading} className="shrink-0 pointer-coarse:h-10">
            {loading ? <LoaderIcon className="animate-spin" /> : <ListIcon />}
            Load
          </Button>
        </div>
        <datalist id={`${id}-models`}>
          {models?.map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
        {models && (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => set({ id: m.id })}
                aria-pressed={value.id === m.id}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:text-foreground pointer-coarse:py-2"
              >
                {m.id}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Row>

      <div className="grid grid-cols-2 gap-4">
        <Row id={`${id}-context`} label="Context window">
          <Input
            id={`${id}-context`}
            inputMode="numeric"
            value={value.context_length ?? ""}
            placeholder="auto"
            onChange={(e) => set({ context_length: number(e.target.value) })}
            className={inputClass}
          />
        </Row>
        <Row id={`${id}-max`} label="Max output tokens">
          <Input
            id={`${id}-max`}
            inputMode="numeric"
            value={value.max_tokens ?? ""}
            placeholder="8192"
            onChange={(e) => set({ max_tokens: number(e.target.value) })}
            className={inputClass}
          />
        </Row>
      </div>
    </div>
  )
}
