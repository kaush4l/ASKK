# Components: the agreement

(The whole shape — principles, flow to code, rigid vs open places, open gaps — is in
`architecture.md`.)

Two things are called a component here. Sections 1 to 7 are about the parts an **engine** is
made of (history, notes, tools...). Sections 8 to 12 are about the parts a **page** is made
of: the layers (tokens → kit → components → views), the rule that a component is given what
it shows, how things move, the talk screen, and the terminal.

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
| `src/ui/features/` | what a person can do and what the words say (`talk.rs`, `run.rs`, `boxes.rs`, `markdown.rs`, `code.rs`, `keys.rs`, `palette.rs`, `queue.rs`, `asks.rs`, `terminal.rs`); no drawing |
| `src/ui/web/kit/` | standard parts from rust-ui.com (section 8) |
| `src/ui/web/components/` | this app's own parts, each given what it shows (section 8) |
| `src/ui/web/views/` | pages: Dashboard, EngineView, ChatView (the talk screen), Models, Shell... |
| `src/ui/terminal/` | the same features as lines (section 11) |
| `assets/styling/` | `glass.css` (tokens, every page), `talk.css` (the talk screen, arrivals) |
| `defaults/` | the starting configuration |

## 8. The UI's parts: tokens → kit → components → views (2026-11-11)

"Component" above means a part of an engine. From here on it means a part of a page. One
set of parts draws every place the app is shown (browser, Mac app, phone, tablet), because
they are all the same Rust source.

| layer | where | what it is | the rule | held by |
| --- | --- | --- | --- | --- |
| tokens | `assets/styling/glass.css` (`:root`, at the top) | every colour, size, time and curve, named once | nothing else writes a colour or a time | review |
| kit | `src/ui/web/kit/` | standard parts copied from rust-ui.com (MIT): avatar, badge, button, card, collapsible, dialog, kbd, scroll_area, separator, skeleton, spinner, tabs, textarea, tooltip | knows nothing of this app; names tokens, never a colour; says where it came from and what we changed | `the_kit_is_standard_parts_and_nothing_else` |
| components | `src/ui/web/components/` | this app's own parts, made of kit parts | **is given the object and the values it shows** | `a_component_only_shows_what_it_is_given`, `looks_live_in_the_stylesheet` |
| views | `src/ui/web/views/` | pages, made of components | asks through `api/`, hands the answers down, decides nothing about the domain | `every_view_a_page_may_name_is_drawn` |
| words | `src/ui/features/` | what a run or a state reads as, for every UI | no drawing | `a_feature_draws_nothing` |

### The rule: a component takes the object and the values to show

A component never asks the service (`crate::api::…()`), never waits for an answer
(`use_resource`, `use_server_future`), never listens for changes, never reaches into a view,
and reads nothing shared behind its back (`use_context`). It is handed a value and draws it;
what the person did goes back up as an event. Naming a *shape* from `api/` or `core/` for
what it is handed is allowed: that is the object.

| who | does | example |
| --- | --- | --- |
| the view | asks, keeps what was asked for, acts | `views/chat.rs` asks `talk(path)`, and `engine_run(path, id)` when a run is opened |
| the component | draws what it is given, says what was pressed | `RunView { run, on_open }` |
| the feature | says what the words are | `features/run.rs`: `headline(&run)` → `Worked for 3.2s · 2 steps · 1 call` |

