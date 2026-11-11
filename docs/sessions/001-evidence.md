# 001 Evidence: what the others built, and what each design is shouting

Gathered 2026-11-10. Every claim says how it is known:

- **source**: read in the project's open source at that day's HEAD.
- **shipped**: read from the installed app with REA (`rea-agents` 6.7.0, static only: nothing
  was launched, attached to or captured; no credential was opened).
- **local**: a `--help`, a generated schema, or a directory listing (names only) on this Mac.
- **docs**: the vendor's documentation.
- **inferred**: a reading of names and shapes, not an observation.

## How it was gathered

| what | how |
| --- | --- |
| REA | `npm install --global rea-agents`, then `rea setup --client claude_code` (adds the `rea` MCP entry to `~/.claude.json`, backup beside it, and the skill at `~/.claude/skills/reverse-engineer-anything`). The MCP tools appear after Claude Code restarts; this pass used the CLI. |
| Claude desktop 4.23118.1, T3 Code 0.1.8, Muse 11.1 | `rea analyze-javascript-application`, `inspect-electron-fuses`, `inspect-macho`, inventories, bounded text search of extracted bundles |
| T3 Code | also its source (`pingdotgg/t3code` at `6c9adfb`) |
| dsh-superagent | all nine docs, about 40 source files, and the DSH install already on this Mac (`~/.dsh`) |
| Claude Code 2.1.321, Codex 0.159.1, Gemini 0.62.0, pi 0.79.3 | local help and Codex's generated JSON schema |
| Grok, Muse Code, ACP | vendor docs only: not installed here |

Limits: REA's graph of Claude's 7 MB main bundle hit its node cap, so Claude's IPC names, flags
and control subtypes come from text search (a string present is not a string used). Muse had no
disassembler behind it: its findings are strings and inventory. No runtime evidence anywhere.

## The five, one table

| | where the agent's loop runs | how the app reaches it | what the app stores | approvals | sharing unit |
| --- | --- | --- | --- | --- | --- |
| **Claude desktop** | a separately installed `claude` CLI (host, VM or over SSH) | the Agent SDK inside the main process spawns it: stream-json plus a control protocol (shipped) | metadata files per session; the transcript stays in the CLI's `~/.claude/projects` (inferred) | `can_use_tool` → a host round trip (shipped names) | plugins, skills, marketplaces |
| **T3 Code** | whichever harness the user has | one Node server beside the window; one driver per harness (source, shipped) | everything: events, receipts, an outbox and about 15 projections in SQLite (source) | durable request rows that state how they can be answered (source) | none found |
| **dsh-superagent** | DSH, in a session per work item | DSH's plugin API: queue, steer, inject (source) | triggers, threads, tickets, decisions, effects in one SQLite file; transcripts stay in DSH (source) | a gate in code; one structured question at a time (source) | a bundle: code + prompts + skills |
| **Muse app** | Meta's cloud, in a VM per user (inferred) | an encrypted socket; the Mac is a node that lends its screen, files and calendar (shipped strings) | almost nothing local (local) | the app shows an approval sheet (shipped names) | none visible |
| **Grok Bot** | xAI's cloud | chat, voice, Slack, X: nothing a program can drive (docs) | — | — | — |

Two names needed untangling. **Muse** on this Mac is the consumer assistant (`com.meta.endo`); the
thing T3 Code drives is **Muse Code**, a separate CLI with its own SDK, not installed here.
**Grok Bot** is a cloud teammate product; the thing with sessions is **Grok Build** (`grok agent
stdio`, which speaks ACP). Only Muse Code and Grok Build are harnesses.

## Claude Code and its desktop app

