# core — a single chat engine, skeleton first

This replaces the earlier loop engine. There is no loop, no tool calls,
no gates, no inbox here — that engine was a first sketch of what an
agent was in the old system, and it has been superseded. The skeleton
now is deliberately the smallest thing that can chat:

1. **User query in.** The main screen (`src/app/page.js`) takes the
   user's input and the session's message history.
2. **One infer call.** `chat()` prepends the engine's instructions as
   the system message and calls the model once, via an inference
   object from `src/core/inference.js`.
3. **Reply out.** The reply string is shown in the chat. No streaming,
   no second turn inside the engine — the next user message starts a
   new single call with the full history.

## The engine

`src/core/engine.js`:

- `createEngine({ instructions, metadata, model })` — an engine is an
  object created with string instructions. `metadata` is an optional
  plain object, stored on the engine and unused for now; it is the
  expansion point. `model` is optional: when given, it is an inference
  id, falling back to matching by model string. When absent, the
  engine uses the desk default (see below).
- `loadEngineFromLocation(location)` — server-side (Node `fs`). Reads
  `instructions.md` from that location and returns
  `createEngine({ instructions, metadata: { location } })`. It does
  not read model.json: model resolution belongs to the desk.
- `chat(engine, { inference, inferences, messages })` — resolves an
  inference (argument, then engine.inference, then engine.model
  matched by id and then by model string), prepends
  `{ role: "system", content: engine.instructions }`, and calls that
  inference's `infer()` exactly once. If nothing resolves, it throws
  "no model configured" instead of inventing a model.
- `engine.twin()` / `twin(engine)` — the engine's live twin as plain
  data for the UI: `{ element: "engine", model, metadata,
  instructionsPreview }` (first line of the instructions, truncated
  at 120 characters). It never includes an inference object, a key,
  or any secret.

The chat API route re-reads the personal folder on every request, so
editing it takes effect without a restart. The client never sends
instructions: the server is the only source of them.

## Inference

`src/core/inference.js` is abstract and OpenAI-standard, with no agent
library and no bundled model:

