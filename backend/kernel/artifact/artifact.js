import { Tool } from "../tool/tool.js"

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
//
// Declared, not written (2026-10-25): a subclass lists its agent commands and the owner's calls as tables —
//   static commands = {say: {description, input, run?}}   run: a method name (default: the command's) or
//                                                          function (input, ctx) bound to the artifact; description and
//                                                          input may be functions of the artifact; tools are type "dev"
//                                                          and draw with the artifact's view unless the entry says;
//                                                          usage: the input as the TOOLS line writes it ("{to, ask}")
//   (an entry may also set `outside`, `type`, `view`)
//   static owner = {reply: "reply" | function (a, from, args)}  a: args[0]; ownerCall exists only when declared
//   static ownerCan = "reply or mark seen"                 the refusal's prose (default: the methods' names)
// bump(patch) merges a state patch, counts its revision and tells the listeners; can(agent) the commands it holds.
export class Artifact {
  static commands = null
  static commandType = "dev" // "artifact": commands that only change it (an answer beside them all is final)
  static owner = null
  static ownerCan = null

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
    return Object.entries(this.constructor.commands ?? {}).map(([name, c]) => {
      const run = typeof c.run === "function" ? c.run : this[c.run ?? name]
      const of = (v) => (typeof v === "function" ? v.call(this) : v)
      const tool = new Tool({ name: `${this.name}.${name}`, type: c.type ?? this.constructor.commandType, view: c.view ?? this.view, ...(c.outside === undefined ? {} : { outside: c.outside }), description: of(c.description), input: of(c.input), run: (i, ctx) => run.call(this, i, ctx) })
      if (c.usage) tool.describe = () => `- ${tool.name} ${c.usage} — ${tool.description}` // its input written out, not listed
      return tool
    })
  }

  // The owner's calls, from `static owner`: undefined when none are declared (the host takes that as "no owner calls").
  get ownerCall() {
    const table = this.constructor.owner
    if (!table) return undefined
    return (method, args = [], from = "owner") => {
      const fn = Object.hasOwn(table, method) ? table[method] : null
      if (!fn) throw new Error(`${this.name}: the owner can ${this.constructor.ownerCan ?? Object.keys(table).join(", ")} (not ${method})`)
      return (typeof fn === "function" ? fn : this[fn]).call(this, args[0] ?? {}, from, args)
    }
  }

  bump(patch = {}) {
    this.state = { ...this.state, ...patch, revision: (this.state.revision ?? 0) + 1 }
    this.changed()
  }

  // The commands of this artifact the agent holds (every one when no agent), as "<id>.<command>".
  can(agent, names = Object.keys(this.constructor.commands ?? {})) {
    return names.map((c) => `${this.name}.${c}`).filter((c) => !agent || agent.tools?.has(c))
  }

  changed() {
    for (const fn of this.listeners) fn(this)
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
