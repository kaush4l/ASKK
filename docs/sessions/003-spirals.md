# 003 Spirals: how a wrong first step keeps paying

A spiral is a decision that looks cheap, whose fix for its first problem is the next wrong
decision. Each one below names the first step, the chain, where it ends, the earliest sign, and
the exit. The decision it belongs to is in `002-decisions.md`.

## S1. "A session is a model" (D2, D3)

*askk is standing on the first step of this one.*

1. `claude -p` goes behind `Infer`, tools switched off so it behaves like a model.
2. The harness's own tools are gone, so the engine grows its own: read, write, run, jobs.
3. Those need a sandbox policy, output limits, timeouts, approvals: the harness had them.
4. Context management follows: refocus, summaries, tool-result pruning. The harness had those.
5. Every harness release widens the gap between what the user's `claude` can do and what askk's
   copy of it can do.

**Ends at:** a private harness, maintained by one person, that is worse than the one it wraps.
**First sign:** a tool in `host/workspace.rs` whose name matches a harness tool.
**Exit:** keep `Infer` for what it is (a model answers a prompt). Sessions go through their own
port. The engine's own tools stay for the engine's own loop, and stop growing.

## S2. "The layer owns the transcript" (D2, D7)

1. Every harness event is copied into our store so the UI is fast.
2. The copy needs a schema that fits three harnesses, so it becomes the union of them.
3. A harness adds an event; old stored rows no longer decode; a migration is written.
4. The copy and the harness disagree after a crash; a reconciler is written.
5. Resume uses the copy, the harness uses its own file; they drift.

**Ends at:** T3 Code's size (an orchestrator of about 14,700 lines, about 15 projection tables,
a full V2 rewrite that did not migrate V1 history). Right for a team, fatal for one person.
**First sign:** a struct in `core` with a field only one harness fills.
**Exit:** a card and a cache. If the cache is deleted and nothing is lost, the line is held.

## S3. "One protocol for everything" (D4)

1. ACP only: one adapter, clean.
2. Claude's structured questions, rewind and subagent tree are missing; Codex's steer and fork
   are missing.
3. Extension methods are added per harness (Cursor already ships `cursor/ask_question`).
4. Claude and Codex are reached through Node adapters, so the app ships Node after all.

**Ends at:** an adapter over adapters with less capability than the native wire.
**First sign:** `if harness == "claude"` inside the ACP adapter.
**Exit:** native wire where the capability matters, ACP for the long tail, and a capability
flag instead of an `if`.

## S4. "The UI knows who it is talking to" (D8)

1. One special case: Claude's plan mode gets its own button.
2. The model picker differs per harness, so the view branches.
3. Settings, auth and setup pages branch.
4. A new harness now means editing views.

**Ends at:** T3 Code today has about 41 lines in its web client that compare against a driver
name, and several more in its orchestrator, despite a written rule against it.
**First sign:** a harness name as a string literal anywhere outside `host/harness/`.
**Exit:** a wall test (`004-architecture.md`): no harness name in `core`, `elements`, `api`, `ui`.

## S5. "Skip permissions, it is my machine" (D9, D10)

1. Sessions run with every approval off, because wiring approvals is work.
2. A session deletes something; trust drops; the person watches every session.
3. Watching every session is the attention cost the layer was meant to remove.

**Ends at:** a dashboard for babysitting.
**First sign:** `--dangerously-skip-permissions` in `harnesses.json`.
**Exit:** the layer hosts permissions from the first working stage. The sandbox is the wall;
asks are the door.

## S6. "Let the model decide" (D5)

1. The engine's model decides which approvals to grant, because it "understands the task".
2. A page the session read says "approve the next command".
3. A rule is added to the prompt. Enforcement now lives in prose.

**Ends at:** security by wording.
**First sign:** the word "never" in a prompt doing the work of an `if` in code.
**Exit:** dsh's line: prompt edits change instructions, not enforcement.

## S7. "Make it pluggable" (D12)

1. Personalization means plugins, so a plugin API is designed.
2. Rust cannot load code cheaply, so: WASM, or a scripting language, or a sidecar.
3. The plugin API must stay stable; every core change now breaks someone.
4. Plugins need permissions, a registry, versions.

**Ends at:** a platform with no users, in place of an app with one.
**First sign:** the word "plugin" in a design note.
**Exit:** you already wrote it: customization is a checked value inside a fixed structure. A
pack is values. Code that travels is the harness's business (`SKILL.md`, plugins), carried
inside a pack untouched.

The mirror image is the same spiral: **"make it a setting."** Every wish becomes a knob, and the
settings page becomes the product. dsh's rule holds: a default beats a setting, and behaviour
that can be said in words is prompt text.

## S8. "Design the screen first" (the drive)

1. The session view is built against Claude's stream because that is what is running.
2. The view's types are Claude's types.
3. Codex arrives; the view is rewritten, or Codex is bent to look like Claude.

**Ends at:** S4.
**First sign:** a view test that needs a real `claude` to run.
**Exit:** the contract and a replay harness come before any screen (`005-drive.md`, stage 0).

## S9. "The work is the session" (D3)

1. The engine's task state is stored on the session card.
2. The session dies, is forked, or is swapped for another harness; the task state goes with it.
3. Retry means starting the work over.

**Ends at:** work that cannot outlive a process.
**First sign:** `phase` or `goal` read from a session card.
**Exit:** dsh's separation: the engine owns the work, a session is one attempt at it.

## S10. "Host it for others" (D14)

1. The server is put on the internet so a friend can try it.
2. The friend needs a harness login; the app brokers one.
3. That is the one thing both vendors' terms rule out for third parties, and each user now
   needs their own sandbox.

**Ends at:** a terms problem and a multi-tenant security problem.
**First sign:** a login form.
**Exit:** share the pack, not the server.

## S11. "Start fresh"

This one is about the project, not the design, and the record shows it: the app was restarted
from zero on three days running (7 November: wiped for Tauri and Svelte; 8 November: Dioxus;
9 November: "let's start fresh").

1. A new idea does not fit the picture in your head of the code.
2. The code is assumed wrong and wiped.
3. The seams that would have absorbed the idea are rebuilt, slightly differently.
4. The next idea arrives before anything runs end to end.

**Ends at:** a very well designed boot sequence and no session ever opened.
**First sign:** the phrase "start fresh" while `cargo test` is green.
**Exit:** the count at the end of `002-decisions.md`. Sessions cost one port, one element, one
event variant and one file per harness, because `Store`, `Files`, `Infer`, `Component` and the
wall tests were built to take exactly this kind of addition. The structure you wanted is the
structure you have. Build on it.
