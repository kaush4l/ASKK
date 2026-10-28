import { Artifact } from "./artifact/artifact.js"
import { Ask } from "./builtin/ask.js"
import { SharedBoard } from "./artifact/board.js"
import { Checklist } from "./artifact/checklist.js"
import { QualityMatrix } from "./artifact/quality.js"
import { Schedule } from "./artifact/schedule.js"
import { Audio } from "./builtin/audio.js"
import { Browse } from "./builtin/browse.js"
import { Dev } from "./builtin/dev.js"
import { Dispatch } from "./builtin/dispatch.js"
import { Files } from "./builtin/files.js"
import { Goal } from "./builtin/goal.js"
import { BUILTIN } from "./builtin/index.js"
import { Plan } from "./builtin/plan.js"
import { Practice } from "./builtin/practice.js"
import { Preview } from "./builtin/preview.js"
import { Runners } from "./builtin/runners.js"
import { Studio } from "./builtin/studio.js"
import { Surgeon } from "./builtin/surgeon.js"
import { Talk } from "./builtin/talk.js"
import { Terminal } from "./builtin/terminal.js"
import { StepContract, Workflow } from "./builtin/workflow.js"

// The kernel's classes, described by the kernel itself (2026-10-26 owner: "the composition can contain the abstract
// classes, the variables, the instances, and how to make changes such that it aligns to a standard … the dev desk makes
// changes to itself from within and updates the documentation for long term"). One catalogue, read three ways: the
// stream carries it (team-core's snapshot `kernel.classes`) so /compose draws each class beside its live instances;
// `bun scripts/composition.js` writes docs/composition.md from it (and `--check` fails when that file is stale or a
// class strays from the standard); an agent reads that file before it changes the kernel.
//
//   kernelClasses() → {bases, kinds, tools, standard}
//     bases  [{name, file, abstract, extends, says, variables: [{name, where, key?, says}], hooks: [{name, says}],
//              change: [step], tests, docs}]                      hand-written: what a base is and how to change it
//     kinds  [{name, extends, file, type, kind, view, keep, poll, says, options, commandType, commands: [{name, usage,
//              says}], owner: [method], hooks: [hook], state: [key], problems: [text]}]   read from each class (its
//              statics and a bare instance), so it never drifts from the code
//     tools  [{name, type, view, outside, says}]               the kit's tools (BUILTIN.tools)
//     standard [{rule, says}]                                 what conformance checks
//   conformance(kind) → problems: what a kind lacks against the standard (empty: aligned)
//
// Names are written here, never read from `constructor.name`: a production bundle renames classes.
// A new base or artifact class is added to BASES / KINDS below (test/classes.test.js fails until a kit type is), its
// variables beside it (the same test reads agent.js: every config.<key> the loop reads must be listed under Agent).

const v = (name, where, says, key) => ({ name, where, says, ...(key ? { key } : {}) })
const h = (name, says) => ({ name, says })

