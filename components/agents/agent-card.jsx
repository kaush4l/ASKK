"use client"

import * as React from "react"
import { PencilIcon, RotateCcwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { pickEditable } from "@/backend/agents/agent-store"
import { RESPONSE_FORMATS } from "@/backend/agents/definitions"
import { engineRegistry } from "@/backend/runtime/registry"
import { PROVIDERS, resolveModel } from "@/backend/models/catalog"
import { TOOL_NAMES } from "@/backend/features"
import { useModels } from "@/hooks/use-models"
import { cn } from "@/lib/utils"

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function ToolBadges({ tools }) {
  if (!tools.length) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <Badge key={tool} variant="outline">
          {tool}
        </Badge>
      ))}
    </div>
  )
}

function AgentView({ agent, liveCount }) {
  const { default: defaultKey } = useModels() // re-render on catalogue changes
  const model = resolveModel(agent.model)
  return (
    <CardContent className="flex flex-col gap-4">
      <Field label="Model">
        <span className="text-sm break-all">
          <span className="font-mono">{agent.model ?? `default (${defaultKey ?? "none"})`}</span>
          {model ? (
            <span className="text-muted-foreground">
              {" "}
              · {model.id} · {PROVIDERS[model.provider]}
            </span>
          ) : (
            <span className="text-destructive"> · not in the model catalogue</span>
          )}
        </span>
      </Field>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Response format">
          <span className="text-sm">{agent.response_format}</span>
        </Field>
        <Field label="Strategy">
          <span className="text-sm">{agent.strategy}</span>
        </Field>
        <Field label="Live engines">
          <span className="text-sm">{liveCount}</span>
        </Field>
      </div>
      <Field label="Tools">
        <ToolBadges tools={agent.tools} />
      </Field>
      {agent.artifacts?.length > 0 && (
        <Field label="Artifacts">
          <ToolBadges tools={agent.artifacts} />
        </Field>
      )}
      {agent.agents?.length > 0 && (
        <Field label="Delegates to (agents as tools)">
          <ToolBadges tools={agent.agents} />
        </Field>
      )}
      <Field label="Instructions">
        <p className="line-clamp-5 text-sm whitespace-pre-wrap">{agent.instructions}</p>
      </Field>
    </CardContent>
  )
}

function AgentForm({ agent, draft, setDraft, ids }) {
  const catalogue = useModels()
  // Keep an unknown key selectable so an edit doesn't silently drop it.
  const modelKeys = [...new Set([...catalogue.models.map((m) => m.key), ...(agent.model ? [agent.model] : [])])]
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const toolOptions = [...new Set([...TOOL_NAMES, ...agent.tools])]
  const toggleTool = (tool) =>
    update({
      tools: draft.tools.includes(tool)
        ? draft.tools.filter((t) => t !== tool)
        : toolOptions.filter((t) => t === tool || draft.tools.includes(t)),
    })

  return (
    <CardContent className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.description} className="text-xs text-muted-foreground">
          Description
        </label>
        <Textarea
          id={ids.description}
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          className="min-h-16 dark:bg-transparent"
        />
      </div>

      <Field label="Response format">
        <Tabs value={draft.response_format} onValueChange={(value) => update({ response_format: value })}>
          <TabsList>
            {RESPONSE_FORMATS.map((format) => (
              <TabsTrigger key={format} value={format} className="pointer-coarse:h-10">
                {format}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Field>

      <Field label="Model">
        <div className="flex flex-wrap gap-2">
          {[null, ...modelKeys].map((key) => (
            <button
              key={key ?? "default"}
              type="button"
              aria-pressed={(draft.model ?? null) === key}
              onClick={() => update({ model: key })}
              className={cn(
                "h-8 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10",
                (draft.model ?? null) === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {key ?? "Default"}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Tools">
        <div className="flex flex-wrap gap-2">
          {toolOptions.map((tool) => {
            const on = draft.tools.includes(tool)
            return (
              <button
                key={tool}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTool(tool)}
                className={cn(
                  "h-8 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10",
                  on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {tool}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.instructions} className="text-xs text-muted-foreground">
          Instructions
        </label>
        <Textarea
          id={ids.instructions}
          value={draft.instructions}
          onChange={(e) => update({ instructions: e.target.value })}
          className="min-h-48 dark:bg-transparent"
        />
      </div>
    </CardContent>
  )
}

export function AgentCard({ agent, edited, liveCount }) {
  const [draft, setDraft] = React.useState(null)
  const [error, setError] = React.useState(null)
  const id = React.useId()
  const editing = draft !== null

  function run(action) {
    try {
      action()
      setDraft(null)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{agent.name}</CardTitle>
        {!editing && <CardDescription>{agent.description}</CardDescription>}
        <CardAction>
          <Badge variant={edited ? "secondary" : "outline"}>{edited ? "edited" : "file"}</Badge>
        </CardAction>
      </CardHeader>

      {editing ? (
        <AgentForm
          agent={agent}
          draft={draft}
          setDraft={setDraft}
          ids={{ description: `${id}-description`, instructions: `${id}-instructions` }}
        />
      ) : (
        <AgentView agent={agent} liveCount={liveCount} />
      )}

      <CardFooter className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button onClick={() => run(() => engineRegistry.updateAgent(agent.name, draft))}>
              Save
            </Button>
            <Button variant="outline" onClick={() => (setDraft(null), setError(null))}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setDraft(pickEditable(agent))}>
            <PencilIcon /> Edit
          </Button>
        )}
        {edited && (
          <Button variant="ghost" onClick={() => run(() => engineRegistry.resetAgent(agent.name))}>
            <RotateCcwIcon /> Reset to file
          </Button>
        )}
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardFooter>
    </Card>
  )
}
