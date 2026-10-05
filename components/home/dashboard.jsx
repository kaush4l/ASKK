"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FolderIcon } from "lucide-react"

import { describeActivity } from "@/backend/core/activity"
import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/platform/host"
import { engineRegistry } from "@/backend/runtime/registry"
import { Approvals } from "@/components/chat/chat"
import { Composer } from "@/components/chat/composer"
import { Constellation } from "@/components/home/constellation"
import { useEngineStates, useEngines } from "@/hooks/use-engines"
import { engineTone } from "@/lib/engine-tone"
import { cn } from "@/lib/utils"

// The home page: a live dashboard of the team. It reads registry and engine
// state only, like every other view; actions go through engine methods.

const greetingFor = (hour) => (hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening")

function ago(iso, now) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const clip = (text, size) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim()
  return flat.length > size ? `${flat.slice(0, size)}…` : flat
}

// Re-render every 30 s so "5 min ago" stays true.
function useNow() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// ── welcome ──────────────────────────────────────────────────────────────

function Welcome({ busy }) {
  const [greeting, setGreeting] = React.useState(null)
  React.useEffect(() => setGreeting(greetingFor(new Date().getHours())), [])
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="min-h-6 text-base text-muted-foreground motion-safe:animate-focus-in"
        style={{ animationDelay: "1.1s" }}>
        {greeting ? `${greeting}. ${busy ? "Your team is at work." : "Your team is ready."}` : " "}
      </p>
      <h1 className="text-5xl tracking-wide sm:text-6xl" aria-label="ASKK">
        {"ASKK".split("").map((letter, i) => (
          <span
            key={i}
            aria-hidden
            className="inline-block motion-safe:animate-focus-in"
            style={{ animationDelay: `${1.3 + i * 0.09}s` }}
          >
            {letter}
          </span>
        ))}
      </h1>
    </div>
  )
}

// ── ask the lead ─────────────────────────────────────────────────────────

function QuickAsk({ engine, state, onOpen }) {
  const [text, setText] = React.useState("")
  const [asked, setAsked] = React.useState(null) // when this page last sent the lead a request
  const messages = state?.messages ?? []
  const reply = asked
    ? [...messages].reverse().find((m) => m.role === "assistant" && m.final && !m.waiting && m.at && m.at >= asked)
    : null
  return (
    <div className="flex w-full max-w-xl flex-col gap-2 motion-safe:animate-rise" style={{ animationDelay: "1.7s" }}>
      <Composer
        value={text}
        onChange={setText}
        onSend={(query) => {
          setAsked(new Date().toISOString())
          engine.send(query)
        }}
        onStop={() => engine.stop()}
        running={state?.status === "running"}
        disabled={!engine}
        label={`Ask ${engine?.name ?? "the lead"}`}
        placeholder={engine ? `Tell ${engine.name} what you need…` : "Starting agents…"}
      />
      {reply && (
        <div className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm" aria-live="polite">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {engine.name} answered
            <button type="button" onClick={() => onOpen(engine)} className="ml-auto underline-offset-2 hover:underline pointer-coarse:min-h-10">
              Open chat
            </button>
          </span>
          <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{reply.content}</p>
        </div>
      )}
    </div>
  )
}

// ── live: who is working, on what, and what needs you ─────────────────────

function lastTool(state) {
  const messages = state?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool" && m.name) return m
    if (m.role === "user" && !m.from) return null // only the current letter's work
  }
  return null
}