// Where a variable is set: "file" the agent's .md frontmatter (key), "config" new Agent(config) (key: its frontmatter
// name when it has one), "static" on the class, "field" set in the constructor, "main" main.js.
export const BASES = [
  {
    name: "Desk", file: "backend/kernel/desk/desk.js", abstract: false, extends: null,
    says: "The team: agents built from nested specs (buildDesk), a board per team, spawn and dismiss at run time; twin() is every element as plain JSON.",
    variables: [
      v("name", "main", "the desk's name (its folder)"), v("title / description", "main", "what the header and cards say"),
      v("lead", "field", "the top agent (the one non-reserved <lead>/<lead>.md folder)"),
      v("ctx", "field", "the build context kept for spawn: env.tools, env.artifacts, env.templates, env.models"),
      v("builtin", "main", "options for kit artifacts: builtin.dev {project, checks, preview}, builtin.surgeon {folder}"),
      v("projects / browser / terminal / mcp / sanitize / telegram / listen", "main", "host capabilities the desk asks for (companion/team/desk.js)"),
    ],
    hooks: [
      h("start({port, live, log, memory})", "→ {desk, ready?, run?}: builds the agents (conventionDesk does it from the folders)"),
      h("run({wake, busy, log})", "background watchers on a continuous server"),
      h("host({call, env, state})", "→ {wrap?, guard?, servers?}: shapes mcp/call"),
    ],
    change: [
      "A desk is configuration: custom/<desk>/main.js = `export default conventionDesk({title, description, …})`, agents as folders <lead>/<lead>.md (members as subfolders), tools/<name>.js, teams/<team>/<team>.md, phases/<flow>.md.",
      "Check it before loading: `bun scripts/desk.js check custom/<desk>` (unknown keys, tools, models, artifacts fail naming the file).",
      "Reload without a restart: POST /__askk/desks/load {name} (409 while it works). A change under backend/kernel, companion or custom/shared needs the server restarted (dev.restart: supervised, rolls back when it breaks).",
      "Kernel behaviour for every desk changes in desk.js only; a desk never patches the kernel.",
    ],
    tests: "backend/kernel/test/kernel.test.js, team.test.js, spawn.test.js; companion/team/compose.test.js", docs: "docs/standard.md, docs/architecture.md",
  },
  {
    name: "Agent", file: "backend/kernel/agent/agent.js", abstract: false, extends: null,
    says: "One ReAct loop: render → infer → parse → answer or run the step's calls together. Every agent is this class; what differs is what fills its slots.",
    variables: [
      v("name", "config", "unique in the desk; names its folder, history.md and quests", "name"),
      v("description", "config", "one line: its card, its line in a lead's TOOLS", "description"),
      v("role", "config", "what it is for and how it works (the .md body) — never what a tool, artifact or the response format already says", "(body)"),
      v("soul", "config", "the desk's shared opening, first in every prompt: <desk>/soul.md, else desks/soul.md (compose.js readSoul)", "(soul.md)"),
      v("soulFile", "config", "the file the soul was read from, shown on the agent page"),
      v("model", "config", "a desk model name; default the desk's", "model"),
      v("maxSteps", "config", "steps before the run ends (default 12)", "max_steps"),
      v("minCalls", "config", "tool calls before an answer is taken (a gate)", "min_calls"),
      v("gateRetries", "config", "soft refusals before the answer goes through flagged (default 2)"),
      v("contextChars", "config", "prompt budget in chars, else contextBudget(model); compaction at 0.9 of it", "context_chars"),
      v("refreshMs", "config", "an artifact's refresh longer than this is a failed refresh (15 s)"),
      v("router", "config", "a step router {decide, act}: predicts each step's calls before the model call; shadow unless act (docs/jepa-router.md)"),
      v("historyKeep", "config", "earlier runs shown under # EARLIER RUNS (default 3)"),
      v("report", "config", "true: the answer carries the report format"),
      v("system", "config", "replaces # RESPONSE entirely (rare)"),
      v("team", "config", "the team it belongs to (its lead's board)", "team"),
      v("folder", "config", "where its .md, history.md and practice live", "folder"),
      v("spawned", "config", "{by, goal, at, keep, team} for a helper made at run time, else absent"),
      v("writes / reads", "file", "lane globs files and terminal honour (no writes: refused)", "writes / reads"),
      v("board", "file", "false keeps it off its team's board", "board"),
      v("tools / artifacts / agents / desks", "file", "what it holds, by name (resolved at compose time)", "tools / artifacts / agents / desks"),
    ],
    hooks: [
      h("on(event, fn)", "start | think | step | call | result | gate | format | guide | answer | error | chat | compact | refresh | inbox"),
      h("ask(request, {from})", "a run (queued behind the one in progress)"), h("guide(text)", "a note for the next step"),
      h("chat(text)", "one model call beside the runs"), h("stop(reason)", "every run and chat ends"), h("addArtifact / removeArtifact", "hold or drop an artifact"),
    ],
    change: [
      "One agent's behaviour = its file: edit <desk>/<lead>/…/<name>/<name>.md (the frontmatter keys above, the body its role). Never subclass Agent for one agent.",
      "Every agent's behaviour = agent.js. A new config key: read it in agent.js, list it here under Agent (test/classes.test.js fails otherwise), map its frontmatter key in companion/team/compose.js KEYS, write it in docs/standard.md.",
      "A new prompt section keeps the order soul → YOU ARE → TOOLS → artifacts → REQUEST → EARLIER RUNS → WORK DONE → RESPONSE (the stable start first); update backend/kernel/README.md (d) and test/prompt.test.js.",
      "A new event: emit it in agent.js, give it a row in backend/live/team-rows.js and a look in backend/live/visual.js in the same change (the twin rule).",
    ],
    tests: "backend/kernel/test/agent.test.js, prompt.test.js, compact.test.js, chat.test.js", docs: "backend/kernel/README.md, docs/soul-and-role.md",
  },
  {
    name: "Tool", file: "backend/kernel/tool/tool.js", abstract: false, extends: null,
    says: "Anything an agent calls, in one TOOLS list: a function, an MCP tool, an artifact command, another agent (AgentTool).",
    variables: [
      v("name", "field", "TOOL_NAME: lowercase, dot-separated (<id>.<command> for an artifact's)"),
      v("description", "field", "what it does and when to use it — shown in TOOLS"),
      v("input", "field", "{field: \"what it means\"}"),
      v("type", "field", "function (the same call within 3 min answers from the first) | dev | artifact | agent | spawn | desk | mcp"),
      v("view", "field", "how the Live feed draws a call (web, terminal, quest, checklist …)"),
      v("outside", "field", "true: its results are text this desk did not write (provenance holds what the run learns)"),
    ],
    hooks: [h("run(input, ctx)", "ctx = {...agent.context, agent, signal, outside}; reach the host only through ctx.host"), h("spec()", "its definition for the UI")],
    change: [
      "A desk's own tool: custom/<desk>/tools/<name>.js `export default defineTool({name, description, input, run, view?, type?, outside?})`, or the agent's tools.js; `bun scripts/tool.js check <file>`.",
      "A kit tool: a factory in backend/kernel/builtin/<file>.js registered in BUILTIN.tools (builtin/index.js); it shows in this catalogue's tools by itself.",
      "A tool that reads the world sets outside: true; one that changes the world is type dev (never answered from the cache).",
      "Its calls need a look: backend/live/visual.js callLook by view.",
    ],
    tests: "backend/kernel/test/kernel.test.js, builtin-web.test.js; scripts/tool.js check", docs: "docs/standard.md",
  },
  {
    name: "AgentTool", file: "backend/kernel/tool/tool.js", abstract: false, extends: "Tool",
    says: "Another agent as a tool: the call is a quest {requirement, ask, outcome} (QUEST_INPUT), the result its report.",
    variables: [v("agent", "field", "the agent it quests"), v("after", "field", "agents that must have answered this run first")],
    hooks: [],
    change: ["Never built by hand: a spec's members become AgentTools in buildDesk; agent.spawn adds one for each helper."],
    tests: "backend/kernel/test/team.test.js", docs: "backend/kernel/README.md",
  },
  {
    name: "Artifact", file: "backend/kernel/artifact/artifact.js", abstract: true, extends: null,
    says: "State an agent keeps beside its conversation: its latest state in every prompt, commands that change it, a view that draws it, owner calls the UI makes.",
    variables: [
      v("about", "static", "one line: what it is for (this catalogue, docs/composition.md)"),
      v("commands", "static", "{name: {description, input, run?, type?, view?, outside?, usage?}} → the holder's tools <id>.<name>"),
      v("commandType", "static", "\"dev\" (changes the world) or \"artifact\" (only itself)"),
      v("owner / ownerCan", "static", "{method: name | fn}: the owner's calls (team call target artifact); ownerCan the refusal's words"),
      v("options", "static", "what main.js builtin.<type> may set, when it takes any"),
      v("name (id)", "field", "lowercase, dot-separated; names its commands"),
      v("kind", "field", "what it is (maps a live instance to its class)"),
      v("view", "field", "how its twin draws (components/views/artifact.jsx VIEWS)"),
      v("keep", "field", "day | always | run | file: what is restored at start"),
      v("poll", "field", "ms: the host refreshes it that often while a tab watches"),
      v("state", "field", "plain JSON; change it with bump(patch), or set it and changed()"),
    ],
    hooks: [
      h("render()", "its block in the prompt (its head line says how to use it)"), h("brief()", "its state in one line (cards, status)"),
      h("refresh(agent)", "async, before each step: reads host state; changed() only when the twin differs"),
      h("gate(agent, answer)", "a reason (or {reason, hard}) to refuse the answer"), h("attach / detach(agent)", "a holder added / dismissed"),
      h("onRunStart(agent, request)", "a holder's run starts"), h("images(agent)", "screenshots for the next model call"),
      h("snapshot / restore", "what keep saves"), h("twinState()", "what its twin shows"),
    ],
    change: [
      "New kit artifact: backend/kernel/builtin/<type>.js `class X extends Artifact` with `static about`, `static commands` (every entry a description and an input), `static owner` when the owner acts; kind, view, keep (and poll) set in the constructor; state changed only through bump().",
      "Register it: BUILTIN.artifacts in builtin/index.js (perDesk), KINDS in backend/kernel/classes.js, its export in backend/kernel/index.js.",
      "Its twin in the same change: a renderer for its view in components/views/artifact.jsx VIEWS (pure logic in backend/live/<type>.js), a call look in backend/live/visual.js.",
      "Its test: backend/kernel/test/builtin-<type>.test.js over test/fake-host.js.",
      "Docs: its entry in backend/kernel/README.md and CLAUDE.md, then `bun scripts/composition.js` rewrites docs/composition.md; `bun scripts/composition.js --check` must pass.",
      "Changing one: edit its statics (the command table), never a role's prose to work around it; keep its twin's state shape, or change its view with it.",
    ],
    tests: "backend/kernel/test/builtin.test.js, hold.test.js, twin.test.js, classes.test.js", docs: "backend/kernel/README.md, docs/composition.md",
  },
  {
    name: "Checklist", file: "backend/kernel/artifact/checklist.js", abstract: false, extends: "Artifact",
    says: "Items an agent ticks with evidence; required (\"!\") items gate the answer while open.",
    variables: [v("items", "field", "[{id, text, required, status, note}]")],
    hooks: [h("requiredWhen(id)", "a required item that may be skipped when it does not apply now")],
    change: ["Extend it (as Plan does) rather than writing a second checklist; its gate stays in gate()."],
    tests: "backend/kernel/test/plan.test.js", docs: "backend/kernel/README.md",
  },
]

