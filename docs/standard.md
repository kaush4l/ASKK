# The desk standard

How to compose a desk from files — agents as folders, tools as files, desks inside desks — and load it into the
running server. Written for whoever builds the next desk: a developer, or a desk whose agents write code. The core
is `backend/kernel/` (map and lifecycle: `backend/kernel/README.md`); the composer is `companion/team/compose.js`;
the worked example is `companion/team/fixtures/sample-desk/` (it mounts `companion/team/fixtures/mini-desk/`).

## Elements

Five elements. Each describes itself as plain JSON for its UI twin; `companion/team/kernel-team.js` streams it
(`GET /__askk/team/stream`), `backend/live/registry.js` feeds the stores, a component draws it. Lifecycle moments
are the rows of the table in `backend/kernel/README.md` (b), named here, not repeated.

| Element | File form | Built by | Lifecycle moments (README (b)) |
| --- | --- | --- | --- |
| Agent | `<lead>/<lead>.md` (+ members as subfolders, `<lead>/<member>/<member>.md`): YAML frontmatter + the role as body; `history.md` beside it (its runs) | `compose.js` `readAgentFolder` → `composeDesk` (a spec) → `backend/kernel/desk/desk.js` `buildAgent` → `Agent` | Agent init, History restore, Run start, Step, Call / result, Gate / format, Guidance, Owner chat, Answer, Error / stop, Agent memory; a team template (`teams/<team>/<team>.md`, below): Kit bound, Spawn, Dismiss |
| Tool | `tools/<name>.js` (the desk's) or `<agent>/tools.js` (one agent's): `export default defineTool({...})` (or an array of them) | `compose.js` `loadTools` / `loadToolFile` (checked by `defineTool`, `backend/kernel/tool/tool.js`) → by name in `tools:` (an agent's tools.js: attached to it) → kernel `makeTool` | Tool init, Call / result |
| Artifact | a type in the catalogue: the kernel's kit by name (`artifacts: [files, terminal, preview, plan, dispatch]`, below), built-ins by .md key (`checklist:`, `artifacts: [report]`), the team board automatic, a desk's own class (extends `Artifact`, `backend/kernel/artifact/artifact.js`) via `conventionDesk({artifacts})` | kernel `resolveArtifact` → `Agent.addArtifact` (its `commands()` become the agent's tools, type `artifact`) | Agent init (`attach`), Run start (`onRunStart`), Artifact restore (`keep`), Artifact saved |
| Desk | `custom/<desk>/` with `main.js` (below) | `companion/team/desk.js` `loadDesk` → main.js `start` → `composeDesk` → kernel `buildDesk` → `Desk` | Host start, Desk load, Desk setup, Desk build, Twins out, Desk terminate; `POST /__askk/desks/load` (below) |
| Call | none: a `call:` block in a reply (`backend/kernel/agent/reply.js`); a call to an agent is a quest `{requirement, ask, outcome}` | `Agent.#call` → `Tool.run(input, ctx)` (`backend/kernel/agent/agent.js`) | Call / result, Gate / format |

| Element | `twin()` fields | UI twin (store → component) | Events |
| --- | --- | --- | --- |
| Agent | `element, id, name, description, role, model, team, folder, desk, tools[], agents[], artifacts[], status` | `backend/live/agent.js` `AgentView` → `components/agents/agent-page.jsx` (`/agents?name=`), `components/canvas/agent-node.jsx` (`/canvas`), `components/home/constellation.jsx`, `components/kernel/desk-levels.jsx`, `components/shell/status-bar.jsx` | `start, think, step, call, result, gate, format, guide, answer, error, chat` (`Agent.on`) → `state {id, patch}` (a `chat`: two thread rows `kind: chat`, never a run) |
| Tool | `element, id, name, type, view, description, input` (+ `agent` for an agent as a tool) | the tool list on `components/agents/agent-page.jsx`; each call by its `view`: `backend/live/follow.js` → `components/live/feed/feed-row.jsx`, `components/live/views/call-panel.jsx` | none of its own: its calls are the agent's `call` / `result` |
| Artifact | `element, id, kind, view, owner, title, keep, brief, state` (+ `items` for view `list`) + `holders` (`Desk.artifacts()`) | `backend/live/desk.js` → `components/views/artifact.jsx` `ArtifactBlock` (one renderer per view), `components/live/artifacts-view.jsx`, `components/kernel/desk-levels.jsx` (2026-10-17: each agent's held artifacts as small live tiles on its home card, `heldTiles`; a click opens the whole view big — a dialog, a bottom sheet on a phone), `components/canvas/artifact-node.jsx`; the preview also `components/live/workbench/preview-pane.jsx` (the one preview pane: the Live workbench's Preview tab and the preview opened big) | `onChange` → `kernel {artifact, boards?}` |
| Desk | `element, lead, tree, agents[], artifacts{id: twin + holders}`; tree nodes `name, team, title, goal, model, desk, description, tools, agents` | `backend/live/team-tree.js`, `backend/live/desk.js` → `components/home/constellation.jsx`, `components/kernel/desk-levels.jsx`, `components/canvas/canvas-page.jsx` (a mounted desk: `components/canvas/desk-frame.jsx`) | `Desk.on(fn)`: every agent's events with its `team` path; the desk log `log {at, source, text}` (`backend/live/log.js` → `components/live/desk-log.jsx`) |
| Call | no `twin()`: its events are its twin — `call {agent, tool, input}`, `result {agent, tool, ok, output}`; on the stream a message `{role: tool, name, kind, view, inputs, ok, output}` | `backend/live/follow.js` → `components/live/feed/feed-row.jsx`; `components/agents/thread.jsx`; `components/canvas/call-chip.jsx` | `call`, `result` (a refused answer: `gate`, `format`) |

## Composition rules

1. **One desk = one folder**: `custom/<desk>/` with a `main.js` (your desks, git-ignored), or `desks/<desk>/` (the core
   desks ASKK ships: `desks/agent`, hosted beside yours; a local desk of the same name wins); its name is the folder
   name (`^[a-z][a-z0-9-]*$`).
2. **Agents nest by folder** (2026-10-21 owner: "create agent will follow the standard of `<desk>/<agent>/<agent>.md` for
   configurations and tools.js"): the desk folder holds exactly one lead folder, `<lead>/<lead>.md`; a member is a
   subfolder of its lead, `<lead>/<member>/<member>.md`, named in the lead's `agents:`, to any depth. An agent is named
   after its folder (`name:` may be left out; another name is an Error), and never `history` or `practice` (those files
   sit beside its .md). The lead is found as the one folder with its `<name>.md` (an `agent.md` there is read too, for
   migration), the desk's own folders aside (`data`, `state`, `tools`, `teams`, `proposed`, `vendor`, `node_modules`,
   `tests`, `lib`, `docs`, `memory`, `history`, `artifacts`, `agents` and dot folders); none or several is an Error that
   lists them (`companion/team/layout.js` `deskLead`). **Legacy**: a desk whose `agents/` holds an agent folder
   (`agents/<lead>/agent.md`, members' `agent.md`: every desk made before 2026-10-21) composes unchanged.
3. **A tool is a file**: `tools/<name>.js` default-exports `defineTool(...)` (or an array); helpers live in a
   subfolder (`custom/<desk>/tools/<sub>/`); `*.test.js` is skipped. `tools/` and every `tools/*.js` are real paths
   inside the desk, never links (refused at compose time). An agent lists tools by name; a name resolves against the desk's
   own `custom/<desk>/tools/` first, then the host's catalogue (`composeDesk({tools})`), then the kernel's inbuilt kit
   (Attach by name, below). An agent's own `<agent>/tools.js` (the same format) is attached to that agent whatever its
   `tools:` lists (a name listed there too is held once); other agents never get it by name.
4. **A desk mounts another with `desks:`**: `desks: [<other>]` in an agent's .md puts `custom/<other>/`'s lead
   under that agent. Its tree node says `desk: "<other>"`. The mounted desk composes with its own `main.js` options
   (`conventionDesk`'s `compose`: models, fallbacks, step limit, artifact types, tool catalogue; without them, the
   kernel's step limit) and its own `custom/<other>/tools/`; its
   agents' `ctx.desk` is `"<other>"` and `ctx.memory` is `memory/<other>/`. It runs in the parent's process
   and workspace: `ctx.host` and `ctx.log` stay the parent's (the host API as the parent desk, the parent's
   `custom/<desk>/data/`, the parent's desk log). A mounted desk is a real folder beside this one (never a link), no cycles, and it
   also composes alone.
5. **Names are unique across a composed desk**, mounted desks included: agent names (the kernel refuses a second
   one), tool names within a desk's `tools/` and its agents' `tools.js` (a name defined twice is an Error naming both
   files).
6. **Tools reach the host only through `ctx.host`** (`hostClient`: the host API as this desk) — no hand-made fetch
   to `/__askk/`, no globals. The endpoints: `companion/server/host-api.js` (fs, web, mcp, apple, speech, team).
7. **Artifacts come from a type catalogue.** The kernel's kit (`files`, `terminal`, `preview`, `plan`, `dispatch`: Attach by name,
   below); built-ins: `checklist` (`checklist:` → `<agent>.checklist`, keep `run`, gates the answer), `report`
   (`artifacts: [report]` → `<agent>.report`, keep `always`, `<agent>.report.write {title, text}` also saves
   `memory/reports/<YYYY-MM-DD>-<slug>.md`), and the team board (automatic: `<team>.board`; `board: false` keeps an
   agent off it). A desk's own: `conventionDesk({artifacts: {type: (agent, spec) => Artifact}})` — a type named like a
   kit type replaces it.
8. **Every new kernel field or event gets its view in the same change** (`docs/philosophy.md`).
9. **Mistakes fail at compose time, not at the first call**: an unknown frontmatter key, model, tool name or artifact
   type, a bad tool file, a missing or cyclic desk — each an Error naming the file and listing what exists.
10. **Desk code is trusted code**: a desk's main.js, agents and tools loaded by `desks/load` run as the host — in its
   process, with its environment and its host API; a tool run by `bun scripts/tool.js run` runs in its own process
   with the caller's environment (the dev desk's `tool.run`: a sandboxed subprocess given only PATH, HOME, TMPDIR,
   LANG and NO_COLOR) and the desk server's host API as its `ctx.host`. The dev desk
   loads only its own projects (`custom/<slug>/` with its project marker) and only after `desk.check` passes;
   its agents' terminals are sandboxed and cannot reach the host API (the server's port is denied to them).
   **The trust boundary**: code an agent writes under `desks/**` runs as the desk server once `tool.run` or
   `desk.load` runs it — `tool.run` in a subprocess whose `ctx.host` is the desk server's host API by design (any
   desk's files, MCP tools and models through it), `desk.load` in the server's own process (its environment and keys
   included). So the writing agent's file lanes (`writes:`) and its terminal's sandbox do not bound what that code can
   do. What bounds it is the owner: every `tool.run` and `desk.load` call is a tool call like any other — a row in the
   Live feed and a call on the canvas, with its input (the file, the slug) and its output — and the owner can stop
   the run.

## Desk folder convention

```
custom/<desk>/             (desks/<desk>/: the core desks ASKK ships)
  main.js                  export default conventionDesk({...})          (below)
  <lead>/<lead>.md         the lead; members as subfolders: <lead>/<member>/<member>.md
  <lead>/tools.js          the lead's own tools (optional; each agent may have one)
  <lead>/practice.md       its practice seed (optional; members' beside theirs)
  <lead>/history.md        its runs (written by the host; local, git-ignored), rotated into <lead>/history/
  <lead>/<helper>/         a kept helper (<helper>.md, keep: desk; written by the host)
  teams/<team>/<team>.md   team templates (optional): never built at start; agent.spawn {template: "<team>"}
  tools/<name>.js          export default defineTool({...})
  data/                    the workspace: the host's fs/* root (made at load when missing)
  state/                   host state: server.json, kernel-team.jsonl, artifacts/, days/, spawned/<name>/
memory/<desk>/             at the repo root (git-ignored, local): the desk's memory and reports (ctx.memory), practice/,
                           retros/, <team>/board.md (each team's board), its loaded projects (projects.json)
```

Legacy (2026-10-21: every desk made before; composed unchanged): `agents/<lead>/agent.md`, members
`agents/<lead>/<member>/agent.md`, templates `teams/<team>/agent.md`, an agent's runs in `transcript.jsonl` (read back, never
written again: its next run starts `history.md`). Move one to the standard with `git mv agents/<lead>/agent.md
<lead>/<lead>.md` (each member likewise) and `mv` its `transcript.jsonl` along; `desks/agent/` was moved so.

