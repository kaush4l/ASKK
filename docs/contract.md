# Contract: engines, objects, views

The one agreement between backend (`core/`, `server/`) and frontend (`src/`). Both sides
build against this file; a change here changes both. See `docs/design.md` for the why.

## 1. Configuration: the engines folder

```
data/
  engines/<id>/engine.md          one folder = one engine (order: `order:` then id)
  engines/<id>/elements/<eid>.md  its elements (any number, any kind)
  engines/<id>/engines/<cid>/…    child engines, same shape, any depth
  state/<path>.json               live state, written by the app (never by hand)
  layout/<view>.json              placement the user saved (dashboard, canvas): order/positions + card sizes
  ui/<view>.json                  the page as a component tree (§6), seeded; hot-reloaded like engines
  ui/assets/<file>                images a page tree names (served at /ui/assets/<file>)
  theme.json                      design tokens (colors, radius, spacing, fonts)
```

`engine.md` / `<eid>.md`: YAML-subset frontmatter (`key: value`, lists `[a, b]`,
inline maps `{a: 1}`) + markdown body.

```md
---
title: Demo engine
kind: engine
order: 1
---
What this engine is for (shown in its medium and large views).
```

```md
---
title: Runs
kind: counter
config: { step: 1 }
---
```

**State in the configuration.** Any `engine.md` or element `.md` may carry `state:` (a map) and
`phase:` in its frontmatter: the object's state and phase when nothing is saved for it. Precedence,
highest first: (1) the live object in memory (a hot reload keeps it), (2) the saved
`state/<id>.json`, (3) the file's `state:` laid over the kind's fresh state key by key (keys it does
not name keep the kind's default) and its `phase:` (default `idle`), (4) the kind's fresh state.
`phase: running` is refused (no task stands behind it) and so is a `state:` that is not a map: the
file loads as a `failed` object. So a folder can describe a whole application's starting state —
a counter at 41, a memory with lessons, a loop with a history — and a run's saved state still wins.

```md
---
title: Runs
kind: counter
state: { value: 41 }
phase: waiting
---
```

**Boot contract:** `boot(store) -> Result<Vec<Engine>>`, never empty. An empty or missing
`engines/` gets the seed (`core/src/seed.rs`) written to disk, so the folder always describes what
runs: one top engine `askk` (title Askk, icon 🪄: model `echo`, loop, phases chat — no tools —, research and build,
workflows with `study: [research, build]`, memory, note `welcome`; no tools element). Boot is tolerant: a `.md` that does not load (an
unknown or missing kind, bad frontmatter, an `engine.md` of another kind) never stops the app — that
object starts `failed` with `state.error` naming the file, exactly as a hot reload makes it (§2), and the
rest boots. A folder holding only a broken `engine.md` boots that one failed engine (it is not seeded over).

## 2. Objects

Every engine and every element is an **object**: `{id, kind, title, phase, state, actions}`
plus its own views and its prompt text. `id` is the path: `askk`, `askk/runs`, `askk/child/x`.

- `phase`: `idle | running | waiting | stopped | interrupted | failed`.
  - `idle`: nothing in flight (also how a task that finished ends).
  - `running`: work in flight — a task (timer) or a lifecycle driven by hand (status, engine).
  - `waiting`: a task in flight that waits on something outside; ends like `running`.
  - `stopped`: halted on purpose — `stop`, `cancel`, or a clean shutdown.
  - `interrupted`: was `running` when the process died (kill -9, crash); nothing resumes by itself.
  - `failed`: a task ended in an error (`state.error`), or the object's `.md` could not be loaded
    (`state = {error}`, no actions, its views show the error; fixing the file recovers it).
- **Engine summary**: an engine's own `phase` is only its own lifecycle (`start`/`stop`). What happens
  below it is its `summary = {running, failed}`: the number of objects under it — its elements and child
  engines, at any depth, never the engine itself — whose phase is `running` or `waiting` (→ `running`) or
  `failed` (→ `failed`). Its `small`, `medium` and `large` views show each non-zero count as a badge
  (`"2 running"` busy, `"1 failed"` error) beside its own phase badge; its prompt says it too. The panel's
  engine tree shows the same counts from `summary`.
- `stop` on an engine cascades: every task below it is cancelled (→ `stopped`), and every object below it
  that is `running`/`waiting` turns `stopped`; idle, failed and other objects are untouched.
- `actions`: `[{name, label, args?: {field: "text" | "number" | "bool"}}]`.
- `views`: one Node tree per **card size**, smallest first: `icon` (the tiniest: light + short label — the
  collapsed rail, far canvas zoom, dense lists), `small` (overview: one line), `medium` (expanded: the working
  set), `large` (intense: everything). All four are always present, each **rooted in a `Card`** whose props carry
  `size` and the object's `status`. A kind that returns a non-Card tree for a size gets it wrapped in its Card (a
  leading Text equal to the title is dropped: the Card says it). A smaller size is the object's own reduced view,
  never the larger one with parts hidden. A full-screen size may follow `large` later (order icon < small <
  medium < large < full).
