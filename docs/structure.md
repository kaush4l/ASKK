# Structure: where every line lives

The folders are the map. A problem has one place; tests in `src/structure.rs` keep it so.

| folder | question it answers | may use |
| --- | --- | --- |
| `src/core/` | what things are and how they behave | the language only (no UI library) |
| `src/elements/` | the kinds of object an engine is made of | `core` |
| `src/host/` | how it is done on this machine (server only) | `core`, `elements` |
| `src/local/` | how it is done inside a browser tab (the `local` build) | `core`, `elements` |
| `src/api/` | what a window may ask, and the answers (plain functions; the wire is generated) | `core`; `host` where a port is still missing |
| `src/ui/` | how it is drawn (Dioxus lives here) | `core`, `api` |
| `src/shells/` | what holds the window | `ui`, `api` |

Dependencies point inward: shells → ui → api → host → elements → core.

How these rules are kept, what each one buys, and the debts still open: `docs/maintenance.md`.
Before keeping a change: `./scripts/check.sh`.

## Where to go

| the problem | the place |
| --- | --- |
| an element refuses its config, or a knob is missing | the kind's entry in `core::KINDS` (`core/mod.rs`): its `params`; the check: `core/param.rs` |
| a hole is not filled, or a bound value shows up in a recipe | `core/param.rs` (`resolve`), filled in `core/boot.rs::init`; the file: `host/data.rs::bindings` (`<home>/personal/bindings.json`) |
| a pack holds something personal, or refuses a recipe | `core/pack.rs` (`export`, `looks_personal`); which keys are personal: `params` in `core::KINDS` |
| a message has the wrong kind, thread or cause | `core/board.rs` (`Act`, `Cause`, `Draft`, `Message::line`) |
| an engine behaves wrongly | `core/engine.rs` (the loop's stages: `core/flow.rs`); one kind of element: `elements/<kind>.rs` |
| a page shows the wrong thing | the page's `page.json` in the data folder (`routes/`) |
| a primitive looks wrong | `ui/web/render.rs`; a built-in view: `ui/web/views/<name>.rs` |
| a figure is drawn wrongly (plot, graph, sketch, table) | `ui/web/figure.rs`; what a figure may hold: `core/figure.rs` |
| a figure is refused, or the board holds the wrong thing | `elements/whiteboard.rs` |
| a run's record (the loop cards) says the wrong thing | written in `core/engine.rs`, its shape in `core/run.rs`, drawn in `ui/web/views/loops.rs` |
| "what is running?" is unclear or wrong | who counts as running: `core/engine.rs` `working`; the list: `api/talk.rs` `busy`; the chip (top bar, notch) and Home's Now strip: `ui/web/views/loops.rs` |
| Home shows too many or too few engines | `ui/web/views/dashboard.rs` (a sub-engine's own engines stay folded until asked for, or until one is at work or has a new message) |
| the conversation shows the wrong thing | `api/talk.rs` (what a beat is), `ui/web/views/chat.rs` (how it is drawn) |
| an attached image, recording or video is sensed wrongly | the command in `senses.json`; the steps: `host/media.rs`; what the engine is told: `elements/attachments.rs` |
| the user's data is read wrongly | `host/data.rs` |
| a model is not shown the images | `host/infer/connectors.rs`; the model's `input` in `models.json` |
| a model cannot be reached | `host/infer/` |
| a session with another agent gets no answer, or the wrong one | that kind's file in `host/harness/` (its wire); the path every prompt takes: `host/harness/mod.rs`; what a session is: `core/session.rs`; the page: `ui/web/views/sessions.rs` |
| a file or command tool misbehaves | `host/workspace.rs` |
| the data folder is read or written wrongly | `host/store.rs` (contract: `core/store.rs`) |
| a window gets no answer, or the wrong one | the answer: `api/answers.rs` or `api/<file>/answers.rs`; that it can be asked at all: the `wire!` list beside it |
| another UI or a script gets no answer, or a question is missing from `GET /ask` | the table in `api/ask.rs` |
| the tray, Dock, notch, companion or window | `shells/mac/<face>.rs`; what it shows: `surfaces.json` |
| the companion's mood or look | the rule: `core/companion.rs`; the drawing: `ui/web/components/companion.rs`; in a page: `ui/web/views/companion.rs` |
| an engine is woken and nothing runs | who runs background work in this build: `core/tasks.rs` (set in `host/mod.rs`, `local/mod.rs`) |
| a window does not refresh | the log of changes: `core/changes.rs`; the server's waiting: `host/changes.rs`; the window's side: `ui/web/views/live.rs` |
| askk does not start in the background, is not found by a terminal, or does not stop | `host/service.rs` (start, record, stop); what a record means: `core/service.rs`; the commands: `shells/service.rs`; the words of `askk status`: `ui/features/service.rs`. The whole of it: [service.md](service.md) |
| a file edited by hand does not take effect, or the wrong thing happens when it does | that it is noticed: `host/watch.rs`; what the file means once read again: `core/reread.rs`; the service's own settings: `core/settings.rs` |
| a window does not notice that askk was restarted or built again | the answer: `hello` (`api/service/answers.rs`); what it means: `ui/features/service.rs` (`seen`) |
| which engines are running, and why one is not | `core/world.rs` (filled by `host/world.rs`, `local/mod.rs`) |
| "where is this stored?" | `core/places.rs` (the roots) and `askk.json` (every key) |

## Memory is not scattered

- **One table of roots**: `core/places.rs`. It is the only file that reads the environment.
- **One home**: with `ASKK_HOME` set, data is `<home>/data` and projects are made in
  `<home>/projects`. The sandbox profile lets the app write and run there and nowhere else.
- **Two places beside it** that are not askk state: `<home>/personal` (the user's own data files; engines only
  read them) and `<home>/media` (what the user attached, with what was sensed in it).
- **One manifest**: `askk.json` names every key in the data folder. Two keys are fixed in code because they are needed before the manifest can be
  read: `askk.json` itself and `askk.pid` (the one-writer lock).
- **One door each**: askk state goes through the store (`core/store.rs`, on disk by
  `host/store.rs`); workspace files go through `core/files.rs` (on disk by `host/workspace.rs`).
  Nothing outside `host/` touches the disk or starts a process.

## Structure is code, customization is a value

A shell has a fixed set of faces (code, one file each). What a face shows is a value in
`surfaces.json`, checked when read: an unknown field, an unknown number or a size no screen can
hold is an error, never a silent default.

```json
{"window": {"title": "askk", "page": "/", "width": 1280, "height": 820},
 "tray":   {"on": true, "number": "running", "items": [{"label": "Open", "page": "/"}]},
 "dock":   {"badge": "waiting"},
 "notch":  {"on": true, "place": "under", "page": "/notch", "width": 360, "height": 34},
 "companion": {"on": true, "place": "bottom-right", "size": 96, "engine": "askk",
               "bubble": {"width": 380, "height": 520}}}
```

`number` is `none`, `waiting` (unseen messages) or `running` (engines not idle). A page is any
route, so the notch can show any page made of primitives.

## Run

The host, sandboxed, in its own home:

```sh
dx build --platform web
PORT=8090 ASKK_HOME=/Volumes/Backup/askk scripts/sandboxed.sh
```

The Mac app (a window on the running host, plus tray, Dock badge and notch panel):

```sh
dx build --platform macos
ASKK_HOST=http://127.0.0.1:8090 target/dx/askk/debug/macos/Askk.app/Contents/MacOS/askk
```

The browser sees the same host at `http://127.0.0.1:8090`.

## The flow, and where each step lives

**Boot** (`host/mod.rs` → `host/world.rs`): read the places → open the data store
(`host/store.rs`) → take the one-writer lock → seed anything missing from the defaults → load
one snapshot: the manifest and everything it names (`core/boot.rs`) → initialise every engine
from that snapshot → start one poller per alert → open the board.

**Run** (`core/engine.rs`, stages named in `core/flow.rs`): an event arrives (a message, an alert, a run request) → every
element reacts (`on`) → the prompt is put together from the elements' sections → the engine
calls inference through the `Infer` port and never learns the provider → the reply is parsed
by the elements → the tools it names are called → state is written through the store.

**The loop is a value.** The stages are fixed in code (`core/flow.rs`); which of them an engine
runs is a list in its `engine.json`, checked when the engine starts:

```json
{"name": "summariser", "flow": ["prompt", "think", "parse", "save"]}
```

No `act` = it answers and never calls a tool. No `refocus` = its history is never folded. An
unknown stage, a stage out of order or twice, or a loop without `prompt`, `think`, `parse`,
`save` is refused with the reason and that engine does not start; the others do. Left out, an
engine runs every stage, as before.

**Every run leaves a record** (`core/run.rs`): one step per pass of the loop, one mark per stage entered, each
with its time, one line on what it did, and the texts it used (the prompt as sent, the reply as received, each
call with its result). The last 12 runs are kept with the engine (`<engine>/runs/<id>.json`). The UI shows a run
as a tiny card (status, a pip per stage, one line) that opens into the whole run, stage by stage: this is where a
loop is read and tuned.

**Modes of conversation.** The Talk page (`/talk`) offers every engine that names a `mode` in its `engine.json`:

```json
{"name": "guru", "mode": "guru", "model": "claude-sonnet-5-5-vision"}
```

`askk` is `translator` (it passes work on); `askk/guru` is `guru`: it answers itself, draws on its board
(`whiteboard` element: `plot`, `graph`, `draw`, `table`, each a checked value the UI draws), reads the user's own
data (`data_list`, `data_read`, `data_query`; a figure's `from` takes its numbers straight from a file) and is
shown or told what the user attaches. A new mode is a new engine folder with a `mode`; no code.

**What is not text** (`core/media.rs`): an attached file is kept by the host and *sensed* by the commands in
`senses.json` — an image is made smaller, a recording becomes its words, a video becomes a few stills plus the
words of its sound track. A message names the attachment with a token (`[media:<id>]`); the `attachments`
element puts the words in the prompt and hands the pictures to the model. A model sees pictures when its method
can carry them: `openai` always, `cli` with `"input": "stream-json"`.

**Provider binding** (`host/infer/`): which provider a model name means is read at first use
and read again only when the models key is marked changed.

**Refresh** (`core/changes.rs` → `api::changes` → `ui/web/views/live.rs`): every store write marks
its key; windows wait on one feed and redraw only what shows a changed key. The Mac faces
count on the same feed.

## Known limits

- Seeding copies a top-level entry only when it is missing: a boot that dies mid-copy leaves
  that entry half filled, and a new default page inside an existing folder is not added.
- The sandbox profile opens the GPU (Metal) and any port on this machine (local model
  servers), which also means the app can reach other local services.
- Mac app: on a full menu bar (a notch display fills up fast) macOS collapses the newest tray
  icons, ours included, behind its « overflow; click « to see it, or Cmd-drag it to a place
  you like (macOS remembers). The app cannot choose its own place: tried, no effect.
  The app is signed ad hoc only (runs on this Mac; sharing it needs your Apple Developer ID); no Dock
  right-click menu.
- The sandbox lets the app run two programs outside itself for video, `ffmpeg` and `ffprobe` (found under
  `TOOLS`, default `/opt/homebrew`, which it may read but not write). Hearing a recording asks a model server on
  this machine (the `hear` command in `senses.json`); with none running, a recording is attached but says why it
  could not be heard.
- A plot's text scales with the plot: in a narrow pane it gets small. A long flow diagram scrolls sideways.
- Restart after a change is not part of the app: start it again by hand or with your own tool.
