import { Browse } from "./browse.js"
import { Talk } from "./talk.js"
import { Dispatch } from "./dispatch.js"
import { deskTools } from "./desks.js"
import { Files } from "./files.js"
import { Plan } from "./plan.js"
import { Practice } from "./practice.js"
import { Preview } from "./preview.js"
import { catalogTool, dismissTool, spawnTool, updateTool } from "./spawn.js"
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
// deskOptions: {clock?, adapter? (files and the preview's visual files: the workspace adapter, files.js — default
// the host), root? (files: the tree's first root)}. Artifacts are shared per desk: every agent that lists `files`,
// `terminal`, `preview`, `plan`, `dispatch`, `browse` or `talk` holds the same instance, id = the type; a spec {type, id} makes a
// separate one (the same id → the same one again); {type, commands: [...]} holds a subset of its commands; {type: plan,
// gate: true} gates that holder's answer. 2026-10-17: the stage is gone — the preview is the one pane (pages and visuals).
// 2026-10-18 owner: no charts — a live training dashboard is a page in the preview, which the UI enlarges to the page.

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
    // agent.spawn {name, role, goal, tools?, artifacts?, keep?, members?, template?, writes?, reads?, model?, max_steps?}: a helper agent for a stated goal (with members or a template: a sub-team on its own board), the caller's quest tool
    "agent.spawn": () => spawnTool(),
    // agent.dismiss {name}: lets a helper the caller spawned go
    "agent.dismiss": () => dismissTool(),
    // agent.catalog {find?} (2026-10-20): what a helper can be given — tools, artifacts, templates, models — and the helpers now
    "agent.catalog": () => catalogTool(),
    // agent.update {name, role?, goal?, tools?, …, keep?} (2026-10-20): rebuild a helper the caller spawned with changed fields
    "agent.update": () => updateTool(),
    // desk.list / create / check / load / ask / propose (2026-10-20): make, check, host and give work to desks (host desks/*)
    ...Object.fromEntries(Object.keys(deskTools()).map((name) => [name, () => deskTools()[name]])),
  },
  artifacts: {
    // files (view files): the workspace tree, the files open and modified (with diffs); write/edit/append in the holder's writes: lane, read/list/search in its reads: lane
    files: perDesk("files", (o) => new Files({ id: o.id, adapter: o.adapter ?? o.files?.adapter, root: o.root ?? o.files?.root ?? "", clock: o.clock })),
    // terminal (view terminal): sessions that keep running (host term/*); the prompt shows each running one's last 50 lines
    terminal: perDesk("terminal", (o) => new Terminal({ id: o.id, separate: o.separate })),
    // preview (view preview): the one pane the owner watches — the app's pages (host browser/*: the agent reads their text,
    // the owner sees their screenshots) and the visuals the agent draws (a spec, a workspace file, a terminal
    // session); the owner's questions about what is in it go back to its keeper (preview.answer)
    preview: perDesk("preview", (o) => new Preview({ id: o.id, separate: o.separate, adapter: o.adapter ?? o.files?.adapter, clock: o.clock })),
    // plan (view checklist): the desk's checklist written at run time (plan.write / tick / skip); gate: true holders answer only when it is done
    plan: perDesk("plan", (o) => new Plan({ id: o.id, clock: o.clock })),
    // dispatch (view dispatch): briefs handed to the holder's agents that run while it keeps working (start / wait / read / stop / list); it answers only when none of its jobs runs
    dispatch: perDesk("dispatch", (o) => new Dispatch({ id: o.id, clock: o.clock })),
    // browse (view browse; 2026-10-18 owner: "not just get but also be able to navigate the web"): a text web browser
    // on the host, a tab per holder — search, open, click a link by number, back, more, find, links, submit a GET form
    browse: perDesk("browse", (o) => new Browse({ id: o.id, clock: o.clock })),
    // talk (view talk; 2026-10-18 owner: "The desk should be able to talk with me too. The work and build can run in the
    // background."): the desk tells the owner results and asks what only the owner decides; never waits for a reply
    talk: perDesk("talk", (o) => new Talk({ id: o.id, clock: o.clock })),
    // practice (view practice; 2026-10-20 owner: "self-reflect like the retro or the critic … update instructions or the
    // tools or any kind of quality guidelines it may have missed"): one per agent (id <agent>.practice) — its run
    // checklist, quality bar, learned instructions, lessons and the tools it lacks, kept in a file it edits itself
    // (deskOptions.practiceStore(agent) → {read, write, seed?, retro?, where}: compose.js binds memory/<desk>/practice/)
    practice: (o = {}) => (agent, spec = {}) => new Practice({ id: `${agent.name}.practice`, owner: agent.name, store: o.practiceStore?.(agent) ?? null, seed: spec?.seed ?? null, reflect: spec?.reflect, clock: o.clock }),
  },
}

export function builtinKit(deskOptions = {}) {
  const bind = (catalogue) => Object.fromEntries(Object.entries(catalogue).map(([name, make]) => [name, make(deskOptions)]))
  return { tools: bind(BUILTIN.tools), artifacts: bind(BUILTIN.artifacts) }
}
