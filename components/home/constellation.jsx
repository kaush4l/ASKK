"use client"

import * as React from "react"
import { ChevronRightIcon } from "lucide-react"

import { agentStatus, subtreeTones, teamTree, treeNames } from "@/backend/live/team-tree"
import { VISUAL_STATES } from "@/backend/live/visual"
import { QUEST_LINK, TONE } from "@/components/views/agent-tone"
import { useDesk } from "@/hooks/use-engines"
import { initials } from "@/lib/engine-tone"
import { LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

// The team as a tree, and the welcome. The lead at the root, each team's lead
// under it, each team's agents under their lead (teams in teams at any depth;
// levels from backend/live/team-tree.js). Every agent says what it is doing
// in a speech bubble, coloured by its state; a link lights up while a quest is
// out on it. Wide enough, the lead's teams stand side by side (top-down);
// otherwise, and always on phones, the tree is indented and teams fold to a
// row of chips. A click on an agent opens its page.

// State colours: TONE (components/views/agent-tone.js), shared with the canvas.
const LABEL = Object.fromEntries(VISUAL_STATES.map((s) => [s.id, s.label]))

function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!(minutes >= 1)) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

// ── one agent: its face and its speech bubble ───────────────────────────

// The tree's bubble: a fixed height (two lines and the foot line), so a face sits FACE_Y down its row:
// p-1 (4) + 56 + gap-1.5 (6) + half the face (16) = 82px; its bottom at 98px.
const BUBBLE_H = "h-14 overflow-hidden"
const FACE_Y = { h: "h-[82px]", top: "top-[82px]" }
const FACE_BOTTOM = "top-[98px]"

function Avatar({ name, status, large = false }) {
  const tone = TONE[status.tone]
  return (
    <span className={cn("relative grid shrink-0 place-items-center", large ? "size-10" : "size-8")}>
      {tone.live && <span aria-hidden className={cn("absolute -inset-1 rounded-full border-2 opacity-50 motion-safe:animate-pulse", tone.line)} />}
      <span
        className={cn(
          "grid size-full place-items-center rounded-full border-2 bg-background transition-colors duration-500",
          large ? "text-sm" : "text-[11px]",
          tone.line,
          tone.dashed && "border-dashed"
        )}
      >
        {initials(name)}
      </span>
      {status.approvals > 0 && (
        <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-orange-500 text-[9px] text-black">
          {status.approvals}
        </span>
      )}
    </span>
  )
}

// The bubble sits on top of its agent's face, its tail pointing down at it (left, or centred over the lead):
// what it says, then a small line — when it reported, that it failed, or its last tool while it thinks.
// In the tree it has a fixed height (BUBBLE_H), so every face sits the same distance down its row and the
// rails in Branch meet it.
function Bubble({ status, centered = false, className }) {
  const tone = TONE[status.tone]
  const foot =
    status.tone === "done" ? { text: `reported ${status.at ? ago(status.at) : ""}`.trim(), className: tone.text }
    : status.tone === "error" ? { text: "error", className: tone.text }
    : status.detail ? { text: status.detail, className: "text-muted-foreground" }
    : null
  return (
    <span className={cn("relative block min-w-0 rounded-lg border bg-card px-2 py-1 text-left text-xs leading-snug transition-colors duration-500", tone.line, className)}>
      <span aria-hidden className={cn("absolute -bottom-[5px] size-2 rotate-45 border-r border-b bg-card", tone.line, centered ? "left-1/2 -ml-1" : "left-3")} />
      <span className={cn("line-clamp-2 break-words", status.tone === "idle" && "text-muted-foreground")}>{status.message}</span>
      {foot && <span className={cn("block truncate text-[11px]", foot.className)}>{foot.text}</span>}
    </span>
  )
}

