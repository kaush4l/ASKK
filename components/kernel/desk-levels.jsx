"use client"

import * as React from "react"
import { BoxIcon, ChevronDownIcon, Maximize2Icon, PlayIcon, SquareIcon, WrenchIcon, XIcon } from "lucide-react"

import { agentVisual, artifactsFor, cardArtifacts, cardRows, currentQuest, heldTiles, holdings, namesIn, sameLayout, teamStatus, teamTitle } from "@/backend/live/desk"
import { spawnedLine } from "@/backend/live/spawned"
import { ProposedHelper } from "@/components/kernel/proposed-helper"
import { CHIP_BTN, TILE_HEAD } from "@/components/kernel/tap-classes"
import { pulse, ring, TONE } from "@/components/views/agent-tone"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { ArtifactBody } from "@/components/views/artifact"
import { useAgent, useArtifact, useDesk, useEngineStates, useEngines, useNamed } from "@/hooks/use-engines"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

// A code desk as cards: every agent is a thread, every agent that holds agents
// a team card. A card (compact) shows its lead, the quest the lead is working,
// each agent's live state, and — separate — its artifacts, drawn by their view.
// Open a card and it expands into the team's tree: lead on top, an arrow to
// each agent, every thread with its speech bubble and its tool chips (by type)
// lighting up while called. The desk card (the lead) sits above the others. Every artifact sits on a card: its
// team's, else its first holder's (artifactsFor). 2026-10-17 owner (the lead creates sub-teams at run time): a team
// the lead spawned is a card like the others — its members as rows, a sub-team's members indented under their lead
// (cardRows), every nested board on it (cardArtifacts), and who spawned it, for what. 2026-10-17 owner ("the agent card
// will show the live artifacts which on click will expand to bigger view"): every artifact on a card is a small live
// tile — its compact view drawn as it changes — and a click opens it big: a dialog on a wide screen, a sheet from the
// bottom on a phone, with the artifact's whole view (the preview: the one pane, with its ask box).

const STATUS_TONE = { working: "llm", reported: "done", error: "error", idle: "idle" }

// Each part subscribes to what it draws (hooks/use-engines.js): the cards to the tree and the artifacts' layout, a row
// to its agent, a tile to its artifact — one agent's step or one artifact's patch redraws that row or tile alone.
export function DeskLevels({ onOpen }) {
  const tree = useDesk((d) => d?.tree)
  const title = useDesk((d) => d?.title)
  const artifacts = useDesk((d) => d?.artifacts ?? {}, sameLayout)
  const everyone = useEngines((r) => r.engines.length)
  const [open, setOpen] = React.useState(() => new Set())
  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  // the artifact opened big: {id, from} (from: the tile's button, where focus goes back), kept while the view closes
  const [big, setBig] = React.useState(null)
  const [bigOpen, setBigOpen] = React.useState(false)
  const expand = React.useCallback((id, from) => {
    setBig({ id, from })
    setBigOpen(true)
  }, [])
  // `/?open=<artifact>` (lib/nav.js workflowHref; an old /workflow link) opens that artifact big once it is on the desk
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open")
    if (id) expand(id, null)
  }, [expand])
  const ctx = React.useMemo(() => tree && { artifacts, teams: new Set(teamsOf(tree)), onOpen, title, everyone, expand, nodes: nodesOf(tree) }, [tree, artifacts, onOpen, title, everyone, expand])
  if (!tree) return null

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Desk">
      <TeamCard node={tree} path={tree.name} ctx={ctx} desk expanded={open.has(tree.name)} onToggle={() => toggle(tree.name)} />
      <Arrow />
      <div className="grid items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {tree.agents.map((t) => {
          const path = `${tree.name}/${t.name}`
          return <TeamCard key={path} node={t} path={path} ctx={ctx} expanded={open.has(path)} onToggle={() => toggle(path)} />
        })}
      </div>
      <ArtifactBig id={big?.id} from={big?.from} open={bigOpen} onOpenChange={setBigOpen} />
    </section>
  )
}

// Every team name in the tree (an artifact owned by none of them sits on its first holder's card).
const teamsOf = (node) => [...(node.team ? [node.team] : []), ...(node.agents ?? []).flatMap(teamsOf)]
// Every tree node by its agent's name (a card row's node: what waits on it for the owner, ProposedHelper).
const nodesOf = (node, out = new Map()) => {
  out.set(node.name, node)
  for (const c of node.agents ?? []) nodesOf(c, out)
  return out
}

// ── a team = a card ──────────────────────────────────────────────────────