- `createInference({ id, provider, endpoint, model, apiKey })` — an
  inference object with `listModels()` (`GET {endpoint}/models`,
  returns the `data[].id` strings, in the server's order) and
  `infer(messages)` (`POST {endpoint}/chat/completions` with
  `{ model, messages }`, returns `choices[0].message.content`).
- Standalone `listModels({ endpoint, apiKey })` / `infer({ endpoint,
  apiKey, model, messages })` wrappers are kept for one-off callers.

Endpoints are normalized (trailing slashes trimmed). Non-OK responses
throw a clear error carrying the status and the server's message.
`apiKey` is optional and, when given, is sent only as a Bearer header.

## The desk and the personal folder

All agent runtime state lives in `personal/` when present, else in
the public defaults (see below). `src/core/desk.js` is
the script that initializes state and gives back a desk:

- `createDesk(location)` (alias `loadDesk`) reads
  `personal/instructions.md`, `personal/model.json`, and
  `personal/.env`, and returns
  `{ engine, inferences, defaultInference }`.
- `personal/model.json` IS a list, one entry per provider:
  `{ id, provider, endpoint, model, apiKeyEnv }`. Different providers
  coexist in the same list. The FIRST entry is the desk default; an
  empty list means no default. Changing the default moves that entry
  to the front of the list.
- `personal/.env` holds API keys ONLY, as KEY=VALUE lines (parsed
  with no new dependency, falling back to process.env). model.json
  never holds a key: an entry references its key only by `apiKeyEnv`
  name (default derived from the provider, e.g. OLLAMA_API_KEY).
- `public/defaults/.env.example` ships placeholder names only.

## Folder check and gitignore (personal vs public defaults)

personal/ is gitignored (see .gitignore). The rule, per file:

- If the personal folder is present, load personal.
- If not, give a default from the public folder.

Concretely, `createDesk()` in `src/core/desk.js` reads, per file,
personal/ first if that file exists, else public/defaults/:
personal/instructions.md else public/defaults/instructions.md,
personal/model.json else public/defaults/model.json (or [] if
neither exists). personal/.env is personal only — never a public
.env, and never returned to the browser.

Fresh checkout works from public/defaults/ alone: instructions
template ("You are ASKK, a helpful assistant. Answer plainly."),
model.json [], and .env.example placeholders. To customise,
create personal/ locally (instructions.md, model.json, .env) —
user-added saves (POST /api/inferences) write to personal/,
creating it if needed, never to public/defaults/, which are
read-only fallback. The old personal/desk.js is gone; all server
routes now import src/core/desk.js.

## Live activity

`src/core/activity.js` is the live state, like the old UI
(backend/live/activity.js, lib/engine-tone.js):

- Phases: idle | llm | tool | tools | waiting, plus
  connecting | no-model | error as UI states.
- describeActivity(): idle = "Idle" (shown as no working),
  llm = "Calling LLM…" (with step number if given),
  tool = "Calling tool {name}…",
  tools = "Running {n} calls in parallel: {names}…",
  waiting = "Waiting for {names}".
- engineTone(): idle grey dot, running emerald pulse dot,
  waiting amber dot, error red dot, starting grey dot.

Activity is real: the chat client sets llm while a /api/chat
request is in flight, idle when nothing is working, error on
failure, connecting while the live object loads, no-model when
the desk has no default. Tool, tools and waiting are defined
but never fire yet — this skeleton has no tools, and inventing
a tool call would be fake activity. They are placeholders for
the tools feature.

## The UI and API routes

- `src/app/page.js` (`/`) — the main screen is the chat. The model
  picker has been REMOVED from this screen: no provider/endpoint
  input, no "Fetch models", no model dropdown, no Save, and no
  client calls to /api/inferences or /api/models. The models store
  (personal/model.json, via the desk) is the source of truth, and
  the picker will be re-added improved later. If no model is
  present, the screen says "No model configured — add an entry to
  personal/model.json" and Send stays disabled; models are managed
  in the file for now. The live engine panel
  (`src/components/engine-live.jsx`) loads on page load and
  refreshes after every chat reply, and now also shows live activity
(idle / LLM call / error / connecting / no-model) and a thin
status strip with the activity dot + text, model, and call stats.
- `src/app/api/engine/route.js` — GET → `{ engine:
  engine.twin(), defaultInference, hasDefault, inferenceCount }`.
  No key is returned, and apiKeyEnv is omitted entirely.
- `src/app/api/desk/route.js` — GET → `{ hasDefault,
  defaultInference, inferences }` with id/provider/endpoint/model
  only. Keys are never returned. Still used by the server; the
  main UI now prefers /api/engine for its live panel.
- `src/app/api/models/route.js` — server proxy, KEPT but unused by
  the UI for now (for the improved picker later): `POST { endpoint,
  apiKey?, provider?, apiKeyEnv? }` → `listModels`. An explicit key
  wins; otherwise the key is resolved server-side from personal/.env
  under apiKeyEnv or the provider-derived name.
- `src/app/api/inferences/route.js` — KEPT but unused by the UI for
  now: POST `{ provider, endpoint, model, apiKey?, apiKeyEnv? }`
  appends (or updates, by id) an entry in personal/model.json
  WITHOUT any key, and writes/updates the key in personal/.env when
  one was supplied. Returns the saved inference without the key.
- `src/app/api/inferences/default/route.js` — KEPT but unused by the
  UI for now: POST `{ id }` moves that entry to the front of
  personal/model.json, making it the default.
- `src/app/api/chat/route.js` — server proxy: `POST { inferenceId?,
  endpoint?, apiKey?, model?, messages }` → loads the desk, resolves
  the inference (explicit id, else one-off endpoint+model, else desk
  default), then `chat()`, and returns `{ reply }`.

## Tests

`bun test src/core/` — engine creation and model parameter, location
loading, engine.twin() plain data (no keys), the single infer call with the system message prepended,
inference resolution by id then by model string, the no-model error,
desk list parsing, first-entry default, engine model override,
apiKeyEnv resolution from a temp .env file, Save-style append without
a key in model.json, and default reordering. Fetch is mocked; no real
model is called.

## Core tools — the default shipped with every desk

`src/core/tool.js` is the abstract Tool contract, like the old
`backend/kernel/tool/tool.js` simplified for the skeleton:

- `new Tool({ name, description, input, run, type, view, outside,
  expectation })` — expectation is one of `immediate | done |
  stream | live-state`: immediate answer, done-notification,
  event-stream notification, or live state. By definition,
  everything the agent invokes is a tool; the distinction is the
  expectation of the answer, not a different kind of code.
- `tool.spec()` — plain data for the UI (`name, type, view,
  description, input, expectation`). `tool.describe()` — one line:
  `- name {fields} — description`. `tool.run(input, ctx)` throws a
  clear error if the tool has no run function.
- `createToolRegistry(tools)` / `listTools(tools)` — flat list,
  lookup by name (duplicate names refused), specs, describe-all.

`src/core/core-tools.js` is the default set, shipped with every
desk. Web is IGNORED for now — no web tools in code, in the
registry, or in the UI:

- **Files** (`src/core/files.js`, `createFilesTool(location, id)`):
  `files.list`, `files.read` (with `from`/`lines` slices),
  `files.write` (creates folders, only inside the root),
  `files.edit` (one exact passage, old must match once, else fail
  — never silently overwrite a changed file), `files.append`,
  `files.search` (case-insensitive, under a folder/file),
  `files.open` (live-state, at most 25, text re-read on open),
  `files.close`, `files.focus` (live-state). A files tool is
  initialized by a location and loads that folder into logical
  space: paths are workspace-relative, no leading `/` or `./`, no
  `..` escape, or the call is refused. State:
  `{ location, root, tree, open, focus, modified }`.
  Per-location singleton by default (documented for Kaushal's
  correction): the same resolved location + id returns the cached
  instance, so two pointers at the same location share state; a
  different id gives a separate view over the same disk, with
  re-read on open. Safety from the old tool: `.env*` (except
  `.env.example`) and `.git` code/config/hooks, plus `.mcp.json`,
  are never read or written through files tools.
- **Focus, the section tool for when a file is too big:**
  `files.focus({ path, from, lines })` returns only that slice of
  the file and records `state.focus = { path, from, lines, by, at }`.
  `files.focus({ path })` with a folder instead makes that folder
  the tree's root for every holder of the instance; `""` resets to
  the location. A file without a slice is read whole and recorded
  as the focus, without changing the root.
- **Terminal** (`src/core/terminal.js`, `createTerminalTool(root)`):
  `terminal.run` (done: to completion, exit + last lines, timeout,
  no shell — one program, or several joined by `&&`, cwd inside
  the workspace), `terminal.start` (stream: a long session, id +
  printed lines/URLs), `terminal.wait` (stream: until exit, until
  text appears, or seconds pass), `terminal.read` (stream: last
  lines), `terminal.send` (stream: a line to stdin),
  `terminal.stop` (stream), `terminal.list` (immediate: every
  session). Sessions are in-memory per workspace root (cached, so
  they survive across API requests in the same server process) and
  cover both script (run → done) and watcher (start/wait → stream)
  expectations. Pipes and redirects are refused (no shell).

The default agent loads ALL core tools: `createDesk()` in
`src/core/desk.js` calls `createCoreTools()` (files root = project
root, terminal root = project root) and the returned desk has
`tools` (flat Tool list), `listTools()` (specs), and `coreTools`
(the groups + registry); the engine gets the same `tools` and
`listTools()`. The current single-turn chat does NOT invoke tools
yet (no loop) — tools are loaded, listed, and shown, and
tool-calling by the LLM is a later feature.

The UI shows them: `src/components/tools-panel.jsx` on the main
page fetches `GET /api/tools` (specs + live state, no secrets, no
physical paths, no web tools) on load, lists every tool by name
with its expectation badge, and expands (shadcn collapsible) each
tool to show its full description, its input fields, and its
current state where applicable (files: root, open files, focus;
terminal: sessions).

## Gitignore: filtered views vs explicit reads

`src/core/gitignore.js` parses the project's ROOT `.gitignore`
only (`parseGitignore(text)` / `isIgnored(matcher, path)`; no new
dependency). When the live artifact loads the filesystem, the
files tool applies it, so tree/list/search/expand exclude every
path matched by that `.gitignore` — `personal/`, `node_modules/`,
`.next/`, `*.log`, and any other pattern there — and ignored
directories are not descended into, so a huge `node_modules/`
costs nothing to walk. The root `.gitignore` file itself is never
filtered (it must stay visible). The live artifact inherits this
filter through the files tool (no second filter): its `expand()`
tree and `/api/artifact` output exclude gitignored files too, and
state.md/history.md never gain ignored paths automatically — they
only list files the agent actually opened.

Distinction, plainly: tree/list/search/expand are
gitignore-filtered views of the filesystem. An explicit
open/read/edit of a path the agent names directly is NOT filtered
by gitignore — it is still allowed unless an existing safety
refusal applies (`.env*` except `.env.example`, `.git`, `.mcp.json`,
path traversal). Supported patterns: `#` comments, trailing `/`
directories, leading `/` and mid-slash root anchoring, `*`, `?`,
`**`, and `!` negation with git's parent rule (a file under an
ignored directory cannot be re-included by a `!file` pattern
alone; re-include the directory too). NOT supported in v1:
character classes, nested `.gitignore` files, `.git/info/exclude`,
and the global gitignore — see `gitignore.js` header. Absent
`.gitignore` means no filtering and no error.

