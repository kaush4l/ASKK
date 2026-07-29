# Spike B — forged module round-trip

Question: are PROMPT §6 (module system) and §7 (L2 scripted modules via Rhai)
buildable? A module whose logic is a **Rhai source string** (data, not
compiled in) must register into a route table at runtime, serve a route,
render an HTML fragment, and live under default-deny capabilities.

Run: `cargo test` (native; the tests are the contract).
Wasm check: `cargo build --target wasm32-unknown-unknown --release`.

## Verdict per claim

| Claim | Result | Evidence |
|---|---|---|
| Module loads from a source string and serves its route at runtime | **WORKED** | `tests/roundtrip.rs::loads_from_string_and_serves_route` — `Host::register(Module { script: "..." })` then `handle("/panels/demo")` → `Ok`; unknown path → typed `RouteNotFound` |
| Dispatch renders the expected HTML fragment | **WORKED** | `renders_expected_fragment_via_granted_capability` — exact match on `<div id="demo">tick 1700000000</div>` |
| Ungranted capability → typed error, no panic, no silent success | **WORKED** | `ungranted_capability_is_typed_denial` — declared-but-not-granted `kv_get` → `ForgeError::CapabilityDenied { capability: KvGet }`. Denial is recovered from a typed marker (`Denied`) inside rhai's error, not by string-matching |
| Exactly one granted capability works, deterministically | **WORKED** | `clock_now()` returns the value injected at `Host::new` (1700000000), asserted byte-for-byte in the fragment |
| Undeclared-in-manifest capability denied even though the host could provide it | **WORKED** | `undeclared_capability_denied_despite_host_grant` — effective grants = declared ∩ host-granted, so the manifest is an upper bound, never a grant |
| Runaway script cannot hang the host | **WORKED** | `runaway_script_hits_operation_limit` — `fn handle() { loop {} }` stops at the operation cap and surfaces as `ForgeError::Script` |
| Registering onto an occupied route is a typed conflict, not a silent overwrite | **WORKED** | `duplicate_route_is_typed_conflict` → `ForgeError::RouteConflict` |
| Compiles to wasm32-unknown-unknown | **WORKED** | see below |

All 6 tests pass (`cargo test`: 6 passed, 0 failed); clippy `-D warnings`
clean. No claim failed or partial.

## Rhai engine limits set (and proven)

Set in `Host::build_engine` (rhai builtins, not hand-rolled):

- `set_max_operations(100_000)` — test-proven against `loop {}`
- `set_max_call_levels(32)`
- `set_max_expr_depths(64, 64)`
- `set_max_string_size(64 KiB)`
- `set_max_array_size(1_000)` / `set_max_map_size(1_000)`

Default deny needs no denylist: rhai exposes **no** fs/net/env/process to
scripts. The script's entire world is the two registered capability
functions, and the ungranted one is registered as a denier.

## Wasm feasibility (feeds ADR-003)

`cargo build --target wasm32-unknown-unknown --release` — **success**, no
feature juggling needed.

- rhai **1.25.1**, features `std + no_float + only_i64` (no default features)
- `forge_spike.wasm` (cdylib, release, no wasm-opt): **463,160 bytes (~452 KB)**

So the L2 interpreter costs roughly ~450 KB of the core's wasm budget before
wasm-opt/gzip — acceptable for a one-time-cached static asset.

## Design notes / limits of the spike

- One `Engine` per module, capability grants baked into the registered
  closures at `register` time. Simple and airtight at this scale; a shared
  engine with per-call context is an optimization to measure later.
- `kv_get` returns a fixed stub (`kv:<key>`); a real store is another spike.
- `handle` here takes only a path; the full `Request`/`Response` seam (§3)
  is Spike/unit territory elsewhere — nothing in this design blocks it.
