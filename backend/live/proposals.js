// What waits for the owner on the desk server (2026-10-20): desks a run that read outside made (the kit's desk.create
// from such a run is held, companion/team/scaffold.js — checked, nothing written, never loaded until accepted) and every
// desk's proposed tool code (desk.propose: never loaded until accepted). The host API's GET desks/proposed, POST
// desks/accept and desks/drop (companion/server/desks.js: only from the page, never a desk); drawn by
// components/kernel/proposed-desks.jsx on the home page, counted in the header's desk menu (GET desks → proposals).
//
//   await loadProposals()                          {desks: [...], tools: [...]}, or null (no desk server here)
//   await proposalCall("accept" | "drop", {name, tool?, reason?})
//                                                  accept a desk → {name, written, accepted, loaded | loadError}
//                                                  accept a tool → {accepted, loaded | loadError}; drop → {dropped}
//   agentRows(lead) → [{depth, ...agent}]         a proposed desk's agents, the lead first, members indented (pure)
//   fromLine(from), acceptNote(result), proposalTitle(p)   the block's words (pure)

import { withBase } from "@/backend/live/base-path"

async function api(endpoint, body) {
  let response
  try {
    response = await fetch(withBase(`/__askk/${endpoint}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
  } catch {
    throw new Error("The desk server is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Request failed (${response.status}).`)
  return data
}

export async function loadProposals() {
  try {
    const data = await api("desks/proposed")
    return { desks: data.desks ?? [], tools: data.tools ?? [] }
  } catch {
    return null
  }
}

export const proposalCall = (method, { name, tool = null, reason = "" }) => api(method === "accept" ? "desks/accept" : "desks/drop", { name, ...(tool ? { tool } : {}), ...(reason ? { reason } : {}) })

// The lead, then each member under its lead (depth 1, 2 …): what each would be and hold.
export function agentRows(lead, depth = 0) {
  if (!lead?.name) return []
  const { members = [], ...agent } = lead
  return [{ depth, ...agent }, ...members.flatMap((m) => agentRows(m, depth + 1))]
}

export const fromLine = (from) => `from a run that read outside${from ? `: ${from}` : ""}`

export const proposalTitle = (p) => (p?.update ? `update of desk ${p.name}` : `new desk ${p?.name ?? "?"}`) + (p?.title && p.title !== p.name ? ` · ${p.title}` : "")

// What an accept did, in a line: written (and loaded, or why not).
export function acceptNote(r = {}) {
  if (r.file) {
    const where = r.accepted ?? `tools/${r.file}.js`
    if (r.loaded) return `Moved to ${where}; ${r.loaded.name} loaded again (${r.loaded.agents} agents).`
    return r.loadError ? `Moved to ${where}; not loaded yet: ${r.loadError}` : `Moved to ${where}; it runs when the desk is loaded next.`
  }
  const written = `Written ${r.folder ?? `custom/${r.name}`}/ (${r.written?.length ?? 0} files)`
  if (r.loaded) return `${written} and ${r.loaded.reloaded ? "reloaded" : "loaded"} (${r.loaded.agents} agents).`
  return r.loadError ? `${written}; not loaded: ${r.loadError}` : `${written}.`
}