// center: the lead on top of the top-down tree; otherwise face and name on a line, the bubble on top of them.
function AgentNode({ node, item, status, ctx, center = false }) {
  const name = item?.engine?.name ?? node.name
  const tag =
    node.depth === 0 ? ctx.title ?? "lead" : node.title && node.title.toLowerCase() !== node.name.toLowerCase() ? node.title : node.spawned ? "helper" : null
  const delay = ctx.intro ? { animationDelay: `${Math.min(0.2 + ctx.order.get(node.name) * 0.05, 1.4)}s` } : undefined
  return (
    <button
      type="button"
      onClick={() => item && ctx.onOpen(item.engine)}
      disabled={!item}
      aria-label={`${name}: ${LABEL[status.tone] ?? status.tone}, ${status.message}. Open its page.`}
      title={`Open ${name}`}
      style={delay}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg p-1 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-rise",
        center ? "w-full max-w-sm items-center" : "flex-1 items-stretch text-left"
      )}
    >
      <Bubble status={status} centered={center} className={center ? "w-full" : BUBBLE_H} />
      <span className={cn("flex min-w-0 items-center gap-1.5", center && "flex-col gap-1")}>
        <Avatar name={name} status={status} large={center} />
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("truncate", center ? "text-base" : "text-sm")}>{name}</span>
          {tag && <span className="shrink-0 truncate text-[11px] tracking-wide text-muted-foreground uppercase">{tag}</span>}
        </span>
      </span>
    </button>
  )
}

// ── a subtree, indented ─────────────────────────────────────────────────
// Geometry: a face's centre sits 20px in (p-1 + half of size-8) and FACE_Y down its row (p-1, the bubble's
// fixed height, gap-1.5, half the face); a team's list is indented 20px, so its rail runs down from the face's
// bottom and an elbow meets each row's face.

function Branch({ node, ctx, questIn = false, last = true }) {
  const item = ctx.byName.get(node.name)
  const kids = node.children
  const open = kids.length > 0 && ctx.isOpen(node)
  const questsOut = new Set((item?.state?.quests ?? []).map((q) => q.to))
  const nested = node.depth > ctx.top
  return (
    <li className={cn("relative", nested && "pl-4")}>
      {nested && (
        <>
          <span aria-hidden className={cn("absolute top-0 left-0 w-px", FACE_Y.h, questIn ? QUEST_LINK : "bg-border")} />
          <span aria-hidden className={cn("absolute left-0 h-px w-4", FACE_Y.top, questIn ? QUEST_LINK : "bg-border")} />
          {!last && <span aria-hidden className={cn("absolute bottom-0 left-0 w-px bg-border", FACE_Y.top)} />}
        </>
      )}
      <div className="relative flex items-start gap-0.5">
        {open && <span aria-hidden className={cn("absolute bottom-0 left-5 w-px bg-border", FACE_BOTTOM)} />}
        <AgentNode node={node} item={item} status={ctx.statusOf(node.name)} ctx={ctx} />
        {kids.length > 0 && (
          <button
            type="button"
            onClick={() => ctx.toggle(node)}
            aria-expanded={open}
            aria-label={`${open ? "Fold" : "Show"} ${node.name}'s team (${treeNames(node).length - 1})`}
            className="mt-2 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:mt-0 pointer-coarse:size-10"
          >
            <ChevronRightIcon className={cn("size-4 transition-transform duration-300 motion-reduce:transition-none", open && "rotate-90")} />
          </button>
        )}
      </div>
      {kids.length > 0 &&
        (open ? (
          <ul className="ml-5 pt-1" aria-label={`${node.name}'s team`}>
            {kids.map((child, i) => (
              <Branch key={child.name} node={child} ctx={ctx} questIn={questsOut.has(child.name)} last={i === kids.length - 1} />
            ))}
          </ul>
        ) : (
          <Chips node={node} ctx={ctx} />
        ))}
    </li>
  )
}

