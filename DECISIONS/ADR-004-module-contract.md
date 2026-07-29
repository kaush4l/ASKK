# ADR-004 — Module contract and registry

**Status:** Proposed (PROVISIONAL)

## Context

Everything the environment can do is a Module (PROMPT §6). I9 demands built-in and forged
modules be **indistinguishable to the system** — and that must hold structurally, not by code
review. A module carries manifest, logic, optional view, optional prompt section (§8.4), and
tests executed before install. The affordance document is generated from the live registry.
Rollback is deletion because a module is data (§7). Related: ADR-003 (script engine) decides
what Tier-1 logic *is*; ADR-006 decides what a capability grant *is*; this ADR decides the
contract and the registry around both.

## Options

**Option A — trait-first.** `trait Module { fn handle(&self, req, ctx) -> Response; … }`.
Built-ins implement it natively; forged modules arrive as data and are wrapped in one adapter
struct that implements the same trait. Registry = `HashMap<ModuleId, Box<dyn Module>>`.
Idiomatic Rust, but uniformity is *aspirational*: built-ins exist as compiled types the rest of
the system can name, import, and call directly, bypassing the registry. One `use my_module::…`
anywhere and I9 is dead silently.

**Option B — data-first.** A module **is a manifest record plus a logic reference**, for
everyone. Built-ins are registered at boot *through the same install path* as forged modules;
their logic reference is an entry in a tier-0 dispatch table (`fn(Request, Ctx) -> Response`)
keyed by module id, populated in exactly one file in `core/`. Forged modules' logic reference is
script source (ADR-003). Dispatch is always: route → registry lookup → manifest → invoke by
tier. No code outside that one dispatch point may call module logic.

## Trade-offs

A gives compile-time typing of built-ins and zero indirection; B costs one table lookup and one
match-on-tier per request. A lets I9 erode invisibly; B makes erosion impossible to write:
there is no manifest field for origin, no registry API that filters by origin, and an
unregistered built-in **does not exist** — no route, no affordance entry, no way to be called.
CI enforcement for B is one grep-shaped check (only `core/dispatch.rs` names built-in handler
fns); for A it is a whole-program call-graph analysis nobody will maintain.

## Decision

**Option B.** The uniformity rule is the load-bearing wall of §6; buy it structurally.

### Manifest (the contract)

```
id, name, version (monotonic), description   — identity; description feeds affordances
capabilities: [CapabilityId]                 — default deny; ADR-006 semantics
routes: [RouteSpec]                          — paths served; registry rejects conflicts
slots: [SlotSpec]                            — dashboard placement (optional)
section: SectionSpec                         — prompt section provided (optional, §8.4 / ADR-009)
schema: DataSchema                           — the module's persisted-data shape (ADR-005)
tier: 0..5                                   — substrate (PROMPT §10)
tests: [Case { request, assertions }]        — executed before install, deny-all ctx
```

### Registry

- **Append-only event log** (I8): `Installed{manifest, logic}`, `Deactivated{id, version}`,
  `Reactivated{id, version}`. The live registry is a fold of the log; every version is kept;
  nothing is destructively overwritten. **Rollback = append `Deactivated` for vN (and
  `Reactivated` for vN-1)** — "deletion" in §7's sense removes the module from existence
  (routes, affordances, sections) without erasing history.
- One active version per module id. Route conflicts rejected at install time.
- Built-ins replay through the same events at boot (generated from the compiled-in set), so the
  log is the single source of truth for *everything* that exists.

### Test-before-install

Declared cases run in a context with **all capabilities denied** plus stub grants the case
declares; any failure aborts install. Built-ins run the identical cases in `cargo test` — same
runner, hosted natively (I3). This is the §7 pipeline's "contract test" phase; the full forge
pipeline (propose → … → announce) is itself a module and is specified in its own module spec,
not here.

### Affordance document

A pure function `affordances(registry, available_capabilities) -> Section`: for each active
manifest whose required capabilities are all currently available (I15), emit id, description,
routes/tools, and capability list. Never hand-written, so it cannot drift; uninstall or
capability loss de-advertises in the same instant. It is itself a section provider — the
registry describing itself through the mechanism it hosts.

## Consequences

- One dispatch point in `core/`; module logic is unreachable except through it. I9 holds by
  construction; the CI check is trivial.
- Built-ins pay the install machinery (manifest authoring, declared tests) — deliberate: it
  keeps the one path honest and forces built-ins to document themselves.
- The registry log is the spine for ADR-005 storage and ADR-007 update/versioning; those ADRs
  consume this event shape.
- Adding a tier later (e.g. Tier-3 WASI) is a new arm in the dispatch match, no contract change.

## Reversal cost

Moderate. Moving to trait-first later is mechanical (wrap the dispatch table in a trait) and
loses no data; the expensive direction is the one we avoided — retrofitting uniformity after
built-ins have leaked into direct calls would be a whole-codebase audit.

## Pending evidence

- **ADR-003 (script engine):** decides the Tier-1 logic-reference format and the ctx binding
  surface; manifest `tests` shape may gain fields to match.
- **spikes/forge (Spike B):** the forged-module round-trip may show the manifest needs
  fields this design missed (e.g. asset references); expect additions, not restructuring.
- **ADR-006:** capability id granularity; this ADR treats `CapabilityId` as opaque.
