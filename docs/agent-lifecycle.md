# Agent lifecycle — birth, loop, context, supervision, memory, nesting

Reference map of how an ASKK engine lives (2026-10-13, read from code; every claim cites file:line at the time of writing — lines drift, names hold). Companion docs: `docs/philosophy.md`, `docs/teams-plan.md`, `docs/parallel-dev-team.md`.


Every path below is relative to `/Users/kaush/Downloads/Dev/powerhouse/`. Every claim cites the file and line it comes from.

---

## 1. Engine birth

```
registry.start()                         backend/runtime/registry.js:157
  ├─ detectHost() has "team"? ── yes ─► #startRemote(): mirror the server over SSE (:161-163, :213-244)
  ├─ loadAgents() + models.load()                                  (:167)
  │    definitions.js loadAgents → loadSource → parseAgent → validateAgent
  │    (private sources first, then public; :331-359, :363-405, :269-315)
  ├─ saved edits layered on top (:170-181); kept spawned agents added (:185)
  ├─ #factory({agent,name,host}) per agent                         (:188)
  │    browser: new EngineProxy → Web Worker engine-worker.js      (:46)
  │    server : runOnServer factory, in-process                    (:101-104)
  ├─ engine.restore() for each one                                 (:190)
  ├─ requiredId = engines[0]  (the default lead)                   (:193)
  ├─ createSupervisor(...)                                         (:196)
  └─ startIntegrationBridge(default engine)                        (:201)
```

- **Strategy.** `createEngine` reads `agent.strategy` (default `"react"`) and looks it up in `ENGINES`. Only `ReActEngine` is registered (`backend/engines/index.js:7-14`).
- **Construction.** `BaseEngine` cannot be instantiated directly (`core/base-engine.js:112`). The constructor creates `Memory(name)` and calls `configure(agent)` (`:120-121`).
- **What `configure()` builds** (`core/engine/definition.js:269-305`):
  - Artifacts come from `createArtifacts(agent.artifacts)` (`features/index.js:352-358`). Saved state survives a reconfigure (`:279-280`).
  - Tools are assembled from four sources:
    - `createTools(agent.tools)`. If the agent has the `filesystem` artifact, `fs.read` and `fs.list` are dropped (`:283-285`).
    - Every artifact's `commands()` (`:286`).
    - One `AgentTool` per name in `agents:`, described through `directory.describe` (`:287-293`).
    - `quest.steer` and `quest.recall`, added if the agent has `agents:` or the `team` artifact (`:296`).
  - An unknown tool name still becomes a `Tool` but fails when invoked (`features/index.js:402-404`, `core/tool.js:480`).
- **MCP tools load lazily.** `_toolContext = null` (`definition.js:299`). The first letter calls `_describeTools()` (`core/engine/inbox.js:268`), which runs `loadMcpTools(agent.mcp)` and adds the tools plus their CONTEXT lines once per definition (`core/engine/prompt.js:228-242`).
- **Two runtimes:**
  - **Browser/demo.** Each engine runs in its own Web Worker. Letters go out as `postMessage({type:"send"})` and the registry routes them (`runtime/engine-worker.js:61-67`, `:78-82`).
  - **Local server.** `companion/team/team.js:151-152` starts one Bun Worker (`team-worker.js`). In that worker the registry builds every engine in the same thread (`companion/team/team-worker.js:84-95`). The directory's `send` there calls `host.send` directly. Autopilot is one static per thread (`core/tool.js:448`).

---

## 2. The loop

### Letters

`deposit()` (`core/engine/inbox.js:43-58`) handles each letter kind differently:

| kind | handling |
|---|---|
| `request`, `quest` | Gets an id, a `_origins` promise, and `_keepLetter`, then `_enqueue` (`:49-56`) |
| `report` | `_receiveReport` joins it into its batch (`quests.js:378-393`) |
| `cancel` | `_cancel` (`quests.js:522-528`) |
| `guidance` | `_receiveGuidance` (`quests.js:440-448`) |
| `status` | `_receiveStatus`: only the newest per quest is kept (`quests.js:410-414`) |
| `reports` (internal) | Built by `_receiveReport` once every quest in the batch is back |

`_drain()` (`inbox.js:182-208`) works one letter at a time. Letters that continue existing work go first: reports and status (`:190`). A new run can be held by `_deferRun` (`:191`, see §5).

### One letter: `_workOn` → `run()`