function TeamCard({ node, path, ctx, desk = false, expanded, onToggle }) {
  const lead = useAgent(node.name)
  const name = teamTitle(node)
  const status = useTeamStatus(desk ? [node.name] : namesIn(node))
  const tone = TONE[STATUS_TONE[status]]
  const quest = currentQuest(lead.state)
  // the desk card: its own; a team card: its own and its sub-teams' (none of them has a card)
  const owned = desk ? artifactsFor(ctx.artifacts, { team: node.team ?? node.name, lead: node.name, teams: ctx.teams }) : cardArtifacts(ctx.artifacts, node, { teams: ctx.teams })
  const spawned = desk ? null : spawnedLine(node)
  const rows = desk ? [] : cardRows(node)
  const detailId = `detail-${path.replace(/\W/g, "-")}`
  const running = lead.state?.status === "running" || lead.state?.activity?.phase === "waiting"

  return (
    <article id={desk ? undefined : `card-${node.name}`} className={cn("flex min-w-0 scroll-mt-4 flex-col rounded-xl border-2 bg-card transition-colors", ring(tone))} aria-label={name}>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailId} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-3 pt-2 text-left">
          <span className={cn("size-2.5 shrink-0 rounded-full", pulse(tone))} />
          <h3 className={cn("truncate", desk ? "text-xl" : "text-lg")}>{desk ? (ctx.title ?? name) : name}</h3>
          <span className={cn("ml-auto shrink-0 text-xs", tone.text)}>{status}</span>
          <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none", expanded && "rotate-180")} />
        </button>
        {desk && lead.engine && (
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
        {!desk && <ProposedHelper node={node} expanded={expanded} />}
        {node.goal && <p className={cn("text-xs text-muted-foreground", !expanded && "line-clamp-3")}>{node.goal}</p>}

        {/* lead */}
        <AgentRow label={node.agents.length ? "lead" : null} name={node.name} onOpen={ctx.onOpen} lead />
        <HeldArtifacts name={node.name} ctx={ctx} skip={owned} />

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
            {node.agents.map((m) => (
              <li key={m.name}>
                <TeamChip node={m} />
              </li>
            ))}
          </ul>
        ) : rows.length ? (
          <ul className="flex flex-col" aria-label="Agents">
            {rows.map((r) => (
              <li key={r.name} style={r.depth ? { marginLeft: `${r.depth * 0.75}rem` } : undefined} className={cn("min-w-0", r.depth > 0 && "border-l border-dashed pl-1")}>
                <AgentRow label={r.lead ? "team" : null} name={r.name} onOpen={ctx.onOpen} />
                <ProposedHelper node={ctx.nodes.get(r.name)} expanded={expanded} />
                <HeldArtifacts name={r.name} ctx={ctx} skip={owned} />
              </li>
            ))}
          </ul>
        ) : null}

        {/* the team's artifacts (the desk card: the desk's own, every agent's), separate, each a live tile */}
        {owned.length > 0 && (
          <section className={TILES} aria-label={`${name} artifacts`}>
            {owned.map((a) => (
              <ArtifactTile key={a.id} id={a.id} onExpand={ctx.expand} />
            ))}
          </section>
        )}
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

// A team's live status from its agents' states (re-renders when it changes, not on every step).
const useTeamStatus = (names) => useEngineStates(useNamed(names), teamStatus)

// The desk card's chip for one of its teams: its status, a click scrolls to its card.
function TeamChip({ node }) {
  const st = useTeamStatus(namesIn(node))
  const t = TONE[STATUS_TONE[st]]
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`card-${node.name}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm hover:bg-accent", ring(t))}
    >
      <span className={cn("size-2 rounded-full", pulse(t))} />
      {teamTitle(node)}
      <span className={cn("text-xs", t.text)}>{st}</span>
    </button>
  )
}

// One line per thread: dot, name, live message.
function AgentRow({ label, name, onOpen, lead = false }) {
  const item = useAgent(name)
  const v = agentVisual(item.state, item.engine?.agent?.agents ?? [])
  const tone = TONE[v.state]
  return (
    <button
      type="button"
      onClick={() => item.engine && onOpen?.(item.engine)}
      title={`Open ${item.engine?.name ?? name}`}
      className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left hover:bg-accent"
    >
      <span className={cn("size-2 shrink-0 rounded-full", pulse(tone))} />
      {label && <span className="shrink-0 text-[11px] uppercase text-muted-foreground">{label}</span>}
      <span className={cn("shrink-0", lead ? "text-base" : "text-sm")}>{name}</span>
      {/opus/i.test(item.engine?.agent?.model ?? "") && <span className="shrink-0 rounded border px-1 text-[10px] uppercase text-violet-300" title="Runs on Opus">opus</span>}
      <span className={cn("min-w-0 flex-1 truncate text-xs", v.state === "idle" ? "text-muted-foreground" : tone.text)}>{v.message}</span>
      {item.state?.inbox?.length > 0 && (
        <span className="shrink-0 rounded-full border px-1.5 text-[11px] tabular-nums motion-safe:animate-in motion-safe:zoom-in" title={item.state.inbox.map((m) => `${m.from}: ${m.text}`).join("\n")}>
          {item.state.inbox.length} waiting
        </span>
      )}
      {item.engine && <Holdings engine={item.engine} />}
    </button>
  )
}

// How many tools and artifacts the agent holds (holdings): two small counts at the row's end, never squeezed.
function Holdings({ engine }) {
  const h = holdings(engine)
  const label = `${h.tools} tool${h.tools === 1 ? "" : "s"}, ${h.artifacts} artifact${h.artifacts === 1 ? "" : "s"}${h.agents ? `, quests ${h.agents} agent${h.agents === 1 ? "" : "s"}` : ""}`
  return (
    <span data-holdings className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground" title={label} aria-label={label}>
      <span className="flex items-center gap-0.5"><WrenchIcon className="size-3" aria-hidden />{h.tools}</span>
      <span className="flex items-center gap-0.5"><BoxIcon className="size-3" aria-hidden />{h.artifacts}</span>
    </span>
  )
}

// The artifacts one agent holds, live, under its row (2026-10-17 owner: "the agent card will show the live artifacts
// which on click will expand to bigger view"): a small tile each, drawn live by its view (backend/live/desk.js
// heldTiles: one every agent holds — the desk's own — is on the desk card, not repeated under each agent; one the card
// already shows as its own is not repeated either). In the expanded tree (`chips`): its id only, the same click.
function HeldArtifacts({ name, ctx, skip = [], chips = false }) {
  const held = heldTiles(ctx.artifacts, name, { everyone: ctx.everyone, skip: skip.map((a) => a.id) })
  if (!held.length) return null
  if (chips) {
    return (
      <ul className="flex flex-wrap justify-center gap-1 pt-1" aria-label={`${name}'s artifacts`}>
        {held.map((a) => (
          <li key={a.id}>
            <ChipButton id={a.id} onExpand={ctx.expand} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className={cn(TILES, "pb-1 pl-5")} aria-label={`${name}'s artifacts`} role="group">
      {held.map((a) => (
        <ArtifactTile key={a.id} id={a.id} onExpand={ctx.expand} />
      ))}
    </div>
  )
}

// Tiles side by side where the card is wide (the desk card), one column in a narrow one; never wider than the card.
const TILES = "grid min-w-0 gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]"
// What a click on a tile's body leaves to the body (its own controls: a job's Stop, a visual's play, a link).
const CONTROLS = "button, a, input, select, textarea, summary, label, [role=button], [role=tab]"

// One artifact small and live: its id and brief over its compact view; a click opens it big. The head is the button
// (keyboard, screen readers, focus comes back to it when the big view closes); a click on the body opens it too,
// unless it lands on one of the body's own controls.
function ArtifactTile({ id, onExpand }) {
  const a = useArtifact(id)
  const ref = React.useRef(null)
  if (!a) return null
  const open = () => onExpand(a.id, ref.current)
  return (
    <div
      data-tile={a.id}
      onClick={(e) => {
        if (!e.target.closest?.(CONTROLS)) open()
      }}
      className="flex min-w-0 cursor-pointer flex-col rounded-md border bg-background/40 px-2 pb-1.5 transition-colors hover:border-foreground/30 motion-reduce:transition-none"
    >
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
        aria-haspopup="dialog"
        title={`Open ${a.id}${a.title ? ` — ${a.title}` : ""} big`}
        className={TILE_HEAD}
      >
        <span className="shrink-0 font-mono text-foreground/80">{a.id}</span>
        <span className="min-w-0 truncate">{a.brief || a.title}</span>
        <Maximize2Icon className="ml-auto size-3 shrink-0" aria-hidden />
        <span className="sr-only">open big</span>
      </button>
      <div className="max-h-44 min-w-0 overflow-hidden">
        <ArtifactBody artifact={a} expanded={false} />
      </div>
    </div>
  )
}

function ChipButton({ id, onExpand }) {
  const a = useArtifact(id)
  const ref = React.useRef(null)
  if (!a) return null
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onExpand(a.id, ref.current)}
      aria-haspopup="dialog"
      title={a.brief || a.title}
      className={CHIP_BTN}
    >
      {a.id}
    </button>
  )
}

// The big view's parts: a sheet from the bottom on a phone, a dialog on a wide screen.
const BIG = {
  phone: { Root: Sheet, Content: SheetContent, Title: SheetTitle, Description: SheetDescription, content: { side: "bottom", className: "gap-0 rounded-t-xl p-0 data-[side=bottom]:h-[92svh]" } },
  wide: { Root: Dialog, Content: DialogContent, Title: DialogTitle, Description: DialogDescription, content: { className: "flex h-[min(88svh,60rem)] w-[min(76rem,calc(100%-2rem))] max-w-none flex-col gap-0 p-0 sm:max-w-none" } },
}

// An artifact big: its whole view — a dialog on a wide screen, a sheet from the bottom (near full height) on a phone.
// Esc, the close button or a tap outside closes it; focus goes back to the tile it was opened from.
// `id` follows the artifact live (closed once it is gone); `artifact` draws one given.
export function ArtifactBig({ id, artifact, from, open, onOpenChange }) {
  const live = useArtifact(id)
  const a = artifact ?? live
  const phone = useIsMobile()
  const finalFocus = React.useCallback(() => (from?.isConnected ? from : true), [from])
  const { Root, Content, Title, Description, content } = BIG[phone ? "phone" : "wide"]
  return (
    <Root open={open && !!a} onOpenChange={onOpenChange}>
      <Content showCloseButton={false} finalFocus={finalFocus} {...content}>
        {a && (
          <div className="flex min-w-0 shrink-0 items-start gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Title className="flex min-w-0 items-baseline gap-2 text-base">
                <span className="shrink-0 font-mono">{a.id}</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{a.state?.config?.title ?? a.title}</span>
              </Title>
              <Description className="truncate text-xs">
                {a.brief || `held by ${(a.holders ?? []).join(", ") || "no one"}`}
              </Description>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 pointer-coarse:size-10" onClick={() => onOpenChange(false)} aria-label="Close">
              <XIcon />
            </Button>
          </div>
        )}
        {a && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-3">
            <ArtifactBody artifact={a} expanded fill />
          </div>
        )}
      </Content>
    </Root>
  )
}