## Live artifacts — the basic agent artifacts

`src/core/artifact.js` is the first artifact, borrowed in shape from
the old `backend/kernel/artifact/artifact.js` and files artifact,
not copied from the old backend:

- An artifact is state an agent keeps beside its conversation,
  rendered as its latest state only. Several agents may hold the
  same artifact and see each other's writes at the next step. Its
  commands are the tools that change it.
- A live artifact IS a filesystem instance: `createLiveArtifact({
  id = "default", location, filesTool, personalBase })` wraps the
  files tool instance for that location (the per-location singleton
  — no second independent files state for the same location). Its
  live state is the files state: `{ id, root, tree, open, focus,
  modified }`. It stays in sync with the instance it depends on
  because open files are re-read on open, and `expand()` re-reads
  them again — so an external file change shows up on the next
  expand. Expectation: `live-state`, not immediate.
- `state()` — current live state, plain data (logical paths only,
  no physical location, no contents, no keys). `twin()` — plain
  data for the UI (`element: "artifact"`, `kind: "live-artifact"`,
  id, root, treeCount, open paths, focus, modified).
- `expand()` — the call the agent makes: returns `{ id, location
  (logical root label), root, tree, openFiles: [{ path, lines,
  preview, truncated, totalLines }], focus, modified }`, with
  previews bounded at 120 lines / 8000 chars, stating truncation
  plainly. It records `artifact.expand` in history and saves
  state. `openPreviews()` is the read-only equivalent for the UI
  route: same bounded previews, no history, no state write.
