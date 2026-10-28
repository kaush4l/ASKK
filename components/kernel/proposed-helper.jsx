"use client"

import { helperCall } from "@/backend/live/desk"
import { proposedOf } from "@/backend/live/spawned"
import { Decide, useDecision } from "@/components/kernel/decide"
import { hm } from "@/backend/live/time"

// What waits on a helper for the owner (2026-10-20, kernel builtin/spawn.js: a keep: desk, or a kept helper's update,
// from a run that read the web is proposed, never in force until accepted) — the twin of its `spawned.proposed`, drawn
// like the practice's pending edits (components/views/artifact.jsx PendingEdits): a dashed block, "proposed · not in
// force", what it would keep or change, where its words came from, Accept / Drop (helperCall → the host's team call
// target "desk" → kernel ownerHelperCall). Used under a helper's row and card on the home page and on its agent page.
//   node: a desk-tree node, a definition or an AgentView (proposedOf); nothing drawn when nothing waits.

export function ProposedHelper({ node, expanded = false }) {
  const p = proposedOf(node)
  // the block leaves with the desk's next tree
  const [call, act] = useDecision((method) => helperCall(method, p.name))
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
        {p.at ? ` · ${hm(p.at)}` : ""}
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
      <Decide
        call={call}
        act={act}
        what={`the ${keep ? "keep" : "update"} proposed for ${p.name}`}
        acceptTitle={keep ? `Keep ${p.name}: it stays until dismissed and comes back at every start` : `Apply the update to ${p.name} as its spawner would`}
        dropTitle={keep ? `${p.name} stays for this run only` : `${p.name} stays as it was kept`}
      />
    </div>
  )
}