| component | file | the object it is given | events it sends up |
| --- | --- | --- | --- |
| `Thread` | `turn.rs` | `Vec<Beat>`, the runs held in full, the pictures of attachments, the message just sent, the answer being written (run id, text) | `on_open(run id, open)` |
| `TurnView` | `turn.rs` | one `Beat` (what was asked, its run, figures, replies) | `on_open`, `on_edit` ("edit from here"), `on_cite(the words chosen in an answer, or all of it)` |
| `RunView` | `run.rs` | one `core::run::Run` (an outline, or in full). It is open while the run goes and closes when it ends, unless the person chose | `on_open(open)` |
| `StageRow` | `run.rs` | one `core::run::Mark` | — |
| `CallRow` | `run.rs` | one `features::run::Call` (tool, the program, the result) | — |
| `EngineChip` | `engine_chip.rs` | a `Mode` (the engine), its activity and detail | — |
| `EnginePick` | `engine_chip.rs` | `Vec<Mode>`, the chosen path | `on_pick(path)` |
| `Composer` | `composer.rs` | the text (a signal the view owns), `Vec<Attached>`, `working`, `busy`, the messages that wait (`Vec<Queued>`), what was steered into the run (`Vec<SteerLine>`), the models (`ModelChoice`), the permission mode, what `@` and `#` reach and the prompts sent before (`Reach`), how much is put aside, whether the browser can hear. It opens the `/ @ #` menu itself from what is typed (`features/compose.rs`) | `on_send`, `on_stop`, `on_attach`, `on_remove`, `on_unqueue(key, write on it again)`, `on_steer(key)`, `on_model(name)`, `on_permit(mode)`, `on_stash(text or none)`, `on_voice` |
| `QueueList` | `composer.rs` | `Vec<Queued>`: what waits until the box is done; whether one may be steered into the run (`steer`) | `on_unqueue`, `on_steer(key)` |
| `PermitPick` | `composer.rs` | the mode: ask every time, allow edits, allow all | `on_pick(mode)` |
| `ApprovalForm` | `asks.rs` | one `core::permit::Approval`: a call that waits for the owner's yes | `on_answer(yes)` |
| `Writing` | `turn.rs` | the answer a run is writing, as far as it has come | — |
| `TalkList` | `talks.rs` | `Vec<TalkInfo>`: an engine's conversations (named, settled, archived); whether it is at work; the one being read; what is searched for and the `Vec<TalkHit>` found | `on_open(id)`, `on_new`, `on_mark(id, archive / settle / name:…)`, `on_query(text)` |
| `SideEdge` | `edge.rs` | the panel's width (`SIDE_WIDTH` bounds it) | `on_width((width, last))` |
| `DiffView` | `workspace.rs` | a `WorkspaceDiff`: the files the last run changed (with its tools or the programs it ran), before and now | — |
| `FilesView` | `workspace.rs` | the workspace root, its files, the one chosen, its text or why not | `on_open(file)` |
| `ModelPick` | `composer.rs` | a `ModelChoice`: every model, the default, the one the engine names itself; a pick names this engine's own (empty: follow the default) | `on_pick(name)` |
| `Prose` | `markdown.rs` | a text in Markdown; it reads it once (`features/markdown.rs`) | — |
| `Markdown` | `markdown.rs` | `Vec<Block>`: the text already read, with what is safe already decided | — |
| `CodeBlock` | `markdown.rs` | a program and the word after its fence; it colours it (`features/code.rs`) and copies it | — |
| `AskForm` | `asks.rs` | one `Ask` (a question that waits for the owner), what became of the last answer | `on_answer(text)` |
| `SpecView` | `spec.rs` | an engine's goal, learnings and tools, as the three texts it holds | — |
| `SessionThread` | `turn.rs` | a session's `Vec<Turn>`, whether the agent works, why it failed | — |
| `Palette` | `palette.rs` | whether it is open, every `Entry` (`features/palette.rs`) | `on_pick(Pick)`, `on_close` |
| `Shortcuts` | `palette.rs` | whether it is open, whether this is a Mac (the keys' names) | `on_close` |
| `TerminalView` | `terminal.rs` | a `core::screen::Screen`, a label | `on_type(the bytes a program reads)` |
| `MediaChip` | `media.rs` | a `Chip`, its picture | — |
| `Topbar` | `topbar.rs` | brand, title, every engine's path, the current one, the theme in use | `on_engine`, `on_theme` |
| `Footer` | `footer.rs` | the contact entries | — |
| `Pill` | `pill.rs` | brand, every box as a `Shown`, the count per state, `Vec<NavLink>`, a line about the service, the id of the open box, whether it is grouped, its width, two signals the shell owns (folded, open). It keeps what is typed into its find field | the box that was looked at, `on_group`, `on_width(px, let go)` |
| `BoxMark`, `BoxRow`, `BoxTile`, `OpenHead` | `boxes.rs` | a `Shown`: the `SessionBox`, the mark this window shows for it, the address that opens it in place, whether it is pinned; a tile also its open questions and how many messages wait for it | the box looked at; what was said into it; `on_pin`; `on_answer(box, question, answer)` |
| `Stat`, `Icon`, `Companion`, `Pane`, `Glass`, `Wall` | one file each | their values | — |

Before this rule the top bar asked for the engines itself, the footer read the shared
settings, and an attachment fetched its own picture. All three now take them; the debt list
in the test is empty and may not grow.

The foot of a conversation (`views/compose.rs`) is a view of its own: it asks for the permission
mode and what waits for a yes, the engine's model, where steers landed, and the workspace's files
once `#` is typed, and runs the `/` commands.

One conversation, two places: `views/conversation.rs` is the talk with an engine, and both
the Talk page (`views/chat.rs`) and an engine's box open on the canvas (`views/open.rs`)
place it. Nothing of it is drawn twice.

Two looks are written on an element, because each is a number that arrives at run time:
the colours a terminal's program chose (`components/terminal.rs`) and the width the owner
dragged the pill to (`views/shell.rs`). The test lists both and no others.

Not moved yet (said plainly): `views/loops.rs` (`RunCard`, `RunPanel`, `NowChip`) and
`views/prompt.rs` are views that still draw and ask in one place; the dashboard, engine,
rooms and sessions pages still use page classes (`.btn`, `.seg`) instead of kit parts.

### The kit: what we changed in our copies

Each file's first line says it. In short: tabs got roles, arrow keys and one sliding mark
(placed by the stylesheet alone: where the browser can tie one element's place to another's,
CSS anchor positioning, the mark takes the chosen tab's place and width; elsewhere the tabs
are columns of one width and the mark's place is the tab's number);
collapsible got `aria-expanded`/`aria-controls`, draws nothing while closed and cannot be
tabbed into; textarea got a value, events and a label (the original could not be typed
into usefully); spinner draws its own ring and says what is awaited; scroll_area uses the
browser's own bar and can be reached by keyboard; tooltip also shows on keyboard focus;
button got a pressed state and the app's control sizes; dialog is opened by its parent (so
a key can open it: the original could only be opened by its own button, through a script
it wrote into the page), says it is a dialog, takes the focus, keeps Tab inside, closes on
Escape and gives the focus back. To add a part: the recipe is at
the top of `src/ui/web/kit/mod.rs`.

