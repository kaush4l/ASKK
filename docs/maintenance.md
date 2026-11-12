# Maintenance: how this code is kept

The aim is not to add features carefully. The aim is to keep a structure in which good
results happen by themselves: a new screen works on every device because of where state
lives, a crash in one engine does not stop the others because of how locks are taken.
A maintainer's work is to keep that structure true. Features are a side effect.

Three things keep it true, in this order:

1. **A rule is a test.** Every rule below is checked by `src/structure.rs`. Nobody has to
   remember it, and its failure message says what to do instead.
2. **A debt is a number.** Where the code does not yet follow a rule, the exception is
   written down in that same test with a count. The count may go down. It may never go up.
3. **One command.** `./scripts/check.sh` runs the tests and compiles every build. A change is
   kept only when it prints `ready`.

## 1. The promises, and what holds each one

| the promise | what makes it true | the test that keeps it |
| --- | --- | --- |
| One core runs on every target | `core/` and `elements/` use the language only: no UI library, no machine, no runtime, no knowledge of which build they are in. What differs per build sits behind a *port* | `the_core_is_the_plain_language`, `only_the_host_touches_the_machine`, `the_core_names_no_runtime`, `the_core_does_not_know_the_build` |
| Any UI can be put in front | State and decisions live in `core/` and the host. A window only *asks* (`api/`) and *draws* what it is given (`ui/`) | `the_wire_is_one_folder`, `only_the_api_reaches_the_host`, `the_core_does_not_know_who_draws_or_asks`, `every_question_can_be_asked_by_any_ui`, `an_answer_is_a_plain_function`, `the_answers_ask_the_core_not_the_host` |
| A capability can come up while running | A port always has an answer; with nothing behind it the answer is "not here", never a crash | the "nothing" form of every port (section 3) |
| The service never stops | Errors are returned with their reason, not thrown. A lock survives a panic. A run cut off is read back as `interrupted` at the next start | `errors_are_returned_not_thrown`, `a_lock_never_stops_the_service` |
| Anyone can follow an error | An error is one plain sentence: what, where, why. Every file answers one question, said in its first lines, and is short enough to read at once | `a_file_is_read_in_one_sitting`, the "Where to go" table in `docs/structure.md` |
| The UI is the same everywhere | A page is a value (which objects it shows). A view is a template. Looks are in the stylesheet | `every_view_a_page_may_name_is_drawn`, `looks_live_in_the_stylesheet` |

## 2. The map

```text
shells/   what holds the window        ─┐
ui/       how it is drawn               ├─ a window: asks and draws, decides nothing
api/      what a window may ask, and the answers ─┘
host/     how it is done on a server   ─┐ a host: gives the core a disk, a model,
local/    how it is done in a tab      ─┘ a place to run code, a way to run work
elements/ the kinds of object an engine is made of
core/     what things are and how they behave
```

Dependencies point down only. `host/` and `local/` stand at the same level: each is a full
host for the same core, and neither knows the other.

## 3. Ports: how one core serves every build

A port is a small trait in `core/` for something the machine must do. The core calls the
port; a host provides it.

