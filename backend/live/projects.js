// The desk's projects outside ASKK, as the Projects page sees them (host API GET projects, POST projects/load and
// projects/unload: companion/capabilities/projects.js). 2026-10-17 owner: "I can load a new project location and the agent
// can work on the project" — a loaded folder is projects/<name>/ in the desk's workspace; its .agents/ (ignoring itself)
// holds what the agents set up for it; a load gives the lead its first-setup run.
//
//   await listProjects()                       { projects: [{ name, path, source, at, missing, setup, workspace }], file }
//   await loadProject({ path, name?, setup? }) { project, created, setup: "sent" | "skipped" | why not }
//   await unloadProject(name)                  { name }
//   projectState(p) → { label, tone }          what a row says about it (pure)

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

export const listProjects = () => api("projects")
export const loadProject = ({ path, name, setup = true }) => api("projects/load", { path, ...(name ? { name } : {}), setup })
export const unloadProject = (name) => api("projects/unload", { name })

// A row's state: its folder gone, set up (its .agents/project.md written by the first setup), or not yet.
export function projectState(p) {
  if (p?.missing) return { label: "folder missing", tone: "error" }
  if (p?.setup) return { label: "set up", tone: "ok" }
  return { label: "not set up yet", tone: "wait" }
}

// What the load answered, in a line for the page.
export function loadNote({ project, created, setup }) {
  const what = `${created ? "Loaded" : "Already loaded:"} ${project.name} → ${project.workspace}/`
  if (setup === "sent") return `${what}. The lead is setting it up now — follow it on Home.`
  if (setup === "skipped") return `${what}.`
  return `${what}. The setup was not sent: ${setup}`
}
