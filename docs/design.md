# Askk design

One application, compiled for different targets, with nothing hardcoded on either side.
Everything is rebuilt from storage at start, so everything survives a restart.

```
Store (folder today, DB later)
  → boot() → engines (engine.md) → elements (<eid>.md) → twins   backend: WHAT to show
  → each twin carries its own views (Node trees: icon, row, card, full)
  → frontend view rules (dashboard, canvas) + primitives registry → UI   frontend: WHERE
```

The wire format (routes, payloads, Node/primitive props, events) is defined only in
[`docs/contract.md`](contract.md); where this file and the contract differ, the contract wins.

## 1. Lifecycle: build, run, stop, restart

This is the primary contract. Every target (local server, Tauri desktop, later mobile/wasm)
follows the same four steps; only the shell around `core` differs.

### Build

| Part | Command | Output |
| --- | --- | --- |
| UI (Svelte 5 SPA) | `bun run build` | `build/` — static HTML/JS/CSS, no server code |
| Core + server (Rust) | `cargo build -p askk-server` | `target/debug/askk-server` |
| Desktop (Tauri) | `bun run tauri build` | a native app bundling `build/` + core |

bun is only the front-end toolchain (Vite, bundling). It never runs in a shipped app.
`core` is a plain Rust library: no web, desktop or hardware code inside it.

### Run

```
askk-server --data ./data --port 4600
  1. parse config (args)
  2. FolderStore::open(data)
  3. lock: data/.lock (pid)         — a lock already there = the last run did not stop cleanly
  4. boot(store) → Runtime          — runtime.json, every engine's config + saved state
  5. bind port, serve:
       GET /world, GET /events (SSE), POST /act /layout /theme — see contract.md §3
       GET  /*         the built UI (build/)
```

Development: `cargo run -p askk-server` beside `bun run dev` (Vite, hot reload).

### Stop

A stop is SIGINT (Ctrl-C) or SIGTERM (launchd, a container, the desktop shell closing).

```
  1. stop accepting requests; in-flight ones finish (graceful shutdown)
  2. every task is cancelled and joined (§5); every `running` object turns `stopped`, its state written through the Store
     (open /events streams are ended so the shutdown can finish)
  3. runtime.json: {last_exit: "clean", stopped_at}
  4. remove data/.lock, exit 0
```

### Restart

A restart is a stop followed by a run. Nothing is kept in memory between the two: whatever
the next run knows, it reads from the Store.

- **Clean restart**: no lock left; runtime.json says `clean`.
- **Crash or kill -9**: the lock is still there → `last_exit: "crash"`. Each engine's last
  written state is used (writes are atomic: temp file + rename, never half written), and an
  object (engine or element) that was `running` comes back `interrupted`.
- The UI reconnects to `/events` by itself (backoff) and re-reads `/world` after a drop, so
  it shows what the new run booted, not what it last saw.
- `scripts/lifecycle.sh` walks run → act → stop → restart → kill -9 → restart on a scratch folder, with two timers
  running across the SIGTERM (→ `stopped`) and one across the kill -9 (→ `interrupted`); it exits 1 on a failed check.
- `boots` counts every start, so a restart is visible in the UI.

## 2. Storage: `Store`

`core::Store` (core/src/lib.rs): JSON records (`list`, `read`, `write`), text files for the
`.md` configuration (`read_text`, `write_text`, `remove`, `dirs`, `files`) and the run lock
(`lock`, `unlock`). Every write is atomic. `FolderStore` is the folder implementation; a
database is another implementation of the same trait; nothing else changes.

```
data/
  runtime.json                    {boots, last_exit: none | clean | crash, started_at, stopped_at}
  engines/<id>/engine.md          an engine (frontmatter + body); children under engines/<id>/engines/
  engines/<id>/elements/<eid>.md  its elements
  state/<object id>.json          {phase, state}, written by the app only
  layout/dashboard.json           {order: [engine ids]}
  layout/canvas.json              {positions: {id: {x, y}}}
  theme.json                      {radius, font, mono, light: {...}, dark: {...}}
  .lock                           present only while running
```

The folder is the truth: structure actions (add/edit/remove element, add child engine) write
the `.md` files, and an empty `engines/` is seeded with one engine at boot. Exact shapes:
contract.md §1 and Backend notes.

## 3. Objects and their twin