- Delegated files calls: `open`, `close`, `focus`, `list`, `read`,
  `write`, `edit`, `append` — all through the wrapped files tool,
  so path-traversal and `.env*`/`.git` refusals are inherited.
  State-changing calls (open, close, focus, write, edit, append,
  expand) record history and rewrite state.md; plain reads/lists
  do not (noise).
- Old `gate()` / `minCalls` are NOT implemented: in the old system
  gate could refuse a final answer and minCalls was the minimum
  artifact-command count before a final answer was allowed. This
  skeleton has no loop and no final-answer gate, so there is
  nothing to gate yet — a later step, not a pretence here.

Persistence — agent state in `personal/memory/agent/`:

- `<personalBase>/memory/agent/<id>/state.md` — current live
  state, rewritten on every state-changing call: title, root,
  focus line, `## Open files`, `## Modified files`, and
  `## Open file previews` (bounded). `stateToMarkdown(state,
  previews)` / `parseStateMarkdown(text)` round-trip it; previews
  are not parsed back (contents live on disk, re-read on load).
- `<personalBase>/memory/agent/<id>/history.md` — append-only,
  one STANDARD ENTRY per agent action, exactly:
  ```
  ## 2026-11-03T22:15:00.000Z · files.open
  - agent: default
  - path: src/core/tool.js
  - detail: opened, 120 lines
  ```
  `appendHistoryEntry(dir-or-artifact, entry)` /
  `parseHistoryEntries(text)` round-trip it. Actions: artifact
  .create, artifact.expand, files.open, files.close, files.focus,
  files.write, files.edit, files.append. History and state carry
  logical paths only — never an absolute path, never a key, never
  .env content. There is NO state.json in this feature, so tools
  can read the state back with the files tools themselves, and
  nothing is ever written to `public/defaults/`.
- `loadLiveArtifact({ id, location, personalBase })` reads
  state.md/history.md back if present (parsed, not raw) and
  restores open/focus/modified into a fresh files instance; if
  absent, it starts empty and creates the folder only on the first
  state-changing call. `createLiveArtifact` is the same, except it
  writes the initial state.md and records `artifact.create` on
  first creation only — repeated loads write no duplicate create
  entry. Tests cover the save → fresh-load round-trip in temp
  folders, never in the real `personal/` folder.

Desk wiring: `createDesk()` also creates (loads, if saved) a
default live artifact for the project root, exposed as
`desk.liveArtifact` and `desk.artifacts = [liveArtifact]` (a list,
so later artifacts can be added), with `desk.listArtifacts()`
returning twins. Chat still does NOT invoke tools or artifacts
(no loop) — the artifact is loaded, listed, and shown, and agent
invocation of expand is a method call for later loop work.

UI: `src/components/live-artifact-panel.jsx` on the main page,
below the Tools panel, fetches `GET /api/artifact` on load and
shows artifact id, root, open files, focus, and modified files,
expanding (shadcn collapsible) each open file to its preview and
each history entry to its details. `GET /api/artifact` returns
`{ artifact: twin, openFiles: previews, history: parsedEntries }`
and is read-only in effect: it creates no history entry, writes
no state, and exposes no keys, absolute paths, or .env content.
No POST route in this feature.

## What is NOT here yet

Everything else is for Kaushal to direct: how metadata expands, what
other files live in the personal folder, streaming, persistence of
chats, and any loop or tool-calling by the LLM — none of those are
in this skeleton. Web tools are also deliberately absent for now.

## Combined view + default agent.md (picked view-6)

The main page is now the combined view
(`src/components/combined-view.jsx`): dashboard overview (runs,
LLM/tool/error counts, Recent runs, Desk overview) + companion
card (SVG face, plain-language status, 4-up stats, live feed,
Show detail toggle) + click-expand minimal dot detailed view
(Soul, Agent, History session vs agent labelled separately,
Tools 16 core / 0 web, Live Artifacts, Skills placeholder).
The card's outline glows with the orb's state colour
(`src/app/globals.css` `.combined-card[data-glow]`): idle grey
dim, LLM sky 1.1s, tool violet 0.7s, waiting amber 2.2s, error
red 0.45s, success emerald 1.4s; motion only while running,
prefers-reduced-motion stops it. Expand is in place and shares
state: the feed list renders in exactly one place (card when
compact, expanded view when expanded), so expand/collapse
preserves feed/stats exactly. The separate EngineLive /
ToolsPanel / LiveArtifactPanel panels and the render-template
DeskTemplate sections are superseded by this view (their files
remain in the tree, but page.js no longer renders them).

