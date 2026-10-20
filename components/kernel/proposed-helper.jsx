"use client"

import * as React from "react"

import { helperCall } from "@/backend/live/desk"
import { proposedOf } from "@/backend/live/spawned"
import { Button } from "@/components/ui/button"

// What waits on a helper for the owner (2026-10-20, kernel builtin/spawn.js: a keep: desk, or a kept helper's update,
// from a run that read the web is proposed, never in force until accepted) — the twin of its `spawned.proposed`, drawn
// like the practice's pending edits (components/views/artifact.jsx PendingEdits): a dashed block, "proposed · not in
// force", what it would keep or change, where its words came from, Accept / Drop (helperCall → the host's team call
// target "desk" → kernel ownerHelperCall). Used under a helper's row and card on the home page and on its agent page.
//   node: a desk-tree node, a definition or an AgentView (proposedOf); nothing drawn when nothing waits.

const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "")

export function ProposedHelper({ node, expanded = false }) {
  const p = proposedOf(node)
  const [call, setCall] = React.useState({ busy: null, error: null })
  const act = async (method) => {
    setCall({ busy: method, error: null })
    try {
      await helperCall(method, p.name)
      setCall({ busy: null, error: null }) // the block leaves with the desk's next tree
    } catch (error) {
      setCall({ busy: null, error: error?.message ?? String(error) })
    }
  }
  if (!p) return null
  const keep = p.kind === "keep"
  return (
    <div data-proposed className="mt-1 min-w-0 rounded border border-dashed border-amber-500/60 px-1.5 py-1 text-xs">
      <p className="text-[11px] text-amber-700 dark:text-amber-400">proposed · not in force · waits for you</p>
      <p className="break-words text-[11px] text-muted-foreground">
        {keep ? (
          <>
            keep <span className="text-foreground/80">{p.name}</span> past this run — its agent.md written, back at every start; until then it goes when{" "}
            {p.by ?? "its spawner"}&apos;s run ends
          </>
        ) : (
          <>
            update of kept <span className="text-foreground/80">{p.name}</span> — it works as it was until you accept
          </>
        )}
        {p.by ? ` · by ${p.by}` : ""}
        {p.at ? ` · ${clock(p.at)}` : ""}
      </p>
      {keep && p.role && <p className={expanded ? "whitespace-pre-wrap break-words" : "line-clamp-3 break-words"}>{p.role}</p>}
      {p.changes.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {p.changes.map((c) => (
            <li key={c.field} className="min-w-0 break-words">
              <span className="text-[11px] text-muted-foreground">{c.field}: </span>
              <span className={expanded ? "whitespace-pre-wrap" : "line-clamp-3"}>{c.value}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="break-words text-[11px] text-amber-700 dark:text-amber-400">from a run that read the web{p.from ? `: ${p.from}` : ""}</p>
      <div className="mt-0.5 flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10"
          disabled={!!call.busy}
          onClick={() => act("accept")}
          aria-label={`Accept the ${keep ? "keep" : "update"} proposed for ${p.name}`}
          title={keep ? `Keep ${p.name}: it stays until dismissed and comes back at every start` : `Apply the update to ${p.name} as its spawner would`}
        >
          {call.busy === "accept" ? "Accepting…" : "Accept"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10"
          disabled={!!call.busy}
          onClick={() => act("drop")}
          aria-label={`Drop the ${keep ? "keep" : "update"} proposed for ${p.name}`}
          title={keep ? `${p.name} stays for this run only` : `${p.name} stays as it was kept`}
        >
          {call.busy === "drop" ? "Dropping…" : "Drop"}
        </Button>
      </div>
      {call.error && <p className="break-words text-[11px] text-red-700 dark:text-red-400">Not done: {call.error}</p>}
    </div>
  )
}
