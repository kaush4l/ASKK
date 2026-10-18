"use client"

import * as React from "react"

import { bookNextRun, clearNextRun, dispatchRows, setDefaultGoal } from "@/backend/live/desk"
import { stripAnsi } from "@/backend/live/term-lines"
import { consoleErrors, fullPath, sessionLabel, shotSrc } from "@/backend/live/workbench"
import { Button } from "@/components/ui/button"
import { ChartView } from "@/components/views/chart"
import { cn } from "@/lib/utils"

// One renderer per artifact view — the artifact's twin on the UI. Used by the desk's team cards
// (components/kernel/desk-levels.jsx), the Live page's artifact tabs and the agent page. Every view the kernel or a
// desk publishes gets a body here; an unknown view falls back to its state, so nothing an agent keeps is hidden.
//   artifact: { id, kind, view, owner, title, holders, brief, state, items?, rows? }  (companion/team/kernel-team.js)

const VIEWS = {
  list: ListView,
  checklist: ChecklistView,
  quality: QualityView,
  board: BoardView,
  schedule: ScheduleView,
  text: TextView,
  memory: TextView,
  table: TableView,
  project: ProjectView,
  files: FilesView,
  terminal: TerminalView,
  preview: PreviewPagesView,
  chart: ChartView, // the kit's charts (components/views/chart.jsx)
  dispatch: DispatchView,
}

// One artifact under its id, its brief (one line, from code) heading it; compact in a closed card, whole open.
export function ArtifactBlock({ artifact: a, expanded }) {
  const Body = VIEWS[a.view] ?? GenericView
  return (
    <div className="rounded-md border bg-background/40 px-2 py-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0 font-mono text-foreground/80">{a.id}</span>
        <span className="truncate">{a.title}</span>
        {a.view !== "list" && a.brief && <span className="ml-auto min-w-0 truncate">{a.brief}</span>}
      </div>
      {a.view === "list" && a.brief && <p className="mt-1 break-words text-sm">{a.brief}</p>}
      <Body state={a.state} items={a.items} rows={a.rows} expanded={expanded} />
    </div>
  )
}

// Rows an artifact publishes ({name, detail}): the desk's picks, book, track record, health.
function ListView({ items = [], expanded }) {
  if (!expanded || !items?.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {items.map((i, n) => (
        <li key={`${i.name}-${n}`} className="text-xs">
          <span className="text-foreground">{i.name}</span> <span className="break-words text-muted-foreground">{i.detail}</span>
        </li>
      ))}
    </ul>
  )
}

// A checklist, or the desk's plan (kernel Plan: the same items under {goal, revision, by}, status ticked for done).
function ChecklistView({ state, expanded }) {
  const items = (state?.items ?? []).map((i) => (i.status === "ticked" ? { ...i, status: "done" } : i))
  const plan = state?.goal || state?.revision ? <PlanHeader state={state} expanded={expanded} /> : null
  if (!items.length) return plan ?? null
  const done = items.filter((i) => i.status !== "open").length
  const shown = expanded ? items : items.filter((i) => i.status === "open").slice(0, 3)
  return (
    <div className="mt-1">
      {plan}
      <div className="h-1 overflow-hidden rounded bg-muted">
        <div className="h-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {shown.map((i) => (
          <li key={i.id} className="text-xs">
            <span className={i.status === "done" ? "text-emerald-400" : i.status === "skipped" ? "text-muted-foreground" : "text-amber-400"}>
              {i.status === "done" ? "✓" : i.status === "skipped" ? "–" : "○"}
            </span>{" "}
            {i.id}: <span className="text-muted-foreground">{expanded && i.note ? i.note : i.text}</span>
          </li>
        ))}
        {!expanded && done === items.length && <li className="text-xs text-emerald-400">all done</li>}
      </ul>
    </div>
  )
}

// The plan's goal and revision (who wrote it last, when); an empty plan says so.
function PlanHeader({ state, expanded }) {
  return (
    <div className="mb-1 flex flex-col gap-0.5">
      {state.goal && <p className={cn("break-words text-sm", !expanded && "line-clamp-2")}>{state.goal}</p>}
      <p className="text-[11px] text-muted-foreground">
        {state.revision ? `revision ${state.revision}` : "no plan yet"}
        {state.by ? ` · by ${state.by}` : ""}
        {state.at ? ` · ${clock(state.at)}` : ""}
      </p>
    </div>
  )
}

