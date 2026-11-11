# Architecture: principles, flow, rigid and open places

This is the map from what askk is meant to be to where the code makes it so. Read it before a
redesign: every decision below says what it costs to change and what it protects.

`components.md` is the agreement per component. This file is the shape of the whole.

## 1. Principles (yours, as the code must hold them)

| # | principle | source |
| --- | --- | --- |
| P1 | A component is behaviour + config + state + UI. Nothing else changes its state but `on(Event)`. | components.md §1 |
| P2 | Core never hard-codes a kind or a tool. Every element is optional; any combination must boot, prompt and render. | lifecycle notes, init |
| P3 | Config is knobs a person writes. State is just enough to rebuild from a backup. | lifecycle notes |
| P4 | Engines create engines (and components, views, scripts) through tools that follow the same rules a person does: they write Specs. | lifecycle notes |
| P5 | Boot is seed → scan → init. seed becomes templates; scan becomes a database later. | lifecycle notes |
| P6 | Objects draw themselves (small / medium / large); the UI only has primitives. | objects, sizes v2 |
| P7 | Phases are the focus; a workflow is phases in order; refocus is a special phase. | setups |
| P8 | Objects mark themselves changed; the UI picks changes up at its own rate. | runtime notes |
| P9 | Same engine + same input = same prompt (stable first, volatile last). | prompt order |

## 2. Flow to code

```text
process start (main.rs)
  └─ host::world::boot_now ─ host::world::world() once                       (src/host/world.rs)
       ├─ open     store::data()             ASKK_DATA: a folder, or one bundle file (*.json); wrapped
       │                                     in Marked (every write marks its key)
       ├─ lock     store::lock               askk.pid: one live process per store
       ├─ seed     core/boot.rs  seed()      defaults store (folder or bundle) → data store (missing
       │                                     top-level keys only)
       ├─ load     core/boot.rs  load()      askk.json (Manifest) → scan what it names →
       │                                     Snapshot {manifest, engines: Tree[]}   ← the standard form
       ├─ fix      manifest::set             every module reads its keys from the manifest
       ├─ jobs     host::workspace::recover_jobs    jobs from before the restart → `lost`
       ├─ tools    tools::shared()           the shared-tool registry (src/host/tools.rs, market.rs)
       ├─ init     core/boot.rs  init()      Tree → Engine, built only from the snapshot's state;
       │                                     core::build(Spec) per element via KINDS; one element per
       │                                     unique kind; save hook = boot::save; key = Tree.dir
       ├─ watch    host::world::watch_all          one poller per element.watch() → Engine::observe → wake
       └─ board    core/board.rs             message boxes at manifest.board; post → wake → Engine::wake;
                                             receivers = engines whose element `receives()`

source (core/store.rs)
  standard form = keys → text. Folder | Bundle (one JSON file) today; a DB or SQL dump = one
  more Store impl. export() / export_world = the whole world as one bundle (backup, template pack).

storage (core/store.rs)
  every askk state read/write = Store::{get, put, list, has, rename, remove} on a key
  host::store::Folder(data/) today; a database later is one new impl. Not state: workspace files (their own port, core/files.rs).

one run  (core/engine.rs Engine::run)
  Input ─► dispatch(Event::Input)
  loop step < max_steps:
     stop?                                    Engine::stop flag
     toolbox()      shared ∩ selects() + element tools() + sub-engines, minus allows() vetoes
     refresh()      live elements re-read → Event::Snapshot
     sections()     element prompt() + toolbox, ordered by Slot (core::order) → input → nudges
     budget ≥ 90%?  refocus: REFOCUS_SLOTS only, phase's refocus() instruction → Event::Folded
     infer.complete(model, prompt, sampling())          infer/ (openai | cli)
     Event::Reply → parse() (first element that reads replies; none = plain answer)
     calls run together (await any | all) → Toolbox log → Event::Called (nested calls too)
     persist()      bump() → changes::mark(engine key) → save hook (store writes mark their keys)
     answer or no calls → idle

change marks (core/changes.rs)  P8
  mark(key): seq += 1, keys[key] = seq, wake waiters. Sources: Marked store writes; Engine::bump
  (live activity, sub-engines, steps). No object is ever polled.

UI (ui/views/*, ui::render::Render)
  shell: use_live_provider — ONE listener per tab: api::changes(epoch, seen) parks on the server
         until something is marked → changed keys → one Signal<key → seq>
  view:  use_live(prefix) = memo over that map (prefix by segment); a resource that reads it
         re-runs only when a key it shows changed (engine page: engines/<path>; shell: ui, routes,
         theme; dashboard/canvas/topbar: engines)
  server fns in api/ → Engine::render(size) / Component::render(size) → Node tree → Render
```

## 3. Where it is rigid (on purpose)

Rigid = changing it ripples everywhere, so it is fixed in one place and guarded by a test.

