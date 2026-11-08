# Components: the agreement

## 1. One contract
Every component is **defined behaviour + configuration + state + UI** (`src/core/mod.rs`, `Component`).

| part | how |
| --- | --- |
| init | `new(Spec)` reads `config` (behaviour knobs, e.g. `response.format = toon`) and `state` (runtime data) |
| lifecycle | `on(Event)` — the only way state changes. Events: `Input`, `Reply`, `Called` (every tool call, nested ones too), `Snapshot`, `Observed` |
| persistence | `spec()` = `{kind, name, config, state}`, written back to its file after every step → a restart resumes |
| prompt | `prompt()` — its section, or nothing |
| UI | `view()` → `Node` tree, drawn by fixed primitives (`compose::Render`) |
| docs | `doc()` — shown in the Components page catalog |

Optional roles: `tools()` (contributes tools), `selects()` (picks shared tools), `allows()` (vetoes tools),
`parse()` (reads replies), `refresh()` (live snapshot), `watch()` + `wake()` (alerts).
One test (`every_kind_obeys_the_contract`) checks the contract for every registered kind.

## 2. The components

| kind | config | state | behaviour |
| --- | --- | --- | --- |
| `response` | `format: json \| toon` | – | tells the model the reply shape; parses calls (several at once) and the answer |
| `phase` | `phases: [{name, focus, tools?}]` | `current` | steers concentration; gates tools per phase; `set_phase` tool |
| `tools` | `use: [names]` | – | selects shared tools; no tools element = no shared tools |
| `history` | `max` | `turns` | user/model/tool turns; flags repeated call sequences (→ write a script) |
| `state` | – | the map | key/value memory; `remember {key, value}` tool |
| `artifact` (live) | `read: {tool, args}` | `content, version` | re-read before every step, so the prompt shows the state **after** the last call |
| `alert` | `source, every_ms, when, wake, keep` | `series, fired, was, pending` | polls a number; `when` over indicators (`last sma ema min max change pct`); edge-triggered wake |
| `script` | `description, steps: [{tool, args}]` | – | a shortcut: one tool running a fixed sequence; `$prev`, `$input`, `$input.key` |

Stock alert example (`elements/aapl.json`, with a `quote` tool selected):
```json
{ "kind": "alert", "config": { "source": { "tool": "quote", "args": { "symbol": "AAPL" } },
  "every_ms": 60000, "when": "sma(5) > sma(20)", "wake": "AAPL 5/20 cross at {value}" } }
```

## 3. Tools and engines
`Tool` = name + description + `invoke(args, toolbox)` (`src/core/tool.rs`). `IntoTool` turns any object
into one; `tool(name, desc, args, fn)` wraps a function. All calls in one reply run concurrently; results are recorded in completion order. An **engine is a tool** (`EngineTool`): every
sub-engine is in its parent's toolbox. The toolbox logs every call, so a script's inner calls reach the
components (phase, state, history) like direct calls.

## 3b. Lifecycle controls
- **Stop**: `Engine::stop()` (Stop button) ends the run before the next step; status `stopped`.
- **Refocus**: the context window in tokens (`engine.json context` override, else the model's `context`, else read from its runtime's models listing; ≈4 chars/token), a prompt at 90% of it triggers one model call that
  summarises the essentials and lessons; `Event::Folded` makes history keep that summary + the last 4 turns.
- **await: any** in a reply: continue after the first call finishes; the others are cancelled.
- **Live**: every save bumps the engine's change counter; the UI long-polls `wait_change` and re-reads.
- **Crash**: a `running` status at boot becomes `interrupted`.
- **Sandbox**: `scripts/sandboxed.sh` runs the built server under `sandbox/server.sb` (repo read-only,
  `data/` read-write, loopback port, HTTPS out; model CLIs from `CLI` (default `~/.local`) with their `~/.claude*` config, keychain and temp files).

## 4. Inference
`Infer::complete(model, prompt)` is the one call. `ModelsInfer` resolves the model by name in
`data/models.json` **each call** (switch at runtime). Runtimes:
- mechanisms in code: `cli` (any command, e.g. `["claude","-p","{prompt}"]`, `["copilot","-p","{prompt}"]`;
  no `{prompt}` = stdin) and `echo` (tests);
- every HTTP runtime is data in `data/runtimes.json`: `{name, base_url, path, auth (bearer | header
  name), headers, body (template with {model}/{prompt}), reply (JSON pointers, first match), models}`.
  Shipped: `openai` (chat completions), `openai-responses`, `anthropic`, `omlx`. Add one by adding an entry.