Kit looks are Tailwind classes; `tailwind.css` maps the kit's colour names onto glass
tokens and holds the kit's few motions. The stylesheets load in this order:
`assets/tailwind.css` (written by `dx`), `glass.css` (tokens and every page), `talk.css`
(the talk screen and how things arrive). glass.css and talk.css are plain CSS outside any
layer, so a page class always wins over a kit utility; bare `input`/`textarea` rules
leave kit parts alone (`:not([data-name])`).

Two traps this makes, both met while building the talk screen:

- **A short page class shadows a kit utility of the same name.** glass.css has `.grid`,
  `.grow`, `.row`, `.stack`. A kit part that needs such a utility writes it out
  (`[display:grid]`, `inline-grid`).
- **A new page class may already mean something.** `.call` and `.side-toggle` did. Before
  naming a class, search glass.css for it.

## 9. Motion and glass: the rules, and where each lives

Taken from the apple-design skill the owner chose
(<https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md>, Apple's
WWDC design talks put in web terms). Only its design guidance is used.

| # | rule from the skill | here |
| --- | --- | --- |
| 1 | **Answer on the press, at once.** "Respond on pointer-down, not on release." | every control sinks to `--press-scale` (.97) in `--motion-press` (100ms) on `:active`; nothing waits for a transition before it reacts |
| 2 | **Springs, not fixed animations. No overshoot by default** (damping 1.0, response 0.3–0.4); bounce (damping ~0.8) only when a flick carried momentum. | `--ease-spring` is that spring, sampled into a `linear()` curve; `--motion-spring` 440ms is response 0.3, `--motion-spring-slow` 590ms is response 0.4. `--ease-bounce`/`--motion-bounce` (damping 0.8) exist and are used nowhere: nothing here is thrown yet |
| 3 | **Anything can be interrupted.** Start from where the thing is now. | what a person can reverse is a CSS *transition* (the side panel, a collapsible, the tabs' mark, the phone's navigation sheet): pressed again mid-way it turns round from where it is. Keyframes are only for arrivals nobody can grab, and an arrival holds nothing once it is over (`backwards`, never `both`: a held animation makes its element the frame of anything fixed inside it) |
| 4 | **Leave the way you came.** Enter and exit on the same path, anchored to the source. | the panel slides in from the right and out to the right; a collapsible closes the way it opened (and stays drawn until it has); a tooltip steps out from the side it sits on; exits use the mirrored curve `--ease-exit` |
| 5 | **Glass shows hierarchy.** Bigger surfaces are thicker; never glass on glass; a bright top edge; dim the page only for something modal; fade at a scroll edge instead of a line. | `--blur-thin` 12 / `--blur` 24 / `--blur-thick` 40px with `--saturate`; `--elev-1` / `--lift` / `--elev-3`; `--hi` top edge; the panel is a sheet with a scrim on a phone and a plain neighbour on a wide screen; `ScrollArea { fade }` |
| 6 | **Move only what is cheap.** `transform` and `opacity`. | so everywhere, except a collapsible's height (grid rows) |
| 7 | **Less motion is not no feedback.** Replace travel and springs with short fades; with "reduce transparency" make surfaces solid; with "more contrast" give them a clear edge. | `prefers-reduced-motion`: the distance tokens become zero, loops stop, colour and opacity still change in `--motion-fast`. `prefers-reduced-transparency`: the surface and blur tokens go solid, so every surface does. `prefers-contrast: more`: solid surfaces, borders in the text colour |
| 8 | **Feedback has four kinds:** status, completion, warning, error. | status: the working line and the engine's dot; completion: the run's line turns to "Worked for…"; warning and error: a sentence in the error colour with `role="alert"` |