- `status`: `{light: tone, now: text, since: unix seconds}` — the live status, computed by the backend from state:
  `light` is the phase tone (an engine with work below lights `busy`), `now` one line of what it does now (loop
  `step 3 · calling model` / `step 2 · running tools` / `answered in 2 step(s)`; timer `12/30 s`; model `last call
  1.2 s` / `testing · one short call` / `never called`; counter `value 41`; meter `3 of 10`; note `N word(s)`;
  phases `phase: work`; tools `N tool(s)` / `No tools`; memory `N lesson(s)`; engine `2 running · 1 failed`; else
  the phase word), `since` when it entered its phase (running ↔ waiting is one stretch; saved with the state,
  `state/<id>.json` = `{phase, state, since}`). The UI shows `since` as "since 10:42" (local time) when not busy.
- `activity`: what the object did, newest first, at most 20: `[{at, action, by: owner | task | loop | workflow, text,
  ok}]` — the owner's actions, a task's start and end (never a timer tick), each loop step (model reply, tool call,
  refocus, phase switch, answer), a model's calls, workflow phases, phase switches, memory lessons, asks. Saved in
  `state/<id>.json` beside `state` (key `activity`), carried across reloads.
- `status.focus`: one line of what it is focused on (loop `working on: <input>` / its last answer; note its first
  line; phases the current phase and its instructions; workflows the running workflow and phase; model connector · id;
  memory the newest lesson; engine its phase · its loop's focus); `status.chip`: the phase label (engine, loop,
  phases) or the running workflow, else null.
- `large` carries `scene` on its root Card (`conversation` loop, `meters` model, `gallery` phases, `pipeline`
  workflows, `reader` note, `spatial` engine, else `default`): how the immersive view lays it out.
- `prompt`: the text a model reads, from the same state as the views.

## 3. Wire format

```
GET  /world   → {engines: [EngineTwin], theme, layouts: {dashboard, canvas}, kinds: [KindInfo], ui: {dashboard, canvas}}
GET  /events  → SSE: event "twin" {id, twin} (an object changed) | event "world" (full world)
POST /act     {target: id, action, args} → {twin}; 400 {error} on refusal
POST /layout  {view: "dashboard" | "canvas", layout} → saved to data/layout/<view>.json
POST /theme   {tokens} → saved to data/theme.json
POST /ui      {view, tree} → checked (a Node at every level), saved to data/ui/<view>.json, broadcasts `world`
POST /ui/asset {name, data: base64 | data: URL} → data/ui/assets/<name> (an image name, ≤ 12 MB) → {url}
GET  /ui/assets/<file>
```

```ts
EngineTwin  = Twin & { elements: Twin[], children: EngineTwin[], summary: {running, failed} }
Twin        = { id, kind, title, phase, state, config, actions, views: {icon, small, medium, large}, status, activity: Activity[], prompt }
Status      = { light: tone, now: string, since: number, focus: string, chip: string | null }
Activity    = { at: number, action: string, by: string, text: string, ok: bool }
Node        = { c: Primitive, props?: object, children?: Node[] }
KindInfo    = { kind, about, config: {field: "text" | "number" | "bool"} }
```

