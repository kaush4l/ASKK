# 009 herdr, rex and Terax: three hosts that own other agents' terminals

Shallow clones of 2026-11-10, read as source and docs; nothing installed or run.
"rex" names several projects; two fit and both are read here:
`TristanBietsch/rex` (kanban over PTY sessions) and `T-RexLabs/rex` (ACP portal; its README
links `asabla/rex`). Compare with `007` (design) and `008` (OpenBot gaps).

## 1. What each one is

| | herdr (`herdrdev/herdr`) | rex — kanban (`TristanBietsch/rex`) | rex — portal (`T-RexLabs/rex`) | Terax (`crynta/terax-ai`) |
| --- | --- | --- | --- | --- |
| language | Rust, one binary | Go, `rex` + `rex-daemon` | Go, `rex` + `rex-central` | Tauri 2 + Rust + React |
| reaches a harness by | **owning its PTY** | owning its PTY | **ACP** (`session/new`) | PTY **+ the harness's own hooks** |
| knows the state by | process name + output patterns (`src/detect/manifests`) | adapters read PTY output | ACP events | hooks over a control socket |
| permission asks | sees "blocked", you answer in the pane | `needs_input`, `Reply` intent | not gated (post-event observers only) | **brokers `PermissionRequest`** with allow/deny |
| after a restart | restores layout; resumes agents by their own id/path (`agent_resume.rs`) | live states become `crashed` | runs are a fold over an event log | spaces restore tabs and cwd |
| record | per-pane state | `meta.json` + raw `transcript.log` | append-only SQLite event log = audit log | none of its own |
| agents drive it | yes: CLI + socket API, "wait until another agent is blocked" | scriptable CLI | CLI | spawns Claude Code, sends follow-ups through gated tools |

## 2. What they confirm

- **The harness's conversation is the harness's.** None keeps its own transcript of meaning;
  rex keeps raw bytes for replay only (= `007` §1).
- **A session's states are the same everywhere:** working / blocked / idle / crashed-or-lost.
  herdr's three marks and rex's `queued · working · needs_input · crashed` are `007` §3 under
  other names.
- **Restart means lost, then resume by the harness's own id** (herdr `AgentSessionRef {Id|Path}`,
  rex invariant 5) = `007`'s `lost`.
- **The host is a daemon apart from its window** (rex: "TUI can exit without killing agents";
  herdr: background server). askk's host/UI split already is this.

## 3. What they add

### T1. The Claude permission wire is answered (closes `000`'s unknown and `008` G7)

Terax installs a Claude Code **`PermissionRequest`** hook into `.claude/settings.json`
(`src-tauri/src/modules/agent.rs` ~L85–92). The hook command talks to the app over a control
socket; the app holds the request until the person decides, then the hook prints
`{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior":
"allow"|"deny", "message", "interrupt"}}}` (`terax-control-protocol/src/hook/render.rs`).
A person gets **up to 900 s** (`MAX_DECISION_SECS`); the hook's own timeout is 60 s above that,
so the host always answers first. It caps 16 pending decisions, 4 per pane, and can return one
of Claude's own `permission_suggestions` (the "always allow" Claude offers).
**Take:** this is the stage 1 wire (now in `006`). Ask expiry 900 s → `gone`. Map
`permission_suggestions` onto `008` G2's `always`. Hooks also give `SessionStart`,
`UserPromptSubmit`, `Stop`, `Notification` — the turn boundaries `007` needs for `report` —
without parsing output.

### T2. Install hooks without wrecking the user's settings

Terax edits harness config with a format-preserving JSON editor (`agent_json.rs`: upsert,
remove-matching, prune-empty) and removes only its own groups; styles for Claude, Codex, Gemini.
**Take:** prefer **per-session settings** (`claude --settings <file>`) so nothing global
changes; if a shared file must be edited, own only marked entries and remove them at end.
Test: `installing_hooks_leaves_other_settings_byte_identical`.

### T3. Detect what you did not start

herdr recognises Claude Code, Codex, Cursor, OpenCode, Grok … already running in a pane, by
manifests of process names and output patterns, and marks them blocked/idle.
**Take:** later, an `attach` harness kind: a read-only card for a harness found running, state
from detection, no asks brokered. Fits desk sessions started by hand. After stage 4.

### T4. Agents waiting on agents

herdr's socket API lets one agent spawn panes, prompt another, and wait until it is genuinely
blocked — askk's engine-drives-session (stage 2), offered to any agent.
**Take:** expose envelope `say` + "wait for report" as one MCP tool served by the host, so a
Claude session can hand work to another member through the board. Stage 5+ (needs `008` G5).

### T5. Concurrency cap at spawn

rex acquires a slot before spawning and releases it at end (invariant 6).
**Take:** `sessions.max_live` in config; an envelope that would start one past it stays `new`.
Stage 1.

### T6. One log that is the audit log

rex portal: runs are a fold over an append-only event log; UI, CLI and audit read the same
events; schema additive-only.
**Take:** confirms `008` G3. Make `audit.jsonl` additive-only from line one (a `v` field, never
rename), so it can later be what goal stage is derived from (`007` Yours 4).

### T7. Raw recordings for replay tests

rex keeps raw PTY bytes and classifies from sanitised views.
**Take:** stage 0 recordings under `tests/sessions/<kind>/` are **raw** stream-json plus hook
payloads, never a cleaned form, so a parser change is retested on the original.

## 4. Not for askk

- **PTY ownership as the main seam** (herdr, rex kanban): state is guessed from output; askk's
  port speaks the harness's own wire and hooks. PTY only for T3.
- **A terminal emulator** (Terax, herdr's ghostty-vt). askk's UI is cards and asks.
- **Central sync, ed25519 identity** (rex portal). Many-machines machinery.

## 5. Where each lands in `005`

| stage | add |
| --- | --- |
| 0 | raw recordings incl. hook payloads (T7); additive-only audit schema (T6) |
| 1 | `PermissionRequest` hook wire, 900 s expiry (T1); per-session `--settings` (T2); `max_live` (T5) |
| 2 | `permission_suggestions` → `always` answer (T1 + `008` G2) |
| after 4 | `attach` kind by detection (T3) |
| 5+ | board as an MCP tool for agents (T4) |

## 6. Unknowns

- Whether `claude --settings <file>` merges hooks with the user's or replaces them — check the
  installed CLI before choosing T2's path.
- 900 s is Terax's choice; Claude's own hook-timeout ceiling not confirmed.
- herdr's detection manifests were listed, not read.
- Nothing here was run.
