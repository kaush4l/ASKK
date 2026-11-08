# Translation: LocalAgents → askk objects

DESIGN ONLY. Nothing here is built, and no engine gets ported until the owner approves this file.
The wire and the object shape come from `docs/contract.md`, and where this file and the contract
differ, the contract wins. Any contract change proposed here is listed in §A and has to be agreed
there first.

Sources read:
- **main**: `LocalAgents/src/core` (engine.js, artifacts/message-board.js, artifacts/cron.js,
  artifacts/skills.js, artifacts/developer.js, tools/{agents,authored,files,terminal,mcp,clock}.js,
  inference.js, methods/{openai,anthropic,cli}.js, models.js, lessons.js, pr.js, service.js),
  `scripts/service.js`, `integrations/telegram/`, `default/{askk,developer}`.
- **desk**: `.worktrees/rebuild/desk`: docs/{BRIEF,STATE-STANDARD,LEARNINGS,SEPARATION,CLEAN-PATH}.md,
  core/{element,engine,loop,next-call,record,prompt,response,redact,confine,gate}.js,
  core/kinds/*, defaults/*, custom/{trader,aosp,…}.

## 0. The mapping in one table

| LocalAgents concept | askk object | kind(s) |
| --- | --- | --- |
| old engine (main `engine.js`, desk `kinds/engine.js`) | an **engine** (folder, `engine.md`) | engine (built in) |
| its loop | the engine's `loop` element plus the pure `next_step` in core | `loop` |
| soul, instructions | the engine's `engine.md` body plus `soul` elements | `text` |
| prompt sections | the `prompt` text of each object, in an order set in `engine.md` | (no kind) |
| model call / methods | `model` element → **connector** `llm-*` | `model` + connectors |
| models settings (`models.json`) | a top engine `settings` whose elements are `model` entries; keys live in connectors | `model` |
| tools | the **actions** of elements, marked `by: model` | (no kind) |
| artifacts (files, terminal, branches, checks …) | elements | `files`, `terminal`, `checks`, `branches` |
| MCP | an element whose actions come from a server | `mcp` |
| message board, queues, chains | one desk-level `board` element plus each engine's `inbox` | `board`, `inbox` |
| open question to the owner | `question` element; engine phase `waiting` | `question` |
| goals | `goal` element | `goal` |
| watchers / alerts | `alert` element (time, script or file) | `alert` |
| cron / scheduler | `alert` with `when:`; the server's scheduler task, never the crontab | `alert` |
| skills | `skills` element (index in the prompt, read on demand) | `skills` |
| lessons / memory | `notes` element (`memory.md` in the folder) | `notes` |
| refocus / compaction | a step of the loop (`Step::Refocus`), with `history.md` as a store | `loop` |
| phases | `phase` element (says, tools, exits, gates) | `phase` |
| proposals | `proposal` element; owner-only `approve` | `proposal` |
| links between engines | `link` element (writer topic → named readers) | `link` |
| PR / branch flow | `branches` + `checks` elements; `pr.md` per branch | `branches`, `checks` |
| supervisor / restart / rollback | a separate `askk-supervisor` binary; `restart` element asks it | `restart` |
| Telegram | a `channel` element + `telegram` connector | `channel` |
| the owner | not an object; it is the `by: owner` caller and the `owner` channel | — |

## 1. Shared rules every kind below follows

These come from the live code (`core/src/object.rs` `Kind`, `engine.rs`) and from desk's
STATE-STANDARD and SEPARATION.

- **One file per object, one writer.** The `.md` holds config and is written only by structure
  actions or by the owner. `state/<id>.json` = `{phase, state}`, written only by the object's own
  `act` on the runtime's single writer (one `tokio::Mutex`/actor per engine tree). A model never
  writes a file directly; it calls an action.
- **Actions carry a caller.** Today `Action {name, label, args}`. Each one also gets
  `by: owner | model | both` (§A1). A model sees only `model|both`, and the UI shows only
  `owner|both`. desk did this by convention: proposal approve, branches merge and self-restart
  were "the owner's", spread across `owner.js` and per-kind checks. Here it is one field, and one
  check in `Runtime::act`.
- **Views come from state, never fetched**: icon, row, card and full, built from the §5 primitives.
  The sketches below use `Card(…)`, `Row=Stack(dir:row)`, `Col=Stack(dir:col)`.
- **Prompt text** is the kind's `prompt(obj)`. The engine's prompt is the ordered join of its
  elements' prompts. That is already true: in contract §4 an engine's twin includes its elements'
  prompts.
- **Words live in config, not in code** (desk BRIEF ground rule, SEPARATION "Words in code").
  Every sentence a model reads comes from `engine.md`, the element `.md` bodies, or a desk-wide
  `words.md` in the top engine (§A5). Kinds in Rust carry behaviour and field names only.
- **Long work = a tokio task** owned by the element. The element's phase goes `running`. The task
  reports through `act` messages to the writer (it never mutates state itself). After a crash the
  phase is `interrupted`, which already exists.

## 2. Concept by concept

Each entry gives the config (frontmatter), state, phase, actions (caller), views, prompt,
persistence, tasks and connector, then what is kept from main, taken from desk, and dropped.

### 2.1 Old engine → engine, and its loop

Config (`engines/<id>/engine.md`):
```yaml
title: Developer
kind: engine
order: 2
model: default            # a model element id under settings, or "inherit"
max_turns: 40             # turns per run (main MAX_STEPS, desk desk.json limit)
stall_after: 900          # seconds; stalled is computed, never stored (desk kinds/engine.js)
prompt: [soul, instructions, goal, phase, notes, skills, files, terminal, board, inbox, messages]
format: toon              # reply format: toon | json (desk BRIEF "Response format")
```
Body = instructions. Child engines = sub engines (main `agent.json parent`, desk `parent:`).

- **State** of the engine object: `{status: needsYou|failed|stalled|working|waiting|quiet,
  step, call, turn, run_id, last_change_at, next_check_at}`. This is desk `kinds/engine.js`'s
  single status source, and it is enough for the dashboard, the canvas and Telegram.
- **Phase**: running while a run is in flight; waiting on a question or on a helper; idle;
  failed; interrupted after a crash.
- **Actions**: `send {text}` (owner/both; a model uses `board.post` instead), `stop` (owner),
  `freeze` / `step_once` / `thaw` (owner; desk SEPARATION "Stopping at a step"),
  `clear_messages` (owner). There are also the existing structure actions.
- **Views**: icon = avatar badge plus status tone. Row = `Row[Badge(status), Text(title),
  Text(step, sm, muted)]`. Card = `Card(title, phase)[Row[status, call], Text(question?),
  Slot(inbox,row), Slot(goal,row)]`. Full = the "engine sees" page: `Col[Slot(loop,full)
  (the next prompt by section with sizes), Slot(messages,full), Slot(each element, card)]`.
  This is desk BRIEF "The engine's page shows what the engine sees", built from Slots, with no
  bespoke page.
- **Prompt**: the ordered sections. The engine's own section is its status line.
- **Tasks**: one `run` task per engine at most (main and desk both serialize runs per engine).
- **Keep from main**: the parent/child tree; `maxSteps`; a run posts its answer back to the
  caller (message-board callback).
- **Take from desk**: the status vocabulary, stalled from the clock, and `next-call.js` purity
  (§B). An engine is just a folder, and adding a folder makes an engine.
- **Drop**: main's `agent.json` + `artifacts.json` + `response.json` split (three files for one
  object), and main's `from:` sessions (a session is just a child engine with a copied config).
  Drop desk's `record.md` too. Our Store already gives an atomic JSON record per object
  (`state/<id>.json`), and STATE-STANDARD §3 wanted md only to be human readable. The full view
  covers that.

`loop` element (one per engine, implicit, `kind: loop`): state `{messages: [...], window_tokens,
used_tokens, turns, pending_calls: [...]}`. Actions `view_next` (both: returns exactly what
would be sent) and `refocus` (owner|model). The messages live in `state/<id>/loop.json`. The fold
goes to the `history` record (§2.15).

### 2.2 Prompt sections

There is no kind. Each element's `prompt()` is a section. The engine's `prompt:` list orders them
(desk desk.json `prompt` order). An element not listed is appended after the others in kind order
(desk "churn": stable first, volatile last, so a provider caches the prefix). Tool documentation
is generated from `by: model` actions and their `args` plus a `doc` (§A1). One renderer exists:
`core::prompt::render(&EngineNode) -> Vec<Section{source, text, chars}>`. The UI's context widget
and the model call both use it, as the desk owner required ("the same text the model is sent,
built by the same code").

Drop main's `template()`/`renderTemplate()` (engine.js:768–835), which were hand-ordered strings.

### 2.3 Model call / inference methods → `model` element + llm connectors

`settings/elements/<id>.md`:
```yaml
title: Default
kind: model
config: { connector: claude-cli, model: opus, window: 200000, parallel: 2, format: toon }
```
- **State**: `{calls, tokens_in, tokens_out, last_error, last_ms}`. **Phase**: idle, or running
  while calls are in flight.
- **Actions**: `test` (owner) and `edit` (owner, a structure action). There is never a model
  action: models do not pick models, except where `engine.md model:` names one.
- **Views**: row = name, connector, a calls/tokens meter. Card adds a test button and last_error.
- **Connectors** (`server/`, not core): `llm-openai` (any OpenAI-compatible URL; oMLX local),
  `llm-anthropic`, `llm-claude-cli` (the prompt on stdin, the CLI's own tools off; desk BRIEF
  "Claude CLI as a model"), `llm-mlx-metal` (in-process jobs under `sandbox/run.sh mlx`). Core
  defines `trait LlmConnector { async fn call(&self, req: ModelRequest) -> Result<ModelReply> }`
  and holds `Arc<dyn …>` handles only.
- **Keep from main**: the method registry idea (`inference.js` METHODS, `methods/*`) and the
  `method/model` id.
- **Take from desk**: `parallel` and `jobs` limits per model; usage totals (`usage.js`).
- **Drop**: keys in `models.json` (main `models.js`, desk `kinds/models.js` both kept the key in
  the same file as the twin's source and filtered it out with `publicModel()`). See §C.

### 2.4 Tools → model-callable actions

A tool is not an object. It is `Action{by: model|both, doc, args}` on some element. That is
already desk's model (`kinds/tool.js`: "A tool is one action of an element … carries no behaviour
of its own"). main's default tools (`tools/agents.js` toolHelp, createSub…) become actions
of the engine (`spawn_child`) or of the loop (`tool_help`).
Scripts (main `tools/authored.js`, desk `kinds/script.js`) are a `script` element: a file in
`engines/<id>/scripts/`, whose header is its doc and args. It runs under the `job` sandbox
connector. An engine writing a new script goes through `proposal` (§2.16). desk's rule ("a new
script goes through scriptWrite and the owner") is kept.

### 2.5 Artifacts → elements

files (`config {root, writes, reads}`; state = pointers only, the tree read live; desk
`kinds/files.js`), terminal (the last command plus running ones; tasks = child processes under
the `job` sandbox; desk `kinds/terminal.js`), checks (core-run commands with recorded exit codes;
desk `kinds/checks.js`), branches. Each one is a Rust kind with `by: model` actions (open, close,
search, run, check_run) and `by: owner` actions (merge, discard). Keep desk's rule that a file's
contents are read at render and never copied into state.

### 2.6 MCP → `mcp` element

`config {command | url, connector: mcp}`. State `{tools: [{name, doc, args}], error}`. Its
actions are dynamic: the server's tool list becomes `by: model` actions named `<server>_<tool>`
(desk `kinds/mcp.js`). The connector holds the process or the HTTP session and any OAuth token
(main `oauth-file.js`, desk `mcp-oauth.js`). That needs dynamic actions, which the `Kind::actions`
signature already allows because it gets `&Obj`. Tasks: the server process.

### 2.7 Message board, queues, chains → `board` (desk-wide) + `inbox` (per engine)

- `board`: one element under the top engine. State `{entries: [{id, chain, from, to, text, at,
  status}]}`, capped, with older entries spilling into a `board` history record.
  Action `post {to, text}` (model): it appends and pushes into the target's inbox.
  Keep main's **chain budget** (`MAX_RUNS 30` shared by every message from one outside post,
  message-board.js:12–15). It is the right fix for wake storms. Keep main's visibility rule (a
  child sees only what was sent to or by it).
- `inbox`: per engine. State `{queue: [...], replying_to: [...]}`. The loop takes from it. A
  run's answer is posted back to the sender (the callback). Persisted, so a restart re-wakes
  unfinished tasks (main and desk both).
- Views: board full = `Table(time, from→to, text, status)`; inbox row = "3 waiting".
- Take from desk: inbox ids dedupe across a restart (STATE-STANDARD §3), and a helper that is
  gone ends the wait with words (`next-call.js whyNoResult`).

### 2.8 Open question to the owner → `question`

One per engine at most, and only a top engine may ask the owner (main message-board; desk Kaka
rule). Children ask their parent. State `{text, options, asked_at, answer?}`. Engine phase
`waiting`, status `needsYou`. Actions: `ask {text, options}` (model), `answer {text}` (owner),
`dismiss` (owner). Views: card = `Card[Text(question), Stack(Buttons per option), Field(answer)]`.
Delivered to Telegram by the channel (§2.20). Keep desk's "an answer goes back as the owner wrote
it" (CLEAN-PATH line 256).

### 2.9 Goals → `goal`

`config {pace?}`. State `{text, done_when, status: open|met|dropped, progress: [...≤6],
next_at}`. Actions: `set`, `progress`, `met` (model); `drop`, `edit` (owner). A goal with `pace`
registers a wake with the scheduler (§2.11). It is in every prompt until closed, and then only
the last outcome stays (desk `kinds/goal.js`). Views: row = text + status badge; card adds a
progress Table and a Meter if a measure is given.

### 2.10 Watchers / alerts → `alert`

One file per alert in `engines/<id>/elements/` (`kind: alert`):
`config {when? (cron fields), every?, script?, inputs?, file?, once, wake: true}`.
State `{last_at, next_at, last_output, fired}`. Actions: `alert_write`, `alert_stop` (model) and
`enable`, `remove` (owner). Time alone runs nothing. A script already approved runs under the
`job` sandbox, its output is the event, and an empty output means not met (desk `kinds/alert.js`).
Keep `alertWakesMost` / `alertRunsMost` as config limits. Drop main's `watchers/<engine>/*.js`
(arbitrary JS run in-process: `tools/authored.js`). It is unconfined.

### 2.11 Cron / scheduler

Not a kind. A **scheduler task** in the runtime holds a min-heap of `(next_at, object id)` from
every alert and goal, and calls that object's `tick` action (`by: system`, §A1). Drop main's
crontab writing (`artifacts/cron.js` + `scripts/cron-run.js`). It reached outside the app, it did
not survive moving machines, and the app has to be running anyway to act. Take desk's `when.js`
five-field local-time parser.

### 2.12 Skills → `skills`

`config {dirs: [skills/, ../shared/skills]}`. State = `[{name, description}]` read from SKILL.md
frontmatter at boot and on file change. The prompt lists names and descriptions only. Actions:
`skill_read {name}` and `skill_run {name, file}` (model, under the `job` sandbox). This follows
main `artifacts/skills.js` and desk `kinds/skills.js`, which agree.

### 2.13 Lessons / memory → `notes`

`config {file: memory.md, limit: 4000}`. State = `{chars}`; the file is the content (desk
`kinds/notes.js`: "the file is the only copy, read every time"). Actions: `remember {text}`,
`forget {ids}` (model; one dated line per lesson, ≤300 chars as in main `lessons.js MAX_LESSON`),
and `edit` (owner). Past the limit, the refocus step asks for a compaction. Keep main's rule that
lessons survive Clear memory.

### 2.14 Refocus / compaction

A loop step, not a kind: `Step::Refocus` when used tokens exceed `refocus_at` (0.9) × window
(main `#compactIfFull` engine.js:127, desk `next-call.js STEP.refocus`). One model call returns a
summary plus `LEARNT:` lines. The summary replaces the old messages, and the lessons go to
`notes.remember`. The removed messages are appended to `state/<engine>/history.jsonl`, which is
never in a prompt (desk SEPARATION "What a refocus keeps").

### 2.15 Persistence of messages and history

`loop.json` holds the live window. `history.jsonl` is append-only and gets one `Store` method
added (§A3).

### 2.16 Phases → `phase`

`config` = desk's phases block, unchanged (defaults/developer/instructions.md):
```yaml
kind: phase
config:
  start: triage
  triage: { says: "...", tools: [files.open, files.search], exits: { done: code, nothing: end } }
  test:   { exits: { pass: { to: confirm, needs: [tests, build] }, findings: code } }
```
State `{current, path, since}`. Action `exit {name, fields?}` (model). A `needs:` exit is checked
against `checks` state by core, so a claim in words opens nothing. Gates are commands under the
`job` sandbox. The phase narrows which `by: model` actions render and are accepted (desk
`Engine.toolAvailable`). Prompt = the current phase's `says` plus its exits. Views: full = the
phase map (`Stack` of Badges, the current one with tone accent, the path taken). Phases only
narrow, never widen (SEPARATION "Strategy is a phase").

### 2.17 Proposals → `proposal`

An engine asks for a new engine, script, alert script or child. Action `propose {kind, name,
files}` (model) writes into `data/proposed/<id>/`, which no boot reads. The proposal is
composed with the same boot code to report errors before anything exists (desk
`kinds/proposal.js`). Actions `approve` / `drop` are `by: owner`. Approve moves the files into
`engines/` and broadcasts `world`. A proposal that came from a run which read the outside world
is tagged (askk's own provenance rule) and still only waits for the owner.

### 2.18 Links between engines → `link`

`config {topic, readers: [engine ids]}` on the writer's side. State `{text, at}`. Action
`link_write {topic, text}` (model, writer only). Readers get a `Slot`-like prompt section. Only
core writes the shared record (desk `kinds/links.js`); a reader cannot write it.

### 2.19 PR / branch flow → `branches` + `checks`

`branches config {repo, prefix: feature/}`. State `[{branch, files, ahead, pr: {title, why,
status}, tests: {at, sha, pass}}]`, read from git (main `pr.js`: diff against base, `PR.md`
sections, tests valid only on that exact sha). Actions: `branch_start`, `commit` (model, inside
its worktree under the `job` sandbox, never its `.git/config` or hooks); `merge` (squash) and
`drop` (owner). Views: full = the diff Table + pr sections + test result. Task: test runs.

### 2.20 Supervisor / restart / rollback

A second binary, `askk-supervisor`, never restarted by the app. It starts the server,
watches `/world`, and keeps the last good build. Socket API: `status`, `apply {message}` (build
→ restart → health → good, else roll back to the kept binary/commit; main `scripts/service.js`:
SERVICE_BUILD gate + SERVICE_PAGES health). A `restart` element (desk `kinds/self-restart.js`):
action `ask {why}` (model), then `approve` (owner), which calls the supervisor connector. Its
state survives the restart it asked for. The existing lock and `interrupted` handling cover the
crash path.

### 2.21 Telegram → `channel` + `telegram` connector

`channel config {connector: telegram, sends: [question, answer, status]}`. The connector holds
the bot token and chat id, and drives send, edit and receive (main `integrations/telegram/bot.js`).
It sees only twins, which is what any client sees (desk `kinds/channel.js`). An inbound owner
message becomes the target engine's `send` / `question.answer` with `by: owner`. State
`{last_update_id, sent: {msg_id → object id}}`, so a reply routes to the right engine. Drop
main's regex `redact` (`/-?\d{6,}/`): the token never enters text that could be logged (§C).

### 2.22 The owner

Not an object. The owner is (1) the `by: owner` caller over `/act` from the UI, the only
authenticated client, and (2) inbound channel messages, mapped to the same call. Desk's
`owner.js` concept becomes nothing more than this caller check.

## A. Primitives and contract changes (minimal)

1. **`Action.by` and `Action.doc`**: `by: owner | model | both | system` (default `owner`), plus
   a one-line `doc` (the tool documentation). This is needed because every safety rule above is
   "only the owner may X". One field replaces desk's scattered checks. `system` is for scheduler
   and connector callbacks. The UI ignores `model`-only actions.
2. **`/act` gets a caller**: the server sets it from the transport (UI = owner). Core's
   `act(target, action, args, by)` refuses a mismatch with `{error}` in words.
3. **`Store::append(kind, id, line)`**: append-only JSONL, for history, the board spill and the
   usage book. An atomic rewrite of a growing log is O(n²). This is the only Store change.
4. **New primitive `Stream`** `{of: id, field}`: live text (model deltas, terminal output) sent
   via a new SSE event `delta {id, field, text}` (desk BRIEF server `delta`). Without it every
   token would be a full twin. That is the only new primitive. Everything else (prompt view,
   phase map, diff) is Table/Code/Text/Badge/Slot.
5. **Words**: a `words.md` per engine plus a top-level one (frontmatter map `key: sentence`),
   read by kinds through `obj.say(key)`. This is a config convention, not a primitive.
6. **Engine-level `model`, `prompt`, `max_turns`, `format` keys** in `engine.md` (§2.1). These
   are frontmatter keys only. Engines have no `config:` today, so they are read as top-level keys
   or the contract adds `config` to engine.md.

Not added: no "tool" or "artifact" type (both are elements and actions), no per-feature routes.

## B. The model call / engine loop in Rust

```rust
// core/src/loop.rs — pure, no IO, no clock (clock passed in)
pub enum Step { Rest, Press(Vec<Msg>), Turn, Refocus, LastWords, Spent }
pub fn next_step(e: &EngineView, now: u64) -> Step;                 // desk next-call.js nextStep
pub fn request_of(e: &EngineView, step: &Step) -> ModelRequest;     // desk callOf: sections + messages + tool docs
pub fn apply_reply(e: &EngineView, reply: &ModelReply) -> Vec<Effect>; // parse → actions to run, or answer, or refusal
```
- `EngineView` is an immutable snapshot of the engine tree (`EngineNode` + loop state).
  `loop.view_next` returns `request_of(snapshot, next_step(snapshot))`, the same value the run
  task sends. A test asserts byte equality between the view and the connector's received request
  (desk LEARNINGS: prove it on a real request).
- **Run task** (one per engine): `loop { snap = runtime.snapshot(id); step = next_step(..);
  match step { Rest|Spent => break, _ => { req = request_of(..); reply = connector.call(req).await;
  effects = apply_reply(..); runtime.commit(id, effects).await } } }`. `commit` goes through the
  single writer, and so does each action call. After any await the task re-reads the snapshot
  and never writes back a value read before it (the askk execution rule).
- **Parallel**: calls in one reply group run with `join_all`. A `then:` group waits on the
  previous one, and a failure skips later groups (askk `#act`). Model calls in parallel
  across engines are bounded by a per-model `Semaphore(parallel)`. Refocus summary calls and
  helper engines run concurrently with other engines, never two runs of one engine.
- **Refusal path**: (1) a provider refusal (connector maps it to `ModelError::Refused`) ends the
  run `failed` with `refused: true`. It is not written to history, and the request goes to the
  parent or top engine to reframe (askk `modelRefusal`). (2) An action refusal returns
  `Refusal(words)` as the tool result. The model goes on, and the words say what to do instead
  (desk `Refusal` class). (3) A malformed reply produces one `Press` with the format words, and
  a second malformed reply fails the run (desk loop.js `malformation` / `repair`).
- **Usage limit** (429 / session limit): it is not a failure. The engine waits, with `next_at`
  set to the reset time.

## C. Secrets: structural

- Keys live only in `data/secrets/` (0600). They are read only by the server's connector
  registry at boot and never by core, kinds or the Store's normal `read`. Core sees
  `ConnectorHandle(id)`. Twins carry `has_key: bool`.
- A `model` / `channel` / `mcp` element names a connector id. It can never hold or render the
  key, because its kind has no field for it.
- Owner key entry goes through a dedicated `secrets.set {connector, value}` server route that
  writes the file and returns nothing. It is not an `/act` action, so no twin or event ever
  carries it.
- Sandboxed jobs get an env allowlist (desk terminal.js) and Seatbelt denies `data/secrets/`.
  CLI connectors spawn with a scrubbed env.
- So there is no regex redaction (drop main `activity.redactSecrets`, telegram `redact`, desk
  `redact.js` 592 lines). Text that never had the key cannot leak it. One test plants a canary
  key and asserts it appears in no twin, event, prompt, log or history file.

## D. Port plan (slices, each proven by a test)

1. **Action.by / doc + caller on /act.** Test: a model-only action from the UI and an owner-only
   action as model are both refused.
2. **Store::append + history record.** Test: 10k appends, then kill -9 mid-write, then the file
   parses.
3. **Secrets + connector registry** (a stub LLM connector). Test: the canary-key test in §C.
4. **`model` kind + `llm-openai` connector against local oMLX.** Test: `test` action round-trip;
   a usage counter.
5. **Pure loop (`next_step`/`request_of`/`apply_reply`) + `loop` element + `view_next`.** Test:
   table of engine snapshots → steps; view == sent bytes with the stub connector.
6. **Run task, parallel calls, refusal path.** Test: two calls run concurrently (timing with the
   stub); a refused reply goes to the parent; kill -9 mid-run → `interrupted`, inbox kept.
7. **`board` + `inbox` + chain budget.** Test: a ping-pong between two engines stops at the
   budget; a restart re-wakes an unfinished task once.
8. **`question` + `goal` + `notes` + refocus.** Test: a forced small window folds, history gets
   the old messages, and LEARNT lines land in memory.md.
9. **`files` / `terminal` / `checks` under the `job` sandbox.** Test: a write outside `writes` is
   refused; a terminal read of `data/secrets` is denied by Seatbelt.
10. **`phase` + gates.** Test: a needs-exit stays shut until checks pass; the tools outside the
    phase are absent from `request_of`.
11. **`alert` + scheduler + `skills`.** Test: a fake clock fires `when:`; an empty script output
    does not wake.
12. **`Stream` primitive + `delta` events.** Test: a UI receives the deltas, and the final twin
    equals the concatenation.
13. **`proposal` + `link` + `mcp`.** Test: a proposed engine with a bad kind is reported and not
    booted; approve boots it.
14. **`branches` + `restart` + supervisor binary.** Test: a broken build is rolled back to the
    kept binary and `/world` answers.
15. **`channel` + telegram connector** (against a fake Bot API). Test: a reply to a question
    message answers that engine.

Engines, only after the owner approves this design: **askk** (top engine: board, question, goal,
notes, skills) after slice 8. **researcher / architect / drawing** (desk defaults) after 11.
**developer** (phases, files, terminal, checks, branches) after 14. **trader** (desk custom/trader,
plus market MCP; paper only until the owner widens it) after 13 and 15. **aosp** and the others in
custom/ last, after 15.

## E. Open questions for the owner (with recommendations)

1. **Store messages as JSON (`state/`) or as md like desk's `messages.md`/`record.md`?**
   Recommend JSON in the Store, made readable through the full view. It keeps one persistence
   path.
2. **Cron: drop the system crontab entirely for an in-app scheduler?** Recommend yes. Wakes need
   the app running anyway, and the supervisor keeps it up.
3. **Who may ask you questions: only top engines (Kaka rule) or any engine?** Recommend only top
   engines. Children ask their parent.
4. **Default reply format: toon (desk) or the one-card `way/sure/act` text (askk)?**
   Recommend the card text for every model, with json-schema where a connector supports it.
5. **Is `Action.by` enough for authority, or do you want per-engine permission lists too?**
   Recommend `by` plus a phase's narrowing. Nothing more until a case needs it.
6. **Port desk's `wisher`/bench comparing engine?** Recommend no, not until after the trader.
7. **Is the Claude CLI the default model and oMLX local the cheap one (desk BRIEF), with "every
   5 calls a local summary"?** Recommend yes for the defaults. Leave the 5-call summary for later,
   as an alert rather than core.
8. **Is the trader paper-only until you approve live orders in the new app, with the order guard
   in a connector the engine cannot edit?** Recommend yes.

## Owner decisions (2026-11-07)

1. Messages: **JSON** (structured, parsed in parallel).
2. Scheduling: **in-app scheduler**; no system crontab.
3. Asking: a **`help.ask` tool** passes the message one level up (sub engine → its parent →
   … → the top engine → the owner). The owner sees every open ask in the UI and can respond at
   any level. Messaging to the owner is mostly the top engine's.
4. Reply format: **TOON by default, JSON as the fallback.**
5. `by` (who may call an action: owner | model | both | system): explained, kept as recommended
   unless the owner objects.
6. **No porting yet** — only the high-level design, done right first. No engine is ported.
7. Models: **yes** — Claude CLI default, local oMLX the cheap one.
8. No trader or other engine yet.

UI: the rebuild/desk glassy dashboard design is a must-have; one collapsible left panel with the
view elements. See docs/design-rules.md.