The complete `main.js`:

```js
import { conventionDesk } from "../../companion/team/compose.js"

export default conventionDesk({ title: "Research desk", description: "Answers research questions with sources." })
```

Options: `name` (default: the folder), `port` (when it runs alone), `models` (default `MODELS`: opus, sonnet,
haiku through the Claude CLI, called through the host's local models), `defaultModel` (`opus`), `fallbacks`
(`["sonnet"]`: tried in order when a model call fails, each failure a desk log line), `maxSteps`, `artifacts`,
`tools`. The returned config carries them as `compose`, so a desk that mounts this one (and `scripts/desk.js check`)
composes it with them (`readDeskConfig`). A desk that needs more (watchers, `host()` hooks) writes its own `start`
and calls `composeDesk` in it.

### <agent>.md

```
---
name: lead
description: "Leads the desk: splits the request between its members, writes the report."
goal: "Answer the owner's request with evidence."
agents: [alpha, beta]
artifacts: [report]
checklist:
  - "alpha: alpha reported"
---
The role: what this agent is for and how it works (the prompt's # YOU ARE section).
```

| Key | Meaning |
| --- | --- |
| `name` | the agent's name, unique across the composed desk (its artifacts are `<name>.<kind>`) |
| `description` | one line: what it is for (its line in its lead's TOOLS list, its card) |
| `title` | its team board's title (an agent holding agents) |
| `goal` | its team board's goal, shown to every member |
| `team` | its team's name (default: the desk's name for the lead, else the agent's name) |
| `model` | a key of the desk's models (default `defaultModel`) |
| `max_steps` | steps per run (default `maxSteps`, else the kernel's 12) |
| `min_calls` | tool calls a run makes before its answer is taken |
| `writes` | paths it may write (globs under the workspace: `*` within a folder, `**` across, a trailing `/` = all below, `!glob` excludes; `files` and `terminal` enforce it, other tools read `ctx.agent.config.writes`); none = it writes nothing through the kit; whatever the lane, never `.env*`, `.mcp.json` or what git runs as code (a `.git` config or hook, the `.git` entry: 2026-10-17 critic — a `.git/**` lane planted a command a wider lane's `git status` ran) |
| `reads` | when set, the only paths it may read, list or search through `files` (globs, as `writes`): the critic's "outputs only" lane — the rest of the tree never reaches its prompt |
| `board` | `false`: kept off its team's board (it never sees the members' notes); a team lead keeps its own |
| `tools` | tool names: the desk's `custom/<desk>/tools/`, then the host's catalogue |
| `agents` | its members: subfolder names (`<member>/<member>.md`) |
| `desks` | desks mounted under it: desk folder names beside this desk |
| `checklist` | what done means per run, `"id: text"` items (`"!id"` cannot be skipped) → `<name>.checklist` |
| `artifacts` | artifact types it holds, each a name or `{type, id?, commands?, gate?}`: the kit's `files`, `terminal`, `preview`, `plan` (shared per desk; `id`: a separate one; `commands`: a subset, e.g. `[read, wait]`; `gate: true`: its answer waits on the plan), `report`, or the desk's own |
| `after` | sibling agents whose reports it works from (they are called first) |

The body is the role. `{{key}}` in the role, description, goal, title and artifacts takes `composeDesk({vars})`. `name`
may be left out of a `<name>.md`: it is the folder's.

### history.md and the boards: memory that survives restarts

2026-10-21 owner ("In order to survive restarts, the memory was to store in md file the history of that agent … For a
shared history board for agents, a memory/<desk>/<sub desk>. Even the memory will be local."):

- **An agent's runs: `history.md` beside its .md** (`companion/team/kernel-history.js`). One section per finished run,
  written by the host: `## <YYYY-MM-DD HH:MM ET> · <from> · answered | error`, the request and the answer (clipped, as
  blockquotes), its steps (`- 1. <thought> → tool, tool`), then the run as recorded (every step's calls with their inputs,
  results, arrival order, refused answers, guidance, times) in a fenced json block on one line — what the next start reads
  back as the agent's EARLIER RUNS and its thread. Past 512 KB it moves to `history/history-<time>.md` (the newest 6
  kept). A spawned helper's is `state/spawned/<name>/history.md`; a kept helper's beside its `<name>.md`. A legacy
  `transcript.jsonl` (and `history/transcript-*.jsonl`) is read after the history files, never written.
- **A team's board: `memory/<desk>/<team>/board.md`** (`companion/shared/paths.js` `boardFile`, `companion/team/board-file.js`;
  the sub desk is the team). Written on every change — the goal and each entry (key, author, time, text) as markdown, the
  board's state in a json block — and restored at every start, whatever the day (a board saved before it: once from its
  `state/artifacts/<id>.json`). A mounted desk's teams under its own `memory/<mounted desk>/`. Boards are no longer
  written to `state/artifacts/`.
- Both are local: `history.md` and `history/` are git-ignored under `desks/` (and `custom/` is local whole), `memory/` is
  git-ignored.

### teams/: team templates

2026-10-17 owner ("let the lead, when required, be able to create a sub team to focus on special critical observation
and in control on a layer"): a desk may keep teams it does not run at start. `teams/<team>/<team>.md` (or `agent.md`) is a
team's lead, its members subfolders named in its `agents:` — the format and keys above, the folder's name as `name`; no
`tools.js` (a spawned team's tools come from the desk's catalogue by name). An
agent holding `agent.spawn` staffs one at run time: `agent.spawn {template: "<team>", goal, keep: desk}` builds the
lead and its members (named `<team>-<member>`, e.g. `probe-watcher`) on their own board `<team>.board` under the
spawner's, and the spawner quests (or dispatches) the lead like its other agents; `agent.dismiss {name: "<team>"}`
removes the team whole. The spawn input's own fields win over the template's. A template's `description` is each
agent's card and its line in its lead's TOOLS, its `title` the board's (none: the role's first line that is not a
section header such as SPEC); every agent holds only what its own .md (or the input) lists. A team name whose
`<team>.board` the desk already has (the desk's own team, a team spawned earlier) is refused: "<team>.board exists:
pick another team name".

```
custom/<desk>/teams/probe/probe.md                 name: probe · writes: ["shared/*/probe/**"] · agents: [watcher, gauge]
custom/<desk>/teams/probe/watcher/watcher.md       writes: ["shared/*/probe/watch.md"]
custom/<desk>/teams/probe/gauge/gauge.md           reads: [...] · board: false
```

- **Checked at compose time like an agent** (`compose.js` `readTemplates` → `templateOf`): an unknown key, tool,
  artifact type or command, or model is an Error naming the template's file; `desks`, `checklist`, `min_calls`,
  `after` and `team` are refused (a spawned team mounts no desk, plans on the desk's `plan`, is named after its lead);
  a member's `goal` is refused (the goal is the team's); `max_steps` 1–300; every name (`<team>-<member>` too) passes
  `SPAWN_NAME`. A folder in `teams/` without its `<team>.md` (or `agent.md`), or with a `tools.js`, is an Error.
- **Handed to the kernel, never built**: `composeDesk` passes `buildDesk` `env.templates` (`{<team>: {name, role, goal,
  tools, artifacts, writes, reads, model, max_steps, board, members: [same]}}`) and `env.models` (the model names a
  spawn may ask for). The start-up tree is only the lead's folder.
- **Bounded by the spawner, at spawn time**: tools are the spawner's own or the desk's catalogue (never its agents or
  an artifact's commands), artifacts the ids it holds or catalogue types within its commands subset, and `writes:` /
  `reads:` must each be covered by one of the spawner's globs (`globCovers`: `projects/**` covers
  `projects/*/eval/**` but not the bare folder `projects`, `shared/*/notes.md` does not cover `shared/**`) — else
  "outside your lane"; the spawner's `!`
  exclusions are appended. Write a template's lanes as narrow as its station needs, inside its spawner's.
- `bun scripts/desk.js check custom/<desk>` prints `templates` (each with its members as `agent.spawn` names them);
  a bad template fails the check. Example: `companion/team/fixtures/kit-desk/teams/probe/` (tested in
  `companion/team/compose.test.js`).

### Attach by name: the inbuilt kit

`backend/kernel/builtin/index.js` (`BUILTIN`, `builtinKit`) is a catalogue every composed desk gets under its own
tools and artifact types (the desk wins a name clash): an agent's .md lists them by name, nothing to write. They reach
the machine through `ctx.host` only (fs/*, term/*, browser/*, web/* in `companion/server/host-api.js`). The artifacts
are shared per desk — every agent that lists `files` holds the same one (id `files`; commands `files.*`) — and
`{type, id: notes}` makes another (commands `notes.*`). `composeDesk` binds the kit once for the whole composed desk
(mounted desks share it: one process, host and workspace) and hands it to `buildDesk`, so `agent.spawn` resolves
these names at run time too. Example: `companion/team/fixtures/kit-desk/`.

```
artifacts: [files, terminal, preview, {type: plan, gate: true}]
tools: [web.search, agent.spawn]
writes: ["projects/**"]                 # files.write / edit / append and the terminal's sandbox write only here
reads: ["shared/*/goal.md", "projects/*/out/**"]   # set: files reads, lists and searches only here
board: false
```

| Name | Kind | Commands / input | Prompt (`render`) | Twin `state` (what the UI draws) |
| --- | --- | --- | --- | --- |
| `files` | artifact, view `files`, keep `always` | `files.list {path}`, `files.read {path, from?, lines?}` (marks open), `files.write {path, content}`, `files.edit {path, old, new, all?}`, `files.append {path, text}`, `files.search {text, path?}`, `files.focus {path}` (tree root) | root + tree (≤ 60 lines, 3 levels) + open + last 8 modified (path, by, +/-), only what the holder may read | `{root, tree: [{path, size, mtime, dir}] ≤ 800, truncated, open: [{path, by, at}] ≤ 12, modified: [{path, by, at, op, added, removed, diff ≤ 80 lines}] ≤ 30, focus: {path, by, at} \| null}` |
| `terminal` | artifact, view `terminal`, keep `file` | two sessions per holder: `terminal.run {command, cwd?, timeout?}` (in its main session, one at a time, to its exit), `terminal.start {command, cwd?, name?}` (in its long session, kept running; the next start replaces it), `terminal.wait {id, seconds, until?}` (until: literal text from a line it prints, e.g. `"val_bpb:"`, or a list where any one is enough — never a regex), `terminal.read {id, lines?}` (its scrollback), `terminal.send {id, text}`, `terminal.stop {id}`, `terminal.list` (id: a session id, `main` / `long`, `<agent>:main`); `run` / `start` take `lease: "gpu"` (2026-10-17: one GPU, one run at a time — a second running session of the desk with the same lease is refused, the reason names the holder and says to `terminal.wait` it) | every running session: header (`[gpu]` when leased) + last 50 lines; finished ones: one line (exit, time) | `{sessions: [{id, name, command, cwd, agent, slot, lease, runs, status, exit, startedAt, endedAt, urls, tail ≤ 50}] ≤ 12}` newest first |
| `preview` | artifact, view `preview`, keep `always` (2026-10-17 owner: "There will be need for only one preview pane" — the one pane the owner and the agents both watch; the stage folded in) | LIVE, the pages: `preview.open {url}` (also puts it in the pane; a `#view` in the URL is its view), `preview.goto {url}`, `preview.click {selector \| x, y}`, `preview.type {text, selector?}`, `preview.press {key}`, `preview.scroll {dy}`, `preview.text`, `preview.eval {expression}`, `preview.console`, `preview.shot`, `preview.close` (the page: the newest open one unless `id`). EXPLAIN, the visuals: `preview.show {id, title, says?, visual}` (draw or redraw — the same id — and put it in the pane; `visual`: a spec `{kind: flow \| steps \| matrix \| line \| bars \| tokens \| scatter \| compare, …}` checked by `backend/kernel/builtin/visual.js`, `{file: "<workspace>.json"}` re-read at most every 3 s while held (only in the holder's `reads:`) or `{terminal: "<session>"}`; 2026-10-18: no `{chart}` — a live dashboard is a page, which the owner's UI enlarges to the whole screen), `preview.focus {id, view?}`, `preview.drop {id}`. ASKED: the owner's question on what is in the pane (team call target `artifact`, `ownerCall("ask")`) goes to the keeper — the first holder of `preview.answer` — as guidance while it runs, else a run; it answers with `preview.answer {ask, text, show?}` (show: the page or visual that answers, put in the pane), and its own answer waits while a question is open | open pages (url, title, console errors, the last text outline), each visual in one line, what is in the pane, the open questions in full, the last 3 answered — text only, ≤ 60 lines | `{pages: [{id, url, title, status, by, at, shot: {n, at, width, height, url} \| null, console ≤ 20, errors}] ≤ 12, visuals: [{id, title, says, visual, by, at, error?, read_at?}] ≤ 16, current: {kind: page \| visual, id, view?} \| null, asks: [{id, text, on: {kind, id} \| null, context, from, at, answer: {text, on, by, at} \| null}] ≤ 40, revision}` |
| `plan` | artifact (kernel `Plan`), view `checklist`, keep `always` | `plan.write {goal, items}`, `plan.tick {id, evidence}`, `plan.skip {id, reason}` | goal + items | `{goal, revision, by, at, items: [{id, text, required, status: open \| ticked \| skipped, note, by, at}]}` |
| `dispatch` | artifact (kernel `Dispatch`), view `dispatch`, keep `file` | `dispatch.start {to, requirement, ask, outcome}` (a quest's brief to one of the holder's agents, returned at once; ≤ 6 running), `dispatch.wait {ids?, seconds?}` (until one ends, the time passes, owner guidance arrives or the run stops), `dispatch.read {id}`, `dispatch.stop {id}`, `dispatch.list`; the holder's answer waits while a job runs (a hard gate: never let through after `gateRetries`); when the holder's run ends for any reason (an answer, `maxSteps`, an error, a stop) its running jobs stop; the owner stops one job from its row (Stop) | the holder's own jobs: running ones with their target's status, reports not yet delivered (head 600) | `{jobs: [{id, to, by, ask, status: running \| done \| failed \| stopped, startedAt, endedAt, report ≤ 4000, error}] ≤ 40}` |
| `web.search` | tool, view `web` | `{q, limit?, source?: web \| wikipedia \| arxiv \| hn}` (`query` works too); a 429/5xx from wikipedia/arxiv/hn is retried once on web (a note says so), else the error names what to leave alone for 2 minutes | | |
| `web.read` | tool, view `web` | `{url, find?, max_chars?}` (the passages around `find`, narrowed here) | | |
| `practice` | artifact (kernel `Practice`, 2026-10-20), view `practice`, keep `file`, one per agent (`<agent>.practice`) | `<id>.tick {id, evidence}`, `.skip {id, reason}`, `.edit {section: checklist \| quality \| instructions \| lessons \| tools, old?, new?, why}`, `.reflect {worked, missed, changes}` — the agent's standing orders, improved by its own retro; the answer waits while a run item is open | the run checklist (its Checklist section + `!reflect`), the quality bar, the learned instructions, the newest lessons, the tools wanted | `{file, revision, at, run: [{id, text, required, status, note}], sections: {checklist, quality, instructions, lessons, tools}, changelog ≤ 20, retros ≤ 5, edits}` |
| `agent.catalog` / `agent.update` | tools, view `spawn` (2026-10-20) | `{find?}` → what a helper can be given (the caller's tools and the desk's with what each does, held artifacts with the caller's commands, types, templates, models, lanes) and the helpers now (status, step, keep); `{name, role?, goal?, tools?, artifacts?, writes?, reads?, model?, max_steps?, keep?}` → a helper the caller spawned rebuilt with those fields changed, or kept (`keep: desk`) | | |
| `desk.list` / `desk.create` / `desk.check` / `desk.load` / `desk.ask` / `desk.read` / `desk.propose` | tools, view `desk` (2026-10-20) | a desk written from a spec (below), checked, hosted, given work (`wait: true`: its answer, polled by id), its workspace read; tool code proposed under `proposed/tools/` for the owner | | |
| `agent.spawn` / `agent.dismiss` | tools, view `spawn` | `{name, role, goal, tools?, artifacts?, keep?: run \| desk, members?, template?, writes?, reads?, model?, max_steps?}` / `{name}`: a helper for a stated goal, never more than its caller (`backend/kernel/builtin/spawn.js`); with `members` or a `template` (teams/, above) a team on its own board, its lanes narrowed inside the caller's; a team is dismissed whole | | |

The files, terminal, preview and dispatch commands are type `dev` (never answered from the run's 3-minute data cache); each
artifact pulls fresh state before every step (`refresh`) and changes its twin only when that state differs. A desk
with its own workspace adapter for `files`: `conventionDesk({artifacts: {files: BUILTIN.artifacts.files({adapter})}})`
(`adapter: {list, read, write, tree?}`, `backend/kernel/builtin/files.js`).

### tools/\<name\>.js

```js
import { defineTool } from "../../../backend/kernel/index.js"

export default defineTool({
  name: "notes.save", // lowercase, dot-separated parts
  description: "save a note in the desk's workspace", // what the agent reads in its TOOLS list
  input: { name: "the note's file name", text: "the note" }, // {field: "what it means"}
  view: "text", // how the Live feed draws a call (null: by type)
  run: async ({ name, text }, ctx) => (await ctx.host.post("fs/write", { path: `notes/${name}.md`, text })).path,
})
```

An agent's own tools: `<agent>/tools.js` in the same format (one `defineTool` or an array), beside its .md — attached to
that agent at compose time, checked like `tools/*.js`, its names unique across the desk.

`ctx` = `{agent, signal, host, desk, memory, log}`: the calling agent, its run's abort signal, the host API
(`host.get(path)`, `host.post(path, body)`), the desk's name, its memory folder, its log (a line on the Live page's
desk log). In a mounted desk, `desk` and `memory` are the mounted desk's; `host` and `log` the parent's (rule 4). From the command line (`scripts/tool.js`):

```
bun scripts/tool.js check custom/<desk>/tools/<name>.js        each tool's twin() as JSON, exit 0; else the reason, exit 1
bun scripts/tool.js run custom/<desk>/tools/<name>.js <tool> '{"text":"hi"}' [--desk <name>] [--port 1111]
bun scripts/desk.js check custom/<desk>                         the tree (mounted desks too) and every agent's tools
```

### Kept helpers: dynamic agents written as <name>.md

2026-10-20 owner ("The agent might want to keep the sub-agents alive, and in which case, these configurations are written
as .MD files in the same folder"): a desk can keep fixed members where its workflow is fixed and let its lead make the
rest at run time. A helper spawned with `keep: desk` (or kept later: `agent.update {name, keep: desk}`) by an agent whose
folder is in the desk's agent tree (the lead's folder; `agents/` in the legacy layout) is written beside it —
`<spawner folder>/<helper>/<helper>.md` in this format plus `keep: desk`, `by` and `at` (a team's members as its
subfolders, each `member_of: <team>`; one written before as `agent.md` stays so) — and its `history.md` records there.
At the next start the host spawns every kept helper again through its spawner (`companion/team/kept.js` `readKept` →
kernel `respawn`), bounded by what the spawner holds then, its runs restored; one that cannot be (its spawner gone, a
tool removed) is a desk log line and stays on disk. `agent.update` rewrites the file; `agent.dismiss` moves the folder to
`memory/<desk>/archive/agents/<day>-<name>/`. To make one a fixed member, name it in its lead's `agents:` and drop the
`keep`, `by` and `at` lines. A kept folder is never one of its lead's `agents:`, so the composer never builds it twice.

### practice: the checklist an agent improves

An agent that lists `practice` holds its standing orders as a file in the desk's memory —
`memory/<desk>/practice/<agent>.md` with `## Checklist`, `## Quality`, `## Instructions`, `## Lessons`, `## Tools` and
`## Changelog` — seeded from `practice.md` beside its .md (the owner's first version: config, in the desk folder)
until its own exists. Every run starts with the Checklist's items open and `!reflect` last; after the work the agent
edits the section that missed (`<agent>.practice.edit {section, old?, new?, why}`) and closes the run with
`<agent>.practice.reflect {worked, missed, changes}` (appended to `memory/<desk>/retros/<agent>.md`). A multi-agent
workflow becomes this checklist: each item a goal the lead closes itself or gives a helper.

### A desk from a request: desk.create

2026-10-20 owner ("for any kind of desk setup, it should be simple enough to request it and the agent figuring out the
good ways of creating the desk"): an agent holding the `desk.*` tools (the core desk's agent, `desks/agent/`) writes a desk
from a spec — host `POST desks/create {name, spec, update?}` (`companion/team/scaffold.js`):

```
spec: {title, description, request?, model?, max_steps?, folders?, lead: AGENT, teams?: [AGENT]}
AGENT: {name, description, role, goal?, title?, model?, max_steps?, writes?, reads?, board?, tools?, artifacts?,
        practice?: {checklist?, quality?, instructions?}, members?: [AGENT]}
```

It writes `main.js` (one template: `conventionDesk({title, description, defaultModel, maxSteps, init})`, its values as
JSON, headed `// made by desk.create`), `<lead>/` (each agent's `<name>.md` and `practice.md`, members nested),
`teams/<team>/<team>.md`, `tools/` (empty), `data/`, `README.md` — composed in a draft first: a spec that does not compose
writes nothing (422 with the compose's reason). `update: true` rewrites only a desk that still carries the mark (its
data, state, history, tools and kept helpers stay; a legacy desk keeps its `agents/` layout). No code an agent wrote is
ever placed: `desk.propose` keeps tool code under `custom/<desk>/proposed/tools/`, and the owner accepts a file by
moving it into `tools/`. `desks/check {name}` composes
a desk (`checkDesk`); `desks/ask {name, text, agent?, wait?}` gives a hosted desk work (from `desk:<asker>`; wait: an
id at once, `GET desks/ask?id=` its status and answer; a desk waiting on another is never asked back with a wait, and
one desk asks another at most 6 times in 10 minutes); `desks/read {name, path}` reads its workspace (its own fs/*; a
reader with a `reads:` lane only where it names `desks/<name>/…`).

### init

`conventionDesk({init})` (2026-10-20 owner: "an initialization method which will help us initialize any of the
dependencies or write in a script and then return a desk object which will be run by the framework"): `async ({dir,
memory, log, host, port})`, awaited at every start before the agents are built (folders, a script in `data/`, a
dependency check); a throw fails the start, and `desks/load` keeps the version that ran. A desk with its own `start`
does the same at its top.

## How-tos

| To | Do |
| --- | --- |
| Add a tool | Write `tools/<name>.js` (template above); `bun scripts/tool.js check` it; add its name to an agent's `tools:`; `bun scripts/desk.js check custom/<desk>`; load (last row). A tool only one agent uses: `<agent>/tools.js` beside its .md (attached to it, no `tools:` entry needed). |
| Add an agent | A folder under its lead (`<lead>/<agent>/<agent>.md`); its folder name in the lead's `agents:`. The lead calls it with a quest. |
| Add a team | Give an agent members (`agents:`): it leads a team and gets `<team>.board`, shared with its members, under the board of the team above; `title` and `goal` head it. |
| Let the lead staff itself | `tools: [agent.spawn, agent.catalog, agent.update, agent.dismiss]` and `artifacts: [practice, dispatch]` on the lead; its practice.md's checklist names the goals (each an item it closes itself or gives a helper); helpers that earn it are kept (`keep: desk`) as `<name>/<name>.md` folders under it. Example: `desks/agent/` (the core desk: one agent, no fixed members). |
| Create a desk from a request | Ask the core desk's agent (`desks/agent/`): `bun run send -- --agents desks/agent --wait "Set up a desk that …"` — it designs the spec, `desk.create`, `desk.load`, `desk.ask` its first request, and fixes the spec until the answer meets its bar. |
| Add a team the lead staffs when needed | A template folder `teams/<team>/<team>.md` (+ members) (teams/, above); the lead holds `agent.spawn` (and `agent.dismiss`) and its role says when to staff it: `agent.spawn {template: "<team>", goal, keep: desk}`. `bun scripts/desk.js check custom/<desk>` lists it under `templates`. |
| Mount a desk in a desk | `desks: [<other>]` in the .md of the agent it goes under; `custom/<other>/` sits beside this desk with its own main.js, agents and tools, and keeps its own options, `ctx.desk` and memory (rule 4; its host, log and workspace are the parent's). `bun scripts/desk.js check custom/<desk>` shows its lead with `desk: "<other>"`. Example: `companion/team/fixtures/sample-desk/lead/beta/beta.md` mounts `companion/team/fixtures/mini-desk/` (its own artifact type in `companion/team/fixtures/mini-desk/artifacts/tally.js`; a desk in the legacy layout). |
| Add an artifact type and its view | A class extending `Artifact` (`backend/kernel/artifact/artifact.js`; examples: `backend/kernel/artifact/checklist.js`, `Report` in `companion/team/compose.js`): `name` `<agent>.<kind>`, `kind`, `view`, `keep`, `render()`, `brief()`, `commands()`, `live()`. Register it: `conventionDesk({artifacts: {ledger: (agent, spec) => new Ledger(...)}})`; agents hold it with `artifacts: [ledger]`. Its `view` is drawn by `components/views/artifact.jsx` (list, checklist, quality, board, schedule, text, memory, table, files, terminal, preview, dispatch; another view shows its state as JSON until a renderer is added there, in the same change). Before writing one, check the kit (Attach by name): `files`, `terminal`, `preview`, `plan` and `dispatch` may already be it. |
| Load into the running server | `POST /__askk/desks/load {"name": "<desk>"}` (same-origin JSON: `Origin: http://localhost:1111`, `Content-Type: application/json`) → `{name, agents, reloaded}`. A new folder is hosted beside the others; a hosted desk is reloaded with fresh modules (main.js, agents, tools/) — refused (409) while its agents work or a run it accepted waits to start, and a reload that fails leaves the previous version running. Refused: a desk folder (or its main.js) that is a link (403), a read-only server (403). Open tabs reconnect on their own. From a tool: `ctx.host.post("desks/load", {name})`. |

## New desk bars

A new desk is done when each holds:

- [ ] `bun scripts/desk.js check custom/<desk>` exits 0 (`layout: standard`) and its tree shows every agent (and every
      mounted desk), its `templates` every team in `teams/`.
- [ ] Every `custom/<desk>/tools/*.js` passes `bun scripts/tool.js check <file>`; each touches the machine only through `ctx.host`.
- [ ] `POST /__askk/desks/load {"name": "<desk>"}` answers 200 and `GET /__askk/desks` lists it.
- [ ] Its lead answers a real question: `bun run send -- --agents custom/<desk> --wait "<question>"` prints a REPORT
      (VERDICT, EVIDENCE, CONFIDENCE, FALSIFIER, GAPS — `backend/kernel/agent/report.js`).
- [ ] Every agent is visible on `/agents?name=<agent>` and on `/canvas`; every artifact on the Live page's Artifacts tab.
- [ ] Its tests (if any) pass: `bun test ./tests` in the desk folder. The standard's own: `companion/team/compose.test.js`,
      `companion/server/desks.test.js`.
