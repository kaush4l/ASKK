# Components: the agreement

(The whole shape — principles, flow to code, rigid vs open places, open gaps — is in
`architecture.md`.)

## 1. One contract
Every component is **defined behaviour + configuration + state + UI** (`src/core/mod.rs`, `Component`).

| part | how |
| --- | --- |
| init | `new(Spec)` reads `config` (behaviour knobs, e.g. `handoff.format = toon`) and `state` (runtime data) |
| lifecycle | `on(Event)` — the only way state changes. Events: `Input`, `Reply`, `Called` (every tool call, nested ones too), `Snapshot`, `Observed` |
| persistence | `spec()` = `{kind, name, config, state}`, written back to its file after every step → a restart resumes |
| prompt | `prompt()` — its section, or nothing |
| UI | `view()` → `Node` tree, drawn by fixed primitives (`ui::render::Render`) |
| docs | `doc()` — shown in the Components page catalog |
| identity | `category()` (prompt, action, live, model) and `icon()` — required, so a new kind cannot forget them |
| prompt slot | `slot()` — which `core::Slot` its section fills; core owns the slot order |

Optional roles: `tools()` (contributes tools), `selects()` (picks shared tools), `allows()` (vetoes tools),
`parse()` (reads replies; no element = the reply is the answer), `refresh()` (live snapshot),
`watch()` + `wake()` (alerts), `abilities()` (tools shown on the card), `log()` (run log),
`summary()` (card line), `transcript()` (chat). Core never names a kind (`core_never_names_an_element_kind`).
One test (`every_kind_obeys_the_contract`) checks the contract for every registered kind.

## 2. The components

