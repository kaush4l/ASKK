"use client"

import * as React from "react"
import { ExternalLinkIcon, GitBranchIcon } from "lucide-react"

import { hm } from "@/backend/live/time"
import { useArtifact } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"
import { importsLine, restartHealthLine, warmClasses, warmLine } from "./dev-warm.js"

// The dev artifact (kernel builtin/dev.js; 2026-10-25 owner: "a goal based live dev artifact … the goal, a UI preview if
// present, a terminal status to control, ability to make changes"): the project the desk changes and its branch, the
// goal it works toward, what changed (git, and what is unchecked since the checks passed), every check with its last
// lines when it failed, the terminal sessions running, the page in the preview. The goal, files, terminal and preview
// it composes are their own artifacts (state.links): each part here subscribes to its own twin.

const CHECK = { pass: "bg-emerald-500", fail: "bg-destructive", never: "bg-muted-foreground/40" }
const label = "text-[11px] uppercase tracking-wide text-muted-foreground"

function Goal({ id }) {
  const goal = useArtifact(id)?.state
  const g = goal?.goal && ["active", "paused"].includes(goal.status) ? goal.goal : null
  const frame = goal?.frames?.findLast((f) => f.status === "working")
  if (!g && !frame) return null
  return (
    <p className="text-sm break-words">
      <span className={label}>Goal </span>
      {g ? g.text : frame.intent}
      {g && goal.next && <span className="text-muted-foreground"> · next: {goal.next}</span>}
    </p>
  )
}

function Unchecked({ id, workspace, since }) {
  const modified = useArtifact(id)?.state?.modified ?? []
  const open = modified.filter((m) => m.path.startsWith(`${workspace}/`) && (!since || m.at > since))
  if (!open.length) return null
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <p className="break-words text-amber-600 dark:text-amber-400">unchecked since the checks passed: {open.map((m) => m.path.slice(workspace.length + 1)).join(", ")}</p>
      {open
        .filter((m) => m.why)
        .map((m) => (
          <p key={m.path} className="break-words text-muted-foreground">
            <span className="font-mono text-foreground/80">{m.path.slice(workspace.length + 1)}</span> — {m.why}
          </p>
        ))}
    </div>
  )
}

function Running({ id }) {
  const sessions = (useArtifact(id)?.state?.sessions ?? []).filter((s) => s.status === "running")
  if (!sessions.length) return null
  return (
    <ul className="flex flex-col gap-0.5 text-xs" aria-label="Running">
      {sessions.map((s) => (
        <li key={s.id} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sky-500 motion-safe:animate-pulse" />
          <span className="min-w-0 truncate font-mono">{s.command}</span>
          {s.urls?.[0] && <span className="shrink-0 text-muted-foreground">{s.urls[0]}</span>}
        </li>
      ))}
    </ul>
  )
}

function Preview({ id, fallback }) {
  const p = useArtifact(id)?.state
  const page = p?.current?.kind === "page" ? p.pages?.find((x) => x.id === p.current.id) : null
  if (!page && !fallback) return null
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className={label}>Preview</span>
      {page ? (
        <a href={page.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 underline-offset-2 hover:underline">
          <span className="truncate">{page.url}</span>
          <ExternalLinkIcon className="size-3 shrink-0" />
        </a>
      ) : (
        <span className="text-muted-foreground">none open ({fallback})</span>
      )}
      {page?.errors > 0 && <span className="shrink-0 text-destructive">{page.errors} console errors</span>}
    </p>
  )
}