function LivePanel({ engines, states, onOpen }) {
  const working = engines
    .map((engine, i) => ({ engine, state: states[i] }))
    .filter(({ state }) => state?.activity && state.activity.phase !== "idle")
  const asking = engines
    .map((engine, i) => ({ engine, approvals: states[i]?.approvals ?? [] }))
    .filter(({ approvals }) => approvals.length)
  if (!working.length && !asking.length) return null
  return (
    <section className="flex w-full max-w-xl flex-col gap-2" aria-labelledby="live-title" aria-live="polite">
      <h2 id="live-title" className="sr-only">Live work</h2>
      {asking.map(({ engine, approvals }) => (
        <Approvals key={engine.id} engine={engine} approvals={approvals} />
      ))}
      {working.length > 0 && (
        <ol className="flex flex-col divide-y rounded-xl border">
          {working.map(({ engine, state }) => {
            const tool = lastTool(state)
            const forWhom = state.working?.from
            return (
              <li key={engine.id}>
                <button
                  type="button"
                  onClick={() => onOpen(engine)}
                  className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        state.activity.phase === "waiting" || state.activity.phase === "approval"
                          ? "bg-amber-500"
                          : "animate-pulse bg-emerald-500"
                      )}
                    />
                    <span>{engine.name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{describeActivity(state.activity)}</span>
                  </span>
                  {(forWhom || tool) && (
                    <span className="truncate pl-4 text-xs text-muted-foreground">
                      {forWhom ? `quest from ${forWhom}` : "your request"}
                      {tool ? ` · last: ${tool.kind === "agent" ? "quest to " : ""}${tool.name}${tool.ok ? "" : " (failed)"}` : ""}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ── agents ───────────────────────────────────────────────────────────────

function AgentCard({ engine, state, onOpen, index }) {
  const { dot, word } = engineTone(state)
  const messages = state?.messages ?? []
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant" && m.final && !m.waiting)
  const approvals = state?.approvals?.length ?? 0
  const quests = state?.quests?.length ?? 0
  const queued = state?.inbox?.length ?? 0
  return (
    <button
      type="button"
      onClick={() => onOpen(engine)}
      className="flex min-h-36 flex-col gap-2 rounded-xl border p-4 text-left transition-colors outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-rise"
      style={{ animationDelay: `${1.8 + index * 0.08}s` }}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span className="text-lg">{engine.name}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">{word}</span>
      </span>
      <span className="line-clamp-2 text-sm text-muted-foreground">{engine.description}</span>
      {lastAnswer && <span className="line-clamp-2 border-l pl-2 text-xs text-muted-foreground">{clip(lastAnswer.content, 160)}</span>}
      <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{messages.length} messages</span>
        {quests > 0 && <span className="text-emerald-500">{quests} quest{quests > 1 ? "s" : ""} out</span>}
        {queued > 0 && <span>{queued} in inbox</span>}
        {approvals > 0 && <span className="text-amber-500">Review {approvals} change{approvals > 1 ? "s" : ""}</span>}
      </span>
    </button>
  )
}

// ── activity ─────────────────────────────────────────────────────────────

function eventsOf(engine, state) {
  return (state?.messages ?? []).flatMap((m) => {
    if (!m.at) return []
    const base = { id: m.id, engine, at: m.at }
    if (m.role === "user" && m.guidance) return [{ ...base, kind: "steer", text: `Guidance from ${m.from}: ${clip(m.content, 120)}` }]
    if (m.role === "user" && m.status) return [{ ...base, kind: "status", text: `Status check on ${m.from}` }]
    if (m.role === "user" && m.reports) return [{ ...base, kind: "report", text: `Reports back from ${m.from}` }]
    if (m.role === "user" && m.from) return [{ ...base, kind: "quest", text: `Quest from ${m.from}: ${clip(m.content, 120)}` }]
    if (m.role === "user") return [{ ...base, kind: "you", text: `You: ${clip(m.content, 140)}` }]
    if (m.role === "assistant" && m.final && !m.waiting) return [{ ...base, kind: "answer", text: `Answered: ${clip(m.content, 140)}` }]
    if (m.role === "tool" && m.name) return [{ ...base, kind: m.ok ? "tool" : "fail", text: `${m.kind === "agent" ? "Quest to" : "Used"} ${m.name}${m.ok ? "" : " — failed"}` }]
    return []
  })
}

const MARK = {
  you: "bg-foreground",
  answer: "bg-emerald-500",
  quest: "bg-sky-500",
  report: "bg-sky-500",
  status: "bg-amber-500",
  steer: "bg-amber-500",
  tool: "bg-muted-foreground/50",
  fail: "bg-destructive",
}

function ActivityFeed({ engines, states, onOpen, now }) {
  const events = engines
    .flatMap((engine, i) => eventsOf(engine, states[i]))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 10)
  return (
    <section className="flex flex-col gap-3 motion-safe:animate-rise"
      style={{ animationDelay: "2.1s" }}
      aria-labelledby="activity-title">
      <h2 id="activity-title" className="text-sm text-muted-foreground">
        Recent activity
      </h2>
      {events.length ? (
        <ol className="flex flex-col">
          {events.map((event) => (
            <li key={`${event.engine.id}-${event.id}`}>
              <button
                type="button"
                onClick={() => onOpen(event.engine)}
                className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
              >
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", MARK[event.kind])} />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{event.engine.name}</span>{" "}
                  <span className="break-words text-muted-foreground">{event.text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ago(event.at, now)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing yet. Ask the lead for something above, and the work shows up here as it happens.
        </p>
      )}
    </section>
  )
}

// ── workspace ────────────────────────────────────────────────────────────

function WorkspaceCard() {
  const [host, setHost] = React.useState(null)
  React.useEffect(() => {
    detectHost().then(setHost)
  }, [])
  const local = host?.mode === "local"
  return (
    <section className="flex flex-col gap-3 motion-safe:animate-rise"
      style={{ animationDelay: "2.2s" }}
      aria-labelledby="workspace-title">
      <h2 id="workspace-title" className="text-sm text-muted-foreground">
        Workspace
      </h2>
      <Link
        href="/files"
        className="flex flex-col gap-2 rounded-xl border p-4 outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <FolderIcon className="size-4 text-muted-foreground" />
          <span className="text-lg">{host ? (local ? "This computer" : "This browser") : "Checking…"}</span>
        </span>
        <span className="text-sm break-all text-muted-foreground">
          {host ? (local ? host.root : "Files are kept in this browser. Run ASKK on your computer to work on a real folder.") : ""}
        </span>
        {host && (
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {HOST_CAPABILITIES.map((cap) => (
              <span key={cap.id} className={hasCapability(host, cap.id) ? "text-emerald-500" : undefined}>
                {hasCapability(host, cap.id) ? "✓" : "–"} {cap.label}
              </span>
            ))}
          </span>
        )}
      </Link>
    </section>
  )
}

// ── page ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const router = useRouter()
  const { engines, requiredId, status, error } = useEngines()
  // The lead (required engine) first: it sits in the middle.
  const ordered = React.useMemo(
    () => [...engines].sort((a, b) => (a.id === requiredId ? -1 : b.id === requiredId ? 1 : 0)),
    [engines, requiredId]
  )
  const states = useEngineStates(ordered)
  const now = useNow()
  const busy = states.some((s) => s?.status === "running" || s?.activity?.phase === "waiting")

  const open = (engine) => {
    engineRegistry.select(engine.id)
    router.push("/chat")
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
      <section className="flex flex-col items-center gap-6">
        <Welcome busy={busy} />
        <div className="w-full max-w-xl">
          {status === "error" ? (
            <p className="text-center text-sm text-destructive">Agents failed to start: {error}</p>
          ) : ordered.length ? (
            <Constellation engines={ordered} states={states} onOpen={open} />
          ) : (
            <div className="aspect-[2/1] w-full" aria-label="Starting agents" />
          )}
        </div>
        <QuickAsk engine={ordered[0] ?? null} state={states[0]} onOpen={open} />
        <LivePanel engines={ordered} states={states} onOpen={open} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="team-title">
        <h2 id="team-title" className="text-sm text-muted-foreground">
          Your team
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((engine, i) => (
            <AgentCard key={engine.id} engine={engine} state={states[i]} onOpen={open} index={i} />
          ))}
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <ActivityFeed engines={ordered} states={states} onOpen={open} now={now} />
        <WorkspaceCard />
      </div>
    </div>
  )
}
