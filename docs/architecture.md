# Architecture map (2026-10-23)

A frozen read of the code as it stands (working tree incl. the uncommitted workflow changes). Nothing here changes
behaviour; it is the slice of view to read before any change. Line numbers drift — the file names stay.

## 1. The layers

```
 config you write            build                 run                     serve                    watch
 ───────────────             ─────                 ───                     ─────                    ─────
 <desk>/main.js        ┐
 <lead>/<lead>.md      │  companion/team/      backend/kernel/        companion/team/          backend/live/
 <agent>/tools.js      ├─ compose.js      ──▶  Desk · Agent · Tool ──▶ kernel-team.js    ──SSE──▶ stream → registry
 tools/<name>.js       │  composeDesk          Artifact · Workflow     state · rows · saves      → AgentView / kernelDesk
 teams/<t>/<t>.md      │  → buildDesk          (events)                team/call ◀──POST──────── → hooks → components
 phases/<flow>.md      ┘                                               host-api.js (fs, term, browser, web, mcp, llm)
```

One Bun process (`scripts/dev.js`) hosts every desk and the Next dev server on one port; `/__askk/*` is the desk
API, everything else the UI. The tab never runs agents (except the hosted browser mode, `backend/browser/`).

## 2. Boot, step by step

| # | Where | What happens | Variables |
|---|---|---|---|
| 1 | `scripts/dev.js` | parse args | `--desks` (custom), `--desk`, `--only`, `--agents`/`ASKK_AGENTS`, `--port`, `--hostname`, `--read-only` |
| 2 | `companion/team/desk.js` `hostedDeskFolders` | core `desks/*` + local `custom/*` (local wins on a name clash) | folders with a `main.js` |
| 3 | `companion/server/desks.js` `hostDesks` | `Promise.all(loadDesk)` — **parallel import** of every main.js | `{name, title, description, port, mcp, integrations, terminal, mounts, projects, host, setup, start}` + `deskPaths`, `memory = memory/<desk>` (`ASKK_MEMORY`) |
| 4 | `desks.js` | `for … await host(desk)` — **serial**: one desk fully up before the next | refuses a desk whose `state/server.json` pid lives |
| 5 | `kernel-team.js` `createKernelTeam` | `desk.start({port, live, log, memory})` | `ASKK_KERNEL_FIXTURE` → not live |
| 6 | `compose.js` `conventionDesk.start` | `init()` → `llmInfer` + fallbacks → `composeDesk` | `models`, `defaultModel`, `fallbacks`, `maxSteps` |
| 7 | `compose.js` `composeDesk` | `deskLead` → `builtinKit` → `deskSpec` (tools/, agent folders, `specOf` checks) → `readTemplates` → kernel `buildDesk` | agent .md keys (`KEYS`), `tools.js`, `teams/` |
| 8 | `kernel-team.js` | restore artifacts (by `keep`), boards (`memory/<desk>/<team>/board.md`), history.md → thread; `team.on` taps; schedule timer; `run()` background; wake book; respawn kept helpers | |
| 9 | `companion/server/host-api.js` | MCP, integrations, `desk.host()` wrap/guard/servers, capabilities, routes | `.mcp.json` + desk `mcp` |
| 10 | `dev.js` | Next dev on a private port; `Bun.serve` public port routes `/__askk/*` by `x-askk-desk` header → `askk_desk` cookie → default desk | |
| 11 | `dev.js` | `announce()` writes `state/server.json`; `startTelegram()` | |

## 3. Configuration surface (what you write → where it is checked)

| File | Shape | Parsed / validated |
|---|---|---|
| `<desk>/main.js` | `conventionDesk({title, description, models, defaultModel, fallbacks, maxSteps, init, builtin})` or a raw `{start, host, setup, …}` | `companion/team/desk.js` `loadDesk`, `compose.js` `conventionDesk` |
| `<lead>/<lead>.md` (members as subfolders) | frontmatter `name, description, title, goal, team, model, max_steps, context_chars, min_calls, writes, reads, board, tools, agents, desks, checklist, artifacts, after`; body = role | `compose.js` `readAgentFolder` (YAML, `{{var}}`), `specOf` (unknown key/tool/model/artifact = Error) |
| `<agent>/tools.js`, `tools/<name>.js` | `defineTool({name, description, input, run, view?, type?, outside?})` | `compose.js` `loadToolFile`/`loadTools`, kernel `defineTool` |
| `<agent>/practice.md` | seed of the agent's standing orders | `practiceStore` |
| `teams/<team>/<team>.md` | an agent spec minus `desks, checklist, min_calls, after, team` | `readTemplates`/`templateOf` → `env.templates` for `agent.spawn {template}` |
| `phases/<flow>.md` | frontmatter `deadline_minutes, retries, board, critical, past_deadline, vars`; `## <id> — <title>` + `key: value` lines (`STEP_KEYS`) + `### Output` | kernel `workflow.js` `parseWorkflowMarkdown` → `checkSteps`; **re-parsed every run** |