// ── expanded: the tree ───────────────────────────────────────────────────

function TeamTree({ node, ctx, desk }) {
  return (
    <div className="flex flex-col items-center">
      <TreeColumn node={node} ctx={ctx} />
      {node.agents.length > 0 && <Arrow />}
      <div className={cn("grid w-full gap-3", desk ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1")}>
        {node.agents.map((m) => (
          <TreeColumn key={m.name} node={m} label={teamTitle(m)} ctx={ctx} />
        ))}
      </div>
    </div>
  )
}

// A thread in the tree with the artifacts it holds as chips under it.
const TreeColumn = ({ node, label, ctx }) => (
  <div className="flex w-full min-w-0 flex-col items-center">
    <AgentNode node={node} label={label} onOpen={ctx.onOpen} />
    <div className="w-full max-w-72">
      <HeldArtifacts name={node.name} ctx={ctx} chips />
    </div>
  </div>
)

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
function AgentNode({ node, label, onOpen }) {
  const name = node.name
  const item = useAgent(name)
  const v = agentVisual(item.state, item.engine?.agent?.agents ?? [])
  const tone = TONE[v.state]
  const tools = [...(node.tools ?? []), ...(node.agents ?? []).map((a) => ({ name: a.name, type: "agent" }))]
  const steps = (item.state?.messages ?? []).filter((m) => m.role === "assistant" && m.action === "tool").length
  return (
    <div className="flex w-full max-w-72 flex-col items-center">
      <div role="status" aria-live="polite" className={cn("relative mb-2 w-full rounded-md border px-2 py-1 text-xs", v.state === "idle" ? "border-transparent text-muted-foreground" : tone.soft)}>
        <span className="line-clamp-3 break-words">{v.message}</span>
        {v.state !== "idle" && <span aria-hidden className={cn("absolute -bottom-[5px] left-1/2 size-2 -translate-x-1/2 rotate-45 border-b border-r bg-card", tone.soft.split(" ")[0])} />}
      </div>
      <button type="button" onClick={() => item.engine && onOpen?.(item.engine)} title={`Open ${name}`} className={cn("flex w-full flex-col gap-1 rounded-lg border-2 bg-card p-2 text-left hover:bg-accent", ring(tone))}>
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", pulse(tone))} />
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
