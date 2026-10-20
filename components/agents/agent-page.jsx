"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CopyIcon, SquareIcon, Trash2Icon } from "lucide-react"

import { askChat, chatAnswer, chatShown } from "@/backend/live/agent"
import { artifactsHeldBy } from "@/backend/live/desk"
import { registry } from "@/backend/live/registry"
import { spawnedLine } from "@/backend/live/spawned"
import { callLook } from "@/backend/live/visual"
import { ActivityLine, ChatPair, Thread } from "@/components/agents/thread"
import { Composer } from "@/components/chat/composer"
import { ArtifactsView } from "@/components/live/artifacts-view"
import { Button } from "@/components/ui/button"
import { CallIcon, toneOf } from "@/components/views/call-look"
import { useDesk, useEngineState, useEngineStates, useEngines } from "@/hooks/use-engines"
import { engineTone } from "@/lib/engine-tone"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// One agent's page — the agent's twin on the UI: what it is (its agent.md: description, role, model, folder,
// team), what it can call (every tool by type and view, its sub-agents), what it keeps (the artifacts it holds),
// what it did (its runs as a thread) and what its model calls cost. Talk to it from here. `?name=<agent>`.

const TABS = [
  { id: "runs", label: "Runs" },
  { id: "role", label: "Role" },
  { id: "tools", label: "Tools" },
  { id: "artifacts", label: "Artifacts" },
  { id: "prompt", label: "Prompt" },
]

export function AgentPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { engines, requiredId, status } = useEngines()
  const states = useEngineStates(engines)
  const name = params.get("name")
  const engine = engines.find((e) => e.name === name) ?? engines.find((e) => e.id === requiredId) ?? null
  React.useEffect(() => {
    if (engine) registry.select(engine.id)
  }, [engine])
  const open = (next) => router.replace(agentHref(next.name), { scroll: false })

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <AgentPicker engines={engines} states={states} current={engine} onOpen={open} />
      {engine ? (
        <AgentDetail key={engine.id} engine={engine} />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">{status === "offline" ? "No desk is running here." : "Connecting to the desk…"}</p>
      )}
    </div>
  )
}