| finding | how known |
| --- | --- |
| A long-lived session is `claude -p --input-format stream-json --output-format stream-json --verbose`, one JSON object per line each way | local, docs |
| Inside the same stream runs a control protocol: `control_request` / `control_response` with subtypes such as `initialize`, `interrupt`, `can_use_tool`, `set_permission_mode`, `set_model`, `rewind_files` | docs (SDK source), shipped |
| A permission request and a structured question arrive the same way (`can_use_tool`); the host answers allow, allow-with-changes, or deny. With no host, what would prompt is denied | docs |
| Resume, fork and fixed ids are flags: `--resume`, `--fork-session`, `--session-id` | local |
| Transcripts: `~/.claude/projects/<folder>/<id>.jsonl`. Live sessions: `~/.claude/sessions/<pid>.json`. The format is not documented | local |
| There is no Rust SDK; both official SDKs spawn the CLI, so a Rust host speaks the lines itself | docs |
| The desktop app holds no agent loop. It embeds the SDK, points it at a `claude` binary it keeps under Application Support, and swaps only *how the process is started* for host, VM and SSH | shipped |
| It gives sessions its own abilities as MCP servers (session, view, window, scheduled tasks, terminal) | shipped names |
| About 27 named worker processes (git, file index, transcript search, worktree copy) | shipped names |
| Its fuses are hardened: no run-as-node, no inspect, ASAR integrity on | shipped |

**What it is shouting.** The vendor's own desktop app is a layer over the vendor's own CLI,
through a wire that is public. The control protocol exists for one reason: so that something
else can be the face and the permission desk. And it keeps cards, not transcripts.

## Codex

| finding | how known |
| --- | --- |
| `codex app-server`: JSON-RPC over stdio; one server, many threads | local, docs |
| The model is thread → turn → item, each with started / completed and deltas | local (schema) |
| Approvals are requests *from* the server (`item/commandExecution/requestApproval`, `…/fileChange/…`, `item/tool/requestUserInput`) | local (schema) |
| `turn/steer` (say something mid-turn), `thread/fork`, `thread/list`, `thread/read` (read a stored thread without resuming it) | local (schema) |
| `codex app-server generate-json-schema` writes the whole protocol as types | local |
| `codex mcp-server` is gone from this version | local |
| Its docs say app-server login was never permitted for commercial or hosted services | docs |

**What it is shouting.** It ships a schema generator for its own wire. That is an invitation to
be wrapped, and thread / turn / item is the shape every other harness can be folded into.

## ACP (Agent Client Protocol)

`session/new`, `session/prompt`, `session/cancel`; the agent answers with `session/update`
(message chunks, thoughts, tool calls and their updates, a plan) and asks with
`session/request_permission`. Resume, list and load are optional capabilities. Spoken natively by
Gemini (local), Grok Build, Cursor, OpenCode, Copilot and others (docs); Claude and Codex only
through Node adapters. A Rust crate exists (`agent-client-protocol`).

**What it is shouting.** A dozen vendors agreed on the smallest contract a layer needs: prompt,
update, permission, cancel. Everything beyond that is a capability someone may not have.

## T3 Code

| finding | how known |
| --- | --- |
| Layout: `packages/contracts` (the wire, nothing else) ← `provider-core` (the adapter interface) ← one package per harness ← `apps/server`; web, desktop and mobile reach the server only over the wire | source |
| The adapter interface is a session runtime: an event stream plus `startTurn`, `steerTurn`, `interruptTurn`, `respondToRuntimeRequest`, `resumeThread`, `forkThread`, `rollbackThread`, `readThreadSnapshot` | source |
| Adapters emit whole normalized entities with app ids already given, not raw deltas | source |
| Capabilities are twelve groups of booleans; a missing one falls back by stated policy, never by imitation | source |
| "Provider ids are evidence. App ids are identity." A native id carries a strength: strong, weak or none | source |
| A command becomes events + projections + a receipt + outbox effects in one SQLite transaction; a worker runs the effects after commit | source |
| It runs no agent loop and adds no tools of its own beyond one optional MCP server per thread; its docs say plainly it is not a harness | source |
| It scans and imports sessions other tools started (Claude, Codex, pi) | source |
| The desktop app is a shell: it starts its own Electron binary as Node to run the bundled server | shipped |
| Size: the three main adapters are 8,000 to 12,500 lines each; the orchestrator is about 14,700; V2 was a rewrite that did not carry V1 history over | source |
| Leaks: driver names compared in the orchestrator and in about 41 lines of the web client, against its own rule | source |
| No way to share or compose a setup | source (absence) |