```
_workOn(letter)                                       inbox.js:259
  origin = reports? letter.origin : status? quest.origin : letter   (:264-265)
  _describeTools(); memory:run → _freshForRun()       (:268-269)
  request msg pushed; state.working = {origin, quest, replyTo…} (:283-298)
  answer = await this.run(text, request, signal)      (:301)
  _dispatched ? origin.rounds++ : settle(origin)      (:304-305)
         │
ReActEngine.run                                       engines/react-engine.js:9
  for step ≤ maxSteps (∞ unless max_steps):
    autoSummarize()                                   (:12)
    reply = step()  ──► guidance spliced in           inference.js:23-29
                        persist(); refreshArtifacts() (:31-34)
                        renderPrompt(elements())      (:35)
                        complete() streamed, 2 retries (:52-63)
                        responseModel.fromRaw(raw)    (:72)
    action ≠ tool & pendingChecks() → refuse ≤2 (∞ if strict) (:20-34)
    action ≠ tool → final answer, return              (:35-39)
    plan = parseToolPlan(response)                    (:41)
    runTools(plan)                                    (:54)
    waitingForReports()? → push "Waiting…", return    (:57-61)
```

### Prompt rendering

The slot order is `soul, instructions, tools, response, history, artifacts, context, request` (`core/template.js:13-22`). Empty slots are dropped. Cache breakpoints go after `response` and after `history` (`:25`, `:29-38`), and are sent as Anthropic `cache_control`.

### Parsing the reply

- `action` must be `tool` or `answer`. Any other value is coerced to `tool` (`core/responses.js:208-213`).
- `parseToolPlan` turns the response into stages:
  - One call per line or comma is one stage.
  - `parallel[...]` is a single stage.
  - It accepts lenient JSON and the `name {json}` shorthand (`core/tool-plan.js:103-152`).

### Running tools

`runTools` (`core/engine/tools-run.js:25-103`):

- More than 16 calls in one response is refused (`:27-37`; `lib/config.js:45`).
- Stages run in order. The calls inside a stage run with `Promise.all` (`:85`).
- After a failed stage, later stages are marked skipped (`:57-62`, `:99-100`).
- Artifacts refresh after any stage that writes (`:92-98`).

`executeTool` (`:106-138`):

- A bare MCP name resolves if exactly one tool ends with it (`:110-114`).
- `approval` tools wait on `_requestApproval` unless autopilot is on. A declined call is cached for the rest of the request (`:119-128`; `core/engine/approvals.js:12-38`).

### Quests

1. `AgentTool.invoke` calls `caller.dispatchQuest` and refuses a quest to itself (`core/tool.js:499-504`).
2. `dispatchQuest` checks `maxRounds`, records `{origin, batch: letter.id}`, delivers through `directory.send`, and returns immediately (`quests.js:344-366`).
3. The step ends with `waiting: true` (`react-engine.js:57-61`).
4. Reports join per batch. When the last one arrives, they come back as one `reports` letter carrying the original `origin` (`quests.js:378-393`).
5. The model sees that letter as "Reports are back…" with a round counter (`inbox.js:236-255`).

Only a final answer settles the origin. `_settle` sends a `report` to `replyTo` if the origin was a quest, and resolves `ask()` (`inbox.js:211-227`).

---

## 3. What the CONTEXT and other slots carry

`elements()` (`prompt.js:200-212`):

| slot | source |
|---|---|
| soul | `agent.soul`: the shared or per-agent `soul.md` (`definitions.js:369`, `:386`), with no header (`template.js:47-50`) |
| instructions | `## YOUR ROLE` + agent.md body + inlined `skills:` (`definition.js:341-346`) |
| tools | One line per tool, plus the quest and parallel notes (`prompt.js:172-194`) |
| response | `responseModel.getInstructions(format)` (`definition.js:304`) |
| history | Messages before the current request (`prompt.js:160-170`) |
| artifacts | Every `artifact.render()` under `## ARTIFACTS` (`core/engine/artifacts.js:417-421`) |
| context | Clock + `Tool.context()` lines + MCP lines + open quests (`prompt.js:205`, `:215-222`; `template.js:62-70`) |
| request | `CURRENT REQUEST` + `WORK DONE ON THE CURRENT REQUEST` + the request restated (`template.js:75-86`) |

Artifacts are refreshed before every step (`inference.js:34`; `artifacts.js:389-392`):

- **checklist** (`features/checklist/artifact.js:97`). `pending()` checks only for non-status work (`:167-172`).
- **filesystem** and **shared**. `SharedArtifact extends FilesystemArtifact` and expands everything (`features/filesystem/artifact.js:107`, `:327-333`).
- **skills.** Resets per origin when `memory: run` (`features/skills/artifact.js:36-45`).
- **compact.** Throttled to `CHECK_MS` (`features/compact/artifact.js:125-134`).
- **team.** Pulls the roster (`features/team/artifact.js:46-53`).
- **terminal** (`features/terminal/artifact.js:27`).