// A folded team: every agent under it as a chip in its colour, busiest first.
function Chips({ node, ctx }) {
  return (
    <ul className="mt-1 mb-2 ml-5 flex flex-wrap gap-1 border-l pl-3" aria-label={`${node.name}'s team, folded`}>
      {subtreeTones(node, ctx.statusOf).map(({ name, tone }) => {
        const item = ctx.byName.get(name)
        return (
          <li key={name}>
            <button
              type="button"
              onClick={() => item && ctx.onOpen(item.engine)}
              disabled={!item}
              title={`${name}: ${ctx.statusOf(name).message}`}
              aria-label={`${name}: ${LABEL[tone] ?? tone}. Open its page.`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-10",
                TONE[tone].line,
                TONE[tone].dashed && "border-dashed"
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", TONE[tone].dot, TONE[tone].live && "motion-safe:animate-pulse")} />
              {name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── the whole tree ──────────────────────────────────────────────────────

// Top-down: the lead centred, a trunk to a bar, each of its teams a column (indented below it).
function TopDown({ tree, ctx }) {
  const n = tree.children.length
  const item = ctx.byName.get(tree.name)
  const questsOut = new Set((item?.state?.quests ?? []).map((q) => q.to))
  const column = { ...ctx, top: 1 }
  return (
    <div className="flex flex-col">
      <div className="flex justify-center">
        <AgentNode node={tree} item={item} status={ctx.statusOf(tree.name)} ctx={ctx} center />
      </div>
      <span aria-hidden className={cn("mx-auto h-5 w-px", questsOut.size ? QUEST_LINK : "bg-border")} />
      <ul className="relative flex" aria-label={`${tree.name}'s teams`}>
        {/* the bar, from the first column's rail to the last's (to the trunk with one column) */}
        <span aria-hidden className="absolute top-0 left-5 h-px bg-border" style={{ width: n > 1 ? `${((n - 1) / n) * 100}%` : "calc(50% - 1.25rem)" }} />
        {tree.children.map((child) => (
          <li key={child.name} className="relative min-w-0 flex-1 basis-0 pt-5 pr-2">
            <span aria-hidden className={cn("absolute top-0 left-5 h-5 w-px", questsOut.has(child.name) ? QUEST_LINK : "bg-border")} />
            <ul>
              <Branch node={child} ctx={column} />
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="State colours">
      {VISUAL_STATES.map((s) => (
        <li key={s.id} className="flex items-center gap-1">
          <span aria-hidden className={cn("size-2 rounded-full", TONE[s.id].dot)} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

// The container's width, measured before paint (it picks the layout).
function useWidth() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function Constellation({ engines, states, onOpen, className }) {
  const kernel = useDesk()
  const [ref, width] = useWidth()
  const [folds, setFolds] = React.useState(() => new Map()) // name → open, once the owner toggles it
  const [intro, setIntro] = React.useState(true)
  React.useEffect(() => {
    const timer = setTimeout(() => setIntro(false), LIMITS.ui.home.treeIntroMs)
    return () => clearTimeout(timer)
  }, [])

  const agents = React.useMemo(() => engines.map((e) => e.agent ?? { name: e.id }), [engines])
  const tree = React.useMemo(() => teamTree(agents, { root: agents[0]?.name, kernel: kernel?.tree }), [agents, kernel?.tree])
  const byName = React.useMemo(() => new Map(engines.map((e, i) => [e.agent?.name ?? e.id, { engine: e, state: states[i] }])), [engines, states])
  const statuses = React.useMemo(() => new Map([...byName].map(([name, { engine, state }]) => [name, agentStatus(state, engine.agent)])), [byName])
  if (!tree) return null

  const teams = tree.children.length
  const topDown = width >= LIMITS.ui.home.treeTopDownPx && teams > 0 && width / teams >= LIMITS.ui.home.treeColumnPx
  // Folded until the owner opens them: indented, every team below the lead's; top-down, only deeper ones.
  const foldFrom = topDown ? 2 : 1
  const openByDefault = (node) => node.depth < foldFrom
  const ctx = {
    byName,
    onOpen,
    intro,
    title: kernel?.tree ? kernel.title : null,
    order: new Map(treeNames(tree).map((name, i) => [name, i])),
    top: 0,
    statusOf: (name) => statuses.get(name) ?? agentStatus(null),
    isOpen: (node) => folds.get(node.name) ?? openByDefault(node),
    toggle: (node) => setFolds((prev) => new Map(prev).set(node.name, !(prev.get(node.name) ?? openByDefault(node)))),
  }

  return (
    <section ref={ref} className={cn("flex w-full min-w-0 flex-col gap-4", className)} aria-label="Your team">
      {width === 0 ? null : topDown ? (
        <TopDown tree={tree} ctx={ctx} />
      ) : (
        <ul className="mx-auto w-full max-w-2xl">
          <Branch node={tree} ctx={ctx} />
        </ul>
      )}
      <Legend />
    </section>
  )
}
