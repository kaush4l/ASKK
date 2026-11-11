# 004 Architecture: where every line of the session layer lives

The decisions of `002-decisions.md`, placed in the folders of `docs/structure.md`. Nothing here
changes the walls: shells → ui → api → host → elements → core.

Signatures below are a proposal for stage 0 to settle (`005-drive.md`), not a finished design.

> **Partly superseded 2026-11-10 by `007-workflow.md`.** The `sessions` element, `Event::Session`
> and the `Ask` structure below are replaced by a session object beside the engine, and by the
> envelope. The harness port, items, `Can`, the adapters and the host section stand. The map in
> `007`, section 6, is the current one.

## The words

Seven words. A new wish becomes an attribute of one of them, or prompt text, before it becomes
an eighth.

| word | what it is | kind or value? |
| --- | --- | --- |
| **harness** | a program that runs an agent's own loop: Claude Code, Codex, anything that speaks ACP, an askk engine | kind = one file of code; instance = one entry in `harnesses.json` |
| **session** | one real conversation inside a harness | a value: a card in a `sessions` element |
| **item** | one thing that happened in a session, whole, with an id | a value |
| **ask** | something a session needs from the person, with how it can be answered | a value on the card |
| **engine** | unchanged: owns the work, carries the sessions | folder |
| **stage** | where the work stands for the person: needs me, working, idle | derived each time, never stored |
| **pack** | a setup someone can hand over | a folder of store keys |

## The map

```text
src/core/session.rs            what a session is: Card, Item, Turn, Ask, Can, and the Harness port
src/elements/sessions.rs       the element an engine carries its sessions with
src/host/harness/mod.rs        the registry: kind name → adapter; instances from harnesses.json
src/host/harness/replay.rs     a recorded session, played back (tests, demos, no login needed)
src/host/harness/claude.rs     Claude Code: stream-json and its control protocol
src/host/harness/codex.rs      Codex: app-server (JSON-RPC)
src/host/harness/acp.rs        Agent Client Protocol: Grok Build, Gemini, Cursor, OpenCode, …
src/host/harness/own.rs        an askk engine, seen as a harness
src/host/sessions.rs           the live ones: start, pump items to the engine, mark changes, let go when idle
src/api/sessions.rs            what a window may ask: list, open, say, stop, answer, read, find
src/ui/views/session.rs        one session, drawn (the same primitives the chat uses)

defaults/harnesses.json                    the instances, like models.json
defaults/templates/desk/                   an engine made to carry sessions
defaults/routes/sessions/page.json         all sessions, those that need you first
defaults/routes/sessions/[id]/page.json    one session
defaults/askk.json                         + "harnesses": "harnesses.json"  (+ "packs": "packs" at stage 6)
tests/sessions/*.jsonl                     recorded sessions every adapter must replay the same way
```

"Where to go", in the form `docs/structure.md` uses:

| the problem | the place |
| --- | --- |
| a session shows the wrong thing | `ui/views/session.rs`; what an item is: `core/session.rs` |
| one harness misreads its own wire | `host/harness/<kind>.rs`, and nowhere else |
| a session will not start, or dies | `host/sessions.rs`; its command: `harnesses.json` |
| an approval never reaches me | `elements/sessions.rs` (the ask), `host/harness/<kind>.rs` (where it is read) |
| an engine uses its sessions wrongly | `elements/sessions.rs` (the tools and the prompt section) |
| a button shows for a harness that cannot do it | the harness's `can()` |

## The port (`core/session.rs`)