| token | value | for |
| --- | --- | --- |
| `--motion-press` | 100ms | the press |
| `--motion-fast` / `-base` / `-calm` / `-slow` | 150 / 200 / 260 / 300ms | colour, hover, small moves |
| `--motion-spring` / `-spring-slow` | 440 / 590ms | arrivals, the panel, a collapsible, the tabs' mark |
| `--motion-stream` | 600ms | an answer fading in |
| `--motion-tick` … `--motion-drift` | 700ms … 28s | what repeats while something works or rests |
| `--ease-spring`, `--ease-bounce`, `--ease-out`, `--ease-exit` | curves | see rules 2 and 4 |
| `--press-scale`, `--hover-y`, `--enter-y`, `--enter-scale`, `--sheet-y`, `--open-scale` | .97, -2px, 8px, .98, 24px, .94 | how far things move; `--open-scale` is how small a box is when it begins to open from its tile |
| `--hit`, `--hit-md`, `--hit-sm`, `--hit-row` | 44, 36, 32, 28px | a control's height for a pointer; on a phone or any touched screen all four are 44px |
| `--lane` | 46rem | the width of the conversation's column |

What was added with the box that opens in place, and where each rule holds:

| what moves | how | rule |
| --- | --- | --- |
| a box opens from its tile and goes back to it | `.box-open` grows from `--open-scale` at the tile's own place (`--from-x`, `--from-y`, measured at the touch) on `--ease-spring`; it leaves to the same place on `--ease-exit`. Both are transitions: a second touch mid-way turns it round. It is drawn until it has left, and what is not shown is `inert` | 2, 3, 4 |
| the tiles under an open box | fade and shrink a step toward the same place, and come back | 4, 6 |
| "go to anything" and the shortcuts | the kit's dialog: a step up and a little smaller on `--ease-spring`, out on `--ease-exit`; the page is dimmed because they are modal | 2, 4, 5 |
| the pill's edge while it is dragged | follows the pointer exactly: the shell's own easing is off for as long as it is held | 1 |
| a message put in the queue | arrives like a turn (`enter`) | 2 |
| a press on a tile's head, the way back, a line of the palette | sinks to `--press-scale` in `--motion-press` | 1 |