Every engine and every element is an object. An element kind implements `core::object::Kind`
(one file in `core/src/kinds/`, listed in `KINDS`): its config fields, initial state, actions,
`act`, its four views and its prompt text. `twin()` turns an object into the Twin the wire
carries — `{id, kind, title, phase, state, config, actions, views, prompt}`; an engine's
EngineTwin adds `elements` and `children`. The views and the prompt come from the same state,
so what a person sees and what a model reads never disagree.

## 4. Views

There are no view files. What to show is each object's own `views` (Node trees of the
primitives in contract.md §5); where to show it is fixed frontend rules (contract.md §6):
the dashboard (cards, element rows, side sheet with the `full` view) and the canvas (frames,
pan/zoom picking icon/row/card, positions saved via `/layout`). Unlock gives edit mode: the
element form is built from `KindInfo.config`, card order and theme tokens are saved through
`/layout` and `/theme`. Unknown primitives render a visible box, never HTML from the backend.

## 5. Async model: tasks, one writer per object

The server runs on tokio (multi-threaded). `core::Hub` (core/src/hub.rs) is the live layer over the `Runtime`:

- **Runtime lock**: the `Runtime` (the object tree) sits behind one short synchronous mutex, never held across an
  `.await`. Reads (`/world`) and in-memory changes take it for microseconds.
- **One writer per object**: each object id has its own async mutex (`Hub::writer`). Every change of one object — a
  sync action, a task tick, a task's end — takes it, changes the object in memory, writes `state/<id>.json`, and
  broadcasts the twin, in that order. So writes to one object land in order (in memory and on disk) and a
  read-modify-write that awaits cannot lose updates; objects never wait on each other's writer. (Store writes use a
  temp file of their own per write, so even two writers of one file could not tear it.)
- **Tasks**: an action whose kind returns `Kind::task` runs `act` synchronously (e.g. phase → `running`), then
  `tokio::spawn`s the body with a `TaskCtx` (its id, `obj()`, `update()`), registered before the writer is released
  (no double start). `/act` returns immediately. A supervisor task awaits the body (spawned as its own task, so a
  panic is a `JoinError`) or a stop signal (`watch`) and writes the end: Ok → `idle`, Err/panic → `failed` with
  `state.error`, cancel/shutdown → abort the body, await it, `stopped`; an object that left the configuration → abort,
  nothing written.
- **Cancellation**: `cancel` signals one task and awaits its end; shutdown signals all, joins them (5 s grace each),
  then runs the runtime's clean shutdown. A crash runs none of this: the last persisted tick stays, and the next boot
  turns `running` into `interrupted`.
- **Hot reload** (server/src/reload.rs): a `notify` watcher on `data/engines/**` (debounced 300 ms) plus a 2 s
  re-scan (macOS FSEvents can drop events) both call `Hub::reload`, which re-reads the folder, keeps live phase/state
  for ids that stay, turns unloadable files into `failed` objects, ends tasks of objects that left, and broadcasts
  `world` only when a twin changed. That makes it idempotent, so the server's own writes cause no loop.

Parallelism is measured, not assumed: five timers of 2, 2, 2, 3, 3 s started at once finish in ~3.0 s (sum 12 s)
in `parallel_timers_take_the_longest_not_the_sum`.

## 6. Hardware: connectors

The app describes work in neutral terms (a job: model, ops, limits). A broker asks
connectors what can run it. Each connector (mlx-metal now; cpu, cuda, webgpu, wasm later)
probes its hardware with a short benchmark at first start, caches the profile, and brings
its own sandbox. mlx-metal: a child process under a Seatbelt profile — Metal allowed,
network and everything outside its workspace denied, one GPU job at a time.
Containers on macOS are Linux VMs without Metal, so they cannot run MLX at full speed.

## 7. Engines: model, loop, phases, tools

The vocabulary is **engine, model, loop, phases, tools** (plus memory and notes). An engine is a
folder; what it can do is exactly the elements it holds, and its views say so (a capability row:
`model: echo echo · loop · phase: work · tools: …`, or `No tools`). Nothing about an engine is
hardcoded: an engine without a tools element offers no tools, its prompt says `No tools.` and its
reply format has no calls.

