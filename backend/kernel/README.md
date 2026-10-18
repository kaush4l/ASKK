# backend/kernel — the map

The core: agents, tools, artifacts, desks. Plain JS, no host dependency (server, tab, test). Outside code imports
`backend/kernel/index.js` only. Paths below are from the repo root; `<…>` in the persisted column is a placeholder.

## (a) Folder map

| File | Holds |
| --- | --- |
| `backend/kernel/index.js` | The one entry: re-exports everything public below. |
| `backend/kernel/agent/agent.js` | `Agent`: the ReAct loop (`ask` → `#run` → `refreshArtifacts` → `render` / infer / `parseReply` / `#call` / `gates` / `#finish`), `addArtifact(artifact, {commands, gate})` (a commands subset per holder; `holding`), `guide`, `on`/`emit`, `context`, `twin()` (with `spawned`). |
| `backend/kernel/agent/reply.js` | `parseReply` (fields, `<<< >>>` blocks, older JSON, plain text) and `RESPONSE_FORMAT` (the prompt's `# RESPONSE`). |
| `backend/kernel/agent/report.js` | The one answer format: `REPORT_FORMAT`, `REPORT_FIELDS`, `parseReport`, `checkReport`, `scoreReport`. |
| `backend/kernel/tool/tool.js` | `Tool` (`spec()`, `twin()`, `run`, `describe`), `AgentTool` (an agent as a tool; `after`), `QUEST_INPUT`, `questText`, `defineTool`, `TOOL_NAME`. |
| `backend/kernel/artifact/artifact.js` | `Artifact` base: state in every prompt, `commands()`, `gate`, `live()`, `snapshot`/`restore`, `keep`, `onChange`, `twin()`; optional hooks `refresh(agent)` (async, awaited before each step's render), `attach(agent, {commands, gate})`, `detach(agent)` (a dismissed holder). |
| `backend/kernel/artifact/board.js` | `SharedBoard`: a team's board (`<team>.board`), nested by parent, `<team>.board.write`. |
| `backend/kernel/artifact/checklist.js` | `Checklist`: what done means per run; gates the answer; `!` items required (`requiredWhen`). |
| `backend/kernel/artifact/quality.js` | `QualityMatrix`: members' reports scored in code (`scoreReport`) as they land. |
| `backend/kernel/artifact/schedule.js` | `Schedule`: the desk's next run (`book`, `takeDue`, `<id>.next`). |
| `backend/kernel/desk/desk.js` | `buildDesk(spec, env)`, `buildAgent` (tool specs → `typed` → `makeTool`, artifacts → `resolveArtifact` (a name, `{type}`, a factory, an instance, `{artifact: instance \| factory}`) + `{commands, gate}`; sets `agent.depth`, `agent.parentBoard`), `Desk` (`ctx` kept from the build, every agent's `home`; `agents`, `boards`, `artifacts`, `tree`, `twin`, `on` — taps that hear later agents and the desk's `spawn`/`dismiss` events — `spawn(spec, caller)` — the name checked against `SPAWN_NAME` (`spawnName`), every artifact shared with the caller held within the caller's commands subset (`withinHolding`; a catalogue type that resolves to the caller's instance and holds more is refused, the build undone) — `dismiss(name, by)`). |
| `backend/kernel/builtin/index.js` | The inbuilt kit, attached by name: `BUILTIN` (`tools`: `web.search`, `web.read`, `agent.spawn`, `agent.dismiss` — each `(deskOptions) => Tool`; `artifacts`: `files`, `terminal`, `preview`, `plan` — each `(deskOptions) => (agent, spec) => Artifact`, one instance per desk and id, id = the type) and `builtinKit(deskOptions)` (the catalogue bound to one desk). |
| `backend/kernel/builtin/files.js` | `Files` (view `files`, keep `always`): the workspace through an adapter (`hostFiles`: fs/list, fs/read, fs/write; or a desk's own) — `files.list`, `read` (marks open), `write`, `edit`, `append` (only in the holder's `writes:`), `search`, `focus` (only in its `reads:` when set); `refresh` pulls the tree (`walkTree`, breadth first); `lineDiff`, `globRegex`, `inLane`, `mayContain`, `cleanPath`, `hostError`. |
| `backend/kernel/builtin/terminal.js` | `Terminal` (view `terminal`, keep `file`): the desk's sessions over host term/* — `terminal.run`, `start`, `wait`, `read`, `send`, `stop`, `list` (the holder's name and `writes` passed on; `wait`'s `until` is literal text or a list of texts, any one enough — the host's includes, never a regex); `refresh` pulls term/list; the prompt shows every running session's last 50 lines. |
| `backend/kernel/builtin/preview.js` | `Preview` (view `preview`, keep `file`): the app's pages over host browser/* — `preview.open`, `goto`, `click`, `type`, `press`, `scroll` (each answers with the page's text outline), `text`, `eval`, `console`, `shot`, `close`; `refresh` pulls browser/list; the prompt is text only. |
| `backend/kernel/builtin/web.js` | `webSearchTool()` (`web.search {q \| query, limit?, source?}`: a 429/5xx from wikipedia/arxiv/hn retried once on web, with a note; else the 2-minute advice), `webReadTool()` (`web.read {url, find?, max_chars?}`, narrowed with `narrowText`), `WEB_TOOLS`. |
| `backend/kernel/builtin/plan.js` | `Plan` (extends `Checklist`): the desk's checklist written at run time — id `plan`, view `checklist`, keep `always`, no reset per run; `plan.write {goal, items}` (a revision keeps closed items still listed), `plan.tick`, `plan.skip`; gates only holders attached with `gate: true` (also while empty). |
| `backend/kernel/builtin/spawn.js` | `spawnTool()` / `dismissTool()` (`agent.spawn {name, role, goal, tools?, artifacts?, keep?}`, `agent.dismiss {name}`; type and view `spawn`), `SPAWN_TOOLS`, `SPAWN_NAME` (re-exported from desk.js). Exactly what a helper gets: tools = names of the caller's own tools (the same instances) or of the desk's catalogue (`env.tools`, named one by one) — never the caller's agents or an artifact's commands; artifacts = ids the caller holds or catalogue types, their commands within the caller's own subset (`agent.holding`: its subset by default, a command outside it refused "<cmd> is not yours on <id>"; a type the caller holds by id or kind is bounded the same way). |
| `backend/kernel/model/llm.js` | `complete` (OpenAI-compatible or Anthropic wire; local providers via the host), `listModels`, `contextWindow`. |
| `backend/kernel/util/text.js` | `narrowText` (passages around `find` terms, capped), `READ_CHARS`, `FIND_CHARS`, `FIND_AROUND`. |
| `backend/kernel/test/agent.test.js` | `Agent.resolveTool`: a member called with its own team's prefix resolves, any other prefix is a missing tool. |
| `backend/kernel/test/hold.test.js` | `refresh(agent)` awaited before each render (a failed or hung refresh = one line); a commands subset per holder. |
| `backend/kernel/test/plan.test.js` | `Plan`: write / tick / skip, revisions, the gate for `gate: true` holders only, no reset per run, restore. |
| `backend/kernel/test/builtin.test.js` | The kit's catalogue: attach by name, one instance per desk, `{type, id}`, a commands subset, the plan's gate, `board: false`, the twin states exactly as the spec, `agent.spawn` resolving the catalogue at run time. |
| `backend/kernel/test/builtin-files.test.js` | `Files`: lanes (`writes:` needed, `reads:` restricts — the critic never sees the code), the tree, open and modified with diffs ≤ 80 lines, focus, search, a desk's own adapter. |
| `backend/kernel/test/builtin-terminal.test.js` | `Terminal`: term/* calls with the holder's name and lane, ≤ 50 lines per running session in the prompt, the twin, a separate instance. |
| `backend/kernel/test/builtin-preview.test.js` | `Preview`: browser/* calls, actions answered with the text outline, a text-only prompt, the twin. |
| `backend/kernel/test/builtin-web.test.js` | `web.search` (the fallback note, the 2-minute advice, `query`), `web.read` (`find`, `max_chars`). |
| `backend/kernel/test/fake-host.js` | Not a test: the fake host (fs/*, term/*, browser/*, web/*) the kit's tests (and `companion/team/compose.test.js`) run on. |
| `backend/kernel/test/spawn.test.js` | `Desk.spawn` / `dismiss` through `agent.spawn` / `agent.dismiss`: quests, tree, twin, taps, keep, refusals, undo. |
| `backend/kernel/test/kernel.test.js` | The loop, desks, gates, checklist, quality, schedule, quests, reply parsing. |
| `backend/kernel/test/prompt.test.js` | The prompt's section order (d), and every prompt string that points at another section. |
| `backend/kernel/test/text.test.js` | `narrowText`. |
| `backend/kernel/test/twin.test.js` | `twin()` of every element, `Desk.artifacts()`, run context, tool factories, `defineTool`, the `desk` marker. |

## (b) Lifecycle

| Moment | Where (path: function) | What happens | Persisted where |
| --- | --- | --- | --- |
| Host start | `scripts/dev.js` (top level) → `companion/server/desks.js`: `hostDesks` | Next dev + every desk in one process: per desk `loadDesk`, `createKernelTeam`, `createHostApi`; then `announce`, `startTelegram`. | `<desk>/state/server.json` (`createKernelTeam` → `announce`) |
| Desk load | `companion/team/desk.js`: `loadDesk` | The desk's main.js imported once per process (cached); its config normalised with `deskPaths`. | — |
| Desk setup | `companion/team/desk.js`: `runDeskSetup` | Optional `setup()` once per continuous server, in the background. | the desk's own |
| Desk build | `companion/team/kernel-team.js`: `createKernelTeam` → main.js `start` (`custom/<desk>/main.js`: `start`) → `backend/kernel/desk/desk.js`: `buildDesk` | `start({port, live, log, memory})` builds the agents; `env.context` becomes every agent's `context`. | — |
| Tool init | `backend/kernel/desk/desk.js`: `typed`, `makeTool` (catalogue `env.tools`, builders `env.types`); `backend/kernel/tool/tool.js`: `defineTool` | Each tool spec bound to the agent being built: a name, a typed spec, an instance, or an `(agent) => Tool` factory. | — |
| Kit bound | `companion/team/compose.js`: `composeDesk` → `backend/kernel/builtin/index.js`: `builtinKit` | The inbuilt kit bound once per composed desk (its shared `files`, `terminal`, `preview`, `plan`; mounted desks share it), merged under the desk's own tools and artifact types (the desk wins), handed to `buildDesk` as `env.tools` / `env.artifacts` (what `agent.spawn` resolves). | — |
| Agent init | `backend/kernel/desk/desk.js`: `buildAgent` | `new Agent` → `addTool` (an artifact's commands too, or the spec's `commands` subset) → `addArtifact` (→ `attach(agent, {commands, gate})`) → the team's `SharedBoard` (not for `board: false`, unless it leads the team); `agent.depth`, `agent.parentBoard`; `Desk` sets `agent.home`. | — |
| Twins out | `companion/team/kernel-team.js`: `definition`, `view` | `Agent.twin()` → the registry's definition; `Artifact.twin()` + `Desk.artifacts()` holders → `kernel.artifacts`. | — |
| Artifact restore | `companion/team/kernel-team.js`: `createKernelTeam` (`restore`, `keepOf`; `rescan` for one that arrives with a spawned agent: each instance restored once (`restored` WeakSet), so a live one held again keeps its state; one that leaves gets its waiting save written (`flush`)) | `x.restore(saved.state)` by `keep`: `always`, `day` (same ET day); `run`/`file` never. | read from `<desk>/state/artifacts/<id>.json` |
| History restore | `companion/team/kernel-transcripts.js`: `createTranscripts` → `restore` | The newest runs become `agent.history` (EARLIER RUNS) and the thread's first messages. | read from `<agent folder>/transcript.jsonl` |
| Run start | `backend/kernel/agent/agent.js`: `Agent.ask` → `#run` (from `companion/team/kernel-team.js` `run`: team call `ask`/`send`, `send`, schedule, `wake`, `deliverWake`) | One run at a time per agent (queue); artifacts' `onRunStart` (a Checklist resets); event `start`. | event row (below) |
| Step | `backend/kernel/agent/agent.js`: `Agent.refreshArtifacts` → `Agent.render` → `infer` → `backend/kernel/agent/reply.js`: `parseReply` | Every artifact's `refresh(agent)` awaited together (a failure or a hang past `config.refreshMs` ?? 15 s: one line in its block; the kit's: `files` pulls its tree through fs/list, `terminal` term/list, `preview` browser/list — coalesced across holders, `changed()` only on a difference), then the prompt rendered whole, in the order of (d); the model called; events `think`, `step` (`ms`, `prompt_chars`, `reply_chars`). | event row |
| Call / result | `backend/kernel/agent/agent.js`: `Agent.#call` → `Tool.run(input, {...context, agent, signal})`; `AgentTool.run` → `questText` | A step's calls run together; repeats within 3 min answer from the first; events `call {tool, input, index}`, `result {tool, ok, output, input, index}` (`index`: the call's place in its step; `tool`: what ran, a prefixed member resolved). `companion/team/kernel-team.js` pairs each result with its call by `index`. | event row |
| Gate / format | `backend/kernel/agent/agent.js`: `Agent.gates` (artifact `gate`, `checkReport`, `minCalls`) | An answer refused (or `held` for guidance), or a reply with neither calls nor answer; events `gate`, `format`; the loop goes on. | event row |
| Guidance | `backend/kernel/agent/agent.js`: `Agent.guide` (via `companion/team/kernel-team.js` `call` method `guide`) | A note for the run in progress, shown once under `# OWNER GUIDANCE`; event `guide`. | event row |
| Spawn | `backend/kernel/builtin/spawn.js`: `agent.spawn` → `backend/kernel/desk/desk.js`: `Desk.spawn` → `buildAgent`; `companion/team/kernel-team.js`: `spawned` | A helper built at run time in its caller's team (soul, model, maxSteps, files lanes copied; tools ⊆ the caller's or the catalogue's), the caller's quest tool `<name>`; desk event `spawn {agent, by, goal, keep}`; the host gives it a state and a folder (only for a `SPAWN_NAME` name), streams `registry` and `kernel {tree}`, logs `<by> spawned <name>: <goal>`. | `<desk>/state/spawned/<name>/agent.md` (a record) and its `transcript.jsonl` |
| Dismiss | `agent.dismiss` → `Desk.dismiss` (or keep `run`: the caller's run ends); `companion/team/kernel-team.js`: `dismissed` | Refused while it (or a helper of its) runs or for an agent that did not spawn it; removed from the list, the caller's tools and children, every tap; desk event `dismiss`; `registry` and `kernel {tree, removed}` streamed. | the folder stays |
| Answer | `backend/kernel/agent/agent.js`: `Agent.#finish` | History push, status idle; event `answer` (with `flags`, `steps`). | transcript row (below) |
| Error / stop | `backend/kernel/agent/agent.js`: `Agent.#run` (catch); `companion/team/kernel-team.js`: `call` method `stop` | Stop aborts the run's `AbortController`; the next step throws `stopped`; event `error`. | transcript row |
| Agent memory | `companion/team/kernel-transcripts.js`: `record` (from `companion/team/kernel-team.js` on `answer`/`error`) | One row per finished run: request, steps, answer; compacted past 512 KB. | `<agent folder>/transcript.jsonl`, `history/` |
| Events | `companion/team/kernel-team.js`: `createKernelTeam` (`team.on` listener) | Every kernel event → a `state` patch to every tab. | `<desk>/state/kernel-team.jsonl` |
| Artifact saved | `companion/team/kernel-team.js`: `save` (on `onChange`) | Debounced 300 ms; a `kernel {artifact, boards?}` event to every tab. | `<desk>/state/artifacts/<id>.json`, `<desk>/state/days/<ET day>/<id>.json` |
| Desk memory | `companion/team/kernel-team.js`: `createKernelTeam` (`memory`) | The folder handed to `start`: the desk's and its teams' memory and reports. | `custom/memory/<desk>/` |
| Schedule / wakes / background | `companion/team/kernel-team.js`: `createKernelTeam` (the `scheduleTimer` interval), `deliverWake`, `wake`; `companion/shared/wakes.js`: `startWakes` | Due runs to the lead (or the wake's agent); start's `run({wake, busy, log})` is the desk's background work. | `<desk>/data/state/wakes.jsonl` |
| Desk terminate | `companion/team/kernel-team.js`: `terminate`; `announce` (process exit) | Clears the schedule timer, stops wakes and background work, aborts runs; `server.json` removed on exit. | — |

## (c) Twin contract

Every kernel element describes itself as plain JSON with `twin()`; `companion/team/kernel-team.js` streams it
(`GET /__askk/team/stream`), `backend/live/registry.js` feeds the stores, a component draws it. A change that adds a
field adds its view.

| Element | `twin()` fields | Stream event that carries it | Store → component |
| --- | --- | --- | --- |
| Agent | `element, id, name, description, role, model, team, folder, desk, tools[], agents[], artifacts[], spawned ({by, goal, at, keep} \| null), status` | `snapshot.registry.engines[i].agent` (`definition`: folder relative, `kernel: true`, no `status`); a spawn or dismiss: `registry {registry, states: {<new>: state}}`; live state in `state {id, patch}` | `backend/live/registry.js` `Registry` (`#mirror`: a new agent's view starts from its state) → `backend/live/agent.js` `AgentView` → `components/agents/agent-page.jsx` `AgentDetail` (`spawned`: `backend/live/spawned.js` `spawnedLine` in its header; also the canvas card at near zoom, `components/canvas/agent-node.jsx`), `components/home/constellation.jsx` `Constellation`, `components/kernel/desk-levels.jsx` `DeskLevels`, `components/shell/status-bar.jsx` `EngineItem` |
| Tool | `element, id, name, type, view, description, input` (+ `agent` for an `AgentTool`; `agent.spawn`/`agent.dismiss`: type and view `spawn`; the kit's `files.*`, `terminal.*`, `preview.*`: type `dev`, view `files` \| `terminal` \| `preview`; `web.search`/`web.read`: view `web`) | the agent definition's `tools` (as specs, without `element`/`id`); each call: `state` patch message `{role: tool, view, inputs, output}` | `backend/live/visual.js` `callLook` (kind per view, `spawn` too) → `components/agents/agent-page.jsx` `ToolList`; `backend/live/follow.js` `liveFeed` → `components/live/feed/feed-row.jsx` `FeedRow`, `components/live/views/call-panel.jsx` `CallPanel` |
| Artifact | `element, id, kind, view, owner, title, keep, brief, state` (+ `items` for view `list`; a board's state `{goal, entries}`; the `Plan`'s `{goal, revision, by, at, items: [{id, text, required, status: open \| ticked \| skipped, note, by, at}]}`; `files`: `{root, tree: [{path, size, mtime, dir}] ≤ 800, truncated, open: [{path, by, at}] ≤ 12, modified: [{path, by, at, op, added, removed, diff ≤ 80 lines}] ≤ 30, focus: {path, by, at} \| null}`; `terminal`: `{sessions: [{id, name, command, cwd, agent, slot: main \| long \| null, runs, status, exit, startedAt, endedAt, urls, tail ≤ 50}] ≤ 12}` newest first (two per holder: `main` its runs, `long` its start; a slot session's fields and tail are its current command's); `preview`: `{pages: [{id, url, title, status, by, at, shot: {n, at, width, height, url} \| null, console ≤ 20, errors}]}`) + `holders` from `Desk.artifacts()` | `snapshot.kernel.artifacts[id]`; `kernel {artifact, boards?}` on change, and again when its holders change (spawn, dismiss); `kernel {removed: [id]}` when no agent holds it | `backend/live/desk.js` `kernelDesk`, `artifactsFor`, `artifactsHeldBy` → `components/views/artifact.jsx` `ArtifactBlock`, `components/live/artifacts-view.jsx` `ArtifactsView`, `components/kernel/desk-levels.jsx` `TeamCard` |
| Desk | `element, lead, tree, agents[], artifacts{id: twin + holders}` | its parts: `snapshot.registry.requiredId` (lead), `snapshot.kernel.tree` (`Desk.tree()`, nodes with `desk` and `spawned`; again as `kernel {tree}` on a spawn or dismiss), `snapshot.kernel.boards` | `backend/live/team-tree.js` `teamTree` → `components/home/constellation.jsx`; `backend/live/desk.js` `kernelDesk` (tree, removed) → `components/kernel/desk-levels.jsx`, `components/canvas/` |
| Run (events) | — (agent events, not a twin) | `state` patches: `status`, `activity`, `messages` (step, tool, gate, guidance, answer rows), `stats` | `components/agents/thread.jsx`, `backend/live/follow.js`, `components/shell/status-bar.jsx` `ActivityItem`, `ModelItem` |
| Desk log | — (host lines) | `log {at, source, text}`; the snapshot's `log` | `backend/live/log.js` `deskLog` → `components/live/desk-log.jsx` `DeskLogView`, `components/shell/status-bar.jsx` `DeskLogItem` |

## (d) The prompt

`Agent.render` (`backend/kernel/agent/agent.js`) writes every step's prompt in the owner's reading order (2026-10-17
owner: "soul, agent instructions, context, quest, history, tools and response format"): who the agent is, what it
is for, what it holds, what is asked, what was done, what it can call, how to reply. Optional parts are left out
when empty; the order of the rest never changes (`backend/kernel/test/prompt.test.js`).

| # | Part | Section |
| --- | --- | --- |
| 1 | soul | `config.soul`, desk-wide, no header (the prompt opens on it) |
| 2 | agent instructions | `# YOU ARE <name>` + `config.role` |
| 3 | context | every artifact the agent holds, `# <id> — <title>`, in its artifact order (`buildAgent`: least-changing first, the board last) |
| 4 | quest | `# REQUEST (from <who>)`, then `# OWNER GUIDANCE` directly under it while a note waits (guidance amends the quest) |
| 5 | history | `# EARLIER RUNS`, then `# WORK DONE ON THIS REQUEST` (this run's steps, newest last) |
| 6 | tools | `# TOOLS` (the brief's fields first when it holds agents) |
| 7 | response format | `# RESPONSE` (`RESPONSE_FORMAT`, + `REPORT_FORMAT` when `config.report`), or `# SYSTEM` when `config.system` replaces it |
