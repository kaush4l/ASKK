# `crates/core/src` — the map

L2 wiring: the one seam, routing dispatch, the effect runtime, and boot. Each
**subject** is a directory whose `mod.rs` is its index; the loose files beside
them are the wiring itself, which belongs to no subject.

## The directories

| Directory | What it holds |
|---|---|
| `agents/` | Who is loaded: installing an agent, precedence between copies of a name, the routes that author one in the browser, and the card and sentences the Agents view prints. |
| `board/` | The status board: one row per agent, the fleet tiles above it, and `stage.rs` — which part of the turn a row's live line is reporting. |
| `chat/` | One agent's conversation: the route that starts a turn, the transcript folded out of the log, and every line the page says around the messages. |
| `failure/` | What a failed turn looks like to the person reading it: the card, the actionable sentence, how the turn ended and what each ending is called, and the folds for a repeat or a sub-agent's failure. |
| `files/` | The workspace's files as a person browses them — the pane, the folder listing, its rows and empty states, whether it may be shown at all, and the `find_files` tool that reaches the same subject from the agent's side. |
| `log/` | One agent's own log: `decisions.rs` is the pure half, `store.rs` moves the bytes through `StorePort`. |
| `proc/` | Long-running processes: the convention they are kept in, the four tools that supervise them, and the pane that shows what is running. |
| `runtime/` | The effect runtime loop — `drive`, `pump`, and the page-requested effects that are not agent turns. |
| `space/` | A space: the shared store an agent and its sub-agents both reach, and the inspector that shows it. |
| `terminal/` | The workspace scrollback: which commands it shows, how one looks, the scroller, and the footnote about the machine they ran on. |
| `trace/` | The tool trace: which calls it holds, how a row renders, who asked, what is still in flight, and whether a row may print "ok". |
| `workspace/` | The workspace, run: the capability gate and the single `WorkspacePort::exec` call, plus a person's gesture turned into the agent's own tool. |

## The loose files

`lib.rs` (the seam), `app.rs`, `boot.rs`, `dispatch.rs` + `ctx.rs`,
`builtins.rs`, `batch.rs`, `effects.rs`, `error.rs`, `tools.rs` (the tool
**executor** — the trace a person reads is `trace/`), `observe.rs`,
`websearch.rs`, and `words.rs` (the sentence fragments every pane shares).

## The `core`/`ui` pane pairing

Every pane exists twice: `core` decides and serves the fragment, `ui` mounts
it. Both crates are now directories-per-subject, so the rule reads:

> **For every pane P, `core/src/P/pane.rs` serves the fragment and
> `ui/src/P/mod.rs` mounts it.**

This is the corrected form of the rule in `CRITIQUE-01` F9, which predates both
directory moves — it held as `core/src/P.rs` ↔ `ui/src/P.rs` when both crates
were flat, and the route and the component each moved one level down into their
subject's folder. It reads true today for seven pairs:

| Subject | Serves the fragment | Mounts it |
|---|---|---|
| chat | `core/src/chat/pane.rs` | `ui/src/chat/mod.rs` (`ChatPane`) |
| board | `core/src/board/pane.rs` | `ui/src/board/mod.rs` (`AgentBoard`) |
| space | `core/src/space/pane.rs` | `ui/src/space/mod.rs` (`SpaceInspector`) |
| terminal | `core/src/terminal/pane.rs` | `ui/src/terminal/mod.rs` (`Terminal`) |
| files | `core/src/files/pane.rs` | `ui/src/files/mod.rs` (`Files`) |
| proc | `core/src/proc/pane.rs` | `ui/src/proc/mod.rs` (`Processes`) |
| trace | `core/src/trace/pane.rs` | `ui/src/trace/mod.rs` (`ToolTrace`) |

The remaining exceptions, which a reader should know:

- **`core::tools` is not `ui::trace`'s partner by name.** `core/src/tools.rs` is
  the tool *executor* and it owns the `/tools` ROUTE (`dispatch.rs:47`), but it
  hands the rendering to `core/src/trace/pane.rs`. So `ui/src/trace/` (which
  used to be `ui/src/tools.rs`, renamed for F9) pairs with `trace/pane.rs`, and
  `core/src/tools.rs` has no `ui` counterpart at all — nothing mounts an
  executor.
- **`core::agents` has no single `ui` folder.** `core/src/agents/pane.rs` serves
  `/agents` and `/agents/file`; on the `ui` side that fragment is read by
  `ui/src/shell/boot_reads.rs`, edited through `ui/src/authoring/` and shown as
  a panel by `ui/src/board/roster.rs` (which used to be `ui/src/roster.rs`).
- **`core::agents::roster` is not `ui::board::roster`.** The core one is the
  precedence algorithm that decides which copy of a name wins;
  `ui/src/board/roster.rs` is a panel.
- **`core::agents::authoring` is mirrored by `ui/src/authoring/agentfile.rs`**,
  not by `ui/src/authoring/mod.rs` (which is the editor component).

Three `ui` directories have no `core` partner because they are chrome, not
panes: `ui/src/shell/` (nav, status bar, routing), `ui/src/centre/` (the centre
column — this is the old `ui/src/stage.rs`, renamed for F9) and `ui/src/ui/`
(the component primitives). `ui/src/composer/`, `ui/src/settings/`,
`ui/src/gallery/` and `ui/src/authoring/` are likewise page-side only.

`core::board::stage` is a *turn* concept — which part of the turn is running —
not a region of the screen. It lives in `board/` because the board row's live
line is its only reader, and that placement is what keeps it from being confused
with `ui/src/centre/`, which is the centre column and was called `stage.rs`
until F9.
