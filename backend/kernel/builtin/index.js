import { Browse } from "./browse.js"
import { Talk } from "./talk.js"
import { Ask } from "./ask.js"
import { Dev } from "./dev.js"
import { Goal } from "./goal.js"
import { Studio } from "./studio.js"
import { Surgeon } from "./surgeon.js"
import { Audio } from "./audio.js"
import { Dispatch } from "./dispatch.js"
import { deskTools } from "./desks.js"
import { Files } from "./files.js"
import { Plan } from "./plan.js"
import { Practice } from "./practice.js"
import { Preview } from "./preview.js"
import { SPAWN_TOOLS } from "./spawn.js"
import { Terminal } from "./terminal.js"
import { WEB_TOOLS } from "./web.js"
import { SPEECH_TOOLS } from "./speech.js"
import { Workflow } from "./workflow.js"

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
// `terminal`, `preview`, `plan`, `dispatch`, `browse`, `talk`, `goal`, `dev` or `studio` holds the same instance, id = the type; a spec {type, id} makes a
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
    // web.search / web.read (web.js) and agent.spawn / dismiss / catalog / update (2026-10-20; spawn.js): factories by name
    ...WEB_TOOLS,
    // speech.say (speech.js, 2026-10-27): an answer spoken through the host's POST speech/say; 501 off macOS
    ...SPEECH_TOOLS,
    ...SPAWN_TOOLS,
    // desk.list / create / check / load / ask / propose (2026-10-20): make, check, host and give work to desks (host desks/*)
    ...Object.fromEntries(Object.keys(deskTools()).map((name) => [name, () => deskTools()[name]])),
  },
  artifacts: {
    files: perDesk("files", (o) => new Files({ id: o.id, adapter: o.adapter ?? o.files?.adapter, root: o.root ?? o.files?.root ?? "", clock: o.clock })),
    terminal: perDesk("terminal", (o) => new Terminal({ id: o.id, separate: o.separate })),
    // preview (view preview): the one pane the owner watches — the app's pages (host browser/*: the agent reads their text,
    // the owner sees their screenshots) and the visuals the agent draws (a spec, a workspace file, a terminal
    // session); the owner's questions about what is in it go back to its keeper (preview.answer)
    preview: perDesk("preview", (o) => new Preview({ id: o.id, separate: o.separate, adapter: o.adapter ?? o.files?.adapter, clock: o.clock })),
    plan: perDesk("plan", (o) => new Plan({ id: o.id, clock: o.clock })),
    dispatch: perDesk("dispatch", (o) => new Dispatch({ id: o.id, clock: o.clock })),
    // browse (view browse; 2026-10-18 owner: "not just get but also be able to navigate the web"): a text web browser
    // on the host, a tab per holder — search, open, click a link by number, back, more, find, links, submit a GET form
    browse: perDesk("browse", (o) => new Browse({ id: o.id, clock: o.clock })),
    // talk (view talk; 2026-10-18 owner: "The desk should be able to talk with me too. The work and build can run in the
    // background."): the desk tells the owner results and asks what only the owner decides; never waits for a reply
    talk: perDesk("talk", (o) => new Talk({ id: o.id, clock: o.clock })),
    // ask (view ask; 2026-10-27, beside speech.say): "what is this?" answered with no run — the element's class file:line, its state now, code hits; the latest answer only
    ask: perDesk("ask", (o) => new Ask({ id: o.id, clock: o.clock, root: o.ask?.root ?? "" })),
    // goal (view goal; 2026-10-24 owner: "the desk will set a goal and will keep working towards the goal … all actions
    // with feedback is to gain towards the goal"): the desk's standing goal, its measure and every run's progress
    // against it; while it is active the host resumes its keeper on its own (kernel-team), the owner's feedback joins it
    goal: perDesk("goal", (o) => new Goal({ id: o.id, clock: o.clock })),
    // dev (view dev; 2026-10-25 owner: "a goal based live dev artifact"): the project a dev desk changes — made ready
    // (dev.init), its checks (dev.check), git status — composed with the holder's goal, files, terminal and preview;
    // main.js builtin.dev {project, checks, preview}
    dev: perDesk("dev", (o) => new Dev({ id: o.id, ...(o.dev ?? {}), clock: o.clock })),
    // studio (view studio; 2026-10-23 owner: "a live artifact where the input will be taken and the model will be used to
    // generate the image … critiqued and improved"): images on this Mac's open model (host image/*), the prompt's versions,
    // critiques, the pick and the owner's feedback; a holder sees its new images on its next step
    studio: perDesk("studio", (o) => new Studio({ id: o.id, clock: o.clock })),
    // surgeon (view surgeon; 2026-10-26 owner: "an LLM surgeon live artifact … pause it at steps to understand … like
    // the intellij debug"): a model run under a debugger in the holder's terminal — breakpoints, step into / over,
    // views of the frame (or one the agent writes), patches, compare; the runtime talks through <folder>/cmd.json and
    // state.json (main.js builtin.surgeon {folder})
    surgeon: perDesk("surgeon", (o) => new Surgeon({ id: o.id, folder: o.surgeon?.folder ?? "surgeon", clock: o.clock })),
    // audio (view audio; 2026-10-24 owner: "even the lead is able to use TTS model to create audio files … the audio
    // transcription can be a tool as well"): scripts → audio files on this Mac's speech models, files → text, a file to
    // the owner's Telegram chat (host audio/*)
    audio: perDesk("audio", (o) => new Audio({ id: o.id, clock: o.clock })),
    // practice (view practice; 2026-10-20 owner: "self-reflect like the retro or the critic … update instructions or the
    // tools or any kind of quality guidelines it may have missed"): one per agent (id <agent>.practice) — its run
    // checklist, quality bar, learned instructions, lessons and the tools it lacks, kept in a file it edits itself
    // (deskOptions.practiceStore(agent) → {read, write, seed?, retro?, where}: compose.js binds memory/<desk>/practice/)
    // workflow (view pipeline; 2026-10-22 owner: "a configurable workflow"): a staged pipeline the desk declares as files
    // (<desk>/<id>/NN-<step>.md: code steps the desk names, research calls, quests to its agents), each judged step's
    // typed ```data checked and re-asked once; run / read, the owner's stop. deskOptions.workflowSource(id) → {load,
    // store, folder} (compose.js binds the desk folder and memory/<desk>/<id>/); the desk's own code steps, schemas and
    // checks: deskOptions.workflowPlugins?.(id)
    workflow: perDesk("workflow", (o) => new Workflow({ id: o.id, clock: o.clock, ...(o.workflowSource?.(o.id) ?? {}), ...(o.workflowPlugins?.(o.id) ?? {}) })),
    practice: (o = {}) => (agent, spec = {}) => new Practice({ id: `${agent.name}.practice`, owner: agent.name, store: o.practiceStore?.(agent) ?? null, seed: spec?.seed ?? null, reflect: spec?.reflect, clock: o.clock }),
  },
}

export function builtinKit(deskOptions = {}) {
  const bind = (catalogue) => Object.fromEntries(Object.entries(catalogue).map(([name, make]) => [name, make(deskOptions)]))
  return { tools: bind(BUILTIN.tools), artifacts: bind(BUILTIN.artifacts) }
}