| rigid thing | where | guarded by | why rigid |
| --- | --- | --- | --- |
| The contract (`Component`) | `core/mod.rs` | `every_kind_obeys_the_contract` | every kind, view and boot step relies on it |
| Required identity: `kind, name, doc, category, icon` | trait methods without defaults | the compiler + contract test (icon must be in `ICONS`) | a new kind cannot forget how it shows up |
| Prompt order = `Slot` order | `core::Slot`, `core::order` | `prompt_order_is_fixed_by_slot_then_name_with_input_last` | P9; prompt caching; elements choose a slot, never a position |
| Refocus keeps `REFOCUS_SLOTS` | `core/mod.rs` | refocus test | the summary sees purpose, knowledge, position, conversation only |
| Core names no kind | `core/*` | `core_never_names_an_element_kind` | P2: adding a kind = one file in `elements/` + one line in `KINDS` |
| Tool calls need a reply reader | `Engine::parse` | `defaults_boot_and_every_selected_tool_exists` | no hidden format fallback; no reader = the reply is the answer |
| Spec file shape `{kind, name, config, state}` | `core::Spec` | boot round-trip test | it is the backup format (P3) and the future DB row |
| Primitives and built-in views | `core::node::PRIMITIVES`, `VIEWS` | `validate_node` | created components stay drawable (P6) |
| One writer per engine step | `Engine::run` + `persist` | — | state on disk is always a whole step |
| State reaches disk only through `Store` | `core/store.rs` | `only_the_store_touches_the_data_folder` | backup = every key; SQLite = one new impl (P3, P5) |
| Tests never touch real data | `store::data()` is a temp folder under `cfg(test)` | — | a test cannot corrupt your desk |
| One process per data folder | `store::lock` at boot | `one_live_process_holds_the_store` | one writer per engine across processes |
| Boot builds only from a snapshot | `boot::load` → `Snapshot` → `init` | `any_source_in_the_standard_form_loads_the_same_world` | the source is a detail (folder, bundle, DB); no object starts from values written in code |
| Keys live in one manifest | `core::manifest` (`askk.json`) | `the_shipped_manifest_names_every_part` | moving or renaming a part = one line of data, not a code search |
| Changes are marked, not polled | `core::changes`, `store::Marked`, `Engine::bump` | `wait_returns_on_a_mark_not_on_a_timer`, `a_marked_store_marks_what_it_writes` | P8; idle app does no work; one connection per tab |
| A figure is a checked value | `core/figure.rs` `Figure::validate` | `a_figure_that_breaks_the_structure_is_refused_with_the_reason` | an engine never sends drawing code; a wrong figure comes back as a reason it can act on |
| Every stage entered is recorded | `Engine::at` → `core/run.rs` | `store_scan_initialises_engines_and_state_survives_restart` | the loop cards show what ran, not what was meant to run |
| Singleton roles | `Component::unique` (handoff, phase, sampling, inbox, whiteboard, attachments) | `a_second_singleton_element_is_refused` | no silent "first wins" |

## 4. Where it is open (extend without touching core)

| to add | do | touches core? |
| --- | --- | --- |
| an element kind | `elements/<kind>.rs` + one `KINDS` line; pick `category`, `icon`, `slot`; optional roles | no |
| a role an element plays on the card or chat | implement `abilities` / `log` / `summary` / `transcript` | no |
| a new engine shape | a folder under `data/templates/<name>`; `create_engine {template}` | no |
| an engine | a folder under `data/engines` (person) or `create_engine` (engine) | no |
| a shared tool | `Tool` impl, listed in `tools::shared` (domain tools in their own module, like `market.rs`) | no |
| a storage backend / source | implement `Store`; pick it in `store::open` (by location) | no |
| a new kind of stored object | a field in `Manifest` (+ `defaults/askk.json`); write it through `store::data()` and it is live | no (one field) |
| a live view | read `use_live(|| <key prefix>)` in its resource | no |
| a model / runtime | `data/models.json` (openai or cli method) | no |
| a page | `data/routes/**/page.json`, `create_view` | no |
| a component (UI) | `data/components/*.json`, `create_component` | no |
| a conversation mode | an engine folder whose `engine.json` names a `mode`; the Talk page lists it | no |
| a kind of figure | a variant in `core/figure.rs` (structure + checks), its drawing in `ui/figure.rs`, its tool in `elements/whiteboard.rs` | one enum |
| a way to sense an input | a command in `senses.json` (image, hear, frame, sound, length) | no |

Slots, in order: `purpose` (goal) → `knowledge` (learning, notes) → `tools` (toolbox first, then
scripts) → `format` (reply rules) → `position` (phase, state) → `world` (artifacts, alerts,
workspace) → `conversation` (history) → `other` → `input` (input, nudge). Within a slot: by name.

## 5. Gap register

Status: **closed** = fixed in this pass; **open** = known, decision needed. Impact = what breaks or
gets harder if left.

