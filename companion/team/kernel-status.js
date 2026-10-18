// A kernel desk's run as one Telegram message, curated for a phone: pure (snapshot → HTML text), no
// I/O. companion/team/kernel-live.js sends it when the lead starts a run and edits it in place as the
// agents work; the final edit marks the run done.
//
//   renderStatus({ desk, lead, states, kernel, registry, run, now }) → string (Telegram HTML, ≤ STATUS_LIMIT)
//     states   engine state per agent, as the team stream carries it (status, activity, messages, working)
//     kernel   { tree, artifacts } from the stream: the desk's tree ({name, team, title, agents: [same
//              shape]}; a node with agents leads a team, the root is the desk's lead) and its artifacts
//              by id ({id, kind, owner, title, holders, brief, state}): the lead's "<name>.checklist" and
//              the desk-level ones (deskBriefs), whatever the desk keeps
//     run      { phase: "live" | "done" | "idle", startedAt, endedAt?, goal?, from?, touched?, outcome? }
//              touched: artifact ids changed during this run (a desk-level one not among them is "earlier")
//
// Layout (every text clipped, then escaped; one icon per visual state):
//   <desk> · LIVE 4m · via schedule
//   <goal, one line>
//   ⏳ head — waiting for news, trend, search · ☑ 1/7
//
//   ⏳ News · 1/3 in
//   ├ 🔧 wire — market.news
//   └ 💭 macro — thinking
//   ✅ Trend — RANGE / CALM, side NONE · conf 0.30
//   ▫️ Not started: Price, Case, Review
//
//   <title>: <brief> (earlier)        one line per desk-level artifact (deskBriefs), by id; "(earlier)":
//   <title>: <brief>                  live, and not changed during this run
// Over the limit it collapses step by step (reported members into counts, shorter clips, member lines
// into counts), then cuts whole lines.

import { agentVisual } from "../../backend/live/visual.js"

export const STATUS_LIMIT = 1500
export const ICONS = { llm: "💭", tool: "🔧", quest: "📨", waiting: "⏳", paused: "✋", error: "❌", done: "✅", idle: "▫️" }