**What it is shouting.** Its own rule, in its `AGENTS.md`: complexity belongs at the adapter
boundary, orchestration stays pure, the UI stays dumb. The folder names say the same thing
before any file is opened. And its size says what happens when the layer also owns the history.

## dsh-superagent and DSH

| finding | how known |
| --- | --- |
| The principle: take as little of a person's attention as possible, give as much value as possible. Every message, setting and panel element is costed against it | source |
| Flow: source → trigger → thread → eval → decision → ticket → assignment → executor; replies return through a channel | source |
| A ticket (the work) is separate from a session (who does it). A ticket has several assignments over time; retry keeps the session, directory and branch | source |
| Code decides everything structural (intake, gate, slots, order, retries, endings). The model decides meaning only, through tools | source |
| The app runs no loop of its own: DSH runs it. The app delivers messages and reacts to status | source |
| Side effects are stored first and done after commit | source |
| `src/core` has no I/O. Six ports. Callers get a role-scoped slice of the engine, not the engine | source |
| A source is a *kind* (code) and an *instance* (configuration); a kind's declared fields generate its settings form | source |
| Stage (needs a person, working, idle) is derived, never stored. The panel lists what waits for a person first; health takes no space | source |
| Every prompt part can be overridden; an override records its base, so an upgrade can say "the default changed" | source |
| DSH itself is about 200 plugins named `dsh-<capability>` and `dsh-<capability>-<how>` (`dsh-fs`, `dsh-fs-local`, `dsh-fs-sandbox`; `dsh-session-persistence`, `dsh-session-persistence-jsonl`). A profile is a list of bundles plus one patch file | local (`~/.dsh/profiles`) |
| Admitted limits: a prototype; nothing deletes old records; workers run with full access as the operator; generic modules name GitHub and Feishu | source |

**What it is shouting.** The package names are the architecture: a contract, then a dash, then
one way of doing it. The domain says the work outlives whoever is doing it. And the philosophy
says the product is not the agent: it is the person's attention, spent only where needed.

What does not transfer to one person at their own desk: allowed lists, admission tables,
strength, mandates and their revalidation, a model as router, channels and acknowledgements.
Those answer "many strangers talk to one agent". Here one known person does.

## askk, today

| finding | how known |
| --- | --- |
| Six folders, dependencies pointing inward, kept by tests in `src/structure.rs` | source |
| Three ports already: `Store` (state), `Files` (the workspace), `Infer` (a model). Each has its doing in `host/` | source |
| A component is behaviour + config + state + UI; state changes only in `on(Event)`; saved as a `Spec` | source |
| The loop's stages are fixed in code; which of them an engine runs is a checked list | source |
| `claude` is used as a model: one prompt in, one text out, tools off, no session kept | `defaults/models.json` |
| The engine has grown its own file, command and job tools | `host/workspace.rs` |
| There is an Asks page, a Dock badge that counts what waits, a change feed, templates, and `export()` of the whole world to one file | source |
| A new default inside an existing folder never arrives, because seeding copies | `docs/structure.md`, known limits |
| 161 tests pass | local, 2026-11-10 |

**What it is shouting.** Three ports, each a noun in `core/` with its verb in `host/`. The
fourth is missing and its place is obvious. The Asks page, the waiting badge and the engine
that "never does the work" were built for someone else to do the work. The one thing pointing
the wrong way: the only road to Claude Code today is as a model, with its tools switched off.

## The same answer, five times

| each of them… | Claude desktop | T3 Code | dsh | ACP | askk |
| --- | --- | --- | --- | --- | --- |
| keeps the loop out of the window | SDK → CLI | server → drivers | DSH | agent process | host |
| has one typed seam to the harness | control protocol | adapter interface | executor port | the protocol | **missing** |
| streams whole, typed events back | `onEvent` | entity updates | session events | `session/update` | change feed |
| makes approval a round trip to the person | `can_use_tool` | runtime request | attention | `request_permission` | Asks page (notes only, today) |
| treats the session id as the unit, the transport as a detail | swaps the spawn | swaps the driver | swaps the executor | swaps the agent | — |
| lends its abilities to the session as tools | host MCP servers | one MCP server | six app tools | `fs/*`, `terminal/*` | — |