| id | gap | status | impact | decision / next step |
| --- | --- | --- | --- | --- |
| G1 | Core and API named kinds: `category()`, `ORDER` (kinds + names), `REFOCUS_KINDS`, `kind_icon`, engine card read `history` state JSON, chat read `history` turns, cards read `phase`/`handoff` state | **closed** | every new kind needed edits in 4–6 core places; inbox and workspace silently had no icon (`dot`) | `category`/`icon` required on the trait; `Slot` replaces `ORDER`; roles `abilities`, `log`, `summary`, `transcript`; guard test |
| G2 | Engine parsed TOON even with no `handoff` element (`elements::handoff::parse_toon` called from core) | **closed** | core depended on one element; `askk/market` selected tools but had no format, so it never really called them (its history is prose) | no reader = plain answer; market got a `handoff`; test: tools ⇒ a reply reader |
| G3 | `create_engine` wrote six hard-coded element kinds in Rust | **closed** | P4/P5: engines made by engines differed from anything a person could edit | copies `data/templates/<template>` (seeded from `defaults/templates/engine`); test: every template boots |
| G4 | No storage seam: state files were written from 9 modules | **closed** | "scan becomes SQLite" meant touching all 9; no single definition of a backup | `core::store::Store` (contract) + `host::store::Folder` (disk); boot, board, engines, components, pages, models, theme, layout, scripts, jobs all use keys; guard test. Exceptions by design: workspace files, git, and `service*.json` (shared with `scripts/service.sh`, via `store::data_dir`) |
| G5 | Post directory found receivers by checking `elements/inbox.json` on disk | **closed** | renaming the inbox element broke delivery silently | `Component::receives`, read once into `Engine::receives` (no lock). The board itself stays one shared store key: messages are between engines, so no single engine owns them |
| G6 | Singleton roles by convention (`phase`, `sampling`, `refocus`, `parse`): first element wins | **closed** | a second phase element was ignored with no error | `Component::unique`; `Engine::new` refuses a second one, naming both |
| G7 | Spawned jobs vanished on restart with no record | **closed** | an engine polling `jobs` after a restart saw nothing | recorded in `jobs.json`; at boot they show as `lost` (last 20) and new ids follow them. Activity stays unsaved on purpose: it describes this process |
| G8 | `api.rs` mixed boot, the tool registry, engine tools, `quote` and every server fn | **closed** | hard to see what the API is; trading inside generic code | `world.rs` (boot, find, pollers, board), `tools.rs` (registry, create/dismiss engine), `market.rs` (quote), `api.rs` = server fns only |
| G11 | Nothing stopped two app processes using the same data folder. Found live: two server processes from 2026-11-08 still poll alerts and write `engines/askk/market` | **closed** (for new processes) | broke "one writer per engine"; the UI showed state disk had moved past | `store::lock`: boot takes `askk.pid`; while a live process holds it, a second one boots no engines and shows the error (a dead holder's lock is taken over). Processes started before this change never took the lock: stop them by hand |
| G9 | `ide` view reads `elements::workspace::view_of` directly | open (accepted) | a built-in view tied to one kind | fine while views are Rust; when views become data, expose it as the workspace's large view |
| G10 | Only engines carried a change counter; theme, pages, models, board changes were invisible to the UI; each view ran its own long-poll and the server checked every 250 ms | **closed** | wasted compute; live only for engines; a poll per view filled the browser's connection limit | `core::changes` (keys → seq, Notify); `store::Marked` marks every write; `Engine::bump`; one `api::changes` feed per tab; `use_live(prefix)` memos. An element's own state change still reaches readers through its engine's key (`engines/<path>` covers its elements) |
| G12 | Boot read keys spelled in 8 modules (`"engines"`, `"board.json"`, `KEY` consts) and only from a folder | **closed** | "boot from a DB/file" or moving a part meant a code search | `askk.json` manifest + `boot::load` → `Snapshot`; `store::open` picks folder or bundle; `export_world` |

## 6. How a decision ripples (check before redesigning)

| if you change | you also change | cost |
| --- | --- | --- |
| a `Component` method signature | every file in `elements/`, contract test | high: do it rarely; add methods with defaults |
| `Slot` order | every prompt (cache prefix), prompt tests, Chat colours | medium: one enum, but a visible behaviour change |
| `Spec` shape | every file in `data/`, seed, backups, future DB schema | very high: version it instead |
| a kind's `state` shape | only that element (files load via `serde(default)`) | low |
| the reply format | `handoff` only (core just asks for `parse`) | low |
| storage (folder → SQLite) | one `Store` impl (G4 closed); keys stay the same | low |
| where a part lives | its `askk.json` field (G12 closed) | low |
| what a view refreshes on | its `use_live` prefix | low |
| what a new engine is made of | the templates folder only (G3 closed) | low |

## 7. Still open, on purpose

- **G9** (`ide` reads the workspace element directly) waits for a real need.
- Workspace files and git are not store keys, so they mark nothing: the IDE refreshes when its
  engine changes (its workspace element snapshot), not when a file changes on disk.
- The live feed is a long-poll (`api::changes`), not a socket: one request parked per tab. A
  websocket would change only `use_live_provider` and the server fn.
- `create_script` writes a `script` element by kind name: it is a tool *about* scripts, outside
  core, so it is allowed to name the kind it creates.
- Element sections in the same slot are ordered by name. If you want a specific order inside a
  slot, name elements for it (or ask for a per-element `rank` knob; not added until needed).