function QualityView({ state }) {
  const rows = Object.entries(state?.rows ?? {})
  if (!rows.length) return <p className="text-xs text-muted-foreground">no reports yet</p>
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {rows.map(([m, r]) => (
        <li
          key={m}
          title={Object.entries(r.parts ?? {}).map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join(" · ")}
          className={cn("rounded border px-1.5 text-xs leading-6", r.score >= 4 ? "border-emerald-500/60" : r.score >= 3 ? "border-amber-400/60" : "border-red-500/60")}
        >
          {m} {r.score}/5
        </li>
      ))}
    </ul>
  )
}

function BoardView({ state, expanded }) {
  const entries = Object.entries(state?.entries ?? {}).reverse()
  const shown = expanded ? entries : entries.slice(0, 2)
  if (!shown.length) return <p className="text-xs text-muted-foreground">empty</p>
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {shown.map(([key, e]) => (
        <li key={key} className="text-xs">
          <span className="text-muted-foreground">{e.author} · {key}:</span>{" "}
          <span className={cn("whitespace-pre-line break-words", !expanded && "line-clamp-2")}>{e.text}</span>
        </li>
      ))}
    </ul>
  )
}

function TextView({ state, expanded }) {
  if (!expanded) return null
  return <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{state?.text || "(empty)"}</pre>
}