## 4. The object model (`backend/kernel/`)

| Object | Built from | State | Emits |
|---|---|---|---|
| `Agent` (`agent/agent.js`) | `config {name, role, soul, model, maxSteps=12, gateRetries=2, minCalls, contextChars, …}`, `{infer, tools, artifacts, context}` | `status`, `current {request, steps, outside}`, `history`, `guidance`, `chats`, `queue` | `start think step call result gate format guide compact answer error chat` |
| `Tool` / `AgentTool` (`tool/tool.js`) | `{name, description, input, run, type, view, outside}` / another agent (quest) | — | (through the agent: `call`, `result`) |
| `Artifact` (`artifact/artifact.js`) | `{name, title}`; `kind, view, keep` | `state` | `changed()` → `onChange` listeners |
| `Desk` (`desk/desk.js`) | `buildDesk(spec, env)` | `lead, list, board, ctx` | relays every agent event + `spawn dismiss keep proposal` |
| `Workflow` (`builtin/workflow.js`) | a phases file, re-read per run | `{status, run, stages[], result, runs, log, config, versions}` | `changed()` (debounced 1 s) |
| `Runners` (`builtin/runners.js`) | desk plug `{check, prepare, onFire}` | `runners[]` each `status, checks, last, fires` | `changed()` |
| Kit artifacts | `files terminal preview plan dispatch browse talk practice` (`builtin/index.js`) | each its own state | `changed()` |

## 5. One run, step by step (`Agent.ask` → `#run`)

1. `ask()` chains onto `this.queue` — **one run at a time per agent**, FIFO.
2. `start`: status running, artifacts' `onRunStart`, emit `start`.
3. Each step `n ≤ maxSteps`:
   1. `refreshArtifacts()` — every artifact in **parallel**, each ≤ 15 s.
   2. `render()` — soul → `# YOU ARE` → artifacts → `# REQUEST` (+ `# OWNER GUIDANCE`) → `# EARLIER RUNS` → `# WORK DONE` → `# TOOLS` → `# RESPONSE`.
   3. ≥ 90 % of budget → `#compact` (one model call, else clip) → emit `compact`.
   4. `collectImages()` — parallel.
   5. emit `think`; `infer(prompt, agent, {images})` (raced with the stop signal); emit `step`.
   6. Calls → `Promise.all` — **every call of a step concurrent**; each emits `call`, `result` (paired by `index`).
   7. Answer → gates (artifact `gate()`, `minCalls`, report fields) → refused: emit `gate`, go on; else `#finish` → emit `answer`.
4. Error or stop → emit `error`.

## 6. Backend → stream → UI pairing

| Backend | SSE | UI twin |
|---|---|---|
| agent `start / step / result / gate / format / compact / guide / chat / answer / error` | `state {id, patch}` (rows, activity, stats) | `Thread` rows (`components/agents/thread.jsx`), Live feed (`backend/live/follow.js` → `components/live/`) |
| agent definition | `snapshot` / `registry` | `/agents?name=` Debug (`agent-page.jsx`: turn by turn) |
| artifact change | `kernel {artifact}` | `ArtifactBody` → `VIEWS[view]` (`components/views/artifact.jsx`): every kernel view has a renderer |
| `spawn / dismiss / keep / proposal` | `registry` + `kernel {tree}` + a log line | tree, cards, `ProposedHelper` |
| desk log | `log` | Live › Desk log, status bar |
| workflow stages | `kernel {artifact}` (view `pipeline`) | `components/workflow/` card + viewer |

### Gaps: emitted or measured, not drawn — all closed 2026-10-23

A second, fresh audit after the first fixes listed every kernel event, desk event, artifact view, tool view, SSE field and
stage field against its UI. Closed, and verified on the live server (a run that searched, spawned, quested and
dismissed; then a server restart):