| kind | config | state | behaviour |
| --- | --- | --- | --- |
| `handoff` | `format: json \| toon` | – | tells the model the reply shape; parses calls (several at once) and the answer |
| `phase` | `phases: [{name, focus, instructions?, expect?, goal, tools?, elements?, refocus?}]`, `repeat` | `current`, `done: [{phase, met}]` | the configurable focus: ordered phases, each gates tools and visible elements; `phase_done {met}` moves to the next only when the goal is met |
| `tools` | `use: [names]` | – | selects shared tools; no tools element = no shared tools |
| `history` | `max` | `turns` | user/model/tool turns; flags repeated call sequences (→ write a script) |
| `state` | – | the map | key/value memory; `remember {key, value}` tool |
| `artifact` (live) | `read: {tool, args}` | `content, version` | re-read before every step, so the prompt shows the state **after** the last call |
| `alert` | `source, every_ms, when, wake, keep` | `series, fired, was, pending` | polls a number; `when` over indicators (`last sma ema min max change pct`); edge-triggered wake |
| `script` | `description, steps: [{tool, args}]` | – | a shortcut: one tool running a fixed sequence; `$prev`, `$input`, `$input.key` |
| `whiteboard` | `max` | `figures: [{run, figure}]` | the teacher's board: `plot`, `graph`, `draw`, `table` put a figure on it (a checked value, `core/figure.rs`; the same title replaces), `wipe` removes; a `plot`/`table` may take real data with `from` |
| `attachments` (live) | `shown` | `seen: [ids]` | what the user attached (`[media:<id>]` tokens in a message): the words go in the prompt, the pictures (an image, a video's stills) to a model that sees |

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
- **Refocus**: the context window in tokens (`engine.json context` override, else the model's `context`, else read from the server's models listing; ≈4 chars/token), a prompt at 90% of it triggers one model call that
  summarises the essentials and lessons; `Event::Folded` makes history keep that summary + the last 4 turns.
- **await: any** in a reply: continue after the first call finishes; the others are cancelled.
- **Live**: every save bumps the engine's change counter; the UI long-polls `wait_change` and re-reads.
- **Crash**: a `running` status at boot becomes `interrupted`.
- **Sandbox**: `scripts/sandboxed.sh` runs the built server under `sandbox/server.sb` (repo read-only,
  `data/` read-write, loopback port, HTTPS out; model CLIs from `CLI` (default `~/.local`) with their `~/.claude*` config, keychain and temp files).

## 4. Inference
`Infer::complete(model, prompt, sampling)` is the one call. `ModelsInfer` resolves the model by name
in `data/models.json` **each call**. A model is `{name, method, base_url, token_env}` (+ `command`
for cli, `max_tokens`, `context`). Two methods, both in code:
- `openai`: `POST {base_url}/chat/completions` with a bearer token from the env var named in
  `token_env` (never stored). Every server speaks it (OpenAI, Anthropic's compatible endpoint, LM
  Studio, oMLX, vLLM, Ollama); only `base_url` changes (blank = `https://api.openai.com/v1`).
- `cli`: any command, e.g. `["claude","-p","{prompt}"]`; no `{prompt}` = stdin.

Old files with `connector`/`key_env` still load. `runtimes.json` and `echo` are gone.

### Sampling element
`sampling` (catalog: Model) is a prebuilt config component. Presets: `default` (sends nothing, the
model's own default), `precise` (temperature 0.2), `balanced` (0.7), `creative` (1.0, top_p 0.95);
`presets` adds or overrides. `use` picks one for the engine, `phases` per phase (refocus included),
and the `sampling {preset}` tool lets the engine switch for its goal (kept in state). Order: phase's
own > chosen by tool > `use` > default. No sampling element = nothing sent. askk ships
`{"phases": {"understand": "precise", "refocus": "precise"}}`.

## 5. Boot: folder → objects
```
data/engines/<engine>/engine.json            {name, description, model, max_steps, status}
data/engines/<engine>/elements/<name>.json   {kind, config, state}
data/engines/<engine>/<sub>/…                sub-engine, same layout, any depth
data/routes/**/page.json  data/models.json  data/ui.json  data/theme.json  data/layout.json  data/components/*.json
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
| `src/core/` | contract (`mod.rs`), `tool.rs`, `engine.rs`, `boot.rs`, `board.rs`, `store.rs` |
| `src/elements/` | one file per component kind |
| `src/host/infer/` | models file, openai + cli methods |
| `src/core/node.rs/` | `Node`, primitives, `Render`, create/list component tools |
| `src/core/store.rs` | `Store`: the only way state reaches disk (folder now, database later) |
| `src/host/world.rs` | boot (seed → scan → init), `find`, alert pollers, board wiring |
| `src/host/tools.rs` | the shared-tool registry, `create_engine` (from a template), `dismiss_engine` |
| `src/host/market.rs` | market tools (`quote`) |
| `src/api/mod.rs` | server functions only |
| `src/ui/components/` | layout primitives (Wall, Pane, Glass, Sidebar, Topbar, Stat) |
| `src/ui/views/` | pages: Dashboard, EngineView, Models, Components, Shell |
| `defaults/` | the starting configuration |

## Tokens

`models.json` per model: `max_tokens` (default 32000, sent as `max_tokens`) and `context` (window in
tokens; 0 = read once from `GET {base_url}/models`, fields `context_length`, `context_window`,
`max_model_len` or `max_input_tokens`, then cached).

## Prompt: sections in a fixed order

`Engine::sections(tools, input)` is the prompt as data: one `Section {name, kind, body}` per
element with a prompt, plus `tools` and `input`. Each element names its `slot()`; core orders
slots (`core::Slot`, `core::order`), then names within a slot (the toolbox first in `tools`):

purpose (goal) → knowledge (learning, notes) → tools (toolbox, scripts) → format (handoff) →
position (phase, state) → world (artifact, workspace, alert) → conversation (history) → other → input → nudge

Stable first, volatile last: what to do and what was learned, then how (tools, the reply format's
general rules), then where the work stands, then the conversation. The input follows, and every
element's `nudge()` (the handoff element's one-line format reminder; config `nudge`, `"off"`
for none) closes the prompt, so the format is the last thing the model reads.

So the same engine and input always render the same text (`core::render`). After the first
step the input carries a reminder that this request's calls already ran (`engine::continued`).
The chat page (`/`) shows these sections live: one colour per kind, a token bar, each section,
and the full rendered text.

## Default developer tools (`src/host/workspace.rs`)

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

`askk --desk <dir>` (or `ASKK_DATA=<dir>`) loads engines, models, routes, theme and
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

`handoff` defaults to `format: toon` (`json` still available):

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
- Components page groups kinds into **Engine, Prompt, Action, Live, Model** (`Component::category`), plus
  **Created** (runtime components); each kind shows a running object of it at all four sizes.

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
`data/layout.json` (`order`, `sizes`). Routes: Home, Chat, Components, Settings (Models,
Theme, Layout as tabs).

## Design note (in progress, 2026-11-08)

We are still fine-tuning the look; these are the current decisions, not final ones.

- Engines and elements are both 2×2 when small (an engine was 3×3; too big).
- Medium card bottom half: what it can use, grouped by type: **Tools** (selected shared tools,
  scripts, set_phase), **Live** (artifacts, alerts), **Engines** (sub-engines). Same icon = one
  mark, names on hover. Note-editing tools (goal, focus, learning) and the reply format are left
  off the card. Below them, the run log: the last 3 actions, newest first.
- Home: click a card to switch it between medium and large; long press for full layout edit.
- Refocus is a phase: a phase with `"refocus": true` gives the instruction sent at 90% context
  (detailed: what to keep, what to drop). It is never the default working phase.
- Open: dark/light contrast measured only by eye; orb motion strength; how large views compose
  for engines with many elements; the startup sequence (scripts that build state from folders
  or a database) is next.


## Prompt size and refocus
- **Budget**: a model's window holds prompt *and* reply, so the input budget is `context - max_tokens`
  (`models.json`: `max_tokens` = cap on each reply, sent with the request; `context` = the whole
  window, 0 = read from the server). An `engine.json` `context` is taken as the input budget as is.
- **Trigger**: refocus only when the prompt reaches 90% of the budget. Each step also emits
  observations `prompt_share` and `history_share` (fraction of the budget) for alerts or later rules.
- **Refocus prompt**: only the purpose, knowledge, position and conversation slots and the input (`core::REFOCUS_SLOTS`);
  tools, artifacts, alerts, scripts and the reply format are left out.
- **History** is a short log: the last `max` (25) inputs and replies, plus only the latest step's
  tool results; the next reply drops them. A refocus summary stays on top.
- **notes** `mode: list` (askk: `notes.md`): `note {text}` / `done {text}`; the engine keeps what
  matters here, since tool results are shown once.

## Reply fields
`response.fields` is an ordered list of `{name, about}` the model writes **before** its calls or
answer, so a model reasons first instead of answering straight away. Default: `thinking`. Add
`plan`, `risks`, `confidence`, … or set `[]` for none. Names `calls`, `answer`, `await`, `tool`,
`args` are reserved. TOON: `name: text` (may span lines, until the next key); JSON: keys of the
object. Parsed into `Reply.fields`; Chat shows each as a collapsible note above the reply; calls
show as `→ tool(args)`. A model's native reasoning channel (`reasoning_content`) is separate and
not sent back.

## Reply format: act
Tool calls are signatures in one list: `act: [read_file(path: "src/main.rs"), run(command: "cargo test"), now()]`.
No count to write. Args are `name: value` pairs (JSON values) or one JSON object; the list may span
lines. Every call starts at once; the engine waits for all, records every result, and the next
step sees them. `answer: <text>` ends the run. JSON format: `{"act": ["tool(args)", ...]}`. The
tools section lists each tool the same way: `- read_file(path: text) — read a file`. Old
`calls[n]{tool,args}:` replies still parse.
History writes each result in the same call form: `list_dir(path: "docs") → build.md, components.md`.
JSON is unwrapped: strings unquoted, objects as `key: value` pairs with empty values dropped
(`run(command: "echo hi") → code: 0, stdout: hi`).

## Lifecycle and direction (design notes, 2026-11-08)

**Config** = knobs, written by a person. An engine must also be able to create sub-engines through a tool, and that tool must follow the same rules as everything else (it writes Specs the same way a person would).
**State** = enough to rebuild the element from a backup (`Spec{kind,name,config,state}` → `build`). It will be defined more precisely later.

Boot runs three steps:
1. **seed**: copies `defaults/` into `data/` when an item is missing. Idea: turn this into a feature (templates, starter engines, reset to default). First step done: `defaults/templates/engine` is seeded to `data/templates/engine`, and `create_engine {template}` copies a template (what a new engine is made of is a folder you edit, not Rust).
2. **scan**: the folder tree *is* the engine structure, and it returns the engine tree. Planned (later, in the pipeline): a SQLite db holds the data, and initialising means opening the db instance.
3. **init**: turns the template into live objects. No tool is hard-coded. Every element in the list is optional, and the UI must render for any combination.

Runtime:
- Each engine gets an `invoke` callable.
- The loop: input → render prompt → LLM → the result decides the next step.
- **Phases** shape the text the model focuses on in the current loop. A workflow is a set of phases where one phase must follow another.
- **Refocus** is a special phase that controls which context is sent and what the instruction is.
- Each object reacts to events, updates its own status and shows it in the UI. Objects mark themselves as changed, and the UI picks up the changes at its own refresh rate, so fast engines can still be rendered.
- **Artifact**: a tool call updates the artifact's state, and the next LLM call sends that updated state with the prompt.
- What an engine learns from observation makes it a *personalised engine*. "Personalised for flow" and "personalised for engine" are still to be defined.

## Page focus rules (design, 2026-11-08)

Each page has one focus. It gets the strongest weight, and everything else steps down.

| Lever | Focus | Secondary | Chrome |
|---|---|---|---|
| Size | `--text-xl` page or object name | `--text-lg`/`--text-md` cards | `--text-sm`/`--text-xs` meta |
| Colour | `--fg` | `--fg` at 85% | `--muted` |
| Accent | the one filled button (`.btn.primary`) | tinted selection (tabs, nav) | none |
| Spacing | `--space-5`/`--space-6` around it | `--space-3`/`--space-4` inside groups | `--space-1`/`--space-2` |
| Status | halo around the card in `--tone` (breathes while working) | dot on the icon | — |

| Page | Focus | Primary action |
|---|---|---|
| Home | engine cards: name (status), phase, short summary, tools, logs; 3 per row max | Open |
| Chat | the conversation and its input | Send |
| Engine | the engine and what it is doing now | Run |
| Components | the catalogue of kinds | — |
| Settings | the model list | Save |

The card summary is the latest refocus summary in history, falling back to the description. A better way to summarise past transcripts is still open.


## Setups (2026-11-08)

Focus is not a separate note: one general instruction only steers one direction. Focus is the
**phase**. Three setups, all from the same elements:

1. **Single loop**: one engine, goal + tools + history + response. No phase, or one phase.
2. **Team**: several engines listed as sub-engines of a lead (each is a tool of the lead), sharing
   one dashboard `artifact` they all read and write.
3. **Phased**: one engine that checks different aspects or works a sequence. `phase` lists the
   phases in order; each says its focus, its own special instructions, the outcomes it must produce (`expect`), its goal (the exit test), and optionally which tools it may
   call and which elements the model sees. The engine moves on only with `phase_done {met}`,
   which needs the evidence and goes to the next phase only (no jumping; `repeat` loops back).
