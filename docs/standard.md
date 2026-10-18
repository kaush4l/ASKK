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
| Agent | `agents/<lead>/agent.md` (+ members as subfolders): YAML frontmatter + the role as body | `compose.js` `readAgentFolder` → `composeDesk` (a spec) → `backend/kernel/desk/desk.js` `buildAgent` → `Agent` | Agent init, History restore, Run start, Step, Call / result, Gate / format, Guidance, Answer, Error / stop, Agent memory |
| Tool | `tools/<name>.js`: `export default defineTool({...})` (or an array of them) | `compose.js` `loadTools` / `loadToolFile` (checked by `defineTool`, `backend/kernel/tool/tool.js`) → by name in `tools:` → kernel `makeTool` | Tool init, Call / result |
| Artifact | a type in the catalogue: the kernel's kit by name (`artifacts: [files, terminal, preview, plan]`, below), built-ins by agent.md key (`checklist:`, `artifacts: [report]`), the team board automatic, a desk's own class (extends `Artifact`, `backend/kernel/artifact/artifact.js`) via `conventionDesk({artifacts})` | kernel `resolveArtifact` → `Agent.addArtifact` (its `commands()` become the agent's tools, type `artifact`) | Agent init (`attach`), Run start (`onRunStart`), Artifact restore (`keep`), Artifact saved |
| Desk | `custom/<desk>/` with `main.js` (below) | `companion/team/desk.js` `loadDesk` → main.js `start` → `composeDesk` → kernel `buildDesk` → `Desk` | Host start, Desk load, Desk setup, Desk build, Twins out, Desk terminate; `POST /__askk/desks/load` (below) |
| Call | none: a `call:` block in a reply (`backend/kernel/agent/reply.js`); a call to an agent is a quest `{requirement, ask, outcome}` | `Agent.#call` → `Tool.run(input, ctx)` (`backend/kernel/agent/agent.js`) | Call / result, Gate / format |

| Element | `twin()` fields | UI twin (store → component) | Events |
| --- | --- | --- | --- |
| Agent | `element, id, name, description, role, model, team, folder, desk, tools[], agents[], artifacts[], status` | `backend/live/agent.js` `AgentView` → `components/agents/agent-page.jsx` (`/agents?name=`), `components/canvas/agent-node.jsx` (`/canvas`), `components/home/constellation.jsx`, `components/kernel/desk-levels.jsx`, `components/shell/status-bar.jsx` | `start, think, step, call, result, gate, format, guide, answer, error` (`Agent.on`) → `state {id, patch}` |
| Tool | `element, id, name, type, view, description, input` (+ `agent` for an agent as a tool) | the tool list on `components/agents/agent-page.jsx`; each call by its `view`: `backend/live/follow.js` → `components/live/feed/feed-row.jsx`, `components/live/views/call-panel.jsx` | none of its own: its calls are the agent's `call` / `result` |
| Artifact | `element, id, kind, view, owner, title, keep, brief, state` (+ `items` for view `list`) + `holders` (`Desk.artifacts()`) | `backend/live/desk.js` → `components/views/artifact.jsx` `ArtifactBlock` (one renderer per view), `components/live/artifacts-view.jsx`, `components/kernel/desk-levels.jsx`, `components/canvas/artifact-node.jsx` | `onChange` → `kernel {artifact, boards?}` |
| Desk | `element, lead, tree, agents[], artifacts{id: twin + holders}`; tree nodes `name, team, title, goal, model, desk, description, tools, agents` | `backend/live/team-tree.js`, `backend/live/desk.js` → `components/home/constellation.jsx`, `components/kernel/desk-levels.jsx`, `components/canvas/canvas-page.jsx` (a mounted desk: `components/canvas/desk-frame.jsx`) | `Desk.on(fn)`: every agent's events with its `team` path; the desk log `log {at, source, text}` (`backend/live/log.js` → `components/live/desk-log.jsx`) |
| Call | no `twin()`: its events are its twin — `call {agent, tool, input}`, `result {agent, tool, ok, output}`; on the stream a message `{role: tool, name, kind, view, inputs, ok, output}` | `backend/live/follow.js` → `components/live/feed/feed-row.jsx`; `components/agents/thread.jsx`; `components/canvas/call-chip.jsx` | `call`, `result` (a refused answer: `gate`, `format`) |

## Composition rules

1. **One desk = one folder**: `custom/<desk>/` with a `main.js`; its name is the folder name (`^[a-z][a-z0-9-]*$`).
2. **Agents nest by folder**: `custom/<desk>/agents/` holds exactly one lead folder; a member is a subfolder of its lead, named in
   the lead's `agents:`, to any depth.
3. **A tool is a file**: `tools/<name>.js` default-exports `defineTool(...)` (or an array); helpers live in a
   subfolder (`custom/<desk>/tools/<sub>/`); `*.test.js` is skipped. `tools/` and every `tools/*.js` are real paths
   inside the desk, never links (refused at compose time). An agent lists tools by name; a name resolves against the desk's
   own `custom/<desk>/tools/` first, then the host's catalogue (`composeDesk({tools})`), then the kernel's inbuilt kit
   (Attach by name, below).
4. **A desk mounts another with `desks:`**: `desks: [<other>]` in an agent.md puts `custom/<other>/`'s lead
   under that agent. Its tree node says `desk: "<other>"`. The mounted desk composes with its own `main.js` options
   (`conventionDesk`'s `compose`: models, fallbacks, step limit, artifact types, tool catalogue; without them, the
   kernel's step limit) and its own `custom/<other>/tools/`; its
   agents' `ctx.desk` is `"<other>"` and `ctx.memory` is `custom/memory/<other>/`. It runs in the parent's process
   and workspace: `ctx.host` and `ctx.log` stay the parent's (the host API as the parent desk, the parent's
   `custom/<desk>/data/`, the parent's desk log). A mounted desk is a real folder beside this one (never a link), no cycles, and it
   also composes alone.
5. **Names are unique across a composed desk**, mounted desks included: agent names (the kernel refuses a second
   one), tool names within a desk's `custom/<desk>/tools/`.
6. **Tools reach the host only through `ctx.host`** (`hostClient`: the host API as this desk) — no hand-made fetch
   to `/__askk/`, no globals. The endpoints: `companion/server/host-api.js` (fs, web, mcp, apple, speech, team).
7. **Artifacts come from a type catalogue.** The kernel's kit (`files`, `terminal`, `preview`, `plan`: Attach by name,
   below); built-ins: `checklist` (agent.md `checklist:` → `<agent>.checklist`, keep `run`, gates the answer), `report`
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
custom/<desk>/
  main.js                  export default conventionDesk({...})          (below)
  agents/<lead>/agent.md   the lead; members as subfolders: agents/<lead>/<member>/agent.md
  tools/<name>.js          export default defineTool({...})
  data/                    the workspace: the host's fs/* root (made at load when missing)
  state/                   host state: server.json, kernel-team.jsonl, artifacts/, days/
custom/memory/<desk>/      the desk's memory and reports (ctx.memory)
```

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

### agent.md

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
| `writes` | paths it may write (globs under the workspace: `*` within a folder, `**` across, a trailing `/` = all below, `!glob` excludes; `files` and `terminal` enforce it, other tools read `ctx.agent.config.writes`); none = it writes nothing through the kit |
| `reads` | when set, the only paths it may read, list or search through `files` (globs, as `writes`): the critic's "outputs only" lane — the rest of the tree never reaches its prompt |
| `board` | `false`: kept off its team's board (it never sees the members' notes); a team lead keeps its own |
| `tools` | tool names: the desk's `custom/<desk>/tools/`, then the host's catalogue |
| `agents` | its members: subfolder names |
| `desks` | desks mounted under it: desk folder names beside this desk |
| `checklist` | what done means per run, `"id: text"` items (`"!id"` cannot be skipped) → `<name>.checklist` |
| `artifacts` | artifact types it holds, each a name or `{type, id?, commands?, gate?}`: the kit's `files`, `terminal`, `preview`, `plan` (shared per desk; `id`: a separate one; `commands`: a subset, e.g. `[read, wait]`; `gate: true`: its answer waits on the plan), `report`, or the desk's own |
| `after` | sibling agents whose reports it works from (they are called first) |

The body is the role. `{{key}}` in the role, description, goal, title and artifacts takes `composeDesk({vars})`.

### Attach by name: the inbuilt kit

`backend/kernel/builtin/index.js` (`BUILTIN`, `builtinKit`) is a catalogue every composed desk gets under its own
tools and artifact types (the desk wins a name clash): an agent.md lists them by name, nothing to write. They reach
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
| `terminal` | artifact, view `terminal`, keep `file` | two sessions per holder: `terminal.run {command, cwd?, timeout?}` (in its main session, one at a time, to its exit), `terminal.start {command, cwd?, name?}` (in its long session, kept running; the next start replaces it), `terminal.wait {id, seconds, until?}` (until: literal text from a line it prints, e.g. `"val_bpb:"`, or a list where any one is enough — never a regex), `terminal.read {id, lines?}` (its scrollback), `terminal.send {id, text}`, `terminal.stop {id}`, `terminal.list` (id: a session id, `main` / `long`, `<agent>:main`) | every running session: header + last 50 lines; finished ones: one line (exit, time) | `{sessions: [{id, name, command, cwd, agent, slot, runs, status, exit, startedAt, endedAt, urls, tail ≤ 50}] ≤ 12}` newest first |
| `preview` | artifact, view `preview`, keep `file` | `preview.open {url}`, `preview.goto {url}`, `preview.click {selector \| x, y}`, `preview.type {text, selector?}`, `preview.press {key}`, `preview.scroll {dy}`, `preview.text`, `preview.eval {expression}`, `preview.console`, `preview.shot`, `preview.close` (the page: the newest open one unless `id`) | each open page: url, title, console errors, its last text outline (≤ 40 lines) — text only | `{pages: [{id, url, title, status, by, at, shot: {n, at, width, height, url} \| null, console ≤ 20, errors}]}` |
| `plan` | artifact (kernel `Plan`), view `checklist`, keep `always` | `plan.write {goal, items}`, `plan.tick {id, evidence}`, `plan.skip {id, reason}` | goal + items | `{goal, revision, by, at, items: [{id, text, required, status: open \| ticked \| skipped, note, by, at}]}` |
| `web.search` | tool, view `web` | `{q, limit?, source?: web \| wikipedia \| arxiv \| hn}` (`query` works too); a 429/5xx from wikipedia/arxiv/hn is retried once on web (a note says so), else the error names what to leave alone for 2 minutes | | |
| `web.read` | tool, view `web` | `{url, find?, max_chars?}` (the passages around `find`, narrowed here) | | |
| `agent.spawn` / `agent.dismiss` | tools, view `spawn` | `{name, role, goal, tools?, artifacts?, keep?: run \| desk}` / `{name}`: a helper for a stated goal, never more than its caller (`backend/kernel/builtin/spawn.js`) | | |

The files, terminal and preview commands are type `dev` (never answered from the run's 3-minute data cache); each
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

`ctx` = `{agent, signal, host, desk, memory, log}`: the calling agent, its run's abort signal, the host API
(`host.get(path)`, `host.post(path, body)`), the desk's name, its memory folder, its log (a line on the Live page's
desk log). In a mounted desk, `desk` and `memory` are the mounted desk's; `host` and `log` the parent's (rule 4). From the command line (`scripts/tool.js`):

```
bun scripts/tool.js check custom/<desk>/tools/<name>.js        each tool's twin() as JSON, exit 0; else the reason, exit 1
bun scripts/tool.js run custom/<desk>/tools/<name>.js <tool> '{"text":"hi"}' [--desk <name>] [--port 1111]
bun scripts/desk.js check custom/<desk>                         the tree (mounted desks too) and every agent's tools
```

## How-tos

| To | Do |
| --- | --- |
| Add a tool | Write `tools/<name>.js` (template above); `bun scripts/tool.js check` it; add its name to an agent's `tools:`; `bun scripts/desk.js check custom/<desk>`; load (last row). |
| Add an agent | A folder under its lead (`agents/<lead>/<agent>/agent.md`); its folder name in the lead's `agents:`. The lead calls it with a quest. |
| Add a team | Give an agent members (`agents:`): it leads a team and gets `<team>.board`, shared with its members, under the board of the team above; `title` and `goal` head it. |
| Mount a desk in a desk | `desks: [<other>]` in the agent.md it goes under; `custom/<other>/` sits beside this desk with its own main.js, agents and tools, and keeps its own options, `ctx.desk` and memory (rule 4; its host, log and workspace are the parent's). `bun scripts/desk.js check custom/<desk>` shows its lead with `desk: "<other>"`. Example: `companion/team/fixtures/sample-desk/agents/lead/beta/agent.md` mounts `companion/team/fixtures/mini-desk/` (its own artifact type in `companion/team/fixtures/mini-desk/artifacts/tally.js`). |
| Add an artifact type and its view | A class extending `Artifact` (`backend/kernel/artifact/artifact.js`; examples: `backend/kernel/artifact/checklist.js`, `Report` in `companion/team/compose.js`): `name` `<agent>.<kind>`, `kind`, `view`, `keep`, `render()`, `brief()`, `commands()`, `live()`. Register it: `conventionDesk({artifacts: {ledger: (agent, spec) => new Ledger(...)}})`; agents hold it with `artifacts: [ledger]`. Its `view` is drawn by `components/views/artifact.jsx` (list, checklist, quality, board, schedule, text, memory, table, files, terminal, preview; another view shows its state as JSON until a renderer is added there, in the same change). Before writing one, check the kit (Attach by name): `files`, `terminal`, `preview` and `plan` may already be it. |
| Load into the running server | `POST /__askk/desks/load {"name": "<desk>"}` (same-origin JSON: `Origin: http://localhost:1111`, `Content-Type: application/json`) → `{name, agents, reloaded}`. A new folder is hosted beside the others; a hosted desk is reloaded with fresh modules (main.js, agents, tools/) — refused (409) while its agents work or a run it accepted waits to start, and a reload that fails leaves the previous version running. Refused: a desk folder (or its main.js) that is a link (403), a read-only server (403). Open tabs reconnect on their own. From a tool: `ctx.host.post("desks/load", {name})`. |

## New desk bars

A new desk is done when each holds:

- [ ] `bun scripts/desk.js check custom/<desk>` exits 0 and its tree shows every agent (and every mounted desk).
- [ ] Every `custom/<desk>/tools/*.js` passes `bun scripts/tool.js check <file>`; each touches the machine only through `ctx.host`.
- [ ] `POST /__askk/desks/load {"name": "<desk>"}` answers 200 and `GET /__askk/desks` lists it.
- [ ] Its lead answers a real question: `bun run send -- --agents custom/<desk> --wait "<question>"` prints a REPORT
      (VERDICT, EVIDENCE, CONFIDENCE, FALSIFIER, GAPS — `backend/kernel/agent/report.js`).
- [ ] Every agent is visible on `/agents?name=<agent>` and on `/canvas`; every artifact on the Live page's Artifacts tab.
- [ ] Its tests (if any) pass: `bun test ./tests` in the desk folder. The standard's own: `companion/team/compose.test.js`,
      `companion/server/desks.test.js`.
