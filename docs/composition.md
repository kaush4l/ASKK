# Composition — the kernel's classes, their variables, instances and how to change them

<!-- Written by `bun scripts/composition.js` from backend/kernel/classes.js and each class's statics. Do not edit by hand:
     change the class (or BASES in classes.js) and run the script; `--check` fails while this file is stale. -->

ASKK is plain classes composed by configuration. Every object on a desk is an instance of one of the classes below;
the live board of instances is the **/compose** page, which draws these classes beside them (a click on an instance
names its class and where a change to it goes). Read this file before changing ASKK itself: find the class, follow its
*How to change*, keep it on the standard, run the checks, then run `bun scripts/composition.js`.

Layers: configuration (`custom/<desk>/` files) → `composeDesk` → kernel instances (`Desk`, `Agent`, `Tool`, `Artifact`s)
→ the desk server streams their twins → the tab draws each twin by its view. Map: docs/architecture.md; rules:
docs/philosophy.md; the desk format: docs/standard.md.

## Changing ASKK from within

1. Name the object (an agent, a tool, an artifact, a workflow) and look up its class here or on /compose.
2. A change to one instance is configuration: its `.md`, `main.js` or workflow file. A change to every instance is its class.
3. Follow the class's *How to change*; a new event, field or command lands with its UI twin in the same change.
4. Run its tests, `bun test` in backend/ and components/, and `bun scripts/composition.js --check`.
5. Run `bun scripts/composition.js` so this file follows; add the dated note to CLAUDE.md / backend/kernel/README.md.
6. Kernel, companion or custom/shared changes need the server restarted (the dev desk's `dev.restart`: supervised, rolled back when it breaks).

## The standard

- **about** — the class says what it is for in one line: `static about`
- **commands** — every command has a description and an input (`static commands`, never a hand-written commands())
- **kind** — a bare instance names its kind, view and keep
- **registered** — a kit artifact is in BUILTIN.artifacts and in classes.js KINDS
- **twin** — its view has a renderer in components/views/artifact.jsx (checked by scripts/composition.js)
- **tested** — a kit artifact has backend/kernel/test/builtin-<type>.test.js (checked by scripts/composition.js)
- **documented** — backend/kernel/README.md names it and docs/composition.md is current (checked by scripts/composition.js)

All 21 artifact classes are aligned.

## Base classes

### Desk

The team: agents built from nested specs (buildDesk), a board per team, spawn and dismiss at run time; twin() is every element as plain JSON.

File: `backend/kernel/desk/desk.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `name` | main |  | the desk's name (its folder) |
| `title / description` | main |  | what the header and cards say |
| `lead` | field |  | the top agent (the one non-reserved <lead>/<lead>.md folder) |
| `ctx` | field |  | the build context kept for spawn: env.tools, env.artifacts, env.templates, env.models |
| `builtin` | main |  | options for kit artifacts: builtin.dev {project, checks, preview}, builtin.surgeon {folder} |
| `projects / browser / terminal / mcp / sanitize / telegram / listen` | main |  | host capabilities the desk asks for (companion/team/desk.js) |

Hooks:

- `start({port, live, log, memory})` — → {desk, ready?, run?}: builds the agents (conventionDesk does it from the folders)
- `run({wake, busy, log})` — background watchers on a continuous server
- `host({call, env, state})` — → {wrap?, guard?, servers?}: shapes mcp/call

How to change:

1. A desk is configuration: custom/<desk>/main.js = `export default conventionDesk({title, description, …})`, agents as folders <lead>/<lead>.md (members as subfolders), tools/<name>.js, teams/<team>/<team>.md, phases/<flow>.md.
2. Check it before loading: `bun scripts/desk.js check custom/<desk>` (unknown keys, tools, models, artifacts fail naming the file).
3. Reload without a restart: POST /__askk/desks/load {name} (409 while it works). A change under backend/kernel, companion or custom/shared needs the server restarted (dev.restart: supervised, rolls back when it breaks).
4. Kernel behaviour for every desk changes in desk.js only; a desk never patches the kernel.

Tests: backend/kernel/test/kernel.test.js, team.test.js, spawn.test.js; companion/team/compose.test.js. Docs: docs/standard.md, docs/architecture.md.

### Agent

One ReAct loop: render → infer → parse → answer or run the step's calls together. Every agent is this class; what differs is what fills its slots.

File: `backend/kernel/agent/agent.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `name` | config | name | unique in the desk; names its folder, history.md and quests |
| `description` | config | description | one line: its card, its line in a lead's TOOLS |
| `role` | config | (body) | what it is for and how it works (the .md body) — never what a tool, artifact or the response format already says |
| `soul` | config | (soul.md) | the desk's shared opening, first in every prompt: <desk>/soul.md, else desks/soul.md (compose.js readSoul) |
| `soulFile` | config |  | the file the soul was read from, shown on the agent page |
| `model` | config | model | a desk model name; default the desk's |
| `maxSteps` | config | max_steps | steps before the run ends (default 12) |
| `minCalls` | config | min_calls | tool calls before an answer is taken (a gate) |
| `gateRetries` | config |  | soft refusals before the answer goes through flagged (default 2) |
| `contextChars` | config | context_chars | prompt budget in chars, else contextBudget(model); compaction at 0.9 of it |
| `refreshMs` | config |  | an artifact's refresh longer than this is a failed refresh (15 s) |
| `router` | config |  | a step router {decide, act}: predicts each step's calls before the model call; shadow unless act (docs/jepa-router.md) |
| `historyKeep` | config |  | earlier runs shown under # EARLIER RUNS (default 3) |
| `report` | config |  | true: the answer carries the report format |
| `system` | config |  | replaces # RESPONSE entirely (rare) |
| `team` | config | team | the team it belongs to (its lead's board) |
| `folder` | config | folder | where its .md, history.md and practice live |
| `spawned` | config |  | {by, goal, at, keep, team} for a helper made at run time, else absent |
| `writes / reads` | file | writes / reads | lane globs files and terminal honour (no writes: refused) |
| `board` | file | board | false keeps it off its team's board |
| `tools / artifacts / agents / desks` | file | tools / artifacts / agents / desks | what it holds, by name (resolved at compose time) |

Hooks:

- `on(event, fn)` — start | think | step | call | result | gate | format | guide | answer | error | chat | compact | refresh | inbox
- `ask(request, {from})` — a run (queued behind the one in progress)
- `guide(text)` — a note for the next step
- `chat(text)` — one model call beside the runs
- `stop(reason)` — every run and chat ends
- `addArtifact / removeArtifact` — hold or drop an artifact

How to change:

1. One agent's behaviour = its file: edit <desk>/<lead>/…/<name>/<name>.md (the frontmatter keys above, the body its role). Never subclass Agent for one agent.
2. Every agent's behaviour = agent.js. A new config key: read it in agent.js, list it here under Agent (test/classes.test.js fails otherwise), map its frontmatter key in companion/team/compose.js KEYS, write it in docs/standard.md.
3. A new prompt section keeps the order soul → YOU ARE → TOOLS → artifacts → REQUEST → EARLIER RUNS → WORK DONE → RESPONSE (the stable start first); update backend/kernel/README.md (d) and test/prompt.test.js.
4. A new event: emit it in agent.js, give it a row in backend/live/team-rows.js and a look in backend/live/visual.js in the same change (the twin rule).

Tests: backend/kernel/test/agent.test.js, prompt.test.js, compact.test.js, chat.test.js. Docs: backend/kernel/README.md, docs/soul-and-role.md.

### Tool

Anything an agent calls, in one TOOLS list: a function, an MCP tool, an artifact command, another agent (AgentTool).

File: `backend/kernel/tool/tool.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `name` | field |  | TOOL_NAME: lowercase, dot-separated (<id>.<command> for an artifact's) |
| `description` | field |  | what it does and when to use it — shown in TOOLS |
| `input` | field |  | {field: "what it means"} |
| `type` | field |  | function (the same call within 3 min answers from the first) \| dev \| artifact \| agent \| spawn \| desk \| mcp |
| `view` | field |  | how the Live feed draws a call (web, terminal, quest, checklist …) |
| `outside` | field |  | true: its results are text this desk did not write (provenance holds what the run learns) |

Hooks:

- `run(input, ctx)` — ctx = {...agent.context, agent, signal, outside}; reach the host only through ctx.host
- `spec()` — its definition for the UI

How to change:

1. A desk's own tool: custom/<desk>/tools/<name>.js `export default defineTool({name, description, input, run, view?, type?, outside?})`, or the agent's tools.js; `bun scripts/tool.js check <file>`.
2. A kit tool: a factory in backend/kernel/builtin/<file>.js registered in BUILTIN.tools (builtin/index.js); it shows in this catalogue's tools by itself.
3. A tool that reads the world sets outside: true; one that changes the world is type dev (never answered from the cache).
4. Its calls need a look: backend/live/visual.js callLook by view.

Tests: backend/kernel/test/kernel.test.js, builtin-web.test.js; scripts/tool.js check. Docs: docs/standard.md.

### AgentTool extends Tool

Another agent as a tool: the call is a quest {requirement, ask, outcome} (QUEST_INPUT), the result its report.

File: `backend/kernel/tool/tool.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `agent` | field |  | the agent it quests |
| `after` | field |  | agents that must have answered this run first |

How to change:

1. Never built by hand: a spec's members become AgentTools in buildDesk; agent.spawn adds one for each helper.

Tests: backend/kernel/test/team.test.js. Docs: backend/kernel/README.md.

### Artifact (abstract)

State an agent keeps beside its conversation: its latest state in every prompt, commands that change it, a view that draws it, owner calls the UI makes.

File: `backend/kernel/artifact/artifact.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `about` | static |  | one line: what it is for (this catalogue, docs/composition.md) |
| `commands` | static |  | {name: {description, input, run?, type?, view?, outside?, usage?}} → the holder's tools <id>.<name> |
| `commandType` | static |  | "dev" (changes the world) or "artifact" (only itself) |
| `owner / ownerCan` | static |  | {method: name \| fn}: the owner's calls (team call target artifact); ownerCan the refusal's words |
| `options` | static |  | what main.js builtin.<type> may set, when it takes any |
| `name (id)` | field |  | lowercase, dot-separated; names its commands |
| `kind` | field |  | what it is (maps a live instance to its class) |
| `view` | field |  | how its twin draws (components/views/artifact.jsx VIEWS) |
| `keep` | field |  | day \| always \| run \| file: what is restored at start |
| `poll` | field |  | ms: the host refreshes it that often while a tab watches |
| `state` | field |  | plain JSON; change it with bump(patch), or set it and changed() |

Hooks:

- `render()` — its block in the prompt (its head line says how to use it)
- `brief()` — its state in one line (cards, status)
- `refresh(agent)` — async, before each step: reads host state; changed() only when the twin differs
- `gate(agent, answer)` — a reason (or {reason, hard}) to refuse the answer
- `attach / detach(agent)` — a holder added / dismissed
- `onRunStart(agent, request)` — a holder's run starts
- `images(agent)` — screenshots for the next model call
- `snapshot / restore` — what keep saves
- `twinState()` — what its twin shows

How to change:

1. New kit artifact: backend/kernel/builtin/<type>.js `class X extends Artifact` with `static about`, `static commands` (every entry a description and an input), `static owner` when the owner acts; kind, view, keep (and poll) set in the constructor; state changed only through bump().
2. Register it: BUILTIN.artifacts in builtin/index.js (perDesk), KINDS in backend/kernel/classes.js, its export in backend/kernel/index.js.
3. Its twin in the same change: a renderer for its view in components/views/artifact.jsx VIEWS (pure logic in backend/live/<type>.js), a call look in backend/live/visual.js.
4. Its test: backend/kernel/test/builtin-<type>.test.js over test/fake-host.js.
5. Docs: its entry in backend/kernel/README.md and CLAUDE.md, then `bun scripts/composition.js` rewrites docs/composition.md; `bun scripts/composition.js --check` must pass.
6. Changing one: edit its statics (the command table), never a role's prose to work around it; keep its twin's state shape, or change its view with it.

Tests: backend/kernel/test/builtin.test.js, hold.test.js, twin.test.js, classes.test.js. Docs: backend/kernel/README.md, docs/composition.md.

### Checklist extends Artifact

Items an agent ticks with evidence; required ("!") items gate the answer while open.

File: `backend/kernel/artifact/checklist.js`

Variables:

| name | set in | frontmatter key | means |
| --- | --- | --- | --- |
| `items` | field |  | [{id, text, required, status, note}] |

Hooks:

- `requiredWhen(id)` — a required item that may be skipped when it does not apply now

How to change:

1. Extend it (as Plan does) rather than writing a second checklist; its gate stays in gate().

Tests: backend/kernel/test/plan.test.js. Docs: backend/kernel/README.md.

## Artifact classes

Read from each class (its statics and a bare instance): what is here is what the code declares.

| class | kit type | extends | kind | view | keep | commands | owner calls | standard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SharedBoard | (kernel) | Artifact | board | board | day | 1 | 0 | aligned |
| Checklist | (kernel) | Artifact | checklist | checklist | day | 2 | 0 | aligned |
| QualityMatrix | (kernel) | Artifact | quality | quality | day | 0 | 0 | aligned |
| Schedule | (kernel) | Artifact | schedule | schedule | always | 1 | 0 | aligned |
| Runners | (kernel) | Artifact | runners | runners | always | 3 | 5 | aligned |
| StepContract | (kernel) | Artifact | contract | text | file | 0 | 0 | aligned |
| Files | files | Artifact | files | files | always | 9 | 0 | aligned |
| Terminal | terminal | Artifact | terminal | terminal | file | 7 | 0 | aligned |
| Preview | preview | Artifact | preview | preview | always | 17 | 4 | aligned |
| Plan | plan | Checklist | plan | checklist | always | 3 | 0 | aligned |
| Dispatch | dispatch | Artifact | dispatch | dispatch | file | 5 | 1 | aligned |
| Browse | browse | Artifact | browse | browse | day | 8 | 0 | aligned |
| Talk | talk | Artifact | talk | talk | always | 3 | 2 | aligned |
| Goal | goal | Artifact | goal | goal | always | 10 | 12 | aligned |
| Dev | dev | Artifact | dev | dev | always | 7 | 0 | aligned |
| Ask | ask | Artifact | ask | ask | day | 1 | 1 | aligned |
| Studio | studio | Artifact | studio | studio | always | 10 | 8 | aligned |
| Surgeon | surgeon | Artifact | surgeon | surgeon | always | 17 | 15 | aligned |
| Audio | audio | Artifact | audio | audio | always | 9 | 5 | aligned |
| Workflow | workflow | Artifact | workflow | pipeline | day | 2 | 8 | aligned |
| Practice | practice | Artifact | practice | practice | file | 4 | 2 | aligned |

### SharedBoard

a team's shared board: what each member posted toward the team's goal, saved in memory/<desk>/<team>/board.md

File: `backend/kernel/artifact/board.js` · extends Artifact · kind `board` · view `board` · keep `day` · commands type `artifact`

State: `goal`, `entries`

Commands:

- `board.write` — write an entry on the probe.board board (same key replaces)

Owner calls: none. Hooks it defines: render, brief, detach, snapshot, restore, twinState.

### Checklist

items ticked with evidence; open required items refuse the answer

File: `backend/kernel/artifact/checklist.js` · extends Artifact · kind `checklist` · view `checklist` · keep `day` · commands type `artifact`

State: `items`

Commands:

- `checklist.tick` — tick an item done
- `checklist.skip` — skip an item that cannot be done

Owner calls: none. Hooks it defines: render, brief, gate, onRunStart.

### QualityMatrix

a quality bar scored per criterion

File: `backend/kernel/artifact/quality.js` · extends Artifact · kind `quality` · view `quality` · keep `day` · commands type `dev`

State: `rows`

Owner calls: none. Hooks it defines: render, brief, attach.

### Schedule

the desk's next runs: when, what, for whom

File: `backend/kernel/artifact/schedule.js` · extends Artifact · kind `schedule` · view `schedule` · keep `always` · commands type `artifact`

State: `next`, `defaultGoal`, `history`

Commands:

- `schedule.next` — book the desk's next run and the goal it starts with (replaces any booked run)

Owner calls: none. Hooks it defines: render, brief.

### Runners

periodic checks a desk plugs in, each with its own run state (running, paused, fired …)

File: `backend/kernel/builtin/runners.js` · extends Artifact · kind `runners` · view `runners` · keep `always` · commands type `dev`

State: `runners`, `revision`

Commands:

- `runners.pause` — pause a runner: it keeps its state and is not checked until resumed
- `runners.resume` — resume a paused, errored, stopped or fired runner: checked again from now
- `runners.check` — check one running runner now (its reading, gap and whether it fires)

Owner calls: pause, resume, now, stop, remove. Hooks it defines: render, brief, restore.

### StepContract

a step agent's contract: code checks its document before the answer is taken

File: `backend/kernel/builtin/workflow.js` · extends Artifact · kind `contract` · view `text` · keep `file` · commands type `dev`

State: `step`, `schema`, `check`, `tries`, `problems`, `text`

Owner calls: none. Hooks it defines: render, brief, gate.

### Files

the workspace's files: list, read, open, write and edit inside the holder's lanes, every change a diff

File: `backend/kernel/builtin/files.js` · extends Artifact · kind `files` · view `files` · keep `always` · commands type `dev`

State: `root`, `tree`, `truncated`, `open`, `modified`, `focus`, `unreadable`

Commands:

- `files.list` — list a folder: names, / for folders, sizes
- `files.open` — keep files open: each one's current text stays in your prompt (read again every step and after each change) until you close it — at most 25; close what you are done with to keep the prompt small
- `files.close` — close open files (their text leaves your prompt)
- `files.read` — read a file once with line numbers (a one-off look; open keeps it in your prompt); from/lines for a slice of a big one
- `files.write` — write a whole file (folders are created); only inside your writes: lane
- `files.edit` — replace one exact passage of a file (old must match once, whitespace included; all: true replaces each)
- `files.append` — add text at the end of a file (created if missing)
- `files.search` — find the lines that hold a text (case-insensitive) in the files under a folder, or in one file
- `files.focus` — show another folder as the tree's root (for every holder)

Owner calls: none. Hooks it defines: render, brief, refresh, restore.

### Terminal

the holder's terminal sessions on the host (main: one command at a time; long: kept running), sandboxed to its lane

File: `backend/kernel/builtin/terminal.js` · extends Artifact · kind `terminal` · view `terminal` · keep `file` · commands type `dev`

State: `sessions`

Commands:

- `terminal.run` — run a command to its end in your main session (no shell: one program, or several joined by &&; cd moves inside the workspace; one at a time — one that keeps running belongs in start): its exit and last lines
- `terminal.start` — start a command in your long session and keep it running between your steps while you run commands in the main one (a dev server, a training run, a watcher; it replaces what ran there): its id, the URLs it prints
- `terminal.wait` — wait on a running session: until it exits, a new line holds the until text, or seconds pass
- `terminal.read` — a session's last lines (its scrollback: each command under its $ line)
- `terminal.send` — send a line to a running session's stdin
- `terminal.stop` — stop a running session
- `terminal.list` — every session in one line each, and the programs this desk runs

Owner calls: none. Hooks it defines: render, brief, refresh.

### Preview

the one pane the owner and agents both watch: live pages and visuals, the owner's questions about what is shown

File: `backend/kernel/builtin/preview.js` · extends Artifact · kind `preview` · view `preview` · keep `always` · poll 3000 ms · commands type `dev`

State: `pages`, `visuals`, `current`, `trail`, `asks`, `recordings`, `revision`

Commands:

- `preview.open` — open a page of an app running on this computer (http://localhost:<port>; the desk server's own only on a desk that lets its agents view this app — then an agent's view: you read, navigate, click and type, nothing you do there writes, no eval) and put it in the owner's pane: its text outline
- `preview.goto` — go to another URL on the page
- `preview.click` — click an element (a CSS selector) or a point
- `preview.type` — type text (into the selector's element, clicked first)
- `preview.press` — press a key
- `preview.scroll` — scroll the page
- `preview.text` — the page's whole text outline: headings, text, links, buttons, inputs
- `preview.eval` — evaluate a JavaScript expression in the page: its value
- `preview.console` — the page's console lines and errors
- `preview.shot` — take a screenshot for the owner (you read the page with text)
- `preview.close` — close the page
- `preview.record` — start recording the page: every action on it from now (open-goto-click-type-press-scroll-shot) is a frame the owner plays back — its screenshot, the action, the URL; end with cut
- `preview.cut` — end your recording (the owner plays it back in the pane)
- `preview.show` — draw a visual in the owner's pane (the same id redraws it): a spec you build — a flow, steps, a matrix, a line, bars, tokens, a scatter or a compare, animated for the owner — a workspace JSON file holding one (read again as it changes), or a terminal session's live output
- `preview.focus` — put a page or a visual in the owner's pane (the item there goes on the trail the owner goes back along)
- `preview.answer` — answer a question the owner asked in the preview; show: the page or visual that shows the answer (it goes in the pane)
- `preview.drop` — drop a visual from the preview

Owner calls: ask, open, back, rerun. Hooks it defines: render, brief, refresh, gate, attach, detach, images, snapshot, restore.

### Plan

the desk's plan written at run time: a goal and items ticked with evidence; gates the holders attached with gate

File: `backend/kernel/builtin/plan.js` · extends Checklist · kind `plan` · view `checklist` · keep `always` · commands type `artifact`

State: `goal`, `revision`, `by`, `at`, `items`

Commands:

- `plan.write` — write the desk's plan: the goal and the items that mean it is done, each observable; replaces the open items (closed ones still listed stay closed)
- `plan.tick` — tick a plan item done
- `plan.skip` — skip a plan item that cannot be done

Owner calls: none. Hooks it defines: render, brief, gate, attach, detach, onRunStart, restore.

### Dispatch

quests handed to agents in parallel: start, wait, read, stop; no job outlives its holder's run

File: `backend/kernel/builtin/dispatch.js` · extends Artifact · kind `dispatch` · view `dispatch` · keep `file` · commands type `dev`

State: `jobs`

Commands:

- `dispatch.start` `{to, requirement, ask, outcome}` — hand one of your agents a brief and keep working while it runs (a quest waits for its report; this does not): the job's id — at most 6 running
- `dispatch.wait` — wait until a job ends, owner guidance arrives or seconds pass: the reports that came back, what still runs
- `dispatch.read` — a job's whole report, or its error
- `dispatch.stop` — stop a job you started (its run ends at its next step)
- `dispatch.list` — your jobs, one line each

Owner calls: stop. Hooks it defines: render, brief, gate, attach, detach.

### Browse

a text web browser on the host, a tab per holder: open, search, click links, back, GET forms

File: `backend/kernel/builtin/browse.js` · extends Artifact · kind `browse` · view `browse` · keep `day` · commands type `dev`

State: `tabs`, `visits`

Commands:

- `browse.open` — open a public web page in your tab: its text in parts, each link marked [n], each form [form Fn: …]
- `browse.search` — search the web into your tab: a results page whose results you follow with click
- `browse.click` — follow a link of the page you are on
- `browse.back` — go back to the page before
- `browse.more` — read on: the next 4000-char part of the page
- `browse.find` — the passages of the whole page around words (links kept)
- `browse.links` — the page's links: number, text, address
- `browse.submit` — submit a GET form of the page (a search box) with your fields; a POST form is never sent

Owner calls: none. Hooks it defines: render, brief, snapshot, restore.

### Talk

the desk's side of the conversation: results said and questions asked of the owner, never waited on

File: `backend/kernel/builtin/talk.js` · extends Artifact · kind `talk` · view `talk` · keep `always` · commands type `dev`

State: `messages`, `seen`, `revision`

Commands:

- `talk.say` — tell the owner something: a result with its numbers and where it is, a finding, what runs now — they read it in the talk panel, with your drawing under it
- `talk.ask` — ask the owner what only they can decide (a direction, a trade-off, a go-ahead) — draw it (visual) so they see the choice, not read it; keep working: the reply comes as OWNER GUIDANCE or a new run
- `talk.drop` — withdraw a question of yours that no longer needs an answer

Owner calls: reply, seen. Hooks it defines: render, brief, snapshot, restore.

### Goal

the desk's standing goal: its measure, every run's progress, the ledger and milestones; the host resumes it on cadence

File: `backend/kernel/builtin/goal.js` · extends Artifact · kind `goal` · view `goal` · keep `always` · commands type `dev`

State: `goal`, `status`, `reason`, `keeper`, `cadence_minutes`, `next_at`, `next`, `failures`, `stall`, `workflow`, `flow_run`, `entries`, `ledger`, `milestones`, `frames`, `revision`

Commands:

- `goal.frame` — frame the request you run now as a goal, first: the outcome, what shows it done, and the route its complexity takes — the least that does it
- `goal.set` — set the desk's standing goal — an outcome it keeps working toward across runs, with how progress is measured; only when the owner asks for a goal to pursue
- `goal.note` — keep one line in the goal's ledger — it outlives the conversation and every compaction: a fact (checked, with evidence), a guess (to check), a decision (taken, and why) or a dead_end (tried, failed, and why — so no later run tries it again)
- `goal.forget` — retire a ledger note that turned out wrong or no longer holds
- `goal.plan` — write the goal's milestones — replaces the open ones (done ones stay): each a checkable item; parallel agents claim them
- `goal.claim` — take an open milestone before working on it — no other agent takes it while your run lasts (released when it ends)
- `goal.done` — mark a milestone done, with what its check showed
- `goal.progress` — record what this run did toward the standing goal and what came of it — every run while the goal is active
- `goal.met` — the target is reached: the desk stops resuming the goal
- `goal.pause` — stop resuming the goal on its own (a blocker only the owner can clear, a market closed)

Owner calls: set, pause, resume, drop, now, cadence, feedback, request, workflow, note, forget, release. Hooks it defines: render, brief, gate, attach, detach, onRunStart, snapshot, restore.

### Dev

the project a dev desk changes: init, checks, git status, checkpoints, supervised restart with rollback

File: `backend/kernel/builtin/dev.js` · extends Artifact · kind `dev` · view `dev` · keep `always` · poll 5000 ms · commands type `dev`

Options (main.js `builtin.dev`):

- `project` — the project name in main.js projects
- `checks` — {name: command | {command, cwd}}: the checks dev.check runs
- `preview` — {command, url}: the app the preview opens

State: `project`, `checks`, `passed_at`, `git`, `preview`, `links`, `checkpoints`, `restarts`, `noted`, `health`, `revision`

Commands:

- `dev.init` — make the project ready to change — once, before any other work on it (a fresh worktree on its own branch, its setup run)
- `dev.check` — run the project's checks in your terminal, in the project — after every change; your answer waits while a change is unchecked
- `dev.status` — the project's git status: its branch and every file changed
- `dev.checkpoint` — keep the project's tree as it is now (a point to roll back to) — a good one is kept on its own whenever every check passes
- `dev.rollback` — put the project's tree back to a checkpoint (the tree now is kept as another: the evidence of what broke)
- `dev.health` — ASKK itself: does the live server answer — every desk hosted, the pages compile (/, /live, /compose)
- `dev.restart` — ASKK itself: restart the live server so kernel and server changes take effect — only with every check passing; if it does not come back healthy, the tree is rolled back to the last good checkpoint and the server restarted on that. Your run ends with the server; the outcome is in the goal's ledger when the loop resumes

Owner calls: none. Hooks it defines: render, brief, refresh, gate, attach, onRunStart, restore.

### Ask

"what is this?" answered now, no run: the pointed element's class file:line, its state now and the code lines the question names — the latest answer only

File: `backend/kernel/builtin/ask.js` · extends Artifact · kind `ask` · view `ask` · keep `day` · commands type `artifact`

State: `question`, `element`, `answer`, `cites`, `at`, `revision`

Commands:

- `ask.what` — answer "what is this?" now, with no run: the pointed artifact's class file:line, its state now and up to 5 code lines the question names — one answer, the next replaces it

Owner calls: what. Hooks it defines: render, brief, attach, detach.

### Studio

images made on this Mac's open model: prompt versions, critiques, the owner's feedback and the pick

File: `backend/kernel/builtin/studio.js` · extends Artifact · kind `studio` · view `studio` · keep `always` · poll 2000 ms · commands type `dev`

State: `goal`, `criteria`, `prompts`, `images`, `picked`, `feedback`, `model`, `presets`, `preset`, `revision`

Commands:

- `studio.goal` — set what the image is for and what done means
- `studio.prompt` — save a new prompt version: the optimised prompt and why it changed
- `studio.generate` — queue images on this Mac's image model from a prompt version — refine an image (from + strength), or edit it (references, mask, auto_mask: when the model accepts them)
- `studio.wait` — wait until images finish; then you see them on your next step
- `studio.critique` — judge an image against the goal and criteria
- `studio.pick` — mark the best image so far
- `studio.look` — see an image again on your next step (to compare)
- `studio.send` — send an image to the owner's Telegram chat (a result, or a choice to ask about)
- `studio.presets` — the presets and what the image model accepts
- `studio.preset` — choose the preset every generate uses (or none)

Owner calls: goal, generate, preset, pick, send, stop, delete, feedback. Hooks it defines: render, brief, refresh, gate, attach, images, snapshot, restore.

### Surgeon

a model run under a debugger: breakpoints, step, inspect tensors, patch, compare

File: `backend/kernel/builtin/surgeon.js` · extends Artifact · kind `surgeon` · view `surgeon` · keep `always` · poll 1500 ms · commands type `dev`

Options (main.js `builtin.surgeon`):

- `folder` — the runtime's folder in the workspace (default surgeon/)

State: `folder`, `session`, `runtime`, `stale`, `views`, `compare`, `sent`, `runs`, `whys`, `timeline`, `replays`, `source`, `diff`, `asks`, `revision`

Commands:

- `surgeon.start` — start a model run in DEBUG: it stops on breakpoints and waits (training or generation) — e.g. script experiments/tiny-gpt/run.py, args "--mode train --steps 2000 --pause-at-start"
- `surgeon.continue` — run on to the next breakpoint (answers where it stopped, or that it is still running)
- `surgeon.step` — step INTO: stop at the next debug point the forward pass reaches
- `surgeon.next` — step OVER: stop at the next training step or generated token
- `surgeon.pause` — stop the run wherever it is now (the next debug point)
- `surgeon.break` — set a breakpoint: at a debug point (a module name from FLOW), "step" (a step / token boundary), or "*" with nan (stop on the first NaN/Inf)
- `surgeon.clear` — remove a breakpoint (id, or all)
- `surgeon.inspect` — make a view of the frame where the run stopped, shown in the surgeon pane — or a view you wrote (script)
- `surgeon.patch` — from now on change a debug point's output: kind ablate (units → 0) or scale (units × factor)
- `surgeon.unpatch` — remove a patch (id, or all)
- `surgeon.compare` — put two views side by side in the pane (observations compared)
- `surgeon.stop` — end the run
- `surgeon.runs` — the recorded runs (every debug run is recorded: its trace, weight snapshots and a copy of its code), newest last
- `surgeon.timeline` — show a recorded run's whole course in the pane: its metrics and every debug point's |act| over the steps
- `surgeon.replay` — THE LIVE REPLAY: draw one view across a recorded run's weight snapshots — a frame per training step, played in the pane (attention forming, the lens sharpening, a feature appearing); prints the numbers per step
- `surgeon.source` — the PROCEDURE behind a debug point: the code of its forward and the line that calls it, from that run's own copy of the code — shown in the pane beside the views
- `surgeon.diff` — compare two recorded runs: their code change (a diff per file) and their metrics (curves overlaid) — after you changed the code and trained again

Owner calls: continue, step, next, pause, stop, break, clear, inspect, unpatch, compare, timeline, replay, source, diff, ask. Hooks it defines: render, brief, refresh, attach, restore.

### Audio

scripts voiced on this Mac's speech models, files transcribed back, sent to the owner's Telegram

File: `backend/kernel/builtin/audio.js` · extends Artifact · kind `audio` · view `audio` · keep `always` · poll 3000 ms · commands type `dev`

State: `jobs`, `tts`, `stt`, `models`, `catalog`, `styles`, `transcripts`, `revision`

Commands:

- `audio.models` — the speech models: in use, installed, voices, options, and how to write a script for each (its SCRIPT FORMAT)
- `audio.prepare` — get a catalogue speech model onto this Mac: added and installed (its weights download on first use)
- `audio.make` — make an audio file from a script — [chapter: title] and [style: name] lines make a long, multi-voice piece that streams out chapter by chapter; unstyled text uses the model given, in its SCRIPT FORMAT
- `audio.wait` — wait until audio files are made
- `audio.transcribe` — an audio file to text on the speech-to-text model; for a file made here, how much of its script was heard
- `audio.send` — send a finished audio file, or one chapter of it, to the owner's personal Telegram chat
- `audio.styles` — the voice styles: how each is voiced and its WRITING guide — read it before writing a styled script
- `audio.style` — set a voice style from the owner's feedback (their words in why)
- `audio.samples` — the same short passage voiced in each style (a chapter each), sent to the owner to compare — then audio.style from their feedback

Owner calls: make, send, transcribe, stop, delete. Hooks it defines: render, brief, refresh, gate, attach, snapshot, restore.

### Workflow

a workflow file run step by step (code, an agent's run, step agents), each step's report on the board

File: `backend/kernel/builtin/workflow.js` · extends Artifact · kind `workflow` · view `pipeline` · keep `day` · poll 15000 ms · commands type `dev`

State: `date`, `status`, `run`, `stages`, `result`, `runs`, `log`, `config`, `versions`

Commands:

- `workflow.run` — run the workflow (every step in order) and return its result; blocks until done — or re-run from a step
- `workflow.read` — today's whole document of a step

Owner calls: stop, stage, step, edit, source, check, version, run. Hooks it defines: render, brief, refresh, gate, attach, detach, restore.

### Practice

an agent's standing orders it improves itself: checklist, quality, instructions, lessons; held edits wait for the owner

File: `backend/kernel/builtin/practice.js` · extends Artifact · kind `practice` · view `practice` · keep `file` · commands type `artifact`

State: `file`, `revision`, `at`, `run`, `sections`, `pending`, `changelog`, `retros`, `edits`, `readError`

Commands:

- `practice.tick` — tick a run checklist item done
- `practice.skip` — skip a run checklist item that does not apply now
- `practice.edit` — change your standing orders for every later run — a checklist item, a quality bar, an instruction, a lesson, a tool you lack; old + new replaces that line, new alone adds, old alone removes; why: the run's evidence. After this run read the web (or a helper's report that did), an instruction or checklist edit is proposed for the owner, not in force
- `practice.reflect` — the run's retro, your last item: what held, what this run missed (a gap in the checklist, the quality bar, an instruction, a tool), and the edits you made for it

Owner calls: accept, drop. Hooks it defines: render, brief, gate, attach, onRunStart.

## Kit tools

Attached by name (`tools: [web.search, agent.spawn]`); a desk's own tool of the same name wins.

| tool | type | view | outside | does |
| --- | --- | --- | --- | --- |
| `agent.catalog` | spawn | spawn |  | before agent.spawn: what you can give a helper — your tools and the desk's (what each does), the artifacts you hold (your commands on each) and the desk's artifact types, team templates, models — and your helpers now (status, keep, goal) |
| `agent.dismiss` | spawn | spawn |  | dismiss a helper you spawned (agent.spawn) once it has answered; its helpers go with it (a team goes whole: dismiss its lead) |
| `agent.spawn` | spawn | spawn |  | make a helper agent for a stated goal: it joins your team and you quest it like your other agents; it gets your soul, model and file lanes (writes, reads, model, max_steps default to yours, each only narrower), and only the tools and artifa |
| `agent.update` | spawn | spawn |  | change a helper you spawned — its role (instructions), goal, tools, artifacts, lanes, model or max_steps — or keep it (keep: desk: it stays across runs and restarts, written as its agent.md); only the fields given change |
| `desk.ask` | desk | desk | yes | give a hosted desk work for its lead (or one of its agents): wait: true returns its answer when its run ends (minutes; polled, never timed out short of max_minutes); without, it is queued and you go on |
| `desk.check` | desk | desk |  | does a desk compose: its agents' tree and every agent's tools (nothing runs) |
| `desk.create` | desk | desk |  | write a new desk custom/<name>/ from a spec — its lead (goal, role, checklist and quality bar as practice, the tools and artifacts it needs: start with one capable lead that spawns helpers; add fixed members only for a workflow that never c |
| `desk.list` | desk | desk |  | the desks hosted in this server: name, what each is for, what it runs now |
| `desk.load` | desk | desk |  | host a desk in the running server, or reload it with its files as they are now (refused while it works) |
| `desk.propose` | desk | desk |  | propose tool code a desk lacks (export default defineTool({name, description, input, run}) — docs/standard.md): kept in custom/<name>/proposed/tools/<file>.js for the owner, who moves it into tools/ to accept it; tell the owner (talk.ask) w |
| `desk.read` | desk | desk | yes | read a file in a hosted desk's workspace (what it wrote: a report, a preview), or list a folder of it — read only |
| `speech.say` | function | — |  | speak a text aloud through the host (macOS `say`): the owner hears it. Off macOS: a 501 error (no speech there) |
| `web.read` | function | web | yes | read a public page: its title, URL and text — with find, only the passages around those terms (use it: a whole page is long) |
| `web.search` | function | web | yes | search the web, wikipedia, arxiv or hn: numbered results with source, title, URL and snippet. Prefer source web for general questions; use arxiv only for papers. A rate-limited or failing wikipedia/arxiv/hn call is retried once on web (see  |

