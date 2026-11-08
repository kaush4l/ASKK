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
element with a prompt, plus `tools` and `input`. Order is by kind (`core::ORDER`), then name:

goal → phase → state → artifact → alert → script → history → tools → response → other kinds → input

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