**Asks and replies.** The `help.ask {question}` tool (§4) puts an ask on the engine one level up:
the asking engine's parent, or — from a top engine — on that engine itself, addressed to the owner.
An engine keeps them in `state.asks = [{id: "a1", from, to: <engine id> | "owner", question, status:
open | answered, reply?, at, replied_at?}]`; its `medium`/`large` views show each open ask with a reply
`Field` (action `reply`, `args: {ask}`), its prompt counts them. The owner answers at any level with
the engine action `reply {ask?, text}` (`ask` absent: the oldest open one): the ask turns `answered`
and the reply is appended to the asking engine's loop as a message `{role: "reply", ask, by: "owner",
text}`, so its next step reads it. A run that asked does not wait for the reply.

Structure actions every engine offers (the create / modify tools), each writing the `.md`
files so the folder stays the truth, then broadcasting `world`:
`element.add {kind, title, config}`, `element.remove {id}`,
`element.edit {id, title?, config?}`, `engine.add {title}` (a child engine),
`engine.edit {title?, body?}` (this engine's `engine.md`: title and/or body; other frontmatter kept),
`engine.remove {id}` (a child engine of this one, full or short id; or the engine's own id to remove itself —
refused for the last top engine). A removed engine's folder and its state files (`state/<id>.json`,
`state/<id>/`) are deleted; tasks under it end. When the target removed itself `/act` answers `{twin: null}`.

## 4. Element kinds (core, built in)

| kind | state | actions | about |
| --- | --- | --- | --- |
| note | `{text}` | `edit {text}` | markdown text |
| counter | `{value}` | `inc`, `dec`, `reset` | a number; config `step` |
| status | `{}` (uses phase) | `start`, `stop` | a lifecycle you drive by hand |
| meter | `{value}` | `set {value}` | a bounded value; config `max` |
| timer | `{elapsed, seconds}` | `start` (idle) / `cancel` (running) | counts to its seconds in a background task, one tick a second; config `seconds` (default 10) |
| model | `{calls, last: {ok, ms, prompt_chars, reply_chars \| error, at}, test?}` | `test` (a task: one short call) / `cancel` | config `connector` (claude-cli \| openai \| anthropic \| echo), `id`, `base_url?`, `key_env?` (the NAME of the env var holding the key; the key is read at call time and is never in state, twins, prompts or logs), `context` (the budget in **characters**, default 120000); views: connector, id, budget, whether the key is set, last call |
| loop | `{messages, step, input, context_used, context_budget, last_answer, last_sent, stop_reason?, refocus?: {count, last: {before, after, folded, kept, lessons, mode, at}}}` | `run {input}` (a task) / `cancel`, `clear` | the engine's run (design.md §7); config `max_steps` (8), `refocus` (0.9), `keep` (2); `large` shows the history and the exact next prompt |
| phases | `{current}` | `next`, `set {phase}` | config `list: [{id, title?, icon?, tools?: [names], instructions?: text}]` (a bare name is `{id}`); the current phase is the mode: its tools and instructions (below) |
| workflows | `{running, last}` | `run {workflow, input}` (a task) / `cancel` | config `list: [{id, title?, icon?, phases: [ids]}]`: runs the loop once per phase in order, each answer the next input, then back to the prior phase |
| tools | `{}` | — | config `list: [names]` from the core registry: `note.write {text, note?, append?}`, `clock.now {}`, `clock.wait {ms ≤ 5000}`, `help.ask {question}`, `files.read {path}` (only `data/workspace/<engine id>/`, ≤ 20000 chars). No tools element and no phase `tools`, or an empty list: every view says "No tools" and the loop offers none |
| memory | `{lessons: [text]}` | `clear` | lessons kept beyond a run; refocus writes them (deduplicated, newest 50); the loop's prompt carries them |

`KindInfo.config` field types: `text`, `number`, `bool`, and `list` (a list, or its comma-separated
text from a form, stored as a list).

Message roles in `loop.state.messages`: `input`, `model` (the raw reply), `tool {tool, args, ok, text}`,
`format` (a reply that did not parse, or calls with no tools offered), `reply {ask, by}`, `refocus` (the
essentials that replaced older history), `phase {phase, by: owner | workflow}` (a phase switch).

**Phases, modes, workflows.** A **phase** is the unit: `{id, title?, icon?, tools?: [names], instructions?}` in
the phases element's `list` (an older `exit:` text is still read and shown). The phase the owner selects
(`set {phase}`) and stays in is the engine's **mode**: it changes only the tools offered and the instructions —
the model, the loop's history and memory carry over; the switch is a `phase` message in the loop's history. Its
instructions are rendered under the prompt's `# PHASE <id>` section. Tools: with a tools element the phase narrows
its list (`offered = tools.list ∩ phase.tools`, as before); with no tools element the phase's own `tools` are
offered (registry tools only), so phases alone can be an engine's modes; a phase without `tools` offers the whole
list. A **workflow** is a separate thing: the `workflows` element's `list: [{id, title?, icon?, phases: [ids]}]`, an
ordered sequence of phases that must run in that order. `run {workflow, input}` (the owner's workflow.run; a task)
selects each phase in turn, runs the loop on the input, and hands that answer on as the next phase's input (every
step in the loop's history); its status is `workflow research→build · 1/2`; `cancel` stops the sequence and the
loop step in flight; when it ends — done, failed or cancelled — the engine returns to the phase that was selected
before it started. `state.last = {workflow, end, answer?, steps: [{phase, answer}]}`. A workflow naming a phase the
engine does not have fails before anything runs. Views: the phases card shows a chip per phase (the current one an
accent badge, the others `set` buttons) and the current phase's instructions; the engine's capability row says
`phase: 💬 Chat` and its status `now` starts with it.

## 5. Primitives (the only HTML; `src/lib/primitives/`)

| c | props | children |
| --- | --- | --- |
| Stack | `dir: row\|col, gap: 0-6, pad: 0-6, align: start\|center\|end\|between, wrap` | yes |
| Grid | `min` (width step xs…page, auto-fill), `gap: 0-6` | yes |
| Card | `title, tone, phase, size?, status?` (a view's root card: `size` and `status` set by the backend) | yes |
| Text | `value, size: xs\|sm\|md\|lg\|xl, tone, mono, md` (md: render markdown; a one-line value renders as inline markdown on one line — rows use this, never raw `**`) | no |
| Badge | `label, tone` | no |
| Meter | `label, value, max, tone` | no |
| Button | `label, action, target?, args?, tone` (target defaults to the owning object) | no |
| Field | `label, name, value, action, target?, args?, kind: text\|number` (submits `{...args, [name]: value}`) | no |
| Table | `columns, rows` | no |
| Code | `value` | no |
| Divider | — | no |
| Avatar | `icon` (one emoji, or `/ui/assets/<image>`), `label` (initials fallback), `phase`, `tone`, `running?`, `asks?`, `failed?` — every object's **icon view is its Avatar alone**; the bigger sizes carry `icon` on their root Card (shown in the header). An object's `icon:` in its .md (validated: one emoji / an asset) overrides its kind's default (model 🧠, loop 🔁, phases 🪜, tools 🧰, memory 📚, note 📝, counter 🔢, timer ⏱️, meter 📊, status 🚦; engine 🧭); twins carry `icon`. Engine live state → ring/badge (`src/lib/logic/avatar.js`): running = pulsing violet ring, asking/waiting = 💬, failed below = ⚠️, stopped/offline = dim, idle online = a green dot. Edit mode: **Icon** (picker + input) writes `icon:` via `element.edit {id, icon}` / `engine.edit {icon}` (`""` = the default again). | no |
| Slot | `of: id, at: size` (embeds another object's own card at that size; the owner can step it) | no |
| Widgets | — (the widget grid: its Slots take their size's footprint, §6) | yes |

Page primitives (§6, only in `data/ui/*.json`):

| c | props | children |
| --- | --- | --- |
| Page | `default?: engine id` (the engine the page centres on and the Composer talks to; the first top engine when absent or gone), `background: {image?, fields: [{at: [x 0-8, y 0-8], size: sm\|md\|lg\|xl, color: token, hard}], wash, ripples, tint?: token, blur: 0-6, dim: 0-6, fit?}` | yes |
| Background | the same fields as `Page.background` (a page may also place one itself) | no |
| Panel | — (the shell's left panel) | no |
| CardGrid | `source: "engines", size: "auto" \| size, min, max (width steps), gap: 0-6, children?` | no |
| Canvas | `source: "engines", zoom: {icon, small, medium}` (zoom thresholds), `grid: bool, minimap: bool, edges: curve\|straight\|step\|none, children?` | no |
| Composer | `target?: engine id` (default: the page's `default`), `phases: bool` (show the phase picker and the Run workflow menu), `placeholder?` | no |

**Scale steps only.** Every style prop in a view or page tree is a step of `design/tokens.json` (docs/design-rules.md
§6, §10): never px, %, hex, rgb, font names or durations. `POST /ui` refuses a raw value (400, naming the path).

`tone`: `neutral | ok | warn | error | busy | accent`, mapped to theme tokens, never raw colors.
Phase → tone: idle neutral, running busy, waiting accent, stopped neutral, interrupted warn,
failed error. An unknown `c` renders a visible "unknown primitive" box, never crashes.
How each primitive looks (material, sizes, tones): `docs/design-rules.md` §6.

## 6. Views (frontend rules only; what to show comes from objects)

- **One view, rendered once.** An object's own view is authoritative: the frontend never
  re-lists what a view already contains (no element list under an engine card). Everything a
  person does to an embedded object attaches to the object where its view shows it: a `Slot`
  renders its target as an interactive item.
- **Pages are trees.** Each route is rendered only from its page tree `world.ui[view]` (`/` → `dashboard`,
  `/canvas` → `canvas`; a missing or broken tree → the default the backend seeds). An unknown primitive renders
  the visible unknown box.
- **Card sizes** (rules in `docs/design-rules.md` §7): a card's size comes from the space it gets (its own measured
  width: < 120 px icon, < 280 small, < 560 medium, else large), the device (phones ≤ 768 px take large as medium),
  the canvas zoom, or a fixed base (a Slot's `at`, a CardGrid's `size`). Every card has a step control (smaller /
  larger); the owner's step is remembered per object in the view's layout (`layouts.<view>.sizes = {id: size}`; a
  step back to the automatic size forgets it). Same cards on phones and wide screens. A card title opens the
  `large` view in a side sheet (a bottom sheet on phones).
- **Cascade** (presentation defaults, containers → children): a container — a page-tree node (`CardGrid`,
  `Canvas`), an engine (`children:` in engine.md, carried as `children_defaults` in its twin, validated like a tree),
  or a Slot's engine — may declare `children: {size?, kinds?: {<kind>: {size}}}`. A card's size: the owner's stepped
  choice > the nearest container's per-kind default > its default > the containers further up > the page tree's
  fixed size > auto (space / zoom). An engine's own views honour its defaults in their Slots. Edit mode: an engine's
  **Children** control writes engine.md through `engine.children {size | auto, kinds?}`. Resolver:
  `src/lib/logic/sizes.js` `cascadeSize` / `resolveSize` (tested). (The seed sets none.)
- **Slot items**: a Slot renders its target as an interactive card at `at` (default small) — edit tools inline.
  The same item is used wherever Slots appear (dashboard, sheet, canvas nodes).
- **Dashboard** (`/`): the CardGrid of the page tree — every top engine as a card, in saved order, in a grid of
  columns at least `min` (360) px wide that fills the width (max `max` 1600 px, centred; 16 px gutter, 24 px from
  768 px). A lone engine takes one column up to 960 px. Cards align to the top.
- **Default engine**: the dashboard features the page's `default` engine — centred, up to 960 px, its own size
  (large) — and every other top engine as a smaller card (base `small`) in a grid below it (`layout.js`
  `featuredSplit`). With one engine it is the lone card.
- **Composer** (the footer text area, `src/lib/logic/composer.js`): a glass bar fixed at the bottom of the content
  (beside the panel, never under it; above the safe-area inset; the mobile drawer overlays it), max 640 px, centred.
  Phase chips (icon + title; the selected one — the mode — pressed) → `set {phase}` on the phases element; a Run
  workflow menu (each workflow with its phases in order) → `run {workflow, input: the text}` on the workflows element;
  a multi-line text area (16 px, grows with its lines up to 12 lines; Enter sends, Shift+Enter a newline, Escape
  leaves) → `run {input}` on the loop; while the loop or a workflow runs, Stop (`cancel`, the workflow first) and the
  status line (`workflow research→build · 1/2 · step 1 · running tools`) with a pulsing light; otherwise
  `<phase> · <loop status>`. The target's open asks are reply chips above it: a chosen chip turns Send into Reply
  (`reply {ask, text}` on the engine). On the dashboard it keeps an in-flow spacer of its own height so the last card
  scrolls clear; on the canvas it publishes `--composer` and the toolbar and minimap sit above it.
- **Sizes as places** (design-rules §7, docs/glass.md): icon and small live in the widget grid; medium expands the
  card into the content area (Escape returns); large is the immersive full-screen scene at `/focus?id=<id>`. The size
  control cycles icon → small → medium → large.
- **Widget grid** (`Widgets`, `src/lib/logic/widgets.js`): card sizes are footprints of square cells, like
  home-screen widgets — icon 2×2, small 4×3; medium and large open out of the grid and keep the small footprint (tokens `span`, `widget.cell`
  88 px, `widget.gap` 12 px). Columns: as many cells as fit, never fewer than 4; on a phone (or a container narrower
  than 4 cells) exactly 4 columns across the full width, cells still square. `grid-auto-flow: dense` packs mixed
  sizes without holes. A card never grows with its content: the header (avatar, title, status) stays, the body
  scrolls (thin scrollbar, faded edges; a wheel over it never pans or zooms the canvas). The icon is an app tile:
  the avatar (`widget.avatar`) and the title below, never scrolling. An engine's own views lay their elements in
  it (medium: Slots at small, large: Slots at medium; the cascade and the owner's steps still pick each size), and
  so do canvas frames, scaled by the camera. The engine on the dashboard is the container, not a widget.
- **Rows** (a `Stack dir:row` without `wrap`): one line. The first `Text` is the title: never
  broken mid-word, truncated with an ellipsis (full text in its `title` attribute), at most 60 %
  of the row; later `Text` values flex and truncate; badges and other items keep their size.
  Text elsewhere wraps at word boundaries, at most 72ch per line.
- **Canvas** (`/canvas`, design-rules §11): every engine a glass frame (compact tidy-tree auto-layout: top-level
  engines side by side, children below their parent, siblings side by side, subtrees packed by contour, measured
  frame sizes, re-laid out when they change; drag to place — a saved position wins),
  edges parent → child and for each help.ask route (open asks highlighted), grid backdrop, minimap; pan (inertia),
  wheel/pinch zoom, − + Fit; positions saved via `/layout`; the zoom picks each card's size (the Canvas node's `zoom` thresholds: below 0.35 icon, 0.6 small, 1.25 medium, else
  large); a stepped card is remembered in `layouts.canvas.sizes`. **Legibility caps the cascade**: whatever the cascade
  or the owner's step picks, no text renders under 10 px on screen — a size whose smallest text would be smaller
  steps down (cards → icon; an icon frame → the far frame: its avatar and a large title, the title hidden while
  still illegible). Fit picks the largest size whose layout fits legibly (rows of top-level engines wrap on a tall
  viewport) and fits again once the frames are measured. Resolver: `sizes.js` `resolveSize({cap})`, `canvas.js`
  `canvasSize`, `fitView`.
- **Edit mode** (both views): Unlock → affordances appear inline on each object, and only
  those its actions offer: an element shows Edit / Remove (its engine's `element.edit` /
  `element.remove`); an engine (top card bar, or a child engine's Slot item) shows + Element,
  + Engine, and Rename when it offers `engine.edit` / `engine.rename`. Forms are built from
  `KindInfo.config`. Engines reorder by dragging the handle (pointer; touch too), or with
  arrow keys on the handle / the ← → buttons; the order is saved via `/layout`. Theme tokens
  are edited with live preview and saved via `/theme`. Lock → normal use.
- **Shell**: one collapsible left panel (views, the engine tree from the world, edit/theme/appearance
  controls, connection status); collapsed = icon rail, remembered; ≤ 768 px an overlay drawer that closes on
  navigation and Escape. No top bar.
- **Look**: `docs/design-rules.md` — glass material for what floats, Amarante (one weight), mono for data,
  4/8 px spacing, borders (not grey fills), tones only from theme tokens and only for phase/attention,
  hierarchy by size not weight, dark mode OLED black; a phase change never moves or resizes anything.
  Phones first: no horizontal scroll at 375 px, touch targets ≥ 40 px, inputs 16 px.
- Live: one `/events` stream; a `twin` event replaces that object in place. Events missed while the stream was down are not replayed: after a reconnect the UI re-reads `/world`.

## Backend notes

Agreed with the frontend (2026-11-07); the backend implements exactly this.

1. **Theme**: `GET /world` → `theme`, and `POST /theme {tokens}`, are
   `{radius, blur, face, font, mono, glass-alpha, card-alpha, light: {bg, surface, fg, muted, border, neutral, ok, warn, error,
   busy, accent, tint, edge, wall-a, wall-b, wall-c, press, press-ink}, dark: {same keys}}` (design-rules §1; `radius` and
   `blur` with units, e.g. `"10px"`; a bare number still means px). Missing `data/theme.json` is seeded at boot with defaults (dark: OLED black `bg`/`surface` `#000000`, borders for
   separation, not grey fills). POST stores the tokens whole and broadcasts `world`.
2. **Layouts**: `layouts.dashboard = {order: [engine ids], sizes?: {id: size}}`, `layouts.canvas = {positions: {id: {x, y}}, sizes?}`;
   `POST /layout {view, layout}` stores exactly that (no world broadcast). Unsaved: `{order: []}` / `{positions: {}}`.
3. **Twin.config**: every Twin (engines too) carries `config`, the object's current config map from its `.md`, `{}` when none.
4. **SSE `world`**: its data is the full `/world` payload. `twin` events are `{id, twin}`; an action on an element sends
   the element's twin and then each engine above it (their prompts include the element). An engine's `twin` (in
   `/act` and in events) is its whole EngineTwin.
5. Structure-action args: `config` may be a map or its text (`{step: 2}` or JSON); only the kind's `KindInfo.config`
   fields, with their types, are accepted. `element.remove`/`element.edit` take a full id (`askk/runs`) or the short
   one (`runs`). File names are slugs of the title (`runs-today.md`, then `runs-today-2.md`). `element.edit` merges the
   given config keys; an element's state survives an edit; a removed element's state file is deleted.
6. Engines also have `start` / `stop` (phase). A clean stop turns every `running` object `stopped`; a crash brings it back
   `interrupted`. State files are `data/state/<id>.json` = `{phase, state}`.
7. **Long-running actions (tasks)**: an action may start a task (today: timer `start`). `/act` answers at once with
   the object `running`; the task then sends a `twin` event (the object, then the engines above it) for every change
   it persists, and ends `idle` (done), `failed` (`state.error`) or `stopped` (`cancel`, shutdown). `cancel` on an
   object with a task stops it and answers with its `stopped` twin; on one without a task it is refused (400). A second
   `start` while one runs is refused. Tasks of different objects run in parallel; changes to one object are applied
   one at a time, in order. A shutdown cancels every task and writes it `stopped` before runtime.json says `clean`; a
   kill -9 leaves the last persisted tick, and the object comes back `interrupted`. While stopping, every call is 503.
8. **Hot reload**: the server watches `data/engines/**` (debounced 300 ms) and re-scans it every 2 s. A change
   re-reads every `.md`: an object whose id and kind are unchanged keeps its live phase and state (an edited config
   applies to it, a running task reads it on its next tick); a new id is restored from `data/state/` or starts fresh;
   a removed object leaves the world (its task ends); its state file is deleted after a grace period
   (10 s; `Hub::set_removed_grace`) unless its `.md` came back meanwhile, in which case its state is restored; a changed kind gets the new kind's
   state. A `.md` that does not load becomes a `failed` object (above) and the rest of the world loads as usual; its
   last good state stays on disk and comes back when the file is fixed. When anything changed, one `world` event
   goes out; an unchanged folder (including the server's own structure writes) sends nothing. Boot is tolerant the same
   way (§1).
9. **Page trees**: `data/ui/dashboard.json` and `data/ui/canvas.json` are seeded at boot when missing (the desk's
   background: four hard-edged fields in `wall-a..d`, wash, ripples; `default: "askk"`; Page → Panel, CardGrid |
   Canvas, Composer `{phases: true, placeholder}`). `GET /world` carries them as `ui`; a file
   that is not a Node tree is served as the default. The server watches `data/ui/` like `data/engines/` (debounced,
   plus the 2 s re-scan); a changed tree sends one `world` event.