```rust
/// A kind of harness. One file in host/harness/ each.
pub trait Harness: Send + Sync {
    fn kind(&self) -> &'static str;
    /// What it can really do. A false flag hides the control; nothing imitates it.
    fn can(&self) -> Can;
    /// Start a session, or take up one that exists (`Open::native`).
    fn open(&self, how: Open) -> Fut<Result<Arc<dyn Live>, String>>;
    /// A session's items as the harness keeps them. `Err` = this harness cannot say.
    fn read(&self, native: &str) -> Fut<Result<Vec<Item>, String>>;
    /// Sessions it holds that askk did not start.
    fn find(&self, under: &Path) -> Fut<Vec<Found>> { Box::pin(async { vec![] }) }
}

/// A session that is running.
pub trait Live: Send + Sync {
    fn say(&self, text: String, shown: Vec<Attachment>) -> Fut<Result<(), String>>;
    fn stop(&self) -> Fut<Result<(), String>>;
    fn answer(&self, ask: &str, with: Answer) -> Fut<Result<(), String>>;
    /// The next thing that happened; `None` when the session has ended.
    fn next(&self) -> Fut<Option<Happened>>;
}

pub enum Happened {
    /// The harness's own id became known, or the model, title or mode changed.
    Card(Patch),
    Turn(Turn),      // Started | Ended { why: Done | Stopped | Failed(String) | Limit, usage }
    Item(Item),      // whole, upserted by id: live and replay are the same code
}

pub struct Item { pub id: String, pub kind: Kind, pub status: Status, pub text: String, pub detail: Value, pub under: Option<String> }
pub enum Kind { Said, Thought, Tool, Ask, Plan, Note }      // who said it is in `detail`
pub enum Status { Open, Done, Failed }

pub struct Ask { pub id: String, pub what: String, pub options: Vec<Choice>, pub reach: Reach }
pub enum Reach { Live, Message, Gone }   // can it still be answered, and how

pub struct Can { pub resume: bool, pub fork: bool, pub steer: bool, pub questions: bool,
                 pub always: bool, pub subagents: bool, pub rewind: bool, pub find: bool, pub usage: bool }
```

Rules the port carries:

- **Items are whole.** An adapter coalesces deltas and sends the item again with more text. The
  window never assembles a stream. (T3 Code's adapters emit whole normalized entities too.)
- **`under`** names the item this one belongs to (a subagent's work under its tool call). That
  is the whole subagent model.
- **`Reach::Gone`** exists so an ask whose process died says so.
- **`detail` is opaque to the core.** Only the adapter that wrote it and the view that draws
  `Tool` items may look inside, and the view reads only agreed fields (`title`, `input`, `output`).
- **No harness name appears in this file.** The registry maps a name to an adapter in `host/`.

## The element (`elements/sessions.rs`)

```json
{"kind": "sessions", "name": "sessions",
 "config": {"harness": "claude", "where": "projects", "live": 3, "answers": []},
 "state":  {"cards": [{"id": "s7", "harness": "claude", "native": {"id": "…", "strength": "strong"},
                       "where": "projects/site", "title": "add the test", "status": "waiting",
                       "asks": [{"id": "a2", "what": "Run `cargo test`?", "reach": "live"}]}]}}
```

- `unique`: one per engine. `category`: `action`. `slot`: `world`.
- **Tools** it gives its engine: `session_open {harness?, where?, say}`, `session_say {id, text}`,
  `session_stop {id}`, `session_read {id, last?}`. No tool answers an ask unless `config.answers`
  names a rule that covers it; the check is in code (S6).
- **Prompt section:** one line per live card (title, status, the last thing said, open asks).
- **`on(Event::Session { id, happened })`** is the only way a card changes, whether the person
  typed to the session or the engine did (D6). This is the one new `Event` variant.
- **`wake`:** a turn ending, or an ask opening, wakes the engine if it has an `inbox`; otherwise
  it only marks a change. A desk with no inbox is plain T3 mode.
- **View:** small = count and how many need you; medium = the cards; large = the session view.
- **State is cards only.** The transcript is the harness's (D7).

Status on a card is one of `starting | working | waiting | idle | lost | ended`. `lost` is what
every live card becomes at boot (the process is gone); opening it resumes by native id. This is
the rule jobs already follow (G7 in `architecture.md`).

**Stage** is derived from the cards when asked: any open ask, `waiting` or failed turn = *needs
me*; any `working` = *working*; else *idle*. The Dock badge's `waiting` number counts the first.

## The host (`host/sessions.rs`, `host/harness/`)

- One child process per live session (Codex: one app-server, many threads), started only here.
  The children inherit the Seatbelt profile; each harness's own folder (`~/.claude`, `~/.codex`)
  is opened in `sandbox/server.sb` by name.
- A pump per live session: `Live::next` → `Engine::dispatch(Event::Session)` → the element saves
  → `changes::mark("sessions/<id>")`.
- A cache of items per session under the home's `cache/` (a root in `core/places.rs`). Not in
  the store, not in a backup, safe to delete.
- Let go of an idle process after a while (T3 Code uses 30 minutes); the card stays, `idle`.
- **Health checks never open a session.** Opening one can start hooks, MCP servers or a login.

`harnesses.json`:

```json
{"default": "claude",
 "harnesses": [
   {"name": "claude", "kind": "claude", "command": ["claude"]},
   {"name": "codex",  "kind": "codex",  "command": ["codex", "app-server"]},
   {"name": "gemini", "kind": "acp",    "command": ["gemini", "--acp"]},
   {"name": "grok",   "kind": "acp",    "command": ["grok", "agent", "stdio"]},
   {"name": "guru",   "kind": "own",    "engine": "askk/guru"}]}
```

The adapter adds its own protocol flags; the value says only which program. An unknown `kind`
or field is refused when read, with the reason.

## The walls (added to `src/structure.rs`)

| test | keeps out |
| --- | --- |
| `no_harness_is_named_outside_its_adapter` | S3, S4: `"claude"`, `"codex"`, `"acp"` as code literals only under `host/harness/` |
| `only_the_harness_folder_speaks_a_harness_wire` | a second place that reads a harness's stream. (A model reached through a command stays in `host/infer/`: it is asked once and answers once, and its command is a value, not code.) |
| `every_harness_replays_the_recorded_sessions_alike` | S8: an adapter that only works live |
| `a_card_holds_nothing_the_harness_can_give_back` | S2: transcript text in state |
| `no_tool_answers_an_ask_without_a_rule` | S6 |
| `a_control_shows_only_when_the_harness_can` | imitation of a missing capability |

## What each rule protects, and what it costs

| rigid thing | why | cost to change |
| --- | --- | --- |
| `Happened` and `Item` | every adapter, the element, the view, every recording | very high after the third adapter: frozen at stage 4, not before |
| `Can` | controls in every view | low: a new flag defaults to false |
| the card's shape | the backup | high: version it |
| one writer per card (`on`) | no torn state between the person and the engine | high |
| adapters share no code beyond the port | T3 Code's shared ACP adapter is about 9,500 lines; isolation keeps a bad harness release in one file | low |

## What stays open on purpose

- **Reports from a session to its engine.** dsh gives workers a `report` tool; T3 Code injects
  one optional MCP server per thread; Claude's desktop app injects several. Until an engine
  needs more than "the turn ended" and "an ask is open", nothing is injected into a session.
- **Worktrees.** `where` on the card is a path today; a worktree is the same field with a rule
  for making it.
- **Sources** (GitHub, a schedule) are elements that `watch()`: open already, not part of this.
- **A socket** in place of the long-poll, when per-token text is wanted (D11).
- **Muse Code.** Not installed here. T3 Code drives it through its own SDK package, which is
  Node. If it speaks ACP it is a line in `harnesses.json`; if not, one more file. The Muse app
  and Grok Bot are cloud assistants with no way in: not harnesses.

## Packs (stage 6, your decision first)

```text
<home>/data/            the personal layer: read first, the only one written
<home>/packs/<name>/    packs, in the order askk.json lists them: read-only
defaults/               shipped: read last
```

- One new `Store` impl (`Layered`): `get` walks the layers, `put` writes the top, `list` merges.
  Boot already builds only from a snapshot of a store, so nothing above the store changes.
- An override records the hash of what it replaced (`base`). When a pack or default moves on,
  the override says "the default changed" in place of silently winning. (dsh does this for
  prompt parts; DSH does it for profiles: bundles in order, then one patch file.)
- `pack.json`: `{name, version, about, needs: ["claude", "tool:quote"]}`. A pack may hold
  engines, templates, routes, components, theme, harness entries, and a `skills/` folder that
  is handed to sessions as the harness's own unit, untouched.
- Never in a pack: `user.md`, `personal/`, `media/`, cards, tokens. The manifest says which
  keys are personal; export refuses them.
- Sharing is `export()` of one pack to one file. It exists.