## 5. Boot: folder → objects
```
data/engines/<engine>/engine.json            {name, description, model, max_steps, status}
data/engines/<engine>/elements/<name>.json   {kind, config, state}
data/engines/<engine>/<sub>/…                sub-engine, same layout, any depth
data/routes/**/page.json  data/models.json  data/runtimes.json  data/ui.json  data/theme.json  data/layout.json  data/components/*.json
```
1. `seed`: copy anything missing from `defaults/` into `data/`.
2. `scan`: read folders into trees (configuration + state; nothing initialised — only components exist).
3. `init`: build each element from its spec, sub-engines first; attach the save hook. A `running` status
   from a crash becomes `interrupted`.
4. Start one poller per alert. 5. Serve. Everything an engine produces is data in its folder.

## 6. UI is configuration
Pages are folders (Next.js style): `data/routes/<path>/page.json` = `{title, nav?, root: Node}`;
`[name]` captures a segment, `[...name]` the rest; static beats dynamic beats catch-all. The sidebar is
the pages with `nav`, ordered by it. `view` nodes place built-in views, `use` nodes place created
components. Engines write pages with `create_view` / `list_views` (askk has them). Shell brand and words
come from `data/ui.json`; design tokens from `data/theme.json` (Theme page). The dashboard is one card per engine, each the engine's own
`view()`; element tiles are each element's `view()`. Created components are `Node` trees in
`data/components/`. The Rust UI only holds primitives and layout rules.

## 7. Code map
| path | holds |
| --- | --- |
| `src/core/` | contract (`mod.rs`), `tool.rs`, `engine.rs`, `boot.rs` (server) |
| `src/elements/` | one file per component kind |
| `src/infer/` | models file, runtimes |
| `src/compose/` | `Node`, primitives, `Render`, create/list component tools |
| `src/api.rs` | world boot, alert pollers, server functions |
| `src/components/` | layout primitives (Wall, Pane, Glass, Sidebar, Topbar, Stat) |
| `src/views/` | pages: Dashboard, EngineView, Models, Components, Shell |
| `defaults/` | the starting configuration |

## Tokens

`models.json` per model: `max_tokens` (default 32000, sent as `{max_tokens}` in the runtime body) and
`context` (window in tokens; 0 = read once from the runtime's models listing via `runtimes.json context`
pointers such as `/max_input_tokens`, `/context_length`, `/max_model_len`, then cached).

## Prompt: sections in a fixed order

`Engine::sections(tools, input)` is the prompt as data: one `Section {name, kind, body}` per
element with a prompt, plus `tools` and `input`. Order is by element name if listed in `core::ORDER`, else by kind, then name:

goal → focus → phase → state → learning → notes → artifact → alert → script → history → tools → response → other → input

So the same engine and input always render the same text (`core::render`). After the first
step the input carries a reminder that this request's calls already ran (`engine::continued`).
The chat page (`/`) shows these sections live: one colour per kind, a token bar, each section,
and the full rendered text.

## Default developer tools (`src/devtools.rs`)

Shared tools, chosen per engine with a `tools` element. File tools and commands are rooted at
`ASKK_WORKSPACE` (default: working directory); paths with `..` or absolute paths are refused.

| tool | args | result |
| --- | --- | --- |
| read_file / write_file / list_dir | `{path, content?}` | text / bytes written / entries |
| run | `{command, timeout_s?}` | `{code, stdout, stderr}` |
| spawn / jobs / stop | `{command}` / – / `{id}` | `{id}` / status + output tail / stopped |
| alarm | `{after_s, input, engine?}` | wakes the engine later with `input` |
| create_script | `{engine, name, description, steps}` | saves `elements/<name>.json` (next boot) |
| parallel | `{calls: [{tool, args}]}` | results in call order, run at once |

## Desk location

`askk --desk <dir>` (or `ASKK_DATA=<dir>`) loads engines, models, runtimes, routes, theme and
layout from `<dir>`; anything missing is seeded from `defaults/`.

## Engine state files: goal.md, focus.md, learning.md

A `notes` element with `config.file` keeps its state as a markdown file in the engine folder;
boot reads it, every save writes it (the element JSON keeps `state: null`). Edit the file by
hand or let the model change it.

| file | mode | tool | prompt |
| --- | --- | --- | --- |
| goal.md | replace | `set_goal {text}` | first section |
| focus.md | replace | `set_focus {text}` | second |
| learning.md | sections | `learn {section, lesson}` adds `- lesson` under `## section`; refocus summaries go to `## refocus` | after state |

## Replies are TOON

`response` defaults to `format: toon` (`json` still available):

```
calls[2]{tool,args}:
  read_file,{"path":"src/main.rs"}
  run,{"command":"cargo test"}
answer: text
```
The parser also accepts `calls[i]{tool,NAME}: {args}` rows and falls back to JSON.

