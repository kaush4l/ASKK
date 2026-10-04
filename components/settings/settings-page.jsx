"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, RotateCcwIcon, StarIcon, Trash2Icon } from "lucide-react"

import { ModelFields } from "@/components/model-fields"
import { ModelsJson } from "@/components/settings/models-json"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { models, MODEL_FIELDS, PROVIDERS } from "@/backend/models/catalog"
import { useModels } from "@/hooks/use-models"

const connection = (model) => Object.fromEntries(MODEL_FIELDS.map((f) => [f, model?.[f] ?? ""]))

// Key + label + connection fields, with Save / Cancel.
function ModelForm({ initial, keyLocked = false, onDone }) {
  const id = React.useId()
  const [key, setKey] = React.useState(initial.key ?? "")
  const [draft, setDraft] = React.useState(connection(initial))
  const [error, setError] = React.useState(null)

  function save() {
    try {
      models.save(key.trim(), draft)
      onDone()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-key`} className="text-xs text-muted-foreground">
            Key (used in agent.md)
          </label>
          <Input
            id={`${id}-key`}
            value={key}
            disabled={keyLocked}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. claude"
            onChange={(e) => setKey(e.target.value)}
            className="font-mono pointer-coarse:h-10 dark:bg-transparent"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-label`} className="text-xs text-muted-foreground">
            Label
          </label>
          <Input
            id={`${id}-label`}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="pointer-coarse:h-10 dark:bg-transparent"
          />
        </div>
      </div>
      <ModelFields value={draft} onChange={(next) => (setDraft(next), setError(null))} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>Save</Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}

function ModelRow({ model, isDefault }) {
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState(null)
  const act = (action) => {
    try {
      action()
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  if (editing) return <ModelForm initial={model} keyLocked onDone={() => setEditing(false)} />

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{model.key}</span>
        {isDefault && <Badge>default</Badge>}
        <Badge variant="outline">{model.source}</Badge>
      </div>
      {model.label && <p className="text-sm">{model.label}</p>}
      <p className="text-xs break-all text-muted-foreground">
        {PROVIDERS[model.provider]} · {model.id}
        <br />
        {model.base_url || "provider default URL"}
        {model.api_key ? " · API key saved" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {!isDefault && (
          <Button size="sm" variant="outline" onClick={() => act(() => models.setDefault(model.key))}>
            <StarIcon /> Make default
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon /> Edit
        </Button>
        {model.source === "edited" && (
          <Button size="sm" variant="ghost" onClick={() => act(() => models.remove(model.key))}>
            <RotateCcwIcon /> Reset to file
          </Button>
        )}
        {model.source === "browser" && (
          <Button size="sm" variant="ghost" onClick={() => act(() => models.remove(model.key))}>
            <Trash2Icon /> Delete
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function SettingsPage() {
  const catalogue = useModels()
  const [adding, setAdding] = React.useState(false)
  const [view, setView] = React.useState("form") // "form" | "json"
  const fallback = catalogue.models.find((m) => m.key === catalogue.default)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Saved in this browser.</p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-lg">Models</CardTitle>
          <CardDescription>
            Every agent uses the default model. An agent that needs another names its key in agent.md
            (<code>model: key</code>). Entries come from <code>.env</code>, <code>public/models.json</code>, or are
            added here; API keys stay in this browser. Edit them in the form or as JSON.
          </CardDescription>
          <CardAction>
            {view === "form" && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
                <PlusIcon /> Add
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="form" className="pointer-coarse:h-10">
                Form
              </TabsTrigger>
              <TabsTrigger value="json" className="pointer-coarse:h-10">
                JSON
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {catalogue.error && <p className="text-sm text-destructive">{catalogue.error}</p>}
          {catalogue.status !== "ready" && <p className="text-sm text-muted-foreground">Loading models…</p>}
          {view === "json" ? (
            catalogue.status === "ready" && <ModelsJson />
          ) : (
            <>
              {adding && (
                // Start from the default connection: usually only the model id changes.
                <ModelForm initial={{ ...connection(fallback), label: "" }} onDone={() => setAdding(false)} />
              )}
              {catalogue.models.map((model) => (
                <ModelRow key={model.key} model={model} isDefault={model.key === catalogue.default} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