### Default agent.md

`public/defaults/agent.md` is the shipped default, from the
agent.md template: Soul (personal/instructions.md, fallback
public/defaults/instructions.md), Model (desk default, first
entry in personal/model.json, resolved at load, key NEVER
written here), Tools (16 core: files.* 9 + terminal.* 7, no
web), Live artifact (id default, project root,
personal/memory/agent/default/state.md + history.md),
Initialization (createDesk → load agent.md → createEngine →
load core tools → create/load live artifact → twin).
`src/core/agent-md.js` parses it by headings/lists
(`parseAgentMd`), loads it with the personal/public fallback
(`loadAgentMd`: personal/agent.md wins, else
public/defaults/agent.md, else a built-in 16-tool default),
and twins it (`agentTwin`: no keys — any key value in the file
is dropped — no absolute paths, no .env content).
`createDesk()` exposes `desk.agent` + `desk.listAgents()`
(one agent, id default), and `GET /api/agent` returns that
twin. The combined view's Agent section renders from
desk.agent where it fits, without duplicating the engine twin.
User-added agent.md saves go to personal/, never to
public/defaults/ (this loader only reads; it never writes).

### Live event-driven UI — what is event-driven in v1, what is NOT

Event-driven in v1: the page takes ONE initial snapshot on
load (/api/engine, /api/tools, /api/artifact, /api/agent,
/api/soul), then the client live-event bus
(`src/lib/live-events.js`, EventTarget-based, no new
dependency) carries llm:start, llm:end, llm:error,
artifact:open, artifact:expand, run:success, run:error,
run:waiting, run:idle. The chat flow emits llm:start /
llm:end / llm:error; the combined view subscribes and updates
face, glow, status, stats and feed IMMEDIATELY on the event,
with no manual refresh and NO refetch after a reply
(page.js deliberately does not re-snapshot after send).
Feed rows: one line first, detail on expand (inputs, result,
artifact state after the call, honesty label "after this
call" vs "now — N later calls changed it since"), stable
call ids (`engine-call-combined-N`) shared by running and
finished rows, failed steps stay visible marked with a plain
reason, partial "N of 5 run tasks done" while a run is in
progress (tasks: LLM plan, files.open, artifact expand,
recovery, success).

NOT yet: a server SSE stream. The bus is in-page only; a
full page reload re-takes the snapshot, it does not replay a
stream. Do not claim SSE for this view until that route is
built. Also not here: loop/tool-calling (chat still
single-turn, tools loaded/listed only), skills, web tools.

### Verification test

The combined view has a "Run verification" test control
(labelled as such) + visible test-results panel. It resets to
a clean state, then simulates the agent life cycle through
the SAME bus and state the real chat uses (idle → LLM →
files.open → artifact expand → terminal/build error →
recovery → success → idle, plus expand/collapse preserving
feed/stats) and asserts actual DOM/UI state after each step
(face, glow, status, stats, feed rows, expanded/collapsed,
artifact open list), PASS/FAIL per step, failures left
visible. Verification feed/artifact entries are simulated
(their details say "(verification)") — they are not real
disk state, and no real model or tool is called.

## Simulate agent — snapshots + replay

`src/core/snapshot.js` (pure, no Node imports — the replay UI
imports it) defines a snapshot: `{ id, at, deskTwin, messages,
steps, progress, partial }`, with steps carrying thought (or
null), calls, context (soul/tools versions, artifact state),
activity, and counts. `src/core/snapshot-store.js` stores it
under `personal/memory/agent/<id>/snapshots/<id>.json` (+ a .md
summary), atomically, personal only, never public/defaults/.
Routes: `GET /api/snapshots` (twins only, no keys/paths),
`GET /api/snapshots/<id>` (full snapshot), `POST /api/snapshots`
(take from the live desk). Replay UI:
`src/components/snapshot-replay.jsx`, driven by the stored
snapshot, not the live run. Honesty label per step ("Context at
this step" vs "now — N later calls changed it since"). Not
captured, labelled never invented: thinking without a thought
field, terminal streams (only final lines as a tool result are
replayable), model internal state (never captured), external
changes after a step. Until the loop records steps, a snapshot
replays messages only, with those labels.

## Desk reader + engine structure standardization (night PR)

Snapshot version: the desk snapshot folder is `memory/`, and
`personal/` and `public/defaults/` are exact replicas following the
SAME logical structure:

```
personal/memory/soul.md
personal/memory/developer.agent.md        (<name>.<type>.md)
personal/memory/developer.instructions.md
personal/memory/model.json
personal/memory/agent/<name>/state.md, history.md, snapshots/
personal/memory/scripts/shared/, scripts/<agent>/
personal/memory/watchers/shared/, watchers/<agent>/
public/defaults/memory/  — the same tree, as templates.
```

Per-file fallback: `personal/memory/<file>` wins, else
`public/defaults/memory/<file>`, else legacy `personal/<file>` /
`public/defaults/<file>`. New writes go to the memory folder only.
Never write to public/. Agent name is a variable, never hardcoded
"default". Desk reader: `src/core/desk-reader.js` (`readDeskSnapshot`,
`deskSnapshotTwin` — twin strips keys, apiKeyEnv, absolute paths).

Abstract elements core: `src/core/elements.js`. Every render-prompt
element is `{id, kind, version, data, render(), toString(), cacheKey}`:
soul, instructions, tools, live artifact, watchers-running, scripts,
models, response format, history. `toString()` is the element's string
as it is NOW (soul text, instructions text, tool specs as
`- name {inputs} — description [expectation]`, etc.). Cache: unchanged
object → cached string, changed object → invalidate and re-render,
never a stale tool list. `renderPrompt()` joins elements in order:
static top (soul, instructions, tools), dynamic bottom (artifact,
watchers, scripts, models, history, response last).

Runtime placement: `src/core/placement.js`. Every agent calls the SAME
create tool; at runtime, shared loads first, then agent-specific,
agent-specific wins on the same name, no duplicates. Shared items are
available to any agent but still narrowed to the caller's tools/lanes.
Agent-specific items are visible/runnable only by that agent. Created
items go to shared ONLY if explicitly chosen, else to `<agent>/`, so
they survive restarts as files. Soul is immutable: any spawn/create
input trying to set a soul is refused. Spawn validation:
`validateSpawn` (name, task goal, tools subset, lanes narrowed,
keep run|desk, agent file `memory/<name>.agent.md`, memory
`memory/agent/<name>`).

Template agent skin: `src/core/template-skin.js`
(`createTemplateAgentSkin` / `createSnapshot`). Creates
`memory/<name>.agent.md` (data + metadata only), empty
`memory/agent/<name>/state.md` + `history.md`, `snapshots/`,
`scripts/<name>/`, `watchers/<name>/`. If `memory/soul.md` exists it
is NEVER modified; a template soul is created only if absent.

Snapshot state v2: `src/core/snapshot-state.js`
(`createDeskSnapshotState`). Includes every element's toString(),
watchers running, scripts we have, tools, artifact state, phase state
(if any), activity, counts — not just messages. Deep-copied.
Restart state (`createRestartState`): kept (keep:"desk") agents /
watchers / scripts respawn, run-only items are recorded but NOT
restarted, plus phase and artifact open/focus, so a restart can
restart what was running.

Default tools — what they enable (core 16, files + terminal, NO web):
- `files.list/read/search` — read the workspace, find context.
  Lanes: workspace-relative only, `..` escapes refused, `.env*`
  (except `.env.example`), `.git`, `.mcp.json` never read/written.
- `files.write/edit/append` — write, gated: exact-match edit, only
  in the holder's writes lane, recorded in history + modified list.
- `files.open/close/focus` — live artifact state: open (max 25,
  re-read on open), focus a file/section/folder, reset with "".
- `terminal.run/start/wait/read/send/stop/list` — run a single
  program or `&&` chain, no shell, no pipes/redirects, workspace
  scoped. `terminal.run` is the build/test tool (done expectation).
- No web tools: the core factory throws if any tool name starts
  with `web.`. Web reads are outside results and are ignored for now.

Models attached (template only): `src/core/providers.js`. Kinds:
API (`api-openai`, `api-anthropic`, `api-local`) and CLI
(`cli-claude`, `cli-openai`, `cli-gemini` — command, not endpoint).
NO built-ins, NO silent default: only what was added is listed,
empty list => empty state, default only if explicitly marked or a
defaultId is passed. No real model calls in this PR; `mockTestProvider`
returns `{ok, mocked}` so the template can be tested without a model,
key, or CLI. Template page: `/models` (separate view, not a dashboard
section). Replay view shell: `/replay` (lists snapshot twins only;
full replay is NOT in this PR). Dashboard: `/` (combined view, chat,
live-event bus — snapshot on load, then events, no refetch, no SSE
claim — unchanged by this PR).

Choose-base script: `scripts/choose-base.mjs`. Default base
`askk-skeleton`; refuses `main` unless `--allow-main`; verifies the
branch head via `git ls-remote`, optionally counts tracked files via
a shallow clone (`--verify-count`), and prints the compare URL.
It creates, pushes, and merges nothing.

## Phases — RESEARCH ONLY (not implemented in this PR)

A phase, in the configuration-driven reading, is the SET OF CURRENT
INSTRUCTIONS passed at that moment: a prompt statement (duty, inputs,
outputs, allowed tools, response format) PLUS a complete indication
to move control to the next phase (exit gate, handoff packet, named
next phase, on-fail loop-back). ReAct is the inner loop inside a
phase; the phase graph is the outer loop, enforced by code. Because
everything is metadata + configuration, the agent itself can, over
time, create the required structure: a new phase is a new
`<name>.phase.md` file (duty, gates, handoff schema, agent assignment),
loaded by the desk reader, validated like any other element — not a
code change, not a prompt the owner must remember. The responses
element must therefore be DYNAMIC: the response format is an element
with its own toString(), version, and cache, not a string literal in
engine code, so a phase can change what a valid response looks like
without changing the engine.

Response formats checked for a phase handoff packet:

- JSON: universal, machine-parsable, schema-validatable, easy to
  test, but verbose (tokens), brittle to a single missing comma,
  and hard for a human to read in a feed. Fits a handoff packet
  well when the packet is consumed by code (checks, gates, snapshot
  review) and when strict validation matters. toString for a JSON
  response element is the JSON itself, pretty-printed, with the
  schema named alongside it.
- TOON (Token-Oriented Object Notation): compact, token-efficient,
  human-readable for flat/tabular data, and good for a phase
  handoff that is mostly lists (files changed, checks, counts).
  Cons: less universal than JSON, fewer validators, nested
  structures get awkward, and a model that has seen far less TOON
  in training may produce invalid TOON more often than invalid
  JSON. Fits a handoff packet when token budget matters and the
  packet is flat, but it needs a validator + a JSON fallback on
  parse failure, or a bad packet silently becomes a bad phase.
- Recommendation for the phase work (tomorrow, not this PR): JSON
  as the canonical handoff format (validated, versioned, snapshot
  as JSON), TOON as an optional compact rendering for the UI feed
  and for token-sensitive steps, derived FROM the JSON, never as
  the source of truth. A phase's response element toString() should
  be able to render either, from the same data, with the same
  version/cache rules as every other element.

NOT in this PR, by design: the developer workflow
(plan → implement → build → critique → review), a create-workflow
tool, developer-desk loading for feature work, real model calls,
the full replay feature, and a restart implementation. Those are
tomorrow's work, on top of this structure — not inside it.

## Harness, loop, goal artifact — CORRECTION (2026-11-04)

Goal = statement only. This supersedes any earlier reading in which
a goal carried a phases statement:

- `goal.create` takes a statement only (plus id/name for addressing).
  It REFUSES phases, a plan, a pre-filled tool list, allowedTools,
  or steps (see src/core/goal-artifact.js: createGoal). A refusal is
  an error, never a silent ignore.
- The harness (src/core/harness.js) translates an owner request into
  exactly one goal.create call and passes the goal to the right
  executing agent. The harness does NOT plan, does NOT write phases
  into the goal, and does NOT choose the executing agent's tools
  beyond spawn lanes.
- The executing agent owns its loop internally: plan -> execute ->
  critique, looping back to plan/execute on critique failure, until
  done. Developer-internal phases live on the developer agent record
  (agent.internalPhases, agent.currentPhase) and in its history —
  never in the goal artifact. There is no goal.set-phase and no
  goal.next-phase tool; goal tools are goal.set-statement,
  goal.set-status, goal.add-step, goal.complete-step, goal.add-evidence.
- The goal artifact keeps: statement, status, live folder
  {root, tree, open, focus, modified} (gitignore-filtered views via
  the files tool; explicit open of a named path is the documented
  exception), steps added during execution, evidence, decisions,
  openQuestions, history, and snapshots (deep copies on status change).
  Goal files on disk are markdown (goalFileText / loadGoalArtifactFile),
  so restart restores goals from memory files.

## New modules in this PR

- `src/core/toon.js` — default response format. parseReply(text) ->
  {thought, calls, answer} for TOON thought:/call: lines, JSON
  fallback on parse failure, plain answer otherwise. A malformed
  call line never invents a call. formatReply() renders TOON.
- `src/core/live-state.js` — ONE single live object per location+id
  (singleton, extending the files/terminal pattern). Mutations through
  it; snapshot() returns the exact object shape as a deep copy. Events:
  llm:start/end, tool:start/end, goal:phase, agent:spawn/report/dismiss,
  compaction, and the live-events vocabulary. Dashboard card and canvas
  both render from snapshot() of this object (src/core/ui-data.js).
- `src/core/loop.js` — runLoop(): TOON by default, one stage of calls
  in parallel via Promise.all, sequential ONLY where a call depends on
  a previous result (a "$result.<name>" reference to another call in
  the same stage defers that call to the next stage, with substitution).
  stop() via createStopSignal() at the next step boundary, maxSteps 12.
  Compaction at >=90% of model ctx: older steps fold into one summary
  step (summariser if given, else a clipped fallback labelled clipped,
  never invented), last 2 steps kept, compaction recorded in history.
  Checks gate: if requireChecks and files were modified with no passing
  test/build terminal.run in the run, the final answer is refused.
  runPhase() narrows a registry to a phase's allowedTools (plus goal.*
  tools, which always belong to the goal's agent) before the loop runs.
  engine.js single-turn chat is untouched.
- `src/core/context.js` — selectContext(state, {phase, goal}) returns
  only current elements (soul always, current-phase instructions/tools,
  goal artifact, goal-clipped history); everything else is returned as
  leftOut [{id, reason, chars}], never silently included. renderContext()
  returns {prompt, meter} where meter segments sum EXACTLY to
  prompt.length (separators are their own segment). Response =
  f(state, context elements, request): no hidden inputs.
- `src/core/parallel.js` — renderElementsParallel() via Promise.all;
  each element {id, kind, version, data, render(), toString(), cacheKey}
  is skipped when its cacheKey matches, only changed elements re-render.
- `src/core/skills.js` — a skill IS a phase object {id, duty, inputs,
  outputs, allowedTools, entryGate, exitGate, handoff, agent, onFail,
  onSuccess}. loadSkillPhase() reads markdown with frontmatter-like
  fields from memory/skills/shared then <agent> (agent wins), personal
  first, then public defaults templates. Example:
  public/defaults/memory/skills/shared/review.skill.md (read-only skill).
- `src/core/spawn.js` — createAgent() (explicit tools subset, refused
  if absent or wider than caller lanes; soul immutable), children
  registry, dismiss() (run agents removed, desk-kept persist as
  <name>.agent.md), report(channel: report/ask — ask is exactly one
  concrete structured question), loadAgent() for restart.
  DEVELOPER_INTERNAL_PHASES: plan -> execute -> critique -> done.
- `src/core/agent-tools.js` — agent-created tools live in memory
  folders only (function: memory/agent/<agent>/<name>.tool.md; script:
  memory/scripts/<agent>/<name>.script.md; watcher:
  memory/watchers/<agent>/<name>.watcher.md; "shared" replaces <agent>
  for shared tools). Shared first, agent-specific wins, no duplicates;
  agent-specific tools are visible/runnable only by that agent. Writes
  go to the personal desk folder only, never public/defaults/. Desk
  tools remain src/core/core-tools.js only.
- `src/core/harness.js` — createHarness(desk) -> {desk, tools (kernel),
  spawnDeveloper, runDeveloper, ask}. ask() composes a goal statement
  from the owner request plus the default goal template
  (public/defaults/memory/goal-default.md, from the DeepSeek
  super-agent philosophy; a short fallback labelled "default" only if
  the template is missing), makes one goal.create call, passes the goal
  to the developer, and returns the developer's report. discoverDesk()
  implements personal/ else public/defaults/ else an honest empty
  state. createHarnessFromDeskFolder() is the cold-start path.
- `src/core/restart.js` — restartState() (kept desk agents respawn,
  run-only recorded-not-restarted, phase + artifact open/focus
  recorded), checkpoint() before merge/restart (files differing from a
  base snapshot, bounded at 200 files, newest 5 kept), healthCheck(),
  rollback(checkpointId), restoreFromMarkdown() (loadAgent +
  loadGoalArtifactFile). SUPERVISOR INTERFACE: the supervisor is a
  SEPARATE process that owns worker lifecycle — it starts the worker,
  watches healthCheck(), and on unhealthy restores a checkpoint and
  restarts it. The worker never restarts itself, and no registry tool
  restarts the process.
- `src/core/checks.js` — runChecks() runs `bun test src/core` and
  `next build` (workspace-scoped, via a supplied runner — mocked in
  tests) and records {name, command, status, exit, tail}.
- `src/core/ui-data.js` + `src/components/agent-card.jsx` +
  `src/components/live-canvas.jsx` — card and canvas data functions
  over one live snapshot; sections/nodes/edges appear only when the
  snapshot carries them (no hardcoded panels). Wired into
  src/app/page.js below the existing chat/snapshot sections, which
  are untouched. The card shows working/thinking/tool calls with stable
  call IDs, parallel grouping, partial first-class, failed visible.
- `src/core/providers.js` (extended, kinds/tests untouched) —
  getModelDetails(provider) returns {ctx, timings, counts} from the
  entry's own data (absent stays null); defaultsFor(model) returns
  explicit LABELLED defaults (ctx 128000 labelled "default", not a
  model fact). setDefaultProvider / updateProvider / removeProvider /
  applyProviderAction are the pure Models-page actions; Test stays
  mocked (mockTestProvider, no real call, no CLI). The /api/models
  route applies them: Use sets the default in the snapshot object and
  persists to personal/memory/model.json only when a personal desk
  folder exists, otherwise in-memory for the server process with a
  plain "not persisted" note. The Models page buttons now call it.
- Gitignore, restated: tree/list/search/expand views exclude
  gitignored paths (files.js, gitignore.js). An explicit open/read/
  edit of a named path is NOT gitignore-filtered, only safety-refused
  (.env, .git, .mcp.json). Gitignored files are never loaded into the
  file artifact through a view.
