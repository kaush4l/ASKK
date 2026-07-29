# Module: core

**One-sentence purpose:** Wires the pure crates behind the one seam — `handle(Request) ->
Response` — plus the single dispatch point, the ≤40-line effect runtime, and boot/migrations.

**Invariants upheld:** I4 (the seam lives here and only here), I6 (Ctx construction is the grant
enforcement point), I8 (dispatch and pump append every fact), I9 (the ONE dispatch file),
I11 (boot runs the migration ladder).

**Routes served / fragments rendered / sections provided:** System routes only (`/system/version`
etc.) as built-in modules registered through the normal install path.

**Capabilities required:** All ports, by construction — it is the only crate that executes effects.

**Public surface:**
- `handle(&mut App, Request) -> Response` — the §3 seam; sync BY DESIGN (reads hit in-memory log
  projections; writes leave as Effects) — an async route here means state escaped the log.
- `App`, `Ports` — the aggregate and the five `dyn` ports; fields private so the seam, pump, and
  boot are the only doors.
- `boot(Ports)`, `migrate(store, from)`, `schema_version()` — ADR-005/007 gate: snapshot-first,
  forward-only, refuse-downgrade.
- `dispatch(app, req)`, `builtin_entry(id)`, `BuiltinHandler`, `Ctx`, `KvHandle` — ADR-004
  Option B: route → registry → tier match; `Ctx` fields are `Option` (ungranted = absent);
  built-ins are plain fn pointers so no state can hide in one.
- `execute_effect(ports, effect)`, `pump(app, event)` — the runtime loop; `pump` is `step`'s only
  runtime caller, so the thinking/doing wall has one door.
- `CoreError` — wiring failures, each wrapped error keeping its own type.

**Depends on / Depended on by:** all L0–L1 crates; dev-dep `adapters_test` / `adapters_web`
(the composition root drives it).

**Owns:** wiring, routing dispatch, the tier-0 dispatch table (one file), effect execution,
the boot sequence.

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

**Blast radius:** the seam signature is the system's one entry — changing it touches the
transport, every test, and every module's invocation; that is why it is frozen first.

**G4 status (walking skeleton — PROVISIONAL interface changes):** `pump` became SYNC
(`(App, Event) -> Vec<Effect>`) and `execute_effect` returns a `'static` future from
Rc-cloned ports; the new `drive(Rc<RefCell<App>>)` loop replaces the frozen async pump
— holding `&mut App` across a model await would wedge every seam round-trip (the chat
poll) for the whole fetch. `Ports` fields are `Rc`, not `Box`, for the same reason.
`Ctx.emit` is a drained buffer of `EventKind` (not a Custom-only closure) and `Ctx`
gained read-only `panels`/`recent` projections pending the real capability story.
Test contract as implemented (crates/core/tests/skeleton.rs): (1) dashboard composes
the slotted panel, 404 is a fragment; (2) full chat turn through the seam vs a
scripted model; (3) model failure renders the typed error fragment; (4) events persist
through StorePort and replay across boot; (5) newer schema refuses boot. The scripted
Work→Verify walk arrives with tool phases (G5).