`Tool.context()` lines come from fs (`features/filesystem/tools.js:258`) and web (`features/web/tools.js:101`, `:113`). They are computed once per definition.

---

## 4. Supervision

`createSupervisor` ticks every 15 s (`runtime/supervisor.js:34`, `:112`; `lib/config.js:69`).

```
engine X running, working.quest && working.replyTo        supervisor.js:43
  new finished steps ≥ owner.check_steps (10) or
  ≥ check_minutes (5) since the last status               (:63-65)
    → deliver(owner, {kind:"status", text: digest(fresh)}) (:67-73)

owner.quests[] where target not (running || working)
  for ≥ stall_minutes (10)                                (:87-93)
    → status {stalled:true}, repeated every stall_minutes (:95-106)
```

- **The owner's side turn.** A status letter runs as a turn that never settles the origin (`inbox.js:263`, `:305`, `:316`).
- **The text it reads.** It is told "on track: one line", or to use `quest.steer` / `quest.recall` (`quests.js:416-435`).
- **steer.** Sends a `guidance` letter to the worker, which picks it up at its next step (`quests.js:484-489`; `inference.js:25-29`).
- **recall.** Sends a `cancel` and fakes a failed report so the batch still joins (`quests.js:491-498`).
- **Owner guidance from Live.** `engine.guide()` (`inbox.js:15-21`).

---

## 5. Memory

- **Files.**
  - `agents/<engine>/memory.md` and `inbox.json` (`core/memory.js:80-81`, `:98-106`).
  - `history-<time>.md` archives, capped at `historyKeep` (6) (`memory.js:110-125`; `lib/config.js:50`).
- **When it is saved.**
  - Before every step (`inference.js:31`).
  - After every letter (`inbox.js:328`).
  - Restored at startup by `restore()` (`core/engine/memory-ops.js:285-298`).
- **`memory: run`.**
  - Each request or quest archives the log and starts empty. Artifacts get `startRun()` (`inbox.js:76-84`).
  - A new run is held while quests are out, for up to 15 min (`inbox.js:89-95`; `lib/config.js:59`).
- **Auto-summarize.**
  - Runs before each step once the rendered prompt reaches ≥ 92 % of the window, and only if history is ≥ 10 % of the window (`memory-ops.js:359-381`; `lib/config.js:51`).
  - The window is min(model, 262144 / `ASKK_CONTEXT_CAP` / `context_window`) (`core/engine/helpers.js:12-18`; `definition.js:322-338`).
- **Hibernate.**
  - Triggers when the engine is idle, the inbox is empty and no quest is out. It keeps the last 20 messages (`inbox.js:135-157`; `lib/config.js:64`).
  - It is on only where `globalThis.askkHibernateMinutes` is set: server shims default it to 30 (`companion/team/shims.js:131`). In the browser it is 0, which means off (`inbox.js:136-138`).
- **`inbox: keep`.** Unsettled requests and quests are saved and redelivered on `restore()` (`inbox.js:100-118`; `memory-ops.js:295`).

---

## 6. Nesting (a quest of a quest)

**Supported.** Nothing stops an agent that received a quest from calling its own `agents:`. The chain below is traced through the code.

```
A ──quest q1──► B            B.origin = q1 {replyTo: A.id}
                B ──quest q2──► C   q2.origin = q1, batch = B's letter   quests.js:355
                B run returns "waiting"; q1.rounds++ (no settle)        inbox.js:304
                C answers → _settle(q2) → report to B.id                 inbox.js:212-220
                B gets "reports" letter, origin = q1                     quests.js:386-391
                B answers → _settle(q1) → report to A.id
A gets reports letter → continues A's own origin
```

- **Cancel cascades.** When A recalls q1, B runs `_cancel(q1)`. That aborts B's work and recalls every quest whose `origin.id === q1`, so C is cancelled too (`quests.js:522-528`).
- **The supervisor tracks C for B.** `working.quest` is the origin quest, even while C is on a `reports` letter (`inbox.js:291-293`), so status letters go to B.
- **False STALLED (code-level hazard).** While B waits on C, B is `idle` with `working: null` (`inbox.js:302`, `:324`). The stall check only counts `running || working` as busy (`supervisor.js:89-90`). If C takes longer than A's `stall_minutes`, A gets a STALLED status for q1 telling it to recall. Recalling q1 would cancel the healthy C.
- **Limits that apply:**
  - The agent cannot list itself in `agents:` (`definitions.js:284`). It cannot send itself a quest at runtime either (`tool.js:502`; `registry.js:59`).
  - `max_rounds` applies per origin at every level (`quests.js:348-353`).
  - Each response can make at most 16 calls (`tools-run.js:27`).
  - **There is no depth limit and no cycle detection.** A→B→A is delivered, because routing picks the first live engine with that name other than the sender (`registry.js:57`).
  - **"An agent once per parallel group" is not enforced in code.** No check exists in `tool-plan.js` or `tools-run.js`. Two calls to the same agent produce two quests to the same engine. They are worked one at a time, and the batch joins both.