export const escapeHtml = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const flat = (text) => String(text ?? "").replace(/\s+/g, " ").trim()
export const clip = (text, n) => {
  const s = flat(text)
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…` : s
}
const ms = (t) => (t == null ? NaN : typeof t === "number" ? t : Date.parse(t))
const findLast = (list, fn) => {
  for (let i = list.length - 1; i >= 0; i--) if (fn(list[i])) return list[i]
  return null
}

// A report's VERDICT line and CONFIDENCE (5-line REPORT: VERDICT/EVIDENCE/CONFIDENCE/FALSIFIER/GAPS);
// a free-form answer gives its first line.
export function parseReport(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.replace(/^[\s*#>-]+/, "").replace(/\*\*/g, "").trim())
  const field = (key) => {
    const line = lines.find((l) => l.toUpperCase().startsWith(`${key}:`))
    return line == null ? null : line.slice(key.length + 1).trim()
  }
  const conf = field("CONFIDENCE")
  const n = conf == null ? NaN : Number(/\d*\.?\d+/.exec(conf)?.[0])
  return { verdict: field("VERDICT") ?? lines.find(Boolean) ?? "", confidence: Number.isFinite(n) ? n : null }
}

// The lead's current run (or its last one): when it started, its goal and who asked.
export function leadRun({ lead, states }) {
  const s = states?.[lead]
  const messages = s?.messages ?? []
  const request = (s?.working?.request && messages.find((m) => m.id === s.working.request)) || findLast(messages, (m) => m.role === "user" && m.kind !== "guidance")
  if (!request) return null
  return { startedAt: ms(s?.working?.at ?? request.at), goal: request.content, from: request.from ?? "owner" }
}

// How a run ended, from the lead's answer after it started: { kind: "answer" | "error" | "stopped", text }.
export function runOutcome({ lead, states }, startedAt) {
  const answer = findLast(states?.[lead]?.messages ?? [], (m) => m.action === "answer" && ms(m.at) >= startedAt - 1000)
  if (!answer) return null
  if (answer.error) return { kind: /^stopped\b|abort/i.test(String(answer.error)) ? "stopped" : "error", text: String(answer.error) }
  return { kind: "answer", text: answer.content ?? "" }
}

const source = (from) => {
  const f = String(from ?? "owner")
  if (f === "owner") return null
  if (f.startsWith("telegram")) return "telegram"
  return f.split(/[\s(:]/)[0] || null
}

export function elapsed(fromMs, toMs, { seconds = false } = {}) {
  const s = Math.max(0, Math.floor((toMs - fromMs) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`
  if (!seconds) return m ? `${m}m` : "<1m"
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s % 60}s`
}

// The teams in desk order: { title, lead, members: [agent names] } (nested teams flattened into their
// parent). A node with agents leads a team (its lead is the node itself, its members node.agents);
// agents directly under the root lead with none of their own form one block of their own.
export function teamBlocks(tree, lead, states) {
  if (!tree) return [{ title: "Team", lead: null, members: Object.keys(states ?? {}).filter((n) => n !== lead) }]
  const under = (node) => node?.agents ?? []
  const flatten = (node) => under(node).flatMap((m) => [m.name, ...flatten(m)]).filter(Boolean)
  const blocks = []
  const direct = []
  for (const m of under(tree)) {
    if (under(m).length) blocks.push({ title: m.title || m.team || m.name, lead: m.name ?? null, members: flatten(m) })
    else if (m.name) direct.push(m.name)
  }
  if (direct.length) blocks.unshift({ title: "Desk", lead: null, members: direct })
  return blocks
}

// The desk-level artifacts in one line each: those the desk's own team owns (deskTeam = tree.team; null:
// every owner's), but not its board, memories, checklists or quality matrices; by id, empty briefs
// skipped. artifacts: by id (the stream's kernel.artifacts) or a list → [{ id, title, brief }].
const NOT_DESK_LEVEL = new Set(["board", "memory", "checklist", "quality"])
export function deskBriefs(artifacts, deskTeam = null) {
  const list = Array.isArray(artifacts) ? artifacts : Object.values(artifacts ?? {})
  return list
    .filter((a) => a?.id && !NOT_DESK_LEVEL.has(a.kind) && (deskTeam == null || a.owner === deskTeam))
    .map((a) => ({ id: String(a.id), title: flat(a.title || a.id), brief: flat(a.brief) }))
    .filter((a) => a.brief)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Tools in one step: "market.quote", "market.quote ×2", "3 calls: market.quote ×2, market.news".
function calls(names) {
  if (!names.length) return "a tool"
  const counts = new Map()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  const parts = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
  return parts.length === 1 ? parts[0] : `${names.length} calls: ${parts.join(", ")}`
}

// One agent in this run: { state, doing, running, started, report? }.
function agentNow(name, { states, registry, since }) {
  const s = states?.[name]
  const messages = s?.messages ?? []
  const inRun = (m) => ms(m.at) >= since - 1000
  const running = s?.status === "running"
  const started = running || messages.some((m) => m.role === "user" && inRun(m))
  const answer = findLast(messages, (m) => m.action === "answer" && inRun(m))
  if (running) {
    const sub = registry?.agents?.find((a) => a.name === name)?.agents ?? []
    const v = agentVisual(s, sub)
    const names = v.active
    const doing =
      v.state === "llm" ? (s.activity?.stage === "responding" ? "writing" : "thinking")
      : v.state === "tool" ? calls(names)
      : v.state === "quest" ? `quest → ${names.join(", ")}`
      : v.state === "waiting" ? `waiting for ${names.join(", ")}`
      : v.state === "paused" ? `needs your approval: ${names[0] ?? ""}`
      : v.state === "error" ? `error: ${s.error ?? ""}`
      : v.message
    return { state: v.state, doing, running, started, report: null }
  }
  if (answer?.error) return { state: "error", doing: `error: ${answer.error}`, running, started, report: null }
  if (answer) {
    const report = parseReport(answer.content)
    return { state: "done", doing: report.verdict, running, started, report }
  }
  return { state: "idle", doing: started ? "stopped, no report" : "not started", running, started, report: null }
}

const conf = (report) => (report?.confidence != null ? ` · conf ${report.confidence.toFixed(2)}` : "")

// Detail levels, tried in order until the text fits: each collapses more.
const LEVELS = [
  { goal: 90, doing: 60, verdict: 80, outcome: 110, brief: 80, reportedMembers: true, members: true },
  { goal: 90, doing: 60, verdict: 80, outcome: 110, brief: 80, reportedMembers: false, members: true },
  { goal: 60, doing: 36, verdict: 50, outcome: 80, brief: 50, reportedMembers: false, members: true },
  { goal: 60, doing: 30, verdict: 44, outcome: 70, brief: 40, reportedMembers: false, members: false },
]

function render(input, level) {
  const { desk, lead, states, kernel, registry, run, now } = input
  const phase = run.phase
  const since = run.startedAt
  const touched = new Set(run.touched ?? [])
  const ctx = { states, registry, since }
  const lines = []

  // Header: desk · state + time · source; the goal on its own line.
  // run.outcome when the caller knows it (null: no answer yet), else the lead's answer since the start.
  const outcome = phase === "live" ? null : run.outcome !== undefined ? run.outcome : runOutcome({ lead, states }, since)
  const end = run.endedAt ?? now
  const word =
    phase === "live" ? `LIVE ${elapsed(since, now)}`
    : phase === "idle" ? `IDLE · last run ${elapsed(since, now)} ago`
    : `${outcome?.kind === "stopped" ? "STOPPED" : outcome?.kind === "error" ? "ERROR" : "DONE"} in ${elapsed(since, end, { seconds: true })}`
  const via = source(run.from)
  // word carries "<1m" in its first minute: escaped like every other text (10-15 03:06: Telegram refused the tag)
  lines.push(`<b>${escapeHtml(clip(desk, 40))}</b> · ${escapeHtml(word)}${via && phase !== "idle" ? ` · via ${escapeHtml(via)}` : ""}`)
  if (run.goal) lines.push(`<i>${escapeHtml(clip(run.goal, level.goal))}</i>`)

  // The lead: what it does now (or how the run ended) and its checklist (the root node's).
  const items = kernel?.artifacts?.[`${kernel?.tree?.name ?? lead}.checklist`]?.state?.items ?? []
  const ticks = items.length ? ` · ☑ ${items.filter((i) => i.status !== "open").length}/${items.length}` : ""
  if (phase === "live") {
    const me = agentNow(lead, ctx)
    lines.push(`${ICONS[me.state]} <b>${escapeHtml(lead)}</b> — ${escapeHtml(clip(me.doing, level.doing))}${ticks}`)
  } else if (outcome) {
    const icon = outcome.kind === "answer" ? ICONS.done : outcome.kind === "stopped" ? "⏹" : ICONS.error
    const text = outcome.kind === "answer" ? parseReport(outcome.text).verdict : outcome.kind === "stopped" ? "stopped by the owner" : `error: ${outcome.text}`
    lines.push(`${icon} <b>${escapeHtml(lead)}</b> — ${escapeHtml(clip(text, level.outcome))}${ticks}`)
  } else {
    lines.push(`${ICONS.idle} <b>${escapeHtml(lead)}</b> — no answer${ticks}`)
  }

  // Teams in desk order; teams not started collapse into one line at the end.
  const teamLines = []
  const notStarted = []
  for (const block of teamBlocks(kernel?.tree, lead, states)) {
    const leadNow = block.lead ? agentNow(block.lead, ctx) : null
    const members = block.members.map((name) => ({ name, ...agentNow(name, ctx) }))
    const all = [...(leadNow ? [leadNow] : []), ...members]
    const title = `<b>${escapeHtml(clip(block.title, 24))}</b>`
    if (!all.some((a) => a.started)) {
      notStarted.push(escapeHtml(clip(block.title, 24)))
      continue
    }
    const busy = all.some((a) => a.running)
    if (!busy && leadNow?.state === "done") {
      teamLines.push(`${ICONS.done} ${title} — ${escapeHtml(clip(leadNow.report?.verdict ?? leadNow.doing, level.verdict))}${conf(leadNow.report)}`)
      continue
    }
    if (!busy) {
      const failed = all.find((a) => a.state === "error")
      teamLines.push(failed ? `${ICONS.error} ${title} — ${escapeHtml(clip(failed.doing, level.verdict))}` : `${ICONS.idle} ${title} — ${leadNow ? escapeHtml(leadNow.doing) : "no report"}`)
      continue
    }
    // Working: the lead's state in the header, then only the members that matter now.
    const reported = members.filter((m) => m.state === "done").length
    const head = leadNow?.running ? leadNow : (members.find((m) => m.running) ?? leadNow)
    const leadPart = leadNow && leadNow.running && leadNow.state !== "waiting" ? ` · lead ${escapeHtml(clip(leadNow.doing, level.doing - 20))}` : ""
    const count = members.length ? ` · ${reported}/${members.length} in` : ""
    teamLines.push(`${ICONS[head.state] ?? ICONS.llm} ${title}${leadPart}${count}`)
    const shown = members.filter((m) => m.running || m.state === "error" || (m.state === "done" && level.reportedMembers))
    const rows = level.members ? shown : shown.filter((m) => m.state === "error")
    const waiting = members.filter((m) => !m.started).length
    const hidden = level.members ? 0 : members.filter((m) => m.running).length
    const tail = [hidden && `${hidden} working`, waiting && `${waiting} waiting to start`].filter(Boolean).join(", ")
    rows.forEach((m, i) => {
      const last = i === rows.length - 1 && !tail
      teamLines.push(`${last ? "└" : "├"} ${ICONS[m.state]} ${escapeHtml(m.name)} — ${escapeHtml(clip(m.doing, level.doing))}`)
    })
    if (tail) teamLines.push(`└ ${tail}`)
  }
  if (notStarted.length) teamLines.push(`${ICONS.idle} ${phase === "live" ? "Not started" : "Not run"}: ${notStarted.join(", ")}`)
  if (teamLines.length) lines.push("", ...teamLines)

  // Footer: the desk-level artifacts, one line each; one not changed in a live run is "earlier".
  const footer = deskBriefs(kernel?.artifacts, kernel?.tree?.team ?? null).map(
    (a) => `${escapeHtml(clip(a.title, 24))}: ${escapeHtml(clip(a.brief, level.brief))}${phase === "live" && !touched.has(a.id) ? " (earlier)" : ""}`,
  )
  if (footer.length) lines.push("", ...footer)
  return lines
}

export function renderStatus({ desk = "desk", lead, states = {}, kernel = null, registry = null, run, now = Date.now(), limit = STATUS_LIMIT }) {
  const derived = leadRun({ lead, states })
  const r = { phase: "live", ...run }
  r.startedAt = ms(r.startedAt ?? derived?.startedAt ?? now)
  if (!Number.isFinite(r.startedAt)) r.startedAt = now
  if (r.endedAt != null) r.endedAt = ms(r.endedAt)
  r.goal ??= derived?.goal ?? null
  r.from ??= derived?.from ?? null
  const input = { desk, lead, states, kernel, registry, run: r, now }
  let lines
  for (const level of LEVELS) {
    lines = render(input, level)
    if (lines.join("\n").length <= limit) return lines.join("\n")
  }
  // Still too long: keep whole lines from the top (never half a tag), then say more was cut.
  const kept = []
  let size = 2
  for (const line of lines) {
    if (size + line.length + 1 > limit) break
    kept.push(line)
    size += line.length + 1
  }
  return `${kept.join("\n")}\n…`
}