// Every artifact class in the kernel: [name, class, file, kit type (BUILTIN.artifacts) or null].
const KINDS = [
  ["SharedBoard", SharedBoard, "artifact/board.js", null], ["Checklist", Checklist, "artifact/checklist.js", null],
  ["QualityMatrix", QualityMatrix, "artifact/quality.js", null], ["Schedule", Schedule, "artifact/schedule.js", null],
  ["Runners", Runners, "builtin/runners.js", null], ["StepContract", StepContract, "builtin/workflow.js", null],
  ["Files", Files, "builtin/files.js", "files"], ["Terminal", Terminal, "builtin/terminal.js", "terminal"],
  ["Preview", Preview, "builtin/preview.js", "preview"], ["Plan", Plan, "builtin/plan.js", "plan"],
  ["Dispatch", Dispatch, "builtin/dispatch.js", "dispatch"], ["Browse", Browse, "builtin/browse.js", "browse"],
  ["Talk", Talk, "builtin/talk.js", "talk"], ["Goal", Goal, "builtin/goal.js", "goal"], ["Dev", Dev, "builtin/dev.js", "dev"], ["Ask", Ask, "builtin/ask.js", "ask"],
  ["Studio", Studio, "builtin/studio.js", "studio"], ["Surgeon", Surgeon, "builtin/surgeon.js", "surgeon"],
  ["Audio", Audio, "builtin/audio.js", "audio"], ["Workflow", Workflow, "builtin/workflow.js", "workflow"],
  ["Practice", Practice, "builtin/practice.js", "practice"],
]
const PARENTS = [[Plan, "Plan"], [Checklist, "Checklist"], [Artifact, "Artifact"]]
const HOOKS = ["render", "brief", "refresh", "gate", "attach", "detach", "onRunStart", "images", "snapshot", "restore", "twinState"]

