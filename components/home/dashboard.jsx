"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FolderIcon, SquareIcon } from "lucide-react"

import { describeActivity } from "@/backend/live/activity"
import { isRunRequest } from "@/backend/live/agent"
import { talkOf } from "@/backend/live/talk"
import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/live/host"
import { SpeechCapability } from "@/components/models/speech-capability"
import { DeskTalk } from "@/components/talk/desk-talk"
import { BrowserAgentBar, BrowserAgentSetup } from "@/components/browser/browser-agent"
import { Constellation } from "@/components/home/constellation"
import { TalkPanel } from "@/components/home/talk-panel"
import { DeskLevels } from "@/components/kernel/desk-levels"
import { ProposedDesks } from "@/components/kernel/proposed-desks"
import { Button } from "@/components/ui/button"
import { useDesk, useEngineStates, useEngines } from "@/hooks/use-engines"
import { LIMITS, ROUTES } from "@/lib/config"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// The home page: a live dashboard of the desk — where the owner talks to the desk (ask the lead, the desk's talk, what
// waits for an accept) and sees which agent runs and what (2026-10-23 owner: "The interaction will mostly happen from the
// dashboard"). It reads the registry and agent state only, like every other view; actions go through the agents'
// methods (calls to the desk server). An agent opens its debug page (turn by turn).

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
    const timer = setInterval(() => setNow(Date.now()), LIMITS.ui.home.clockTickMs)
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
        {greeting ? `${greeting}. ${busy ? "Your team is at work." : "Your team is ready."}` : " "}
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

// No desk server answers here (capability `team` missing): how to start one — or (2026-10-20, the hosted version) run a
// single agent in this tab against a model the owner names (components/browser/browser-agent.jsx).
function Offline() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
        <p>No desk is running here.</p>
        <p className="text-muted-foreground">
          The desk runs on your computer and this page follows it. Start it from the repository with{" "}
          <code className="font-mono text-foreground">bun run dev</code> and open the address it prints — or run an agent in this browser below.
        </p>
      </div>
      <BrowserAgentSetup />
    </div>
  )
}

// ── live: who is working, on what ────────────────────────────────────────

function lastTool(state) {
  const messages = state?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool" && m.name) return m
    if (isRunRequest(m)) return null // only the current run's work (guidance and an owner chat are not a run)
  }
  return null
}