// Rows of objects (`rows`, else `items`, else the state's first array): one column per key.
function TableView({ state, items, rows, expanded }) {
  const data = rows ?? items ?? Object.values(state ?? {}).find(Array.isArray) ?? []
  if (!expanded || !data.length) return null
  const columns = [...new Set(data.flatMap((r) => Object.keys(r ?? {})))].slice(0, 8)
  return (
    <div className="mt-1 max-w-full overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>{columns.map((c) => <th key={c} className="px-1 py-0.5 font-normal">{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((r, n) => (
            <tr key={n} className="border-t">
              {columns.map((c) => <td key={c} className="px-1 py-0.5 align-top break-words">{format(r?.[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const format = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))

// A view this UI does not know yet: the state as it is, so the owner still sees it.
function GenericView({ state, items, expanded }) {
  if (!expanded) return null
  if (items?.length) return <ListView items={items} expanded />
  if (typeof state?.text === "string") return <TextView state={state} expanded /> // a {text} state reads as text, not JSON
  const text = JSON.stringify(state ?? {}, null, 1)
  return <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{text === "{}" ? "(empty)" : text}</pre>
}

// The project a desk is building (a desk's project artifact): which project, its
// title, folder and workspace path, who pointed the files tree at it; open, every other project one line each.
// 2026-10-17: its files and changes are the files artifact's now (FilesView below, the Live workbench).
//   state: { current, projects: {slug: {kind, title, root, path, createdAt}}, focus: {path, by, at} | null }
function ProjectView({ state, expanded }) {
  const project = state?.current ? state.projects?.[state.current] : null
  const others = Object.entries(state?.projects ?? {}).filter(([slug]) => slug !== state?.current)
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      {project ? (
        <p className="break-words text-xs">
          <span className="text-foreground">{state.current}</span>{" "}
          <span className="text-muted-foreground">
            · {project.kind} · {project.root}/{project.title && project.title !== state.current ? ` · ${project.title}` : ""}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">no project open</p>
      )}
      {project && state.focus?.path && "by" in state.focus && (
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          files: {state.focus.path}/ {state.focus.by ? `(${state.focus.by}, ${clock(state.focus.at)})` : ""}
        </p>
      )}
      {expanded && others.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t pt-1">
          {others.map(([slug, p]) => (
            <li key={slug} className="break-all font-mono text-[11px] text-muted-foreground">
              <span className="text-foreground/80">{slug}</span> · {p?.kind} · {p?.root}/
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "")

// The project's files as a compact tree: a folder line once, its files indented under it.
function ProjectFiles({ files, focus }) {
  const rows = React.useMemo(() => {
    const out = []
    const seen = new Set()
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      const parts = f.path.split("/")
      parts.slice(0, -1).forEach((name, depth) => {
        const dir = parts.slice(0, depth + 1).join("/")
        if (!seen.has(dir)) {
          seen.add(dir)
          out.push({ key: `${dir}/`, name: `${name}/`, depth, dir: true })
        }
      })
      out.push({ key: f.path, name: parts.at(-1), depth: parts.length - 1, size: f.size, focus: f.path === focus })
    }
    return out
  }, [files, focus])
  if (!rows.length) return <p className="text-xs text-muted-foreground">no files yet</p>
  return (
    <ul className="max-h-64 overflow-y-auto border-t pt-1 font-mono text-[11px]" aria-label="project files">
      {rows.map((r) => (
        <li
          key={r.key}
          style={{ paddingLeft: `${r.depth * 0.75}rem` }}
          className={cn("break-all", r.dir ? "text-muted-foreground" : r.focus ? "rounded-sm border border-sky-500/60 text-sky-400" : "text-foreground/80")}
          aria-current={r.focus ? "true" : undefined}
        >
          {r.name}
          {!r.dir && r.size != null && <span className="text-muted-foreground"> {r.size}B</span>}
        </li>
      ))}
    </ul>
  )
}

// One change: who wrote what, when, and its diff (+ green, - red), wrapped so a phone never scrolls sideways.
function ProjectChange({ change: c, lines }) {
  const all = String(c.diff ?? "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1)
  const shown = lines ? all.slice(0, lines) : all
  return (
    <div className="min-w-0 border-t pt-1">
      <p className="break-all text-xs">
        <span className="text-foreground">{c.agent}</span> <span className="text-muted-foreground">{c.op}</span> <span className="font-mono text-foreground/80">{c.path}</span>{" "}
        <span className="text-muted-foreground">{clock(c.at)}</span>
      </p>
      {shown.length > 0 ? (
        <pre className="mt-1 max-w-full whitespace-pre-wrap break-all font-mono text-[11px] leading-4">
          {shown.map((l, n) => (
            <span key={n} className={cn("block", l.startsWith("+") ? "text-emerald-400" : l.startsWith("-") ? "text-red-400" : "text-muted-foreground")}>
              {l || " "}
            </span>
          ))}
        </pre>
      ) : (
        <p className="text-[11px] text-muted-foreground">no change in the text</p>
      )}
      {lines && all.length > lines && <p className="text-[11px] text-muted-foreground">… {all.length - lines} more lines</p>}
    </div>
  )
}

// The files artifact (backend/kernel/builtin/files.js): its root, the files open and modified, the newest change with
// its diff; open, the tree and every change one line each. The Live workbench draws it whole (components/live/workbench/).
//   state: { root, tree: [{path, size, mtime, dir}], truncated, open: [{path, by, at}], modified: [{path, by, at, op,
//   added, removed, diff}], focus }
function FilesView({ state, expanded }) {
  const root = state?.root ?? ""
  const modified = [...(state?.modified ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const newest = modified.at(-1)
  const open = state?.open ?? []
  const files = React.useMemo(() => (state?.tree ?? []).filter((e) => e?.path && !e.dir).map((e) => ({ ...e, path: fullPath(root, e.path) })), [state?.tree, root])
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-2">
      <p className="break-words text-xs">
        <span className="font-mono text-foreground">{root || "workspace"}/</span>{" "}
        <span className="text-muted-foreground">
          · {files.length}
          {state?.truncated ? "+" : ""} files · {open.length} open · {modified.length} modified
        </span>
      </p>
      {expanded && open.length > 0 && (
        <p className="break-all font-mono text-[11px] text-sky-700 dark:text-sky-300">{open.map((o) => o.path).join("  ")}</p>
      )}
      {expanded && <ProjectFiles files={files} focus={state?.focus?.path} />}
      {newest ? <ProjectChange change={{ ...newest, agent: newest.by }} lines={expanded ? null : 8} /> : <p className="text-xs text-muted-foreground">no changes yet</p>}
      {expanded && modified.length > 1 && (
        <ul className="flex flex-col gap-0.5 border-t pt-1">
          {modified.slice(0, -1).reverse().map((c, n) => (
            <li key={`${c.at}-${n}`} className="break-all font-mono text-[11px] text-muted-foreground">
              {clock(c.at)} {c.by} {c.op} <span className="text-foreground/80">{c.path}</span> <span className="text-emerald-400">+{c.added ?? 0}</span> <span className="text-red-400">-{c.removed ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const SESSION_TONE = { running: "text-emerald-500", failed: "text-red-500", stopped: "text-amber-500" }

// A session holding a lease (2026-10-17: `terminal.run {lease: "gpu"}` — one GPU, one run at a time): a small badge
// with the lease's name, on the card's rows and the Live terminal pane's tabs.
export function LeaseBadge({ lease, className }) {
  if (!lease) return null
  return (
    <span title={`holds the ${lease} lease: another session asking for it waits`} className={cn("shrink-0 rounded border border-amber-500/60 px-1 font-mono text-[10px] leading-4 text-amber-700 dark:text-amber-300", className)}>
      {lease}
    </span>
  )
}

// The terminal artifact (backend/kernel/builtin/terminal.js): its sessions newest first — an agent's main and long
// sessions named "coder · main" with the command they run — each with its status and exit code; closed, the newest
// running one's last lines; open, every session's tail.
//   state: { sessions: [{id, name, command, cwd, agent, slot, runs, status, exit, startedAt, endedAt, urls, tail, lease}] }
function TerminalView({ state, expanded }) {
  const sessions = state?.sessions ?? []
  if (!sessions.length) return <p className="mt-1 text-xs text-muted-foreground">no sessions yet</p>
  const shown = expanded ? sessions : sessions.slice(0, 3)
  const tailOf = (s) => (s.tail ?? []).map((l) => stripAnsi(l))
  const running = sessions.find((s) => s.status === "running")
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {shown.map((s) => (
          <li key={s.id} className="min-w-0 text-xs">
            <p className="flex min-w-0 items-baseline gap-1.5">
              <span className={cn("shrink-0", SESSION_TONE[s.status] ?? "text-muted-foreground")}>●</span>
              <span className="min-w-0 truncate font-mono" title={s.command}>
                {sessionLabel(s)}
                {s.slot && <span className="text-muted-foreground"> {s.command}</span>}
              </span>
              <LeaseBadge lease={s.lease} />
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {s.status}
                {s.status !== "running" && s.exit != null ? ` · exit ${s.exit}` : ""}
              </span>
            </p>
            {expanded && s.tail?.length > 0 && (
              <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border px-2 py-1 font-mono text-[11px] leading-4 text-muted-foreground">{tailOf(s).join("\n")}</pre>
            )}
          </li>
        ))}
      </ul>
      {!expanded && running?.tail?.length > 0 && (
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-muted-foreground">{tailOf(running).slice(-4).join("\n")}</pre>
      )}
      {!expanded && sessions.length > shown.length && <p className="text-[11px] text-muted-foreground">+{sessions.length - shown.length} more</p>}
    </div>
  )
}

const JOB_TONE = { running: "bg-emerald-500 motion-safe:animate-pulse", done: "bg-sky-500", failed: "bg-red-500", stopped: "bg-amber-500" }

// Re-render every second while a job runs, so its elapsed time counts.
function useTick(active) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

// The dispatch artifact (kit dispatch, backend/kernel/builtin/dispatch.js; 2026-10-17: work a lead hands a station
// while its own steps go on): one row per job — status, "j2 → data", the ask in one line, how long it has run (else how
// long it took and when it ended) — running first; a finished job's report (or error) opens under it. Closed, the
// running jobs and the newest ended ones, at most four rows. In a narrow card (a phone's, 2026-10-17: a long member
// name like "observatory-analyst" pushed the time past the card's edge) the station's name truncates, the ask takes a
// line of its own and the end clock goes; from a 28rem card on, one line.
//   state: { jobs: [{id, to, by, ask, status: running | done | failed | stopped, startedAt, endedAt, report, error}] }
function DispatchView({ state, expanded }) {
  const running = (state?.jobs ?? []).some((j) => j?.status === "running")
  const now = useTick(running)
  const rows = dispatchRows(state, { now })
  if (!rows.length) return <p className="mt-1 text-xs text-muted-foreground">no jobs yet</p>
  const shown = expanded ? rows : rows.slice(0, 4) // running first, so a closed card never hides one behind an ended job
  return (
    <ul className="@container mt-1 flex min-w-0 flex-col gap-1">
      {shown.map((r) => (
        <li key={r.id} className="min-w-0 text-xs">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 @md:flex-nowrap">
            <span aria-hidden className={cn("size-2 shrink-0 translate-y-[-1px] self-center rounded-full", JOB_TONE[r.status] ?? "bg-muted-foreground/50")} />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground/90 @md:max-w-[45%] @md:flex-initial" title={`${r.id} → ${r.to}`}>
              {r.id} → {r.to}
            </span>
            <span className="order-last min-w-0 basis-full truncate pl-3.5 text-muted-foreground @md:order-none @md:flex-1 @md:pl-0" title={r.ask}>
              {r.ask}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title={r.endedAt ? `ended ${clock(r.endedAt)}` : undefined}>
              {r.running ? r.elapsed : `${r.status}${r.elapsed ? ` · ${r.elapsed}` : ""}`}
              {!r.running && r.endedAt ? <span className="hidden @md:inline"> · {clock(r.endedAt)}</span> : null}
            </span>
          </p>
          {(r.report || r.error) && (
            <details className="group pl-3.5">
              <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
                {r.error ? <span className="min-w-0 truncate text-red-700 dark:text-red-400">{r.error}</span> : <span className="min-w-0 truncate">report: {r.report.slice(0, 120)}</span>}
              </summary>
              {r.report && (
                <pre className="mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border px-2 py-1 font-sans text-[11px] leading-4 text-muted-foreground">
                  {expanded ? r.report : `${r.report.slice(0, 600)}${r.report.length > 600 ? "…" : ""}`}
                </pre>
              )}
            </details>
          )}
        </li>
      ))}
      {!expanded && rows.length > shown.length && <li className="text-[11px] text-muted-foreground">+{rows.length - shown.length} more</li>}
    </ul>
  )
}

// The preview artifact (backend/kernel/builtin/preview.js): each page the agents opened — its url, title, status and
// console errors, and its latest screenshot (small when closed). The image comes from the host (/__askk/browser/shot),
// never through the stream.
//   state: { pages: [{id, url, title, status, by, at, shot: {n, at, width, height, url} | null, console, errors}] }
function PreviewPagesView({ state, expanded }) {
  const pages = state?.pages ?? []
  if (!pages.length) return <p className="mt-1 text-xs text-muted-foreground">no pages open</p>
  const open = pages.filter((p) => p.status !== "closed")
  const shown = expanded ? pages : (open.length ? open : pages).slice(0, 1)
  return (
    <ul className="mt-1 flex min-w-0 flex-col gap-2">
      {shown.map((p) => {
        const src = shotSrc(p.shot)
        const errors = consoleErrors(p).count
        return (
          <li key={p.id} className="flex min-w-0 flex-col gap-1 text-xs">
            <p className="flex min-w-0 items-baseline gap-1.5">
              <span className={cn("shrink-0", p.status === "open" ? "text-emerald-500" : "text-muted-foreground")}>●</span>
              <span className="min-w-0 truncate font-mono" title={p.url}>
                {p.url}
              </span>
              {errors > 0 && <span className="ml-auto shrink-0 text-[11px] text-red-500">{errors} error{errors === 1 ? "" : "s"}</span>}
            </p>
            {p.title && <p className="truncate text-[11px] text-muted-foreground">{p.title}</p>}
            {src && (
              // eslint-disable-next-line @next/next/no-img-element -- a host route, not a static asset (static export)
              <img src={src} alt={`Screenshot of ${p.title || p.url}`} loading="lazy" className={cn("h-auto max-w-full rounded-sm border object-contain object-left-top", !expanded && "max-h-40")} />
            )}
          </li>
        )
      })}
      {!expanded && pages.length > shown.length && <li className="text-[11px] text-muted-foreground">+{pages.length - shown.length} more</li>}
    </ul>
  )
}

// The next run: when, and the goal it starts with. The lead books it too (its schedule tool).
function ScheduleView({ state }) {
  const next = state?.next ?? null
  const [at, setAt] = React.useState("")
  const [goal, setGoal] = React.useState("")
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  React.useEffect(() => setGoal((g) => g || state?.defaultGoal || ""), [state?.defaultGoal])
  const act = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const when = next ? new Date(next.at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit" }) : null
  return (
    <div className="mt-1 flex flex-col gap-2">
      <p className="text-sm">
        {next ? (
          <>
            Next: <span className="text-sky-400">{when} ET</span> · by {next.by} — {next.goal}
          </>
        ) : (
          <span className="text-muted-foreground">no run booked</span>
        )}
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          act(() => bookNextRun({ at, goal }))
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor={`${id}-at`}>At (ET, HH:MM)</label>
          <input id={`${id}-at`} value={at} onChange={(e) => setAt(e.target.value)} placeholder="HH:MM" className="h-10 w-24 rounded-md border bg-background px-2 text-base md:text-sm" />
        </div>
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-goal`}>Goal for that run</label>
        <textarea id={`${id}-goal`} value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="rounded-md border bg-background p-2 text-base md:text-sm" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-10" disabled={busy || !goal.trim() || !at.trim()}>Book next run</Button>
          {next && <Button type="button" variant="outline" className="h-10" disabled={busy} onClick={() => act(clearNextRun)}>Clear</Button>}
          <Button type="button" variant="ghost" className="h-10" disabled={busy || !goal.trim()} onClick={() => act(() => setDefaultGoal(goal))} title="Used when a run is booked without a goal">Save as default goal</Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </div>
  )
}