| port | in | server (`host/`) | browser tab (`local/`) |
| --- | --- | --- | --- |
| `Store` (askk's own state) | `core/store.rs` | a folder, or one file | IndexedDB |
| `Files` (the workspace) | `core/files.rs` | the disk | not yet |
| `Infer` (ask a model) | `core/mod.rs` | model servers, command-line models | `fetch` to a model server |
| `Senses` (images, sound) | `core/media.rs` | `ffmpeg`, a local model | not yet |
| `Tasks` (work beside the caller) | `core/tasks.rs` | the server's runtime | the tab's loop |
| the running engines | `core/world.rs` | boot from a folder | boot from IndexedDB |
| `Tables` (the user's own data files) | `core/tables.rs` | the personal folder | not yet |
| change listeners | `core/changes.rs` | wakes waiting windows (`host/changes.rs`) | not yet |
| `Tool` (what an engine can do) | `core/tool.rs` | files, commands, market, data | `run_code` (sandboxed) |

With nothing set, a port still answers: the store keeps things in memory, `Tasks` says nobody
runs the work, a missing tool is simply not offered to the engine. The app starts in every
build; it only does less.

**The rule for a new capability** (a sandbox, a camera, a new kind of storage):

1. Write the trait in `core/` in the core's words ("run this program", not "start Docker").
2. Give it a "nothing" form that answers with a sentence saying it is not available here.
3. Provide it in each host that can. A host that cannot simply does not.
4. If it can appear later (the user installs something, a device is plugged in), the host
   checks at the time of the call, not at start. Nothing is cached that can go stale.

Never write `#[cfg(feature = …)]` in the core to get the same effect. It looks cheaper and
it is how the tab build came to have `create_view` and `create_component` tools that
answered "created" and wrote nothing. That is now a failing test.

## 3b. Builds: one source, several programs

A build is a choice of cargo feature. The feature picks a host (who fills the ports) and a
shell (what holds the window); the core is the same in all of them.

| build | made with | what it is | host | checked in CI | published |
| --- | --- | --- | --- | --- | --- |
| `server` | `--features server` | the host: runs the engines, serves pages and `/ask` | `host/` | built and tested on Linux and macOS (x86-64, arm64), built on Windows (x86-64, arm64) | a program per machine, kept with each CI run |
| `web` | `--features web` (wasm) | a window in a browser, on a running host | none: it asks the host | built | with the server (`dx build`) |
| `desktop` | `--features desktop` | the Mac app: window, tray, Dock, notch | none: it asks the host | compiled on macOS | not yet |
| `mobile` | `--features mobile` | iPhone and iPad | none: it asks the host | not yet | not yet |
| `local` | `--no-default-features --features local` (wasm), `scripts/local.sh` | the whole app inside one browser tab, no server | `local/` | built | GitHub Pages, on every push to `main` |

`local` cannot be combined with another build; trying is a compile error that says so.

**The fullest build is one command:** `./scripts/run.sh` builds the host and its window as
released and starts them at `http://127.0.0.1:8090`. The program carries the defaults it was
built with, so it makes a first home anywhere, with no `defaults` folder beside it.
`./scripts/smoke.sh` proves that: it starts the built program in an empty folder and asks it
for its engines, its capabilities, every page and a wrong question.

**What a build can do is not written in this table.** Each host notes what it provides, on
the line beside where it fills the port (`core/caps.rs`), and the app answers for itself:
the `capabilities` question (`POST /ask/capabilities`, and the list at the top of the tab's
page). A capability that is missing says what the app does without it.

| | server | tab (`local`) |
| --- | --- | --- |
| store | the data folder | the browser's storage (IndexedDB) |
| engines | yes | yes |
| background work | the server's runtime | while the tab is open |
| project files, commands | yes | no |
| images, sound, video | yes | no |
| the user's data tables | yes | no |
| models | servers and command-line models | any model server the tab can reach |
| run code | commands in the workspace | JavaScript and Python in the browser's sandbox |

**Adding a build** (a phone that runs engines itself, a small device): a new host folder
beside `host/` and `local/`, a feature in `Cargo.toml`, a line in the table above, a job in
`.github/workflows/ci.yml`, a step in `scripts/check.sh`. No change in `core/`.

**What is published.** The tab build packs the `defaults/` folder of this repository into the
program (`build.rs`), and that program is public on GitHub Pages. So `defaults/` holds only
what may be public. One person's own engines, accounts and rules stay on the machine: they
are named in `.gitignore`, so they are in neither the repository nor any published build.

## 4. Any UI: what a new front end has to do

The core already describes every screen as data: a page is a tree of *nodes*
(`core/node.rs`) made of 23 primitives (`pane`, `row`, `stat`, `figure`, …), and each domain
object says how it looks as such a tree. So a new UI is three things:

| a UI must | Dioxus (today) | a terminal UI | a JS framework (Next, Svelte, …) |
| --- | --- | --- | --- |
| draw the primitives | `ui/render.rs` | one function per primitive | one component per primitive |
| ask the host | generated server functions (`wire!`); in the tab, the plain functions themselves | `api::ask::ask(name, args)` in the server's process | `POST /ask/<name>` with a JSON object; `GET /ask` lists every question and its arguments |
| hear changes | `ui/views/live.rs` | `core::changes::listen` | `POST /ask/changes`, held open until something changes |

What does **not** carry over for free is the 13 *built-in views* (`chat`, `ide`, `rooms`, …):
they are Rust code in `ui/views/`. So the direction is fixed: **when a view can be said as
nodes, say it as nodes.** Each view moved from code to nodes appears in every UI at once.
A built-in view is kept only for what primitives cannot say (a text editor, a canvas).

An answer is a plain function (`api/answers.rs`, `api/<file>/answers.rs`): no UI library, one
sentence for an error. Each has one line in its file's `wire!` list (the Dioxus form) and one
in the table in `api/ask.rs` (the form for everyone else). The answer over plain HTTP is
the same value the Dioxus window gets, and an error is one sentence:

```text
POST /ask/engine_budget {"path": "askk"}   → 200 {"ok": 168000}
POST /ask/engine_view   {"path": "nope"}   → 400 {"error": "no engine 'nope'"}
POST /ask/engine_view   {}                 → 400 {"error": "'engine_view' needs the argument 'path'"}
```

The address is the server's own (this machine only, by default). The body must be JSON, so a
page from another site cannot post to it unasked.

## 5. The UI: a page is a value, a view is a template

**A page** is `routes/<path>/page.json`: a title, a place in the sidebar, and a tree naming
what is shown. It is data in the store; an engine can write one. No Rust changes.

**A view** follows one shape, top to bottom, and nothing else:

```rust
/// One sentence: what this view shows, and for whom.
#[component]
pub fn GlanceView() -> Element {
    // 1. Ask: the domain objects this view shows, each tied to the keys it depends on,
    //    so it is asked again when (and only when) one of them changes.
    let g = use_live_server(String::new, glance)?;
    let g = g().unwrap_or_default();
    // 2. Draw: components and classes. No decisions about the domain here.
    rsx! {
        div { class: "glance row", role: "status",
            span { class: "badge", "{g.waiting} waiting" }
        }
    }
}
```

| rule | why |
| --- | --- |
| A view asks only through `api/` | the same view works whoever the host is |
| A view decides nothing about the domain ("is this engine running?" is answered by the core) | a second UI would otherwise answer it differently |
| What repeats becomes a component in `ui/components/`, one file each | one place to fix a look |
| No inline `style:` except a number worked out at run time | the theme changes every page together |
| A view that grows past one sitting is split by what it shows | see the size rule |

## 6. A service that never stops

| rule | in practice |
| --- | --- |
| Return the error | `Result<_, String>` with a sentence, passed up with `?`. `.unwrap()`, `.expect()` and `panic!` are counted per folder and the count only goes down |
| Take a lock with `held()` | `core/held.rs`. A panic while holding a lock no longer makes every later use panic |
| One engine's failure is that engine's | an engine that cannot start says why and the others start; a run that fails is recorded with its reason |
| State is enough to start again | a run is saved when it starts and as it goes; one cut off is `interrupted` on the next start, never lost |
| Background work goes through `core::tasks` | so each build decides how it runs, and a build with nobody to run it says so |

## 7. Errors a layman can follow

An error message is written for the person who will read it at a bad moment. Its shape:

```text
what failed          where                why
engine 'askk/guru':  element 'history':   unknown key 'max_turn'
```

- Say the thing by the name the user knows (the engine's path, the file's key), not the
  Rust type.
- Say what was expected next to what was found.
- Never show a debug dump (`{:?}`) of an internal value to the user.
- An unknown or wrong value in a data file is an error with the file's key in it, never a
  silent default.
- A test's failure message says what to do, not only what is wrong. Read any message in
  `structure.rs` for the tone.

Every source file starts with `//!` lines that say which one question it answers. When a
file answers two, it becomes two files.

## 8. Recipes

| to add | touch | do not touch |
| --- | --- | --- |
| a kind of element | `elements/<kind>.rs`, one line in `core::KINDS` | the engine loop |
| a tool | the host that can do it (`host/tools.rs`, `local/code.rs`) | `core/` |
| a capability | a port in `core/` + its "nothing" form, then each host (section 3) | `ui/` |
| a page | a `page.json` in the store | any Rust |
| a built-in view | `ui/views/<name>.rs`, its name in `core::node::VIEWS`, its arm in `ui/views/mod.rs` | `core/` beyond that name |
| a question a window asks | a plain function in an `answers.rs`, one line in that file's `wire!`, one line in the table in `api/ask.rs` | `ui/` reaching into `host/` |
| a host (a phone, a device) | a new top-level folder beside `host/` and `local/`, added to the map in `main.rs` first | `core/`, `elements/` |
| a UI | section 4 | `core/`, `host/` |

## 9. Changing a rule

A rule that is in the way is sometimes wrong. Then change the rule, in the open:

1. Change the test in `structure.rs` and the line in this file, in a change of its own.
2. Say in that change what the rule protected and what protects it now.
3. Only then write the code that needed it.

Raising a debt number is the same act and needs the same reason. "The test was failing" is
not one.

When a bug is found, fix it, then ask: *which wall would have stopped this?* If one could
have, add it as a test. That is how the tab's silent tools became
`the_core_does_not_know_the_build`.

## 10. Debts today (2026-11-11)

Counted by the tests; this table is a reading of them, not a second source.

| debt | size now | where it is counted |
| --- | --- | --- |
| places that stop the program instead of returning an error | core 10, elements 1, host 10, api 4. Most are "turn this value into JSON", which does not fail in practice; `api/mod.rs:274` and the three `take().unwrap()` on a child process can | `errors_are_returned_not_thrown` |
| a file too long to read at once | `core/engine.rs`, 608 lines of code (limit 450) | `a_file_is_read_in_one_sitting` |
| inline styles | 20 across 8 files, 11 of them in `ui/figure.rs` | `looks_live_in_the_stylesheet` |
| answers that name the host | 17 lines in 5 files | `the_answers_ask_the_core_not_the_host` |

Not yet countable, in the order they should be done:

1. **Some answers still reach into `host/`** (17 lines, counted by
   `the_answers_ask_the_core_not_the_host`): rooms, sessions, attachments, model connectors,
   workspace jobs, the held-open `changes`. Those 20 questions exist on the server only; the
   other 36 are answered in the tab too. Each needs a port in `core/`, as the running
   engines (`core/world.rs`) and the user's tables (`core/tables.rs`) now have.
1b. **The real UI does not run in the tab yet**, though it could now ask. What is left is in
   `ui/`: `ui/views/live.rs` starts from a server-rendered value (`use_server_future`), and
   the stylesheets are bundled by `dx`, which the tab build does not use.
2. *(done: `core/caps.rs`, the `capabilities` question.)* It is not shown in the real UI's
   Settings page yet.
3. **Background work in `host/` is not watched.** Alert pollers, jobs and sessions are
   started with `tokio::spawn` directly; if one panics it ends without a word. Route them
   through `core::tasks` and have the server's `Tasks` print the name and reason when one ends.
4. **`core/engine.rs` answers four questions** (the loop, waking, the record, drawing itself).
   Split along those.
5. **Spec and state share a folder** (`engines/<e>/`). Sharing a recipe is a filter today;
   with two roots it is a copy, and a recipe gets a stable hash.
6. **The tab has no change feed for the UI** and no workspace or senses.

## 11. The routine

| when | do |
| --- | --- |
| before keeping any change | `./scripts/check.sh` (tests, every build, then the built app is started and asked) |
| a debt number can go down | lower it in `structure.rs` in the same change |
| a new top-level folder, port, view or build | add it to the map (`main.rs`, this file) first |
| each release | read section 10 against the tests; move finished items out |
| a push to `main` | CI runs the check and builds every program; Pages publishes the tab build. A red run is fixed before anything else |
