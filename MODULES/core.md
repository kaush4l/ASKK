# Module: core

**One-sentence purpose:** Wires the pure crates behind the one seam — `handle(Request) ->
Response` — plus the two dispatch tables, the effect runtime, and boot/migrations.

The effect runtime is two functions and both are small: `pump`
(`crates/core/src/runtime/mod.rs:25`, 10 lines) is the sync thinking half and the only runtime
caller of `agent::step`; `drive` (`crates/core/src/runtime/mod.rs:44-71`, 28 lines) is the async
loop that executes what `pump` described. The "≤40-line effect runtime" this file used to claim
was not true when written — `drive` was 151 lines and flat (CRITIQUE-01 F5) — and is stated here
as a measured fact rather than an aspiration. `scripts/check-size.py --functions` is the check;
neither function is on its report.

**Invariants upheld:** I4 (the seam lives here and only here), I6 (Ctx construction is the grant
enforcement point), I8 (dispatch and pump append every fact), I9 (the ONE dispatch file),
I11 (boot runs the migration ladder).

I9 is upheld by *two* tables, not one file, and a reader should know both:
`dispatch::builtin_entry` (`crates/core/src/dispatch.rs:42`) maps module id → handler, and
`tools::tool_entry` (`crates/core/src/tools.rs:107`) maps tool name → handler. The second one
replaced a four-way fallthrough chain inside `batch.rs` (CRITIQUE-01 F4); it exists because the
awaiting tools must run outside any borrow of `App`, and the append-and-push that makes a call
durable has to be written exactly once.

**Routes served / fragments rendered / sections provided:** Ten built-in modules, all registered
through the normal install path and all reached through `builtin_entry`
(`crates/core/src/dispatch.rs:42-53`): `dashboard` (`GET /`), `status` (`GET /panels/status`),
`chat`, `agents`, `tools`, `board`, `space`, `terminal`, `files`, `processes`. There is no
`/system/…` namespace. Each one's route set is declared in its own `manifest()`; each serves an
HTML fragment folded out of the log (I8).

**Capabilities required:** All ports, by construction — it is the only crate that executes effects.

**Public surface:**
- `handle(&mut App, Request) -> Response` — the §3 seam; sync BY DESIGN (reads hit in-memory log
  projections; writes leave as Effects) — an async route here means state escaped the log.
- `App`, `Ports`, `ENTRY_AGENT` — the aggregate and the `Rc<dyn …>` ports. `Ports`
  (`crates/core/src/app.rs:27-47`) now carries **nine**, not the five frozen at G3: the original
  `model`/`store`/`net`/`clock`/`rng`, plus `spaces` (`KvStore`), `workspace` (`WorkspacePort`)
  and `agents` (`AgentPort`). `Rc`, not `Box`, so a `'static` future can be built from a clone
  without holding the app across an await.
- `boot(Ports)`, `migrate(store, from)`, `schema_version()` — ADR-005/007 gate: snapshot-first,
  forward-only, refuse-downgrade.
- `dispatch(app, req)`, `builtin_entry(id)`, `BuiltinHandler`, `Ctx`, `KvHandle` — ADR-004
  Option B: route → registry → tier match; `Ctx` fields are `Option` (ungranted = absent);
  built-ins are plain fn pointers so no state can hide in one.
- `execute_port_effect(ports, effect)`, `pump(app, event)`, `drive(app)` — the runtime.
  `execute_port_effect` is named for what it does — it executes only the PORT half of the effect
  set; a tool call is routed by `tools::tool_entry` and run by `batch::invoke` instead. It returns
  a `'static` future built from Rc-cloned ports. `pump`
  is `step`'s only runtime caller, so the thinking/doing wall has one door.
- `answer(app)`, `agent_names(app)`, `agent_files(app)`, `log_kinds(app)`, `last_failure(app)` —
  folds over the log for callers that need a value rather than a fragment (`crates/core/src/lib.rs:49-104`).
- `report_agent`, `report_authored`, `report_activity`, `report_memory`, `restore_log`, `window` —
  the door a Worker's facts come in through, called by `adapters_web`'s seam wrapper before every
  `handle` (`crates/adapters_web/src/seam.rs:27-47`).
- `CoreError` — wiring failures, each wrapped error keeping its own type.

**Depends on / Depended on by:** all L0–L1 crates; dev-dep `adapters_test` / `adapters_web`
(the composition root drives it).

**Owns:** wiring, routing dispatch, the two dispatch tables (`dispatch::builtin_entry` for
modules, `tools::tool_entry` for tools), effect execution, the boot sequence, and the built-in
modules themselves — which since the restructure live one subject per directory under
`crates/core/src`. `crates/core/src/README.md` is the map of that tree and is the file to read
before adding to it.

**Explicitly does not own:** domain logic, direct Web APIs, anything an adapter should own, the
content of any module.

**Failure modes:** schema newer than code → refuse boot, offer export; effect against a vanished
target → `DanglingReference` as a fact; port failure → typed error becomes an Event, the machine
decides.

**Test contract:** (1) `handle(get("/system/version"))` under `cargo test` with `adapters_test`
ports — the §3 promise; (2) unknown route → 404 fragment; (3) pump: scripted model drives
Work→Verify with every transition logged; (4) boot replays registry events and registers
built-ins through install; (5) migration ladder runs forward and refuses backward.

**Rejected alternatives:** `handle` as a method on a global singleton (untestable second app);
fine-grained effects in the runtime (ARCHITECTURE §1c mitigation: coarse effects, one loop).

**Blast radius:** the seam signature is the system's one entry — changing it touches every
`ui` event handler, every test, and every module's invocation; that is why it is frozen first.

**G4 status (walking skeleton — PROVISIONAL interface changes):** `pump` became SYNC
(`(App, Event) -> Vec<Effect>`) and `execute_port_effect` returns a `'static` future from
Rc-cloned ports; the new `drive(Rc<RefCell<App>>)` loop replaces the frozen async pump
— holding `&mut App` across a model await would wedge every seam round-trip (the chat
poll) for the whole fetch. `Ports` fields are `Rc`, not `Box`, for the same reason.
`Ctx.emit` is a drained buffer of `EventKind` (not a Custom-only closure) and `Ctx`
gained read-only `panels`/`recent` projections pending the real capability story.
Test contract as implemented (`crates/core/tests/skeleton.rs`): (1) dashboard composes
the slotted panel, 404 is a fragment (`dashboard_panel_and_404`); (2) full chat turn through the
seam vs a scripted model (`chat_turn_through_seam_with_scripted_model`); (3) model failure renders
the typed error fragment (`model_failure_renders_typed_error_fragment`); (4) events persist
through StorePort and replay across boot (`events_persist_and_replay_across_boot`); (5) newer
schema refuses boot. `skeleton.rs` is no longer the whole story: `crates/core/tests/` now holds
~50 files, one per increment or critique round, and they are the executable form of everything
below the G4 line.