## Objects: four views and live activity

Every backend object (engine and every element kind) draws itself; the UI only renders.

- `Component::render(size)` / `Engine::render(size, hidden)` → an `object` node carrying the
  object's name, kind, size and activity. Sizes: **icon** (glyph), **small** (name + one
  line), **medium** (its view), **large** (view + config + state; engines: elements at medium,
  sub-engines small). Elements get all four by default and may override.
- `activity()`: live state. Engine: `idle → thinking (waiting on the model) → calling (tools;
  detail = names) → refocusing → idle | stopped | error`; alert: `armed | fired`. Each engine
  change bumps its version, so open pages update through `wait_change`.
- CSS gives each activity its effect (`act-thinking` slow pulse, `act-calling` fast pulse,
  `act-refocusing` violet, `act-fired` flash, `act-error` red, `act-stopped` dim).
- Components page groups kinds into **Engine, Prompt, Action, Live** (`core::category`), plus
  **Created** (runtime components); each kind shows a running object of it at all four sizes.

## PRs, changelog and restart (static features, `src/pr.rs`)

- **PRs page** (`/pr`): every `git worktree` is a PR. Its `pr.md` is `# Title`, optional
  `status: working | ready`, then `## Section` blocks. Tabs: Overview (sections), Changes
  (diff against the merge-base with `main`, numbered rows), Commits (over `main`). `main`
  shows its uncommitted work; its log is the changelog. Put feature work in
  `.worktrees/<slug>` on a `feature/<slug>` branch.
- **Restart**: run the app with `scripts/service.sh`. It keeps the terminal, starts the app
  (`start` in `data/service.json`), and on Restart runs `update`, then `build`; if both pass it
  stops the app and starts it again, all output in the same terminal. A failed step leaves the
  running app alone. Status: `data/service-status.json`. Without the supervisor, Restart runs
  the same steps detached (plus `stop`) and logs to `data/service.log`.
- Tools for engines and scripts: `list_prs`, `changelog`, `restart`.

## Design rules (every element follows these)

Liquid glass: floating surfaces (`.glass`: panel, page header, phone routes button) carry a
top-left sheen, a lit top edge and two-layer depth; content sits on calm `.pane`s; never glass on
glass. Over busy content (the phone sheet) glass goes near-opaque so text stays legible.

1. **Type**: system stack (SF Pro on Apple), tight headings, tabular numbers in code and diffs.
2. **Contrast**: text meets AAA (7:1) in dark and light; `prefers-contrast: more` raises it further.
3. **Focus**: one visible ring on `:focus-visible`, none for pointer clicks.
4. **Targets**: every control is at least 44px tall (`--hit`).
5. **Motion**: quick feedback, spring arrivals, press scales to .96; `prefers-reduced-motion`
   removes it; `prefers-reduced-transparency` removes blur.
6. **Disabled** always reads as disabled.

Navigation panel by screen: **wide** (≥1200px) full panel, folded to an icon rail by the button
in its own header (labels become hover/focus tooltips); **medium** (768–1199px) icon rail;
**phone** one floating routes button opening the panel as a sheet (scrim tap or a link closes
it). Icons come from each route's `page.json` (`icon`). The page header shows where you are.

## Object sizes v2: small, medium, large (supersedes the four-size section)

Design tokens and rules follow `archive/docs/design-rules.md` (Amarante 400 for everything but
data, hierarchy by size, `.pane` content / `.glass` floats, state changes colour and shadow
only). Objects sit on a cell grid (`--cell` 48px, 52px from 768px; `--gap` 12px).

| size | what | footprint |
| --- | --- | --- |
| small | the live icon: emoji or icon over a breathing orb, status dot with halo while working, name beneath | 2×2 cells; engines 3×3 |
| medium | a card: icon 2×2 · name, activity, phase (or what it is doing) · a row of icons for the tools, live artifacts and sub-engines it holds (one per kind of ability, names on hover) · body that scrolls inside | 6 cells wide, 4 rows + body |
| large | the state view filling the content area: head, recent tool calls, live artifacts and alerts, every element as a medium card, sub-engines small | full width |

`engine.json` `icon` sets an engine's emoji. Activity tones: idle/stopped neutral, thinking
busy, calling accent, refocusing warn, armed ok, fired warn, error error.

Home (`/`) is the dashboard: every top engine at its own size. Press and hold the board (450ms)
or press Edit layout: cards jiggle, drag to reorder, S/M/L per engine; saved in
`data/layout.json` (`order`, `sizes`). Routes: Home, Chat, PRs, Components, Settings (Models,
Theme, Layout as tabs). The PR page is one component.
