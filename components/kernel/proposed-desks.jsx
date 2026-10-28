"use client"

import * as React from "react"

import { detectHost } from "@/backend/live/host"
import { acceptNote, agentRows, fromLine, loadProposals, proposalCall, proposalTitle } from "@/backend/live/proposals"
import { Decide, DECIDE_BTN as BTN, useDecision } from "@/components/kernel/decide"
import { Button } from "@/components/ui/button"
import { LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

// What waits for the owner on the desk server (2026-10-20) — the twin of the host's proposals (GET desks/proposed,
// backend/live/proposals.js): a desk a run that read outside made (desk.create held: checked, nothing written, desk.load
// refuses it) and every desk's proposed tool code (desk.propose: never loaded). Drawn like a helper's proposal
// (components/kernel/proposed-helper.jsx): a dashed block, "proposed · not in force", every text that would be a prompt
// (each agent's role, goal, practice) or code, where its words came from, Accept / Drop (POST desks/accept | desks/drop:
// the page only, never a desk). A desk's Accept writes it as desk.create would now and loads it; a tool's moves it into
// tools/ and loads its desk again. On the home page; nothing drawn when nothing waits or no desk server answers.

const clock = (at) => {
  const ms = Date.parse(at ?? "")
  return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""
}
const Lines = ({ label, items }) =>
  items?.length ? (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <ul className="flex flex-col">
        {items.map((x, k) => (
          <li key={k} className="break-words">
            {x}
          </li>
        ))}
      </ul>
    </div>
  ) : null

// One agent the desk would have: who it is, its role (the prompt it would run with), what it would hold.
function AgentRow({ a, expanded }) {
  const holds = [...(a.tools ?? []), ...(a.artifacts ?? [])]
  return (
    <li className="min-w-0 border-l pl-1.5" style={{ marginLeft: `${Math.min(a.depth, 4) * 10}px` }}>
      <p className="break-words">
        <span className="text-foreground/90">{a.name}</span>
        {a.template && <span className="text-[11px] text-muted-foreground"> · team template</span>}
        {a.model && <span className="text-[11px] text-muted-foreground"> · {a.model}</span>}
        {a.description && <span className="text-muted-foreground"> — {a.description}</span>}
      </p>
      {a.goal && <p className="break-words text-[11px] text-muted-foreground">goal: {a.goal}</p>}
      <p className={cn("break-words", expanded ? "whitespace-pre-wrap" : "line-clamp-3")}>{a.role}</p>
      {holds.length > 0 && <p className="break-all font-mono text-[10px] text-muted-foreground">{holds.join(" · ")}</p>}
      {(a.writes || a.reads) && (
        <p className="break-all font-mono text-[10px] text-muted-foreground">
          {a.writes ? `writes ${a.writes.join(", ") || "none"}` : ""}
          {a.writes && a.reads ? " · " : ""}
          {a.reads ? `reads ${a.reads.join(", ") || "none"}` : ""}
        </p>
      )}
      {expanded && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          <Lines label="practice · checklist" items={a.practice?.checklist} />
          <Lines label="practice · quality" items={a.practice?.quality} />
          <Lines label="practice · instructions" items={a.practice?.instructions} />
        </div>
      )}
    </li>
  )
}

function DeskProposal({ p, onDone }) {
  const [expanded, setExpanded] = React.useState(false)
  const [call, act] = useDecision(async (method) => {
    const r = await proposalCall(method, { name: p.name })
    onDone(method === "accept" ? acceptNote(r) : `Dropped ${p.name}.`)
  })
  const rows = [...agentRows(p.lead), ...(p.teams ?? []).flatMap((t) => agentRows(t).map((a, k) => ({ ...a, template: k === 0 })))]
  return (
    <div data-proposed-desk={p.name} className="min-w-0 rounded border border-dashed border-amber-500/60 px-2 py-1.5 text-xs">
      <p className="text-[11px] text-amber-700 dark:text-amber-400">proposed · not in force · waits for you</p>
      <p className="break-words text-sm">{proposalTitle(p)}</p>
      <p className="break-words text-[11px] text-muted-foreground">
        {p.update ? "it runs as it was until you accept" : "nothing written yet: desk.load refuses it until you accept"}
        {p.by ? ` · by ${p.by}` : ""}
        {p.at ? ` · ${clock(p.at)}` : ""}
      </p>
      {p.description && <p className="break-words">{p.description}</p>}
      {expanded && p.request && <p className="break-words text-[11px] text-muted-foreground">request: “{p.request}”</p>}
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((a, k) => (
          <AgentRow key={`${k}:${a.name}`} a={a} expanded={expanded} />
        ))}
      </ul>
      {expanded && p.folders?.length > 0 && <p className="break-all font-mono text-[10px] text-muted-foreground">folders: {p.folders.join(", ")}</p>}
      {expanded && p.written?.length > 0 && <p className="break-all font-mono text-[10px] text-muted-foreground">would write: {p.written.join(", ")}</p>}
      <p className="break-words text-[11px] text-amber-700 dark:text-amber-400">{fromLine(p.from)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Decide call={call} act={act} what={`the ${p.update ? "update of" : "new"} desk ${p.name}`} acceptTitle="Write the desk as desk.create would now (every check again) and load it" dropTitle="Delete the proposal: nothing is written" />
        <Button type="button" variant="link" size="xs" className={cn(BTN, "mt-1")} onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show all"}
        </Button>
      </div>
    </div>
  )
}