export function DevView({ state, expanded }) {
  const p = state?.project
  if (!p) return <p className="text-xs text-muted-foreground">No project configured.</p>
  const links = state.links ?? {}
  const git = state.git
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-2">
      <p className="flex min-w-0 items-center gap-1.5 text-xs">
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-mono">{p.workspace}</span>
        {p.ready ? <span className="shrink-0 text-muted-foreground">{p.branch ?? ""}</span> : <span className="shrink-0 text-amber-600 dark:text-amber-400">not initialized</span>}
        {git && <span className="ml-auto shrink-0 text-muted-foreground">{git.files.length} changed</span>}
      </p>
      {links.goal && <Goal id={links.goal} />}
      <ul className="flex flex-col gap-1" aria-label="Checks">
        {(state.checks ?? []).map((c) => (
          <li key={c.name} className="flex min-w-0 flex-col gap-0.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", CHECK[c.status] ?? CHECK.never)} />
              <span>{c.name}</span>
              <span className="min-w-0 truncate font-mono text-muted-foreground">{c.command}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{c.status === "never" ? "not run" : `${c.status} ${hm(c.at)}`}</span>
            </span>
            {expanded && c.status === "fail" && c.tail?.length > 0 && <pre className="max-h-40 overflow-auto rounded border p-1.5 font-mono text-[11px] whitespace-pre-wrap">{c.tail.join("\n")}</pre>}
          </li>
        ))}
      </ul>
      {links.files && <Unchecked id={links.files} workspace={p.workspace} since={state.passed_at} />}
      {expanded && git?.files?.length > 0 && (
        <ul className="flex flex-col font-mono text-[11px]" aria-label="Changed files">
          {git.files.map((f) => (
            <li key={f.path} className="flex gap-2">
              <span className="w-5 shrink-0 text-muted-foreground">{f.code}</span>
              <span className="min-w-0 truncate">{f.path}</span>
            </li>
          ))}
        </ul>
      )}
      {links.terminal && <Running id={links.terminal} />}
      {links.preview && <Preview id={links.preview} fallback={state.preview?.url ?? null} />}
      <Safety state={state} expanded={expanded} />
    </div>
  )
}

// Health, checkpoints and restarts (2026-10-25: dev.checkpoint / rollback / health / restart): closed, the last restart
// and the last good checkpoint in a line; open, each restart with what broke and where the tree went back to.
const RESTART = { ok: "text-emerald-600 dark:text-emerald-400", rolled_back: "text-amber-600 dark:text-amber-400", failed: "text-destructive" }
function Safety({ state, expanded }) {
  const good = (state.checkpoints ?? []).find((c) => c.kind === "good")
  const restarts = state.restarts ?? []
  const h = state.health
  const warm = warmLine(h?.warm)
  const heavy = importsLine(h?.imports)
  if (!good && !restarts.length && !h) return null
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span className={label}>Safety</span>
        {h && <span className={h.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>health {h.ok ? "ok" : "failing"} {hm(h.at)}</span>}
        <span className="text-muted-foreground">{good ? `last good ${good.id} ${hm(good.at)}` : "no good checkpoint yet"}</span>
        {warm && <span className={warmClasses()}>{warm}</span>}
        {heavy && <span className={warmClasses()}>{heavy}</span>}
      </p>
      {h && !h.ok && <p className="break-words text-destructive">{h.problems.join("; ")}</p>}
      {(expanded ? restarts : restarts.slice(0, 1)).map((r) => (
        <div key={r.id} className="flex min-w-0 flex-col gap-0.5 border-t pt-1">
          <p className="break-words">
            <span className="font-mono">{r.id}</span> <span className={RESTART[r.status] ?? "text-muted-foreground"}>{r.status.replace("_", " ")}</span> <span className="text-muted-foreground">{hm(r.ended_at ?? r.at)} · {r.by}</span> — {r.why}
          </p>
          {restartHealthLine(r) && <p className="break-words font-mono text-[11px] text-muted-foreground">{restartHealthLine(r)}</p>}
          {r.problems?.length > 0 && <p className="break-words text-muted-foreground">broke: {r.problems.join("; ")}</p>}
          {r.rollback && <p className="text-muted-foreground">rolled back to {r.rollback.id} ({r.rollback.restored} restored, {r.rollback.reverted} reverted, {r.rollback.removed} removed) — the broken tree is {r.rollback.before}</p>}
          {expanded && r.log?.length > 0 && <pre className="max-h-32 overflow-auto rounded border p-1.5 font-mono text-[11px] whitespace-pre-wrap">{r.log.join("\n")}</pre>}
        </div>
      ))}
      {expanded && (state.checkpoints ?? []).length > 0 && (
        <ul aria-label="Checkpoints" className="flex flex-col font-mono text-[11px] text-muted-foreground">
          {state.checkpoints.map((c) => (
            <li key={c.id} className="break-words">
              {c.id} {c.kind} {hm(c.at)} · {c.files} files{c.why ? ` — ${c.why}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