// Every agent of the desk, grouped by team: a select on phones, a list beside the page on wider screens.
function AgentPicker({ engines, states, current, onOpen }) {
  const groups = React.useMemo(() => {
    const byTeam = new Map()
    engines.forEach((e, i) => {
      const team = e.team?.split("/").at(-1) ?? "desk"
      if (!byTeam.has(team)) byTeam.set(team, [])
      byTeam.get(team).push({ engine: e, state: states[i] })
    })
    return [...byTeam]
  }, [engines, states])
  return (
    <>
      <div className="border-b p-3 md:hidden">
        <label htmlFor="agent-pick" className="sr-only">Agent</label>
        <select
          id="agent-pick"
          value={current?.name ?? ""}
          onChange={(e) => onOpen(engines.find((x) => x.name === e.target.value))}
          className="h-10 w-full rounded-md border bg-background px-2 text-base"
        >
          {groups.map(([team, list]) => (
            <optgroup key={team} label={team}>
              {list.map(({ engine }) => (
                <option key={engine.id} value={engine.name}>{engine.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <nav aria-label="Agents" className="hidden w-52 shrink-0 overflow-auto border-r p-2 md:block">
        {groups.map(([team, list]) => (
          <div key={team} className="mb-3">
            <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{team}</p>
            {list.map(({ engine, state }) => {
              const tone = engineTone(state)
              return (
                <button
                  key={engine.id}
                  type="button"
                  onClick={() => onOpen(engine)}
                  aria-current={engine.id === current?.id ? "page" : undefined}
                  className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent", engine.id === current?.id && "bg-accent text-foreground")}
                >
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
                  <span className="truncate">{engine.name}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </>
  )
}

const seconds = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

function AgentDetail({ engine }) {
  const state = useEngineState(engine)
  const desk = useDesk()
  const [tab, setTab] = React.useState("runs")
  const [input, setInput] = React.useState("")
  const [sent, setSent] = React.useState(null) // what became of the last message: queued, or guidance not delivered
  // the last question asked here, until the thread shows its answer as a chat row (the host appends the pair)
  const [chat, setChat] = React.useState(null)
  const tone = engineTone(state)
  const running = state?.status === "running"
  const stats = state?.stats
  const held = React.useMemo(() => Object.fromEntries(artifactsHeldBy(desk?.artifacts, engine.name).map((a) => [a.id, a])), [desk?.artifacts, engine.name])
  const active = new Set(state?.activity?.names ?? (state?.activity?.name ? [state.activity.name] : []))
  const spawned = spawnedLine(engine) // a helper made at run time: by whom, for what, how long it stays (null: a desk agent)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className={cn("size-2.5 rounded-full", tone.dot)} />
          <h1 className="text-2xl">{engine.name}</h1>
          <span className="text-xs text-muted-foreground">{tone.word}</span>
          {running && (
            <Button variant="destructive" size="sm" className="ml-auto h-10" onClick={() => engine.stop()}>
              <SquareIcon /> Stop
            </Button>
          )}
        </div>
        {engine.description && <p className="text-sm text-muted-foreground">{engine.description}</p>}
        {spawned && (
          <p data-spawned className="break-words text-xs text-muted-foreground">
            {spawned}
          </p>
        )}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {engine.team && <Field label="team">{engine.team}</Field>}
          <Field label="model">{engine.model ?? "desk default"}</Field>
          {engine.folder && <Field label="folder"><code className="font-mono">{engine.folder}</code></Field>}
          <Field label="model calls">{stats ? `${stats.calls} · last ${seconds(stats.lastMs)} · avg ${seconds(stats.avgMs)} · prompt ${stats.promptChars?.toLocaleString()} chars` : "none since the desk started"}</Field>
        </dl>
        <div role="tablist" aria-label={`${engine.name} views`} className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("rounded-md border px-2.5 py-1 text-xs pointer-coarse:py-2.5", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
              {t.id === "tools" && <span className="ml-1 text-muted-foreground">{engine.tools.length}</span>}
              {t.id === "artifacts" && <span className="ml-1 text-muted-foreground">{Object.keys(held).length}</span>}
            </button>
          ))}
        </div>
      </header>

      {tab === "runs" && (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
              <Thread engine={engine} messages={state?.messages ?? []} empty={`No runs yet. Message ${engine.name} below, or it runs when another agent hands it a quest.`} />
            </div>
          </div>
          <Composer
            className="mx-auto w-full max-w-3xl p-4 pt-0"
            value={input}
            onChange={setInput}
            onSend={(text) => (engine.send(text), setSent(running ? `Queued: ${engine.name} runs it after the current run.` : null))}
            onGuide={async (text) => {
              // Read at its next step (the thread shows it); a run that ended first gives the text back.
              setSent(null)
              const back = (why) => (setInput((now) => now || text), setSent(why))
              try {
                const { delivered } = (await engine.guide(text)) ?? {}
                if (!delivered) back(`${engine.name} finished before your note arrived: it is back in the box, send it as new work.`)
              } catch (error) {
                back(`Guidance not sent: ${error.message}`)
              }
            }}
            onAsk={async (question) => {
              // A question answered beside the run: the thread shows the pair (kind chat rows); a failure gives the text back.
              setSent(null)
              setChat({ question, pending: true })
              const outcome = await askChat(engine, question)
              if (outcome.error) setInput((now) => now || question)
              setChat(outcome)
            }}
            onStop={() => engine.stop()}
            running={running}
            placeholder={`Message ${engine.name}…`}
            above={
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pb-2">
                <ActivityLine engine={engine} activity={state?.activity} />
                <ClearMemory engine={engine} />
                {sent && (
                  <p className="w-full text-xs text-muted-foreground" aria-live="polite">
                    {sent}
                  </p>
                )}
                {chat && !chatShown(state?.messages, chat.answer) && (
                  <ChatPair
                    engine={engine}
                    question={chat.question}
                    answer={chatAnswer(chat)}
                    pending={!!chat.pending}
                    error={chat.error}
                    onDismiss={() => setChat(null)}
                    className="w-full text-xs"
                  />
                )}
              </div>
            }
          />
        </>
      )}
      {tab === "role" && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words font-sans text-sm">{engine.role || "(no role text)"}</pre>
        </div>
      )}
      {tab === "tools" && <ToolList tools={engine.tools} active={active} />}
      {tab === "artifacts" && (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <ArtifactsView artifacts={held} empty={`${engine.name} holds no artifacts.`} />
        </div>
      )}
      {tab === "prompt" && <NextPrompt engine={engine} messages={state?.messages} />}
    </div>
  )
}

const Field = ({ label, children }) => (
  <div className="flex min-w-0 gap-1">
    <dt>{label}</dt>
    <dd className="min-w-0 break-all text-foreground/80">{children}</dd>
  </div>
)

// Every tool, by type: its sub-agents (quests), the artifacts' commands, its functions and MCP tools, each with its
// call kind's look (callLook, as its calls show in the thread and the Live feed). A tool in use right now is marked.
const TYPE_LABEL = { agent: "Sub-agents (quests)", artifact: "Artifact commands", function: "Functions", mcp: "MCP tools" }
function ToolList({ tools, active }) {
  const groups = React.useMemo(() => {
    const byType = new Map()
    for (const t of tools) {
      const type = TYPE_LABEL[t.type] ? t.type : "function"
      if (!byType.has(type)) byType.set(type, [])
      byType.get(type).push(t)
    }
    return Object.keys(TYPE_LABEL).filter((t) => byType.has(t)).map((t) => [t, byType.get(t)])
  }, [tools])
  if (!tools.length) return <p className="p-4 text-sm text-muted-foreground">No tools.</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {groups.map(([type, list]) => (
          <section key={type} className="flex flex-col gap-1.5" aria-label={TYPE_LABEL[type]}>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{TYPE_LABEL[type]}</h2>
            {list.map((t) => {
              const look = callLook({ type: t.type, view: t.view, name: t.name })
              return (
                <div key={t.name} data-call-kind={look.kind} className={cn("rounded-md border px-3 py-2", active.has(t.name) && toneOf(look).border)}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <CallIcon look={look} className="size-3.5" />
                    <span className="min-w-0 break-all font-mono">{t.name}</span>
                    {t.view && <span className="rounded border px-1 text-[10px] text-muted-foreground">{t.view}</span>}
                    {active.has(t.name) && <span className={cn("text-xs", toneOf(look).text)}>in use</span>}
                  </div>
                  {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                  {Object.keys(t.input ?? {}).length > 0 && (
                    <dl className="mt-1 grid gap-0.5 text-xs">
                      {Object.entries(t.input).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="shrink-0 font-mono">{k}</dt>
                          <dd className="min-w-0 break-words text-muted-foreground">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}

// The prompt the agent's next step would see (soul → role → artifacts → request → history → tools → response format).
function NextPrompt({ engine, messages }) {
  const [prompt, setPrompt] = React.useState("")
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    let current = true
    engine.preview("").then(
      (text) => current && (setPrompt(text ?? ""), setError(null)),
      (e) => current && setError(e.message)
    )
    return () => {
      current = false
    }
  }, [engine, messages?.length])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span>The prompt {engine.name}'s next step would see</span>
        <span className="ml-auto tabular-nums">{prompt.length.toLocaleString()} chars · ~{Math.ceil(prompt.length / 4).toLocaleString()} tok</span>
        <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-10" aria-label="Copy prompt" disabled={!prompt} onClick={() => navigator.clipboard.writeText(prompt)}>
          <CopyIcon />
        </Button>
      </div>
      {error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{prompt || "Rendering…"}</pre>
    </div>
  )
}

// Forget the agent's earlier runs (its EARLIER RUNS in the prompt); the transcript beside its agent.md stays.
function ClearMemory({ engine }) {
  const [asking, setAsking] = React.useState(false)
  if (!asking)
    return (
      <Button variant="ghost" size="sm" className="h-8 text-xs pointer-coarse:h-10" onClick={() => setAsking(true)}>
        <Trash2Icon /> Clear memory
      </Button>
    )
  return (
    <span className="flex items-center gap-1 text-xs">
      Forget {engine.name}'s earlier runs?
      <Button variant="destructive" size="sm" className="h-8 pointer-coarse:h-10" onClick={() => (engine.clearMemory(), setAsking(false))}>
        Clear
      </Button>
      <Button variant="ghost" size="sm" className="h-8 pointer-coarse:h-10" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  )
}