// A bare instance for its constructor's defaults (kind, view, keep, poll, state keys); a kit type through its factory.
function bare(C, type) {
  try {
    if (type) return BUILTIN.artifacts[type]({})({ name: "probe", tools: new Map() }, {})
    return new C({ name: "probe", id: "probe", step: { id: "probe" }, check: () => ({ problems: [] }) }) // StepContract takes a step
  } catch {
    return null
  }
}

const text = (x) => (typeof x === "string" ? x : "")
const ownHooks = (C) => HOOKS.filter((name) => {
  for (let p = C.prototype; p && p !== Artifact.prototype; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, name)) return true
  return false
})

export const STANDARD = [
  { rule: "about", says: "the class says what it is for in one line: `static about`" },
  { rule: "commands", says: "every command has a description and an input (`static commands`, never a hand-written commands())" },
  { rule: "kind", says: "a bare instance names its kind, view and keep" },
  { rule: "registered", says: "a kit artifact is in BUILTIN.artifacts and in classes.js KINDS" },
  { rule: "twin", says: "its view has a renderer in components/views/artifact.jsx (checked by scripts/composition.js)" },
  { rule: "tested", says: "a kit artifact has backend/kernel/test/builtin-<type>.test.js (checked by scripts/composition.js)" },
  { rule: "documented", says: "backend/kernel/README.md names it and docs/composition.md is current (checked by scripts/composition.js)" },
]