// 2026-10-23 owner ("the dashboard showing which agent is running and what"): one row per agent at work — what it does
// now, the request it works on (yours, or a quest and from whom), how long, its last call — and Stop (the owner can
// stop anything). A row opens the agent's debug page (turn by turn).
function since(iso, now) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return Number.isFinite(s) ? (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`) : null
}

// Who a run is for, in words (audit 19: every from read "quest from …", a Telegram message and a booked wake too).
function sourceOf(request, engines) {
  const from = request?.from
  if (!from || from === "owner") return "your request"
  if (String(from).startsWith("telegram")) return "your request (Telegram)"
  if (engines.some((e) => e.name === from)) return `quest from ${from}`
  return `from ${from}`
}

function LivePanel({ engines, states, onOpen }) {
  const working = engines
    .map((engine, i) => ({ engine, state: states[i] }))
    .filter(({ state }) => state?.activity && state.activity.phase !== "idle")
  // a second clock while anyone works, so each row's time runs
  const [now, setNow] = React.useState(() => Date.now())
  const any = working.length > 0
  React.useEffect(() => {
    if (!any) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [any])
  if (!any) return null
  return (
    <section className="flex w-full max-w-xl flex-col gap-2" aria-labelledby="live-title" aria-live="polite">
      <h2 id="live-title" className="text-sm text-muted-foreground">At work now</h2>
      <ol className="flex flex-col divide-y rounded-xl border">
        {working.map(({ engine, state }) => {
          const tool = lastTool(state)
          const request = state.messages?.find((m) => m.id === state.working?.request)
          const took = state.working?.at ? since(state.working.at, now) : null
          return (
            <li key={engine.id} data-at-work={engine.name} className="flex min-w-0 items-start">
              <button
                type="button"
                onClick={() => onOpen(engine)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", state.activity.phase === "waiting" ? "bg-amber-500" : "animate-pulse bg-emerald-500")}
                  />
                  <span>{engine.name}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{describeActivity(state.activity)}</span>
                  {took && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{took}</span>}
                </span>
                {request && (
                  <span className="truncate pl-4 text-xs">
                    <span className="text-muted-foreground">{sourceOf(request, engines)}: </span>
                    {clip(request.content, LIMITS.ui.home.activityMessageChars)}
                  </span>
                )}
                {tool && (
                  <span className="truncate pl-4 text-xs text-muted-foreground">
                    last: {tool.kind === "agent" ? "quest to " : ""}
                    {tool.name}
                    {tool.ok ? "" : " (failed)"}
                  </span>
                )}
              </button>
              {state.status === "running" && (
                <Button variant="ghost" size="sm" className="m-1.5 shrink-0 text-destructive pointer-coarse:h-10" aria-label={`Stop ${engine.name}`} onClick={() => engine.stop()}>
                  <SquareIcon /> Stop
                </Button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ── activity ─────────────────────────────────────────────────────────────

function eventsOf(engine, state) {
  return (state?.messages ?? []).flatMap((m) => {
    if (!m.at) return []
    const base = { id: m.id, engine, at: m.at }
    if (m.kind === "guidance") return [{ ...base, kind: "you", text: `Guided: ${clip(m.content, LIMITS.ui.home.activityMessageChars)}` }]
    // an owner chat (2026-10-17): the question and the answer, beside the runs
    if (m.kind === "chat" && m.role === "user") return [{ ...base, kind: "you", text: `Asked: ${clip(m.content, LIMITS.ui.home.activityMessageChars)}` }]
    if (m.kind === "chat") return [{ ...base, kind: "chat", text: `Replied: ${clip(m.content, LIMITS.ui.home.activityMessageChars)}` }]
    if (m.role === "user" && m.from) return [{ ...base, kind: "quest", text: `From ${m.from}: ${clip(m.content, LIMITS.ui.home.activityLetterChars)}` }]
    if (m.role === "user") return [{ ...base, kind: "you", text: `You: ${clip(m.content, LIMITS.ui.home.activityMessageChars)}` }]
    if (m.role === "assistant" && m.action === "answer") return [{ ...base, kind: m.error ? "fail" : "answer", text: `${m.error ? "Failed" : "Answered"}: ${clip(m.content, LIMITS.ui.home.activityMessageChars)}` }]
    if (m.role === "assistant" && m.action === "gate") return [{ ...base, kind: "gate", text: clip(m.content, LIMITS.ui.home.activityMessageChars) }]
    if (m.role === "tool" && m.name) return [{ ...base, kind: m.ok ? "tool" : "fail", text: `${m.kind === "agent" ? "Quest to" : "Used"} ${m.name}${m.ok ? "" : " — failed"}` }]
    return []
  })
}

const MARK = {
  you: "bg-foreground",
  answer: "bg-emerald-500",
  quest: "bg-sky-500",
  chat: "bg-primary/70",
  gate: "bg-amber-500",
  tool: "bg-muted-foreground/50",
  fail: "bg-destructive",
}

function ActivityFeed({ engines, states, onOpen, now }) {
  const events = engines
    .flatMap((engine, i) => eventsOf(engine, states[i]))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, LIMITS.ui.home.activityRows)
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
  const browser = host?.mode === "browser"
  return (
    <section className="flex flex-col gap-3 motion-safe:animate-rise"
      style={{ animationDelay: "2.2s" }}
      aria-labelledby="workspace-title">
      <h2 id="workspace-title" className="text-sm text-muted-foreground">
        Workspace
      </h2>
      <Link
        href={ROUTES.files}
        className="flex flex-col gap-2 rounded-xl border p-4 outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <FolderIcon className="size-4 text-muted-foreground" />
          <span className="text-lg">{host ? (local ? (host.desk?.name ?? "This computer") : browser ? "This browser" : "No desk server") : "Checking…"}</span>
        </span>
        <span className="text-sm break-all text-muted-foreground">{host ? (local ? host.root : browser ? "The files the agent in this tab keeps, in this browser." : "Start the desk server to see its workspace.") : ""}</span>
        {local && (
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {HOST_CAPABILITIES.map((cap) => (
              <span key={cap.id} className={hasCapability(host, cap.id) ? "text-emerald-500" : undefined}>
                {hasCapability(host, cap.id) ? "✓" : "–"} {cap.label}
              </span>
            ))}
          </span>
        )}
      </Link>
      {local && hasCapability(host, "speech") && <SpeechCapability className="px-1" />}
    </section>
  )
}

// ── page ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const router = useRouter()
  const { engines, requiredId, status, error } = useEngines()
  // The lead first: it is the root of the tree.
  const ordered = React.useMemo(
    () => [...engines].sort((a, b) => (a.id === requiredId ? -1 : b.id === requiredId ? 1 : 0)),
    [engines, requiredId]
  )
  const states = useEngineStates(ordered)
  const now = useNow()
  const desk = useDesk()
  const busy = states.some((s) => s?.status === "running" || s?.activity?.phase === "waiting")
  const talk = talkOf(desk?.artifacts)

  const open = (engine) => router.push(agentHref(engine.name))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
      <section className="flex flex-col items-center gap-6">
        <Welcome busy={busy} />
        {status === "offline" ? (
          <Offline />
        ) : status === "error" ? (
          <p className="text-center text-sm text-destructive">The desk failed to start: {error}</p>
        ) : (
          <>
            <BrowserAgentBar />
            {/* 2026-10-23 owner: "make the landing dashboard page the way to interact" — the goal and phase, the recent
                conversation, the message box and the voice, in one place. */}
            <TalkPanel engine={ordered[0] ?? null} state={states[0]} artifacts={desk?.artifacts} talking={!!talk} now={now} />
            <LivePanel engines={ordered} states={states} onOpen={open} />
            {/* 2026-10-18 owner: "The desk should be able to talk with me too" — what the desk tells and asks you. */}
            {talk && <DeskTalk talk={talk} engine={ordered[0] ?? null} leadMessages={states[0]?.messages} className="max-w-2xl" />}
            {/* 2026-10-20: what a run that read outside made (a desk, tool code), held until you accept it. */}
            <ProposedDesks className="max-w-2xl" />
          </>
        )}
        {/* The desk's tree takes the page's width: wide enough, the lead's teams stand side by side. */}
        {status !== "offline" && status !== "error" && (
          <div className="w-full">
            {ordered.length ? <Constellation engines={ordered} states={states} onOpen={open} /> : <div className="mx-auto aspect-[2/1] w-full max-w-xl" aria-label="Connecting to the desk" />}
          </div>
        )}
      </section>

      {/* The desk's levels: the lead → the teams it holds → their members, with every artifact. */}
      {desk?.tree ? <DeskLevels onOpen={open} compact /> : null}

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <ActivityFeed engines={ordered} states={states} onOpen={open} now={now} />
        <WorkspaceCard />
      </div>
    </div>
  )
}