- **Spawned agents are always leaves:**
  - A spawned agent cannot spawn (`runtime/spawner.js:221`).
  - Its definition has `agents: []` and the `team` artifact removed (`:67`, `:111`). It therefore gets no AgentTools and no quest tools (`definition.js:287-296`).

---

## 7. `agent.spawn` and the spawner

- **`agent.spawn`** (`features/team/artifact.js:136-147`):
  1. `directory.spawn(spec)` builds the definition and engine.
  2. `dispatchQuest(name, goal)` hands it the goal.
  3. If the first quest fails, the new agent is killed.
- **The definition** (`spawner.js:60-131`):
  - It inherits the caller's soul, model, response_format and skillset.
  - `tools`, `mcp` and `artifacts` must be a subset of the caller's (`:50-56`, `:65-67`).
  - `writes` must sit inside the caller's lane (`:70-79`). `preserve` and `strict` are inherited (`:118-119`).
  - It always has `memory: "keep"` (`:114`) and `max_steps` 40 by default, capped at 200 (`:121`; `lib/config.js:74-75`).
- **Limits:**
  - At most `spawn_max` (6, cap 20) alive per caller (`:223-227`; `lib/config.js:82`).
  - Names must be unique across the team (`:229-231`).
- **Ending:**
  - The reaper ends task agents after `idle_minutes` (30) idle (`:182-192`).
  - `kill` ends one, and its open quests are recalled first (`team/artifact.js:191-196`).
  - `keep` saves the agent to `askk.spawned`, and it is restarted with the team (`spawner.js:245-251`; `registry.js:185`, `:192`).
- **Routing.** It goes through the registry's `#host` (`registry.js:64-67`), worker `host` messages (`engine-worker.js:70-82`), or `spawnDirectory` on the server (`team-worker.js:89`).

---

## Constraints for a team-of-teams design

**Supported:**
- **Hierarchies of any depth** built from static `agents:` lists. Reports route back level by level, and each level's `origin` is preserved (§6).
- **Fan-out at each level** with `parallel[...]`. Results join per batch (`quests.js:382-392`). The ceiling is 16 calls per response.
- **Cascading cancel and stop** down the tree (`quests.js:522-528`; `base-engine.js:198-203`).
- **Status, steer and recall** from each direct parent, on that parent's own `check_*` and `stall_minutes` settings.
- **Round caps per origin at every level** (`max_rounds`) and step caps (`max_steps`).
- **One extra tier of short-lived helpers** under any agent that has the `team` artifact. This includes mid-tier agents, because the static agents themselves are not `spawned`.

**Not supported, or hazardous:**
- **No quests between teams or desks.** `host.send` looks only inside one registry (`registry.js:56-58`). Each desk is its own `createTeam` and worker (`companion/team/team.js:74`, `:151`). `team/send` is a one-way `request` with no `replyTo` and no report (`team.js:252-264`), so a "team of teams" has to live inside one registry.
- **Spawned agents cannot delegate** (no `agents:`, no `team`). A spawned sub-lead cannot run its own sub-team.
- **No depth limit and no cycle guard.** A→B→A is allowed and can interleave runs.
- **A mid-tier agent is single-threaded.** It works one letter at a time. While it waits for reports, a second parent's quest will start (with `memory: keep`, that interleaves its history). With `memory: run`, the second quest is held for up to 15 min (`inbox.js:89-95`).
- **Routing goes to the first live engine by name** (`registry.js:57`). Two parents sharing one sub-lead share that one engine.
- **False STALLED for a waiting mid-tier: fixed 2026-10-13.** The supervisor now counts a target with open quests of its own as busy (`supervisor.js` stall check), so a team lead waiting on its members is not reported STALLED.
- **No hard deadline unless set: added 2026-10-13.** agent.md `quest_minutes` arms a timer per quest handed out; with no report by then the quest is called back in code (`quests.js` `_armDeadline`) and reports back failed, so the batch still joins. The supervisor alone cannot bound a member stuck in one long inference (no new steps, no status).
- **"Once per parallel group" is documented but not enforced.**
- **Quests are not persisted across restarts** unless the receiver has `inbox: keep`. Even then, the sender's `_quests` map is in memory only (`base-engine.js:97`), so reports after a restart find no quest and are dropped (`quests.js:380`).
- **On the server, every engine shares one thread.** Concurrency is async, not parallel CPU (`team-worker.js:84-95`), and autopilot is global to that thread.