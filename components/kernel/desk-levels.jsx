"use client"

import * as React from "react"
import { ChevronDownIcon, PlayIcon, SquareIcon } from "lucide-react"

import { agentVisual, artifactsFor, cardArtifacts, cardRows, currentQuest, namesIn, teamStatus, teamTitle, VISUAL_STATES } from "@/backend/live/desk"
import { spawnedLine } from "@/backend/live/spawned"
import { Button } from "@/components/ui/button"
import { ArtifactBlock } from "@/components/views/artifact"
import { useDesk, useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

// A code desk as cards: every agent is a thread, every agent that holds agents
// a team card. A card (compact) shows its lead, the quest the lead is working,
// each agent's live state, and — separate — its artifacts, drawn by their view.
// Open a card and it expands into the team's tree: lead on top, an arrow to
// each agent, every thread with its speech bubble and its tool chips (by type)
// lighting up while called. The desk card (the lead) sits above the others. Every artifact sits on a card: its
// team's, else its first holder's (artifactsFor). 2026-10-17 owner (the lead creates sub-teams at run time): a team
// the lead spawned is a card like the others — its members as rows, a sub-team's members indented under their lead
// (cardRows), every nested board on it (cardArtifacts), and who spawned it, for what.

// Visual state → colors. Motion only while the thread works.
const TONE = {
  llm: { ring: "border-violet-500", dot: "bg-violet-500 motion-safe:animate-pulse", soft: "border-violet-500/70 bg-violet-500/10", text: "text-violet-400" },
  tool: { ring: "border-amber-400", dot: "bg-amber-400 motion-safe:animate-pulse", soft: "border-amber-400/70 bg-amber-400/10", text: "text-amber-400" },
  quest: { ring: "border-blue-500", dot: "bg-blue-500 motion-safe:animate-pulse", soft: "border-blue-500/70 bg-blue-500/10", text: "text-blue-400" },
  waiting: { ring: "border-sky-400 border-dashed", dot: "bg-sky-400", soft: "border-sky-400/70 bg-sky-400/10", text: "text-sky-400" },
  paused: { ring: "border-orange-500", dot: "bg-orange-500", soft: "border-orange-500/70 bg-orange-500/10", text: "text-orange-400" },
  error: { ring: "border-red-500", dot: "bg-red-500", soft: "border-red-500/70 bg-red-500/10", text: "text-red-400" },
  done: { ring: "border-emerald-500/60", dot: "bg-emerald-500", soft: "border-emerald-500/50 bg-emerald-500/5", text: "text-emerald-400" },
  idle: { ring: "border-border", dot: "bg-muted-foreground/40", soft: "border-border", text: "text-muted-foreground" },
}
const STATUS_TONE = { working: "llm", reported: "done", error: "error", idle: "idle" }

export function DeskLevels({ onOpen, compact = false }) {
  const desk = useDesk()
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  const byName = React.useMemo(() => Object.fromEntries(engines.map((e, i) => [e.id, { engine: e, state: states[i] }])), [engines, states])
  const [open, setOpen] = React.useState(() => new Set())
  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  if (!desk?.tree) return null
  const { tree } = desk
  const teams = new Set(teamsOf(tree))
  const ctx = { byName, artifacts: desk.artifacts ?? {}, teams, onOpen, title: desk.title }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Desk">
      {!compact && <Legend />}
      <TeamCard node={tree} path={tree.name} ctx={ctx} desk expanded={open.has(tree.name)} onToggle={() => toggle(tree.name)} />
      <Arrow />
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tree.agents.map((t) => {
          const path = `${tree.name}/${t.name}`
          return <TeamCard key={path} node={t} path={path} ctx={ctx} expanded={open.has(path)} onToggle={() => toggle(path)} />
        })}
      </div>
    </section>
  )
}