| element | what it is |
| --- | --- |
| `model` | how to reach a model: a connector (`echo` in core; `claude-cli`, `openai`, `anthropic` added by the server, `server/src/connectors.rs`), an id, a context budget in characters, and `key_env` — the name of the env var with the key, read only by the connector at call time |
| `loop` | the run: `run {input}` spawns a task |
| `phases` | the units of work `{id, title, icon, tools, instructions}`; the selected one (`set`) is the mode — its tools are offered, its instructions go under `# PHASE` |
| `workflows` | ordered sequences of phases: `run {workflow, input}` runs the loop once per phase, each answer the next input, then returns to the prior mode |
| `tools` | names from the core registry (`core/src/tools.rs`) |
| `memory` | lessons kept beyond a run |
| `note` | text the prompt carries; `note.write` writes it |

### The run (`core/src/run.rs`)

```
loop until an answer or max_steps:
  prompt  = render(engine, loop)        pure: ENGINE (title + body: the soul), PHASE (+ its instructions), TOOLS,
                                        MEMORY, NOTES, HISTORY, INPUT, REPLY FORMAT
  if len(prompt) ≥ refocus × budget → refocus, render again
  phase waiting; state.context_used, context_budget, last_sent = prompt
  reply   = connector.call(prompt)      recorded on the model: calls, last {ms, chars}
  phase running; step + 1; the reply appended as a `model` message
  parse   = TOON, else JSON             (core/src/toon.rs; a failure → a `format` message, go on)
  calls   → run together (tokio JoinSet), results appended in call order; a tool not offered
            on this step answers an error result
  answer  → state.last_answer, the task ends idle
```

The loop's `full` view draws `render(engine, loop)` — the same function the step calls — so what it
shows is byte for byte what the next step sends; `last_sent` keeps what the last one sent.

### Phases, modes, workflows: one engine, many ways of working

The seed is one engine, Askk, whose phases are chat (no tools), research (`files.read`, `clock.now`, `help.ask`)
and build (`note.write`, `files.read`, `clock.now`). A phase is the unit; a **mode** is the owner selecting one
phase to stay in (the composer's chips, the phases card) — switching changes only the tools and the instructions,
and the model, the loop's history (which records the switch), memory and notes carry over. A **workflow** is a
separate element: an ordered list of phases run one after another, each phase's answer the next one's input, the
engine back in its prior mode afterwards (`study: [research, build]` in the seed). Why the workflow lives in its
own element and not as `next:` links on phases: a phase stays one self-contained unit that any number of workflows
reuse, and the order is written once, where it is run (contract §4).

### Reply format (TOON subset)

```
thought: <one line>
calls[2]{tool,args}:
  clock.now,{}
  note.write,{"text":"a, b"}
answer: <runs to the end of the reply>
```

`calls[N]{tool,args}:` is a tabular array of exactly N indented rows, each `tool,<JSON object>` split
on the first comma. `answer:` is the last field. JSON fallback:
`{"thought", "calls": [{"tool", "args"}], "answer"}`, bare or in a ``` fence.

### Refocus

Before each model call, when the prompt reaches `refocus` (default 0.9) of the model's context
budget (characters), the loop runs the refocus workflow instead of letting the context overflow:

1. Nothing to fold (history ≤ `keep` messages, default 2): skip.
2. A model call (purpose refocus) over the whole history asks for the essentials in TOON:
   `goal:`, `decisions:`, `facts:`, `open:`, then `lessons[N]:` with `  - <lesson>` rows. When the
   call fails or the reply does not parse, a deterministic fallback builds the same from the history
   (goal = the newest input, decisions = the models' thoughts, facts = the newest five tool results,
   lessons = what the goal was, which tools served it, which failed). The `echo` model answers with
   exactly that fallback.
3. The history becomes `[{role: refocus, text: essentials}] + the newest keep messages`.
4. The lessons go into the engine's `memory` element (deduplicated, newest 50 kept); every later
   prompt carries them under `# MEMORY`.
5. `state.refocus = {count, last: {before, after, folded, kept, lessons, mode: model | fallback, at}}`
   — the loop's card shows it ("refocused 1×: 1500 → 700 chars …").

### Asking

`help.ask` passes a question one level up: a child engine's ask lands on its parent; a top engine's
on itself, addressed to the owner. The owner sees every open ask on the engine that holds it, with a
reply field, and answers at any level (`reply`); the reply becomes a message of the asking engine's
loop. Contract §3.