function ToolProposal({ t, onDone }) {
  const [expanded, setExpanded] = React.useState(false)
  const [call, act] = useDecision(async (method) => {
    const r = await proposalCall(method, { name: t.desk, tool: t.file })
    onDone(method === "accept" ? acceptNote(r) : `Dropped ${t.file}.js.`)
  })
  return (
    <div data-proposed-tool={`${t.desk}/${t.file}`} className="min-w-0 rounded border border-dashed border-amber-500/60 px-2 py-1.5 text-xs">
      <p className="text-[11px] text-amber-700 dark:text-amber-400">proposed tool · not loaded · waits for you</p>
      <p className="break-all font-mono text-[11px]">{t.path}</p>
      <p className="break-words text-[11px] text-muted-foreground">
        for desk {t.desk}
        {t.by ? ` · by ${t.by}` : ""}
        {t.at ? ` · ${clock(t.at)}` : ""}
      </p>
      {t.why && <p className="break-words">why: {t.why}</p>}
      <pre className={cn("mt-1 overflow-auto rounded border p-1.5 font-mono text-[11px] whitespace-pre", !expanded && "max-h-32")}>{t.code}</pre>
      {t.truncated && <p className="text-[11px] text-muted-foreground">(the first 20000 characters: the whole file is {t.path})</p>}
      {t.from && <p className="break-words text-[11px] text-amber-700 dark:text-amber-400">{fromLine(t.from)} — read every line before you accept it</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Decide call={call} act={act} what={`tool ${t.file}.js for ${t.desk}`} acceptTitle="Move it into tools/; its desk is loaded again so it runs" dropTitle="Delete the proposal: nothing is written" />
        <Button type="button" variant="link" size="xs" className={cn(BTN, "mt-1")} onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show all"}
        </Button>
      </div>
    </div>
  )
}

export function ProposedDesks({ className }) {
  const [data, setData] = React.useState(null)
  const [note, setNote] = React.useState(null)
  const [local, setLocal] = React.useState(false)
  const refresh = React.useCallback(() => loadProposals().then((d) => d && setData(d)), [])
  React.useEffect(() => {
    let live = true
    detectHost().then((h) => {
      if (!live || h.mode !== "local") return
      setLocal(true)
      refresh()
    })
    return () => {
      live = false
    }
  }, [refresh])
  React.useEffect(() => {
    if (!local) return
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), LIMITS.ui.shell.hostRefreshMs)
    return () => clearInterval(timer)
  }, [local, refresh])
  const done = (line) => {
    setNote(line)
    refresh()
  }
  const n = (data?.desks.length ?? 0) + (data?.tools.length ?? 0)
  if (!n && !note) return null
  return (
    <section aria-label="Proposals that wait for you" className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}>
      {n > 0 && (
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          Waits for you · {n} proposal{n === 1 ? "" : "s"}
        </h2>
      )}
      {data?.desks.map((p) => (
        <DeskProposal key={`d:${p.name}:${p.at}`} p={p} onDone={done} />
      ))}
      {data?.tools.map((t) => (
        <ToolProposal key={`t:${t.desk}/${t.file}:${t.at}`} t={t} onDone={done} />
      ))}
      {note && (
        <p className="break-words text-[11px] text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </section>
  )
}