export function conformance(k) {
  const problems = []
  if (!k.says) problems.push("no static about")
  for (const c of k.commands) if (!c.says || !c.hasInput) problems.push(`command ${c.name}: needs a description and an input`)
  if (!k.kind) problems.push("a bare instance could not be made (kind, view and keep unknown)")
  if (k.handWritten) problems.push("commands() written by hand: declare static commands")
  return problems
}

function kindOf([name, C, file, type]) {
  const a = bare(C, type)
  const parent = PARENTS.find(([P]) => C !== P && C.prototype instanceof P)?.[1] ?? null
  const describe = (d) => text(typeof d === "function" ? (a ? d.call(a) : "") : d)
  const commands = Object.entries(C.commands ?? {}).map(([cmd, c]) => ({ name: cmd, usage: c.usage ?? null, says: describe(c.description), hasInput: c.input != null }))
  const k = {
    name, extends: parent, file: `backend/kernel/${file}`, type, says: text(C.about), options: C.options ?? null,
    kind: a?.kind ?? null, view: a?.view ?? null, keep: a?.keep ?? null, poll: a?.poll ?? null,
    commandType: C.commandType, commands, owner: Object.keys(C.owner ?? {}), hooks: ownHooks(C),
    state: a?.state && typeof a.state === "object" ? Object.keys(a.state) : [],
    handWritten: Object.hasOwn(C.prototype, "commands"),
  }
  k.problems = conformance(k)
  for (const c of k.commands) delete c.hasInput
  delete k.handWritten
  return k
}

function toolOf([name, make]) {
  try {
    const t = make({})
    return { name, type: t.type, view: t.view ?? null, outside: !!t.spec?.().outside, says: text(t.description).split("\n")[0].slice(0, 240) }
  } catch {
    return { name, type: null, view: null, outside: false, says: "" }
  }
}

let cached = null
export function kernelClasses() {
  cached ??= {
    bases: BASES,
    kinds: KINDS.map(kindOf),
    tools: Object.entries(BUILTIN.tools).map(toolOf).sort((a, b) => a.name.localeCompare(b.name)),
    standard: STANDARD,
  }
  return cached
}

// The kit types KINDS lists (a test checks it against BUILTIN.artifacts).
export const KIND_TYPES = KINDS.map(([, , , type]) => type).filter(Boolean)