// Every team name in the tree (an artifact owned by none of them sits on its first holder's card).
const teamsOf = (node) => [...(node.team ? [node.team] : []), ...(node.agents ?? []).flatMap(teamsOf)]

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="State colors">
      {VISUAL_STATES.map((s) => (
        <li key={s.id} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", TONE[s.id].dot.replace(/motion-safe:\S+/, ""))} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

// ── a team = a card ──────────────────────────────────────────────────────

function TeamCard({ node, path, ctx, desk = false, expanded, onToggle }) {
  const { byName } = ctx
  const lead = byName[node.name]
  const name = teamTitle(node)
  const status = desk ? teamStatus([lead?.state]) : teamStatus(namesIn(node).map((n) => byName[n]?.state))
  const tone = TONE[STATUS_TONE[status]]
  const quest = currentQuest(lead?.state)
  // the desk card: its own; a team card: its own and its sub-teams' (none of them has a card)
  const owned = desk ? artifactsFor(ctx.artifacts, { team: node.team ?? node.name, lead: node.name, teams: ctx.teams }) : cardArtifacts(ctx.artifacts, node, { teams: ctx.teams })
  const spawned = desk ? null : spawnedLine(node)
  const rows = desk ? [] : cardRows(node)
  const detailId = `detail-${path.replace(/\W/g, "-")}`
  const running = lead?.state?.status === "running" || lead?.state?.activity?.phase === "waiting"

  return (
    <article id={desk ? undefined : `card-${node.name}`} className={cn("flex min-w-0 scroll-mt-4 flex-col rounded-xl border-2 bg-card transition-colors", tone.ring)} aria-label={`${name}`}>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailId} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-3 pt-2 text-left">
          <span className={cn("size-2.5 shrink-0 rounded-full", tone.dot)} />
          <h3 className={cn("truncate", desk ? "text-xl" : "text-lg")}>{desk ? (ctx.title ?? name) : name}</h3>
          <span className={cn("ml-auto shrink-0 text-xs", tone.text)}>{status}</span>
          <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none", expanded && "rotate-180")} />
        </button>
        {desk && lead?.engine && (
          running ? (
            <Button variant="destructive" size="sm" className="mt-2 h-10" onClick={() => lead.engine.stop()} title="Stop the lead's run">
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button size="sm" className="mt-2 h-10" onClick={() => lead.engine.send(node.goal)} title="Run the desk's goal now (live models and market data)">
              <PlayIcon /> Run
            </Button>
          )
        )}
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        {spawned && <p data-spawned className="break-words text-[11px] text-muted-foreground">{spawned}</p>}
        {node.goal && <p className={cn("text-xs text-muted-foreground", !expanded && "line-clamp-3")}>{node.goal}</p>}

        {/* lead */}
        <AgentRow label={node.agents.length ? "lead" : null} name={node.name} item={lead} onOpen={ctx.onOpen} lead />

        {/* the quest the lead works */}
        <div className="rounded-md border border-dashed px-2 py-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Quest{quest ? ` · from ${quest.from}` : ""}{quest && !quest.active ? " · last" : ""}
          </div>
          <p className={cn("break-words text-sm", !expanded && "line-clamp-3")}>{quest?.text || <span className="text-muted-foreground">none yet</span>}</p>
        </div>

        {/* the agents it holds: the desk's as chips (their cards follow below), a team's as rows */}
        {desk ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Teams">
            {node.agents.map((m) => {
              const st = teamStatus(namesIn(m).map((n) => byName[n]?.state))
              const t = TONE[STATUS_TONE[st]]
              return (
                <li key={m.name}>
                  <button
                    type="button"
                    onClick={() => document.getElementById(`card-${m.name}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm hover:bg-accent", t.ring)}
                  >
                    <span className={cn("size-2 rounded-full", t.dot)} />
                    {teamTitle(m)}
                    <span className={cn("text-xs", t.text)}>{st}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : rows.length ? (
          <ul className="flex flex-col" aria-label="Agents">
            {rows.map((r) => (
              <li key={r.name} style={r.depth ? { marginLeft: `${r.depth * 0.75}rem` } : undefined} className={cn("min-w-0", r.depth > 0 && "border-l border-dashed pl-1")}>
                <AgentRow label={r.lead ? "team" : null} name={r.name} item={byName[r.name]} onOpen={ctx.onOpen} />
              </li>
            ))}
          </ul>
        ) : null}

        {/* the team's artifacts, separate, each under its id */}
        <section className="flex flex-col gap-1.5" aria-label={`${name} artifacts`}>
          {owned.map((a) => (
            <ArtifactBlock key={a.id} artifact={a} expanded={expanded} />
          ))}
        </section>
      </div>

      {/* expanded: the team's tree, every thread with its bubble and tools */}
      <div id={detailId} className={cn("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          {expanded && (
            <div className="border-t px-3 py-3">
              <TeamTree node={node} ctx={ctx} desk={desk} />
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

// One line per thread: dot, name, live message.
function AgentRow({ label, name, item, onOpen, lead = false }) {
  const v = agentVisual(item?.state, item?.engine?.agent?.agents ?? [])
  const tone = TONE[v.state]
  return (
    <button
      type="button"
      onClick={() => item && onOpen?.(item.engine)}
      title={`Open ${item?.engine?.name ?? name}`}
      className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left hover:bg-accent"
    >
      <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
      {label && <span className="shrink-0 text-[11px] uppercase text-muted-foreground">{label}</span>}
      <span className={cn("shrink-0", lead ? "text-base" : "text-sm")}>{name}</span>
      {/opus/i.test(item?.engine?.agent?.model ?? "") && <span className="shrink-0 rounded border px-1 text-[10px] uppercase text-violet-300" title="Runs on Opus">opus</span>}
      <span className={cn("min-w-0 truncate text-xs", v.state === "idle" ? "text-muted-foreground" : tone.text)}>{v.message}</span>
    </button>
  )
}

// ── expanded: the tree ───────────────────────────────────────────────────

function TeamTree({ node, ctx, desk }) {
  return (
    <div className="flex flex-col items-center">
      <AgentNode node={node} item={ctx.byName[node.name]} onOpen={ctx.onOpen} />
      {node.agents.length > 0 && <Arrow />}
      <div className={cn("grid w-full gap-3", desk ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1")}>
        {node.agents.map((m) => (
          <div key={m.name} className="flex flex-col items-center">
            <AgentNode node={m} label={teamTitle(m)} item={ctx.byName[m.name]} onOpen={ctx.onOpen} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <span aria-hidden className="flex h-6 flex-col items-center self-center">
      <span className="w-px flex-1 bg-border" />
      <span className="size-0 border-x-4 border-t-[6px] border-x-transparent border-t-border" />
    </span>
  )
}

// One thread in the tree: speech bubble over the node, tools as chips.
// Tool chips by type: a function plain, an MCP tool dotted, an agent (a quest) solid.
const TYPE_CHIP = { mcp: "border-dotted", agent: "border-solid", function: "" }
function AgentNode({ node, label, item, onOpen }) {
  const name = node.name
  const v = agentVisual(item?.state, item?.engine?.agent?.agents ?? [])
  const tone = TONE[v.state]
  const tools = [...(node.tools ?? []), ...(node.agents ?? []).map((a) => ({ name: a.name, type: "agent" }))]
  const steps = (item?.state?.messages ?? []).filter((m) => m.role === "assistant" && m.action === "tool").length
  return (
    <div className="flex w-full max-w-72 flex-col items-center">
      <div role="status" aria-live="polite" className={cn("relative mb-2 w-full rounded-md border px-2 py-1 text-xs", v.state === "idle" ? "border-transparent text-muted-foreground" : tone.soft)}>
        <span className="line-clamp-3 break-words">{v.message}</span>
        {v.state !== "idle" && <span aria-hidden className={cn("absolute -bottom-[5px] left-1/2 size-2 -translate-x-1/2 rotate-45 border-b border-r bg-card", tone.soft.split(" ")[0])} />}
      </div>
      <button type="button" onClick={() => item && onOpen?.(item.engine)} title={`Open ${name}`} className={cn("flex w-full flex-col gap-1 rounded-lg border-2 bg-card p-2 text-left hover:bg-accent", tone.ring)}>
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", tone.dot)} />
          <span className="truncate text-sm">{label && label !== name ? `${label} · ${name}` : name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{steps ? `${steps} st` : ""}</span>
        </span>
        {tools.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tools.map((t) => (
              <span key={t.name} title={t.type} className={cn("rounded border px-1 text-[11px] leading-5", TYPE_CHIP[t.type], v.active.includes(t.name) ? cn(tone.soft, "text-foreground") : "text-muted-foreground")}>
                {t.name}
              </span>
            ))}
          </span>
        )}
      </button>
    </div>
  )
}
