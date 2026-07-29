# Module: module

**One-sentence purpose:** Defines what a module *is* (manifest + logic reference), folds the
append-only registry, generates the affordance section, and supplies the escaping view primitives.

**Invariants upheld:** I8 (registry is a fold of events), I9 (data-first contract: no trait to
bypass, no origin field to filter on), I10 (rollback = append Deactivated; every version kept),
I15 (affordances advertise only what is available).

**Routes served / fragments rendered / sections provided:** Provides the `affordances` Section
(generated); renders no fragments itself but owns the `Fragment` type all rendering flows through.

**Capabilities required:** None — pure data and pure functions.

**Public surface:**
- `Manifest, RouteSpec, SlotSpec, SectionSpec, DataSchema, Tier, Case, Assertion` — the ADR-004
  contract, field for field; public because the forge authors them and storage persists them.
- `Logic` — `BuiltIn` (no fn pointer: the dispatch table lives in ONE core file) | `Script{source}`.
- `RegistryEvent, Registered, Registry` (`new/replay/apply/install/deactivate/reactivate/active/
  resolve_route/get`) — the fold; fields private so origin-filtering is unwritable (I9's structural half).
- `run_install_tests(manifest, logic)` — deny-all declared-case runner (test-before-install).
- `affordances(registry, available)` — the generated account; pure, so de-advertising is instant.
- `view::{Fragment, FragmentBuilder, page_shell}` — escaping-by-construction primitives; the XSS
  audit surface is this one file (ARCHITECTURE §1b).
- `ModuleError` — typed install/registry rejections.

**Depends on / Depended on by:** `kernel`, `context` (Section), `script` (T1 test runs) /
`agent` (forge drafts manifests), `core` (dispatch + boot replay).

**Owns:** the contract, the fold rules (one active version, conflict rejection), affordance
generation, HTML escaping.

**Explicitly does not own:** any specific module's business logic, the interpreter itself, the
tier-0 dispatch table (core's one file), grant policy.

**Failure modes:** route conflict / duplicate version → typed rejection at install, never at
dispatch; failed declared test → install aborts; malformed manifest → `InvalidManifest` before the
module can exist.

**Test contract:** (1) replay(fold events) ≡ incremental applies; (2) install rejects route
conflicts and version reuse; (3) deactivate removes routes+affordances, reactivate restores;
(4) affordances omit modules with unavailable capabilities; (5) builder output is escaped for
hostile text (Spike A's injection case); (6) `run_install_tests` fails a failing case.

**Rejected alternatives:** trait-first contract (ADR-004 Option A — I9 erodes invisibly);
central template crate (ARCHITECTURE §1b — built-ins and forged would render differently).

**Blast radius:** manifest field changes touch storage schema (ADR-005), the forge generator, and
every stored module; registry semantics changes touch boot and dispatch.