Seen with "reduce motion" on (headless Chrome, `--force-prefers-reduced-motion`, and the
media feature set over the DevTools protocol): the distances are zero, no keyframes run,
and the box, the tiles and the dialogs still fade in 150ms. Seen with "reduce
transparency": the pill, the tiles and the palette are solid `--tint` with no blur, the
wall's lights are off. With "more contrast" as well, the new parts get an edge in the text
colour.

Not taken, and why: dragging with the finger, handing the finger's speed to a spring,
throwing, rubber-banding at an edge (rules 2, 5, 6 and 9 of the skill) need a surface a
person drags, and there is none yet (the panel opens by a button). Sound and haptics: none.
Type tracking by size: the app's face (Amarante) is one weight with one tracking.

## 10. The talk screen, measured against T3 Code

T3 Code (<https://github.com/pingdotgg/t3code>, <https://t3.codes>) is an open-source
"agent harness control surface" by Theo's company: a web, desktop and phone app that
drives coding agents already installed on the machine (Claude Code, Codex, Cursor and
others). Its source and docs were read on 2026-11-11 (`apps/web/src/components/`,
`docs/user/`); nothing was installed, and no screenshot was looked at.

Its main screen: a sidebar of threads in sections (pinned, active, working, snoozed,
settled) each with a status word and a timer; a header with the project and thread title;
the timeline in one centred column; a glass composer; a right panel with tabs (diff,
terminal, files, browser); a terminal drawer at the bottom.

| T3 Code part | what it does | askk | state |
| --- | --- | --- | --- |
| centred lane | `--chat-content-max-width: 46rem` | `--lane: 46rem` | same |
| user message | right-aligned bubble, `max-w-[80%] rounded-2xl p-3` | `.ask`, 80% wide, right | same |
| assistant message | Markdown, no bubble, fades in as it streams (600ms) | `Prose`: headings, lists, tasks, quotes, tables, links, inline code; fades in (`--motion-stream`). While a run's model writes, `Writing` shows the answer so far with a caret after its last line: the runtime hands each piece on (`Infer::stream`: an `openai` server's event stream, a `cli` command's output as it prints, Claude Code's `stream-json` deltas), the engine keeps it per run and step (`core/heard.rs`) and marks `said/<engine key>` at most every 60ms; the view asks `run_partial(path)` on that key only. The reply format says which part is the answer (`Component::partial`: a `handoff` reply's `answer:`, nothing while fields or calls are written) | same; **the tab's echo streams word by word, but a model server the tab reaches is asked whole** (its stream is not read there yet); the caret stops blinking with reduce motion |
| code blocks | highlighted (Shiki), a copy button, the language | `CodeBlock`: a copy button, the language, colours for Rust, JavaScript and TypeScript, Python, JSON, shell and a diff from one small reader (`features/code.rs`) | same idea; **six languages, coloured by word and not by grammar**; any other language is plain |
| links, raw HTML | sanitised; links open outside | decided once where the text is read: only `http`, `https`, `mailto`; raw HTML is text; a picture is a link and is never loaded | safer than drawing it; **no pictures in an answer** |
| math, Mermaid, file and thread links | drawn | — | **none** |
| tool calls | consecutive calls fold into one summary row; open, a list of rows (24px, small text); each row opens to a mono body | `RunView`: one line (`Worked for 3.2s · 2 steps · 1 call`) that opens to a `StageRow` per stage; under `act`, a `CallRow` per call showing the program and its result | same idea; askk shows every stage of the loop, not only the calls |
| "Working for N" | a live line with a shimmer and a timer | the run's line while it runs: shimmer, timer, the stage it is in; the engine's dot pulses | same |
| stop / send | round send button; Stop while working | `Composer`: round Send, Stop beside it while the engine works | same |
| composer | glass, `rounded-2xl`, grows, attachments strip, model and effort pickers, permission mode, dictation | glass, grows, attachments strip, Enter sends and Shift+Enter breaks the line, a model choice | the model choice names this engine's own model (`set_engine_model`), the permission mode is chosen beside it, `/ @ #` open a menu, voice where the browser hears (2026-11-12); **no effort picker** |
| queued messages | a message sent while working waits, can be edited or steered | `QueueList`: a message sent while the box works waits in sight, in order, goes when the box is done and has read the one before; it can be taken back or written on again, and (an engine at work) **sent now**: it lands in the engine's message box, and the run in hand reads it at its next step. The queue is kept in the browser beside the window (`askk-queue` in localStorage), so a reload brings it back | same; **steering reaches an engine with an inbox at its next step, not mid-reply**, and another browser has its own queue |
| approvals | an inline row, never hidden | `AskForm`: a blocked box shows its question with a field to answer, in its tile and when open | same for an engine's questions; **a harness's own permission prompts are not seen** (`docs/sessions/009`) |
| changed files, diff | a card in the reply, a diff tab | a fenced `diff` in an answer is coloured; the panel's **Diff** tab shows what the last run that wrote files changed (`workspace_diff`): each file before the run first touched it and now, `+n −m`, a unified diff (`features/diff.rs`) coloured by the same reader | **no card in the reply**; only changes made through the workspace's `write_file`/`edit_file` are seen (a program a run starts that writes files is not), and they are held in memory: a restart forgets them |
| right panel | tabs: diff, terminal, files, browser; resizable | tabs: Board, Loop, Prompt, **Diff**, **Files** (the workspace tree, a file opened read only through `workspace_file`); each workspace tab asks only while it is chosen; opens and closes, a sheet under 1200px; in the tab both say a workspace needs askk on a machine | **not resizable; no terminal or browser tab** |
| thread list | a sidebar of threads in sections, status, timer; pinned; search | the pill: every session as a row with its state mark and last line, what needs the owner first; a find field; groups by place; boxes pinned to the canvas; its width dragged. Inside an engine, `TalkList`: **every conversation with it** (the open one first, then the last open), a new one begun from the head; the one it had before is the first (`core/talks.rs`: a conversation is the state of the elements a clear empties, put aside under `<engine>/talks/`) | same idea, as boxes; **while the engine works, another conversation can be read (not opened)**, and the open one keeps going and is live when you go back; a new one waits until it is done; notes, goal and learning are the engine's, not a conversation's; **no timers, no snooze, no sections by state** |
| opening a thread | the thread fills the main part; the URL names it | a box opens in place and fills the canvas; the address names it after `#`, so a reload, a link and the back button agree | same |
| minimap, find in thread | ticks per message, `mod+f` | — | **none** |
| keyboard | `mod+k` palette, `mod+b` sidebar, `mod+j` terminal and many more; rebindable | `mod+k` "go to anything" (every box, page and action), `mod+b` folds the pill, `/` writes, `?` lists the keys, Escape closes what is open, arrows move in the pill and the palette | **a short fixed list; not rebindable; no `mod+n`, no `mod+j`** |
| command palette | threads, projects, actions, themes, sub-pages | `Palette`: sessions, pages, actions (fold, theme, idle, new session, keys); a combobox over a listbox for a screen reader | same idea; **flat: no sub-pages, no recent list** |
| terminal | a drawer and a tab, a real terminal (xterm) | `TerminalView` draws a `Screen` the service worked out and sends keys back; shown with made-up screens (Settings, Parts) | **the part is built, not wired**: the service's terminals are another stream's work (section 12) |
| phone | sidebar and right panel become sheets; composer stays at the bottom; touch targets grow | the pill and the panel are sheets; a box opens to the whole canvas; composer at the bottom; every control 44px | same |
| virtualised list | long threads stay fast: only rows in sight exist | every turn is in the page, but a turn far off screen is not laid out or painted (`content-visibility: auto`, its last height remembered) | **not virtualised, skipped**: measured below |
| other browsers | Chrome, Safari, Firefox | Chrome (headless, every screen at three widths, dark and light, console empty) | **Safari and Firefox not seen** (neither could be driven on the build machine without installing something) |

Long threads, measured (2026-11-11, headless Chrome, release build, 1440×900, made-up
turns each with a heading-less answer, a code block and a list; Settings → Parts): laying
out the thread again after its width changed took 0.29 ms for 500 turns and 1.33 ms for 2000
with far turns skipped, against 3.9 ms and 18.1 ms with every turn laid out. Putting 2000
turns on the page took 184 ms. An engine keeps its last 25 exchanges, so its own thread is
never that long; a session with another agent can be.

Not on par with T3 Code, in one list (2026-11-11, after the work above):

- An answer arrives whole: nothing streams word by word.
- Code is coloured by one small reader for six languages, not by a grammar; no math, no
  Mermaid, no pictures in an answer.
- The model choice names one engine's own model and the permission mode is chosen per engine
  (2026-11-12); no effort picker; dictation only where the browser has speech.
- A waiting message cannot be steered into the run in hand, and the queue is lost on reload.
- A harness's own permission prompts are not seen; only an engine's questions are answered
  in place.
- No changed-files card, no diff, files, browser or terminal tab in the right panel, and the
  panel cannot be resized.
- One conversation per engine; no timers, snooze or sections by state in the list.
- No find in a thread, no minimap.
- A short fixed list of keys, not rebindable; the palette is flat.
- The terminal box is drawn and typed into with made-up screens only: it is not wired to
  the service.
- Long threads are skipped off screen, not virtualised.
- Safari and Firefox were not looked at.

Density taken from it: the 46rem lane, the 80% bubble, small text and 28px rows for work,
11–12px mono for programs and results with a capped height (`min(18rem, 50dvh)`),. Motion: T3 Code uses plain 150–200ms eases and no springs; askk follows
the skill (section 9) instead.

## 11. The terminal, laid out like herdr

herdr (<https://github.com/herdrdev/herdr>, <https://herdr.dev>; Rust, one binary) is "the
runtime your coding agents live on": a terminal application that runs agents in panes,
with a background server a thin client attaches to and detaches from, and a mark beside
each agent saying whether it is working, blocked, done or idle. Its source was read on
2026-11-11 (`src/client/shell/`, `src/ui/sidebar/`); it was not run. (`docs/sessions/009`
compares it with two others for a different question.)

How its screen is laid out: a sidebar of workspaces and agents under dim bold lowercase
headings (` spaces`, ` agents`) with a `─` rule between sections; each row is a state mark,
one space, the name, then dim fields joined by ` · `; a bar of key hints where the key is
bold in the accent colour and its meaning is dim, two spaces between pairs. Marks: working
`◐` yellow, blocked `×` red, done `✓` teal, idle `○` green, unknown `·` dim. It has a
16-colour theme beside its truecolor one.

askk's terminal is lines, not a full screen, so it borrows the *grammar*, not the panes
(`src/ui/terminal/layout.rs`, every function a test can read):

| herdr | askk terminal |
| --- | --- |
| a row: mark, name, dim fields joined by ` · ` | the head: ` askk  ○ askk/coder · ready · 6 engines`; a run: ` ✓ Worked for 41ms · 2 steps · 1 call` |
| state marks and their colours | `○` ready (green), `◐` working (yellow), `✓` done (teal), `×` failed (red), `!` ended early (yellow) |
| dim lowercase headings, `─` rules | ` run`, ` answer`, a rule before the answer and before the commands |
| a row and its continuation lines, indented | a stage: name, what it did, its time; under it the note the model wrote first (`summary: …`); under `act` each call: `→ run_code(…)` and its result |
| key hints: key bright, meaning dim, two spaces | ` /engines list  /use <path> choose  /history read  /steps last run  /can build  /quit leave` |
| 16-colour theme | the only palette: bold, dim, blue, green, cyan, yellow, red |
| attach to a background server | `askk terminal --to <address>` (it does not detach: it is lines) |
| live state | while a run goes, one line written over itself says the step and stage |

Colour is used only when the lines go to a terminal a person is looking at. Sent to a pipe
or a file, with `NO_COLOR` set, or with `TERM=dumb`, the same lines are written plain: a
test checks that the coloured text with its colour removed *is* the plain text.

Not on par with herdr, said plainly: no panes, no tabs, no sidebar, no keys beyond typed
commands, no mouse; one engine at a time; a run's stages are listed when it ends (while
it goes there is one live line).

## 12. A terminal box on a page

The service holds a terminal and works its screen out (`core/screen.rs`); a page only draws
that object. `TerminalView` is the part that does:

| | |
| --- | --- |
| it is given | a `Screen` (rows of spans, cursor, title, alive, exit) and a label |
| it draws | one row per screen row in the data face; each span in its colours; the cell under the cursor on its own (a frame, and a blinking block once the terminal has the focus); bold, dim, slanted, underlined, ink and ground changed over; a line under it with the title, or how the program ended (`■ ended with code 1`) |
| colours | `""` is the terminal's own. `"0"`..`"15"` are tokens (`--term-0` … `--term-15`, named from the palette, so they follow light and dark). `"16"`..`"255"` and `#rrggbb` are worked out (`features/terminal.rs`, `ink`) and drawn exactly as given |
| it sends up | `on_type(String)`: text as it is, Enter `\r`, Backspace `\x7f`, Tab `\t`, Escape `\x1b`, arrows `\x1b[A`…`D`, Home/End/Delete/PageUp/PageDown/F1–F12 as their sequences, Control+letter as its control byte, Alt+key as Escape then the key. Command+key is left to the window |
| the focus | a field under the screen holds it, so a phone raises its keyboard and an input method can compose; the screen is that field's label, so a touch focuses it. Shift+Tab leaves the terminal. While it has the focus the keys of section 10 are not heard: Control+K belongs to a shell |
| proved by | `features/terminal.rs` tests (colours, cells, the cursor cut on letters, a dead terminal, every key), and Settings → Parts: three made-up screens, with what is typed written out as bytes |

To wire it to a real terminal (a view does this; the part stays as it is):

```rust
// in views/open.rs, for a box whose id is `terminal:<id>`
let live = use_live(move || format!("terminals/{id}"));           // its key on the change feed
let screen = use_resource(move || { let _ = live(); crate::api::terminal_screen(id) });
rsx! { TerminalView { screen: screen().and_then(Result::ok).unwrap_or_default(), label: title,
    on_type: move |keys: String| { spawn(async move { let _ = crate::api::terminal_type(id, keys).await; }); } } }
```

Not there yet, said plainly: the part does not tell the service its size (`terminal_resize`
needs the cell's measured width), it does not scroll back (the `Screen` has no history), a
selection cannot be copied with a key, and wide letters (CJK, emoji) are trusted to be two
cells wide in the data face.

## Tokens (of a model)

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
The talk screen's side panel (Prompt) shows these sections live: one colour per kind, a token
bar, each section, and the full rendered text.

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
4. **Targets**: on a phone or any touched screen every control is at least 44px tall (`--hit`);
   with a pointer, controls are denser (`--hit-md`, `--hit-sm`, `--hit-row`).
5. **Motion**: the rules and their tokens are in section 9 (the press answers at once and
   sinks to .97; arrivals ride a spring that does not overshoot; "reduce motion" keeps the
   feedback and drops the travel; "reduce transparency" makes every surface solid).
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
`data/layout.json` (`order`, `sizes`). Routes: Home, Canvas, Talk, Sessions, Rooms, Settings (Models,
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
object. Parsed into `Reply.fields`; the talk screen shows each inside the run, under the stage that read the reply (`parse`); calls
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
