// Artifact: state an agent keeps beside its conversation, rendered into every prompt as its latest
// state only. `commands()` are the tools that change it. Several agents may hold the same artifact
// (a team's shared board): each sees the others' writes at its next step.

// Hooks an artifact may define: attach(agent, {commands, gate}) when added (how that agent holds it: a commands
// subset, gated), detach(agent) when a spawned holder is dismissed, onRunStart(agent, request) when a run
// starts, gate(agent, answer) → a reason to refuse the final answer (or null), snapshot() /
// restore(data) for saving, refresh(agent) (async) awaited before each step's render — 2026-10-17: a host-backed
// artifact reads its state there (a terminal's tail, a file tree), so render() stays synchronous; it calls changed()
// only when its twin state differs, so a refresh per step does not flood the stream. `name` is its id,
// "<owner>.<kind>" (market.board, lead.checklist).
// For views (UI, status messages): `kind` (what it is), `view` (how its state renders: board, checklist,
// quality, schedule, text, table…) and brief() — its state in one line.
export class Artifact {
  constructor({ name, title } = {}) {
    this.name = name
    this.title = title ?? name
    this.kind = "artifact"
    this.view = "text"
    this.keep = "day" // saved and restored: "day" (the same ET day), "always", "run" or "file" (never)
    this.owner = null
    this.state = {}
    this.listeners = new Set()
  }

  get id() {
    return this.name
  }

  snapshot() {
    return structuredClone(this.state)
  }

  restore(data) {
    if (data && typeof data === "object") this.state = data
  }

  render() {
    return JSON.stringify(this.state, null, 2)
  }

  brief() {
    return ""
  }

  // The Live page's view of it: {view, data}.
  live() {
    return { view: this.view, data: this.state }
  }

  // Its twin on the UI as plain data (components/views/artifact.jsx draws it by `view`); the host adds `holders`
  // (Desk.artifacts). A "list" view also carries its rows as `items`, so a view draws them without knowing the kind.
  twin() {
    const twin = { element: "artifact", id: this.id, kind: this.kind, view: this.view, owner: this.owner, title: this.title, keep: this.keep, brief: this.brief?.() ?? "", state: this.twinState() }
    if (this.view === "list") twin.items = this.live?.().data?.items ?? []
    return twin
  }

  // The state a twin shows (SharedBoard: its goal and entries, not its tree).
  twinState() {
    return this.state
  }

  commands() {
    return []
  }

  changed() {
    for (const fn of this.listeners) fn(this)
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