- Each tool call's `ms` and each step's model `ms`: thread, Live feed, kept in `history.md`, restored.
- `answer.flags` (gates let through after `gateRetries`): drawn, and restored.
- Gate `hard`: on the event and the row ("hard: retries never let it through").
- Spawn / dismiss / keep / proposal (set and dropped): `lifecycle` rows in the causing agent's thread, the Live feed, the
  run's loop on the canvas and in the workflow viewer (`runSteps`), both desk hosts; kept on the run's trail (`notes`) so
  a restored thread shows them where they fell. A kept helper respawned at start writes none (its spawner is idle).
- Compaction: numbers drawn as chips (before → after, % of budget, steps / runs folded, how); kept and restored.
- Artifact refresh failures: kernel event `refresh {artifact, ok, error}` once when it fails and once when it is back →
  a row (thread, feed, loop), kept and restored (before: only the prompt said so).
- Listener errors: the first reaches the desk log (`context.log`).
- Model fallback: the convention desk's `withFallbacks` logs each one (desk log).
- StepContract's text view showed "(empty)": it now keeps `state.text`.
- Dispatch job `by`: drawn. `dispatch`, `runners`, `pipeline` calls: their own look.
- A stage's `flow` (what flowed in by source and size, the prompt, what came out): a line under the phase's Input.
- Workflow `concurrency`: in the viewer's settings line.

Third audit (2026-10-23, fresh, after the above) — closed, verified live (a stopped run restored with its steps after
a restart):

- A failed or stopped run: the kernel's `error` event carries its `request` and `steps`; history.md keeps it with its
  trail; the thread's restore (`history.restore(agent, n, {all: true})`) brings back the newest failed runs and notes
  (≤ 2n) between the answered ones; EARLIER RUNS still reads answered runs only.
- A compacted run: the kernel keeps the folded steps in its record (`current.folded`, `#record`) — step n is
  `record[n - 1]` — so trail order, gates, times and rows match on restore.
- Step screenshots: kept on the trail and restored; the screenshots-only "saw" row is a note (restored where it fell);
  the browser desk draws it too.
- A desk event or refresh while the agent is idle: its own note section in history.md (`history.recordNote`).
- An owner chat's `visual` reaches the inline answer (the chat call returns it).
- Step rows carry their number `n` and an answer written beside calls; stats show total, reply size, last call, the
  answering model; runners their set time; the workflow viewer stage heads, the run before's status/time, learnings in
  force, the desk's prompts line, the run's note and deadline, each run's start–end, the result's `expect` and file.
- Looks: a `text` tool view; any view without a look is named in the feed. Lifecycle rows show keep / team / goal.
- Speech narrator: phrases for the kernel's real tools; quest reports narrated from real rows; the first snapshot is the
  baseline (restored answers were re-spoken). Runners' Start/Test form only where the artifact says it can.
- Removed: the `boards` stream field (boards are artifacts), `models: null`, `EMPTY_STATE.live`, `boardAt`.

Fourth audit (fresh) — closed, verified live (restart with saved stats; step number in the activity line):

- A restored call row draws as it did live: its `kind` / `view` are recorded with the run (`looks` on the trail).
- A run cut off by a hard kill: `state/running/<agent>.json` is written at start and removed when the run ends; one
  left at the next start is recorded as interrupted and shows in the thread. Model-call stats are saved
  (`state/agent-stats.json`) and restored; an agent whose last run failed restores as `error`.
- A step agent gone after a restart (or dismissed at the next run): no dead link; the stage says where its runs are
  kept (`state/spawned/<name>/history.md`), and the stage's own prompt and answer stand for it.
- `compact` rows carry the summary's `ms` and the step it came before; `think` carries its step into the activity
  ("Calling LLM… (step 3)"); a kernel runner's pace is read in its own sign and unit (checks).
- A workflow step's limits (`max_steps`, `min_calls`, `status`) and its `### Output` format are drawn in Work; the
  unused stage `file` field is gone.

Fifth audit (fresh) — closed, verified live (configuration panel; desk log across two restarts):

- A killed run restores with the steps it had taken: the run marker is rewritten at each step boundary with the
  request, `agent.runRecord` (outputs clipped) and the trail.
