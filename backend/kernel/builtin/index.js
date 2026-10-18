import { Charts } from "./charts.js"
import { Dispatch } from "./dispatch.js"
import { Files } from "./files.js"
import { Plan } from "./plan.js"
import { Preview } from "./preview.js"
import { dismissTool, spawnTool } from "./spawn.js"
import { Terminal } from "./terminal.js"
import { webReadTool, webSearchTool } from "./web.js"

// The inbuilt kit (2026-10-17 owner: everything is an independent inbuilt tool or artifact any agent attaches by
// name): a catalogue every desk gets under its own tools and artifact types (companion/team/compose.js merges it; the
// desk wins a clash). Plain JS over ctx.host, like the rest of the kernel.
//
//   BUILTIN.tools      {name: (deskOptions) => Tool}
//   BUILTIN.artifacts  {type: (deskOptions) => (agent, spec) => Artifact}
//   builtinKit(deskOptions) → {tools: {name: Tool}, artifacts: {type: (agent, spec) => Artifact}}: the catalogue bound
//                      to one desk (call it once per desk: its shared instances are made there)
//
// deskOptions: {clock?, adapter? (files and charts: the workspace adapter, files.js — default the host), root? (files:
// the tree's first root)}. Artifacts are shared per desk: every agent that lists `files`, `terminal`, `preview`, `plan`,
// `dispatch` or `charts` holds the same instance, id = the type; a spec {type, id} makes a separate one (the same id →
// the same one again); {type, commands: [...]} holds a subset of its commands; {type: plan, gate: true} gates that
// holder's answer.

const ARTIFACT_ID = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/

// One instance per desk and id: the per-agent factory hands every holder of `id` the same one.
const perDesk = (type, make) => (o = {}) => {
  const made = new Map()
  return (agent, spec = {}) => {
    const id = spec?.id == null || spec.id === "" ? type : String(spec.id).trim()
    if (!ARTIFACT_ID.test(id)) throw new Error(`${agent?.name ?? "an agent"}: ${type} id "${id}" — lowercase words, dot-separated (it names the commands: ${id}.…)`)
    if (!made.has(id)) made.set(id, make({ ...o, id, separate: id !== type }))
    return made.get(id)
  }
}

export const BUILTIN = {
  tools: {
    // web.search {q | query, limit?, source?: web | wikipedia | arxiv | hn}: numbered results; a 429/5xx falls back to web, with a note
    "web.search": () => webSearchTool(),
    // web.read {url, find?, max_chars?}: a public page's title, URL and text, narrowed to the passages around find
    "web.read": () => webReadTool(),
    // agent.spawn {name, role, goal, tools?, artifacts?, keep?}: a helper agent for a stated goal, the caller's quest tool
    "agent.spawn": () => spawnTool(),
    // agent.dismiss {name}: lets a helper the caller spawned go
    "agent.dismiss": () => dismissTool(),
  },
  artifacts: {
    // files (view files): the workspace tree, the files open and modified (with diffs); write/edit/append in the holder's writes: lane, read/list/search in its reads: lane
    files: perDesk("files", (o) => new Files({ id: o.id, adapter: o.adapter ?? o.files?.adapter, root: o.root ?? o.files?.root ?? "", clock: o.clock })),
    // terminal (view terminal): sessions that keep running (host term/*); the prompt shows each running one's last 50 lines
    terminal: perDesk("terminal", (o) => new Terminal({ id: o.id, separate: o.separate })),
    // preview (view preview): the app's pages (host browser/*); the agent reads their text, the owner sees their screenshots
    preview: perDesk("preview", (o) => new Preview({ id: o.id, separate: o.separate, clock: o.clock })),
    // plan (view checklist): the desk's checklist written at run time (plan.write / tick / skip); gate: true holders answer only when it is done
    plan: perDesk("plan", (o) => new Plan({ id: o.id, clock: o.clock })),
    // dispatch (view dispatch): briefs handed to the holder's agents that run while it keeps working (start / wait / read / stop / list); it answers only when none of its jobs runs
    dispatch: perDesk("dispatch", (o) => new Dispatch({ id: o.id, clock: o.clock })),
    // charts (view chart): the observation desk's graphs — workspace metrics files (.tsv/.csv/.jsonl/.json, a glob: one series per run) re-read as they grow
    charts: perDesk("charts", (o) => new Charts({ id: o.id, adapter: o.adapter ?? o.files?.adapter, clock: o.clock })),
  },
}

export function builtinKit(deskOptions = {}) {
  const bind = (catalogue) => Object.fromEntries(Object.entries(catalogue).map(([name, make]) => [name, make(deskOptions)]))
  return { tools: bind(BUILTIN.tools), artifacts: bind(BUILTIN.artifacts) }
}
