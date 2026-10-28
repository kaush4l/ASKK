"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FolderIcon } from "lucide-react"

import { busy } from "@/backend/live/focus"
import { HOST_CAPABILITIES, detectHost, hasCapability } from "@/backend/live/host"
import { openQuestions, talkOf } from "@/backend/live/talk"
import { BrowserAgentBar, BrowserAgentSetup } from "@/components/browser/browser-agent"
import { ChatRail, LeadGoal, MessageBox } from "@/components/home/talk-panel"
import { DeskLevels } from "@/components/kernel/desk-levels"
import { ProposedDesks } from "@/components/kernel/proposed-desks"
import { StateLegend } from "@/components/kernel/state-legend"
import { SpeechCapability } from "@/components/models/speech-capability"
import { useDesk, useEngineStates, useEngines } from "@/hooks/use-engines"
import { ROUTES } from "@/lib/config"
import { agentHref } from "@/lib/nav"
import { cn } from "@/lib/utils"

// The home page (2026-10-23 owner: "The interaction will mostly happen from the dashboard"; 2026-10-25 owner: "Rework it
// for much more cleaner outlook"; then: "Make the chat window short and to the side and focus on the agent flow live
// dashboard at the center with the text box"): in the centre the agent flow — what the lead works toward, the desk live
// (who does what, colour by state with its key, the artifacts each holds as live tiles, what waits for your accept, the
// workspace) — over the message box; at the side a narrow chat (components/home/talk-panel.jsx: one scrolling timeline
// with the run's live status). On a phone the flow and the chat are a tab each, the message box under both. It reads the registry and agent state only; actions
// go through the agents' methods. An agent opens its debug page (turn by turn).

// No desk server answers here (capability `team` missing): how to start one — or (2026-10-20, the hosted version) run a
// single agent in this tab against a model the owner names (components/browser/browser-agent.jsx).
function Offline() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 md:py-12">
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

// Where the desk works: its folder and what the host offers, one link to the files.
function Workspace() {
  const [host, setHost] = React.useState(null)
  React.useEffect(() => {
    detectHost().then(setHost)
  }, [])
  const local = host?.mode === "local"
  return (
    <section aria-label="Workspace" className="flex flex-col gap-2">
      <Link href={ROUTES.files} className="flex flex-col gap-1 rounded-xl border p-3 text-sm outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="flex items-center gap-2">
          <FolderIcon className="size-4 text-muted-foreground" />
          {host ? (local ? (host.desk?.name ?? "This computer") : host.mode === "browser" ? "This browser" : "No desk server") : "Checking…"}
        </span>
        {local && <span className="truncate text-xs text-muted-foreground" title={host.root}>{host.root}</span>}
        {local && (
          <span className="flex flex-wrap gap-x-2.5 text-[11px] text-muted-foreground">
            {HOST_CAPABILITIES.filter((cap) => hasCapability(host, cap.id)).map((cap) => <span key={cap.id} title={cap.label}>{cap.short}</span>)}
          </span>
        )}
      </Link>
      {local && hasCapability(host, "speech") && <SpeechCapability className="px-1" />}
    </section>
  )
}

// Flow | Chat on a phone; side by side from lg up.
function Tabs({ view, onView, working, asks }) {
  const tab = (id, label, badge) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => onView(id)}
      className={cn("flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-sm", view === id ? "bg-accent text-foreground" : "text-muted-foreground")}
    >
      {label}
      {badge}
    </button>
  )
  return (
    <div role="tablist" aria-label="Dashboard" className="flex gap-1 border-b p-1.5 lg:hidden">
      {tab("flow", "Flow", working && <span aria-label="at work" className="size-2 rounded-full bg-violet-500 motion-safe:animate-pulse" />)}
      {tab("chat", "Chat", asks > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{asks}</span>)}
    </div>
  )
}

export function Dashboard() {
  const router = useRouter()
  const { engines, status, error } = useEngines()
  const lead = engines[0] ?? null
  const [view, setView] = React.useState("flow")
  const working = useEngineStates(engines, busy)
  const asks = useDesk((d) => openQuestions(talkOf(d?.artifacts)).length)
  const open = React.useCallback((engine) => router.push(agentHref(engine.name)), [router])

  if (status === "offline") return <Offline />
  if (status === "error") return <p className="p-8 text-center text-sm text-destructive">The desk failed to start: {error}</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Tabs view={view} onView={setView} working={working} asks={asks} />
      {/* the centre: the agent flow */}
      <div className={cn("@container min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:col-start-1 lg:row-start-1 lg:flex", view === "flow" ? "flex" : "hidden")}>
        <BrowserAgentBar />
        <LeadGoal engine={lead} />
        <StateLegend className="flex-wrap gap-y-1" />
        {/* the lead → the teams it holds → their members, each with the artifacts it holds, live */}
        <DeskLevels onOpen={open} />
        {/* 2026-10-20: what a run that read outside made (a desk, tool code), held until you accept it */}
        <ProposedDesks />
        <Workspace />
      </div>
      {/* the side: the chat, short */}
      <ChatRail engine={lead} className={cn("flex-1 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:border-l", view === "chat" ? "flex" : "hidden")} />
      {/* under the flow (under both tabs on a phone): the message box */}
      <MessageBox engine={lead} className="border-t p-3 lg:col-start-1 lg:row-start-2" />
    </div>
  )
}