- Kept helpers restore like desk agents (`restoreAgent`: marker, stats, error status, thread).
- Stats are saved after every counted model call (a chat's and a compaction's too); the browser host keeps stats and
  the error status across a reload.
- The desk log's newest lines are saved (`state/desk-log.json`) and come back at start.
- The workflow viewer's Configuration panel: the run-wide settings (a desk's own from code included) and each step's
  how / waits / reads / contract / barrier.
- Schedule: the next run's why and the runs taken. Stage detail: every problem and the output file. The result's price
  levels. Runners: until when, and each fire's value. The narrator says a failed run once. Dead readers removed
  (`rows` prop, `workflowsOf`).

Sixth audit (fresh) — closed, verified live (a `kill -9` mid-run: launchd restarted the server; the thread showed the
run, its two finished searches and "interrupted"):

- The kill marker is written at each `think` (every finished step is in `agent.runRecord` then), not at a result.
- Practice retros come back from their store at start (`parseRetros`; both desk hosts' stores have `retros()`).
- The browser desk keeps its desk log (`log` in the store). Kept helpers respawned by an update restore their current
  stats. `llm.js`'s own backup-model fallback is a desk log line (`model: …`); the agent page no longer reads an
  "answered by" model no backend sends.
- An artifact block shows what a restart keeps of it (`keeps day | always | run | file`); the result says which
  stage wrote it and when; the Configuration panel names the workflow's folder.

Seventh audit (fresh) — closed, verified live (a log line written a moment before launchd's SIGTERM survived):

- Integrations (the Telegram listener: listening, a failed poll, a contested bot, a stopped listener) and a desk's
  `setup` script write to the desk log, not the console alone.
- A stop flushes what waits on a debounce (artifact saves, the desk log): SIGTERM / SIGINT exit through `exit`, where
  every desk's `flushSaves` runs; `terminate()` flushes too; the browser host writes its pending thread and artifact
  saves on terminate.
- A run marker of a helper that is not back is recorded in its own `spawned/<name>/history.md`, then removed.
- A proposal the restored thread shows waiting, which did not survive the restart: a row in that thread and a log line.
- A workflow run cut off by a restart is in its Runs list as interrupted.
- Listener errors reach the desk log at the 1st, 10th, 100th …; a dismissed helper's stats go with it.

Eighth audit (fresh) — closed, verified live (an `echo` terminal session listed again after a restart):

- A step still out at a kill: the run marker holds the step in flight (its thought, calls, the results in so far);
  the calls that never answered are marked `cut` and never drawn — the restored rows are the ones that streamed.
- Runs accepted and not started (a queued send, a due schedule run, a delivered wake) are on disk
  (`state/accepted.json`); at the next start each is a row in its agent's thread and a log line, to send again.
- Thread message ids are unique across processes (`k<boot>-<n>`).
- Finished terminal sessions come back from `terminal.jsonl` read-only as `earlier:<id>` with their last lines.
- Failed history / marker / stats writes are desk log lines; the speech hardware's lines reach the desk log; an
  interrupted stage is settled for the viewer's follow; the narration hint matches what is spoken; `stats.model`
  (never drawn, only ever the configured model) is gone.

Ninth audit (fresh) — closed, verified live (a `cat` session running at launchd's SIGTERM listed as stopped after it):

- A terminal session still running when the process ends gets its `terminal.jsonl` row (status stopped, "the server
  stopped"), so it comes back as `earlier:<id>`.
- A stop flushes an artifact's own debounce first (`Workflow.flush`: its 1 s `touch`), then the host's saves.
- The browser host flushes on `pagehide`, keeps runs handed over and not started (`queued` in the store), and at its
  next start says them and any proposal that did not survive, as the desk server does.
- Practice: the standing checklist and the last edit time are drawn; a retro that could not be written says so.
  Quality matrix rows show verdict, confidence, ok and time. A reload's "integrations not listened here" and "closing
  the previous version" reach the desk log.

By design: a reload whose previous version also fails to start leaves no desk to log into — the server log and the
desks/load answer say it.

Tenth audit (fresh, trade-card included) — closed, verified live (a `kill -9` with a running `cat` session; the
trade-card card and exec views):

- A terminal session running at a hard kill: `terminal-running.json` lists the running sessions; one left at start is
  recorded as killed ("the server was killed while it ran"); restored sessions keep their stop reason.
- A desk that keeps its card beside its result (trade-card): the result view merges both, and the card's other fields,
  the desk's record counters, learnings found / demoted, watch notifications and the calibration's time are drawn.
- trade-card's exec view lists the rest of its state (real positions and guard caps, the day's lock / stand-down /
  exit, conditions, catalysts, the week, fires); OpenAlice's down / back lines reach the desk log.
- A workflow's edit history survives a new day (`versions/index.json` beside the kept texts).
- Retro times are read back as UTC.

Eleventh audit (fresh) — closed:

- The browser host's kernel lines (`context.log`) reach its desk log.
- Practice: an unreadable file is kept as it is (never the seed written over it) and said; a failed save is said.
- trade-card: a broker read that fails (sync, manage, an order lookup) is on the position (`broker_error`) and the
  exec state (`broker`) with a log line; a sent order whose poll gets no answer says so on its row and in the log.
- Dispatch rows show a job queued behind its target's run and a report not read yet (twin `began`, `delivered`);
  terminal sessions show why they ended (`reason`, `error`, `signal` in the twin); learning candidates are listed with
  their counts; the Outcome shows a desk's learnings / notifications alone too; a step's required ```data example is
  drawn; a workflow step agent's line says it lasts until the next run (`managed`).

Twelfth audit (fresh) — every event, row, view and field had its twin; what remained were failures swallowed on the
save / restore path. Closed: a state file that does not read (queued runs, run markers, stats, Telegram's state, a
trade-card memory file) is set aside as `<file>.unreadable-<ms>` and named in the desk log — never dropped, reset or
written over silently; a kept helper whose .md does not parse, a history block that does not read, a terminal.jsonl
line, a session log that does not open, a reused stage's data, the workflow's version list, a desk's extra twin
fields, a practice seed or retros that do not read, and an artifact's screenshots that fail — each is a desk log line,
a state field or a refresh row. The browser host logs chats and guidance as the desk server does.

Thirteenth audit (fresh) — closed: the browser host checks every store write (a refused one is a desk log line, once
per key; a refused retro reaches Practice's `retroError`); an unreadable desk log or terminal-running.json is set aside
and said; a failed save of the running sessions and an unreadable terminal.jsonl are said; trade-card's broker account
read that fails is a stage error ("sizing from config.json's equity"); a desk an agent created is in the asking desk's
log; the browser host logs a guided ask; files: folders that do not list are named (`unreadable` on the twin), a search
counts the files it could not read; a speech setting not saved says so; the dead `s.events` read is gone.

Fourteenth audit (fresh) — closed: the book of running process groups (reaped after a crash) is set aside and said when
it does not read, and a write that fails is said; a workflow's version list that does not read is set aside before an
edit replaces it; a practice's pending line that does not parse is kept as written and said (never dropped at a save),
and its retros' read error has its own field; trade-card says a day file left out of its reports; the Telegram bridge
says when the desk's stream ends and answers what waits at once; a keep-run helper that could not be dismissed, or is
still working after its caller's run, is a desk log line; a session log file that stops taking output is said.

Fifteenth audit (fresh) — closed: a workflow that does not load stays editable from the viewer (its twin says
`editable`); a practice seed that does not read keeps its error; trade-card says a real position whose stop/target did
not move (on the order and in the log), a group-mute file that does not read, and daily bars that did not come; a
stage's files that do not parse are named under its Input; saved preview visuals that no longer check are named
(`dropped`); the restart sweeps' own failures are log lines; the browser host counts and says views that throw.

Sixteenth audit (fresh) — closed: a screenshot the host could not give is thrown, so the agent's refresh row says the
step went without it; a legacy transcript's unreadable lines are counted like history.md's; a run marker that could not
be written at a run's start is said; a watch glob whose folder would not list is said (`unreadable` on the glob's
result); the Telegram live status says when it stops following; the board view draws its goal and each entry's time.

Seventeenth audit (fresh) — closed: the browser host says at start when it has no storage (nothing outlives the tab),
which saved values no longer read, and clears (and says) a run helper that did not come back; trade-card says a slot
that waits (the lead busy, a run going) and a falsify re-run skipped because the lead is busy; a preview template that
no longer checks is named in `dropped`; a terminal row not written at the stop is said; a terminal row shows reason,
error and signal together; a mounted desk's refusal carries its own reason; a kept-helper folder that does not list is
said; trade-card refuses a report.md that is there but unreadable (the viewer shows it); the live speech transcript's
failure is on the tab's console.

Kept on disk for a person, not drawn: `state/kernel-team.jsonl` (every event, an audit trail) and
`state/days/<day>/` (each day's artifacts). A dispatch's jobs keep `file` (they end with their holder's run, so a
restart starts it empty).

By design: an owner chat's rows are not in history.md (a chat is never a run); Clear memory clears the live thread
and EARLIER RUNS but leaves history.md (the record); a restart restores the newest `historyKeep` answered runs (plus up
to twice as many failed runs and notes), not the whole 400-row window.

UI-only branches with no backend source were removed: `approvals`, `inbox`, `quests`, `contextWindow` on agent state;
activity phases `parsing / agent / approval / summarizing / compacting`, stages `thinking / responding`, `retry`; the
`paused` visual state; the speech pipeline's approval path and `approval-card.jsx`. The home tree's quest lines now read
the real calls out (`questsOut`), so they light when a quest is out.

## 7. Serial and parallel

| Where | Mode | Why |
|---|---|---|
| Desk modules load | parallel | `Promise.all(loadDesk)` |
| Desks host (start, restore) | serial | `for … await host()` — implementation choice |
| `desks/load` reloads | serial | one promise queue; 409 while the desk works |
| Runs of one agent | **serial** | `this.queue` — by design (one `current`) |
| Runs of different agents | parallel | no cross-agent lock |
| Owner chat | parallel with runs | outside the queue |
| Calls in one step | parallel | `Promise.all`; results paired by `index` |
| Artifact refresh / images | parallel | `Promise.all` |
| Quest (`AgentTool`) | blocks the caller's step; two quests to one agent serialize on its queue | `await agent.ask` |
| `dispatch.start` | parallel, ≤ 6 per holder | not awaited; the target's queue still serializes its own jobs |
| Workflow runs | serial | `this.active` |
| Workflow steps | DAG — parallel when `after` allows, ≤ `concurrency` | scheduler starts every ready step, `Promise.race`; **default `after` = previous step**; a code step blocks only its readers (or every later step with `barrier: true`) |
| Step attempts (retries) | serial | required |
| Runners in a tick | checks parallel, fires serial | `Promise.allSettled` over checks; `onFire` one at a time (it wakes agents) |
| Schedule / wake book | 30 s timers; delivery not awaited | |
| Polled artifacts | one refresh at a time per artifact, only while a tab watches | |

### Where parallel steps collided (fixed 2026-10-23 unless marked open)

- **Board order** (fixed). `renderPhase`, `renderStep`, `flowStep`, `stepVariables` build a phase's board from steps *earlier in
  the file*, not *upstream* — with siblings running together, what a phase sees depends on timing.
- **Two phases on one agent** (refused at load now). They queue on the agent anyway; worse, the second's grants are skipped (`tools.has`), then
  deleted when the first ends; `config.maxSteps` save/restore overlaps and can leave the first phase's override in
  place; `watchAgent` counts both runs' turns on both rows.
- **No concurrency cap** (fixed: `concurrency:`) on research calls or spawned step agents.
- **Kernel `emit`** (fixed) called listeners without a try: a throwing listener (a UI tap) ends the run.

## 8. Changes (2026-10-23)

1. Kernel `emit` isolates listener errors (`listenerErrors`; the first to the desk log); the run goes on.
2. Workflow — what a step reads is what it waits on: board, `{{phase}}` vars, `inputs: all` from `settledBefore`, never
   file order. The scheduler waits on the whole `settledBefore` set (a reused step does not vouch for a code step
   re-run under it); `waitsOf` = `after` + what the step reads (`inputs`, `{{step}}`) + code steps marked
   `barrier: true`. A code step blocks only its readers by default.
3. Workflow — two phases on one `agent:` that may run side by side do not load; the error names the fix.
4. Workflow — `concurrency: N` caps the steps running at once (0 / unset: no cap); shown in the viewer.
5. Runners — due runners are checked together (`Promise.allSettled`); results and fires applied one at a time, in order.
6. Twins — every gap above.

Tests: 794 core + 186 trade-card pass (`agent.test.js` watchers/timings/refresh, `workflow-md.test.js` parallel phases,
barriers, concurrency, `builtin-runners.test.js`, `follow.test.js`, `kernel-team.test.js` spawn + history notes).

## 9. Which page is for what (2026-10-23 owner)

- **Dashboard** (`/`): where the owner talks to the desk — Goal and phase, a rolling conversation (requests/answers),
  the message box, the voice bar (continuous wake word or single command, 1.5 / 2 s pause) — and sees which agent runs
  what: "At work now" rows (activity, the request and from whom, elapsed, last call, Stop).
- **Live follow** (`/live`): every call as it happens and the state it left — the call panel draws the artifact the call
  acted on (`callArtifactId`), "after this call" when nothing later touched it, else "now — N later calls changed it".
- **Debug** (`/agents?name=`): one agent turn by turn; no message box.
- Canvas: the same live view on a pannable map.

## 10. Audit 18 (closed)

trade-card exec view: the real-order guard's mode and caps (`realItems`); preview binds: a failed status read or stop
shows on the bind (never "stopped" while it may run); checklist view: required "!", who and when; browser host:
an artifact save refused is said once per key; desk server dismiss line carries its reason.

## 11. Audit 19 (closed) and the studio (2026-10-23)

Audit 19:
- **Refusals said:** a send the desk refuses is said (dashboard box and voice), and a Clear memory refusal is said too.
- **Clear memory:** refused mid-run on both hosts; the button hides while the agent runs.
- **Dashboard chat:** an ask and its reply draw whole on the dashboard (`ChatPair`: visual, Queue it, guided).
- **Voice:** the voice's last note or error shows. Single mode closes even on "stop".
- **Owner's requests:** Telegram requests count as the owner's. The At work now source reads "your request (Telegram)", "quest from <agent>" or "from <source>".
- **Live follow:** "after this call" counts refresh rows and changes the tab saw with no call (owner, poll, restart).
- **Statuses:** skipped stages and plan items get their own status.
- **Goal card:** it shows the answer for runs the owner did not start.
- **Stale note:** "Queued" clears when the run it waited behind ends.

The studio: images on this Mac. Host `image/*` (mflux, one GPU job at a time) → kernel `studio` artifact (goal,
prompt versions, images with lineage and live progress, critiques, pick, owner feedback; a holder sees its new images
on its next model call) → `StudioView`. Desk `custom/studio`: artist (prompt optimisation, variants, refine) + critic
(a second model). Serial: image jobs (one GPU). Parallel: the artist's other work while images render (studio.wait is
the join).

## 12. Local models, the studio's edits, voice switches, Telegram for every desk (2026-10-23)

- **One models folder** (`companion/models`): `models/<kind>/<name>/model.md` per model — kind stt | tts | image, its
  engine (apple | say | command | openai), how it runs (fixed argv, `inputs` as flags, `modes`), what it accepts, its
  options with defaults and the owner's `values:` (written back by the panel, so they survive a restart);
  `models/models.md` the one chosen per kind; seeded from the tracked catalogue. Speech: mlx-audio's OpenAI-compatible
  server (Parakeet, Whisper, Qwen3-ASR, Granite; Kokoro, Qwen3-TTS, Chatterbox), started by the helper and killed with
  the desk server. Verified live: Parakeet 35 ms warm (punctuated), Kokoro 89 ms warm.
- **Image models say what they take**: Qwen Image 2.1's `generate` (prompt, init + strength) and `edit` (references,
  mask, auto_mask). Presets (`models/image/presets/*.md`) shape a call. One GPU for the process.
- **Studio**: the model and presets in its state; marks (zoom, boxes with notes) → the marked image the agent sees + a
  mask; the owner's goal runs `phases/make.md` (expand → choose the preset → generate → critique → refine). Verified
  live: photo beat illustration on same-seed drafts; pick 8.6/10; a marked mug became a fern under the mask (8.8/10).
- **Listening and speaking are separate**: `speak` off by default; the mic never turns it on.
- **Telegram**: every hosted desk posts its runs' live status (a running workflow stage by stage) and reports; one desk
  takes the messages.
- **Audit 20 (closed)**: one GPU queue per process; a closed desk starts nothing; model servers never killed for a slow
  probe, killed on start timeout; values starting with "-" never become flags; image routes without a restart;
  marks kept on a refused call; marks go to a live maker; `key_env` limited; uploads owner-only and size-checked;
  install lines `uv tool install` / `brew install` only; touch targets; critique scores in any list form (the live run's
  critic sent `[{light: 9}]`).
