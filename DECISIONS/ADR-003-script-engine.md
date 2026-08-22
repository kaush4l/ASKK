# ADR-003 — Script engine for forged modules

**Status:** Accepted, then **UNBUILT (increment 09)** — the engine choice stands, the `script` crate
that was to hold it does not. See "Unbuilt, and what survives" at the foot of this file.
(PROVISIONAL — decided unattended per PROMPT §17 from Spike B + R5 evidence; human review pending)
**Evidence:** `spikes/forge/` (running code), `docs/research/script-engine.md` (measured bake-off)

## Context

§7 L2: the agent authors module logic in an interpreter embedded in the Wasm core — zero ambient
capability, per-capability grants (I6), runs identically under host `cargo test` (I3).

## Options (all measured compiling to wasm32-unknown-unknown, opt-level=z + lto + wasm-opt)

| Engine | In-core build | Size delta (opt) | Notes |
|---|---|---|---|
| **Rhai 1.25** | PASS | **1.30 MB** | pure Rust; default-deny by construction; per-op fuel, call-depth, string/array caps; no known CVE/RUSTSEC |
| Koto 0.16 | PASS | 1.12 MB | smaller, but younger, coarser limits, thinner serde story |
| Boa 0.21 (JS) | PASS | 2.53 MB | the sleeper: in-core JS is size-viable; loses on limit granularity + engine surface |
| Steel 0.8 | PASS | 2.42 MB | Scheme — worst LLM-authoring fit |
| QuickJS (rquickjs) | **FAIL** in-core | 0.72 MB as wasip1 | C engine; viable only as a Tier 3 WASI module (Javy pattern) |
| Lua (mlua) | **FAIL** | — | lua-src refuses the target |

## Decision

**Rhai**, in the `script` crate. Spike B proved the whole §6/§7 contract with it: module loaded
from a data string, route served, fragment rendered, default-deny falling out of Rhai's
zero-ambient design, manifest-as-upper-bound = one set intersection, typed denial errors, 6/6
host tests, 452 KB spike wasm.

**Strongest argument against (stated per §1 rule 2):** LLMs write JavaScript far better than
Rhai, and every forged module is model-authored. This is real and may dominate in practice.

Two structural points override it for v1: (a) C engines in-core would share linear memory with
the kernel, and quickjs-ng has 2024–2026 heap-overflow/UAF CVEs reachable from pure JS input —
in-core JS-via-C is disqualified independent of the toolchain wall; (b) Rhai's per-operation
fuel/depth/size limits map directly onto I6/I7 with no extra machinery.

**Named reversal trigger:** if the forge pipeline shows sustained static-validate failures on
model-authored Rhai after a syntax-primer section is added to the paper, adopt QuickJS as a
**Tier 3 WASI module** (never in-core), or promote Boa if in-core JS is required.

## Consequences

~1.3 MB wasm budget; a Rhai syntax primer becomes part of the forge pipeline's generate-phase
context; forged-module tests run on the host unchanged.

## Reversal cost

Medium. The capability-binding surface (per-module engine + closures, Spike B) is the contract;
swapping engines re-implements the binding table but touches no manifest, registry, or gate
logic. The Tier 3 escape hatch requires the WASI substrate (§10) which is planned regardless.

## Unbuilt, and what survives (increment 09, 2026-08-22)

`crates/script` is deleted. This ADR is not reversed — it was never executed. The crate reached
G3's interface freeze and stopped there: at deletion it was 155 lines carrying eight `todo!("G4")`
bodies, zero tests, and zero construction sites for any `ScriptError` variant. G4 built a walking
skeleton of the *chat* seam instead, and the eighteen increments since built an agent on top of it.
Nothing ever called `compile`, `call_handle`, or `effective_grants`. `crates/agent/src/forge.rs`,
the pipeline that would have been this engine's only caller, is deleted in the same commit for the
same reason — two `todo!("G4")` bodies and no route in `builtin_entry`.

**Why deletion and not waiting.** A frozen interface costs nothing while it is only read. This one
was not only read: `crates/core/src/error.rs:13` `use script::ScriptError;` and an unused
`script = { path = "../script" }` in `crates/module/Cargo.toml` put `rhai` in the shipped bundle's
dependency closure — the ~1.3 MB this ADR budgeted, being paid, for a feature that does not run.
An unbuilt decision that costs bytes is a bill, not a plan.

**What survives, and it is the whole ADR minus the crate.** The bake-off table above is measured
evidence and does not decay; Spike B is running code in `spikes/forge/`; the argument against
(models write JavaScript better than Rhai) and the two structural points that override it are
unaffected by whether a crate exists. The named reversal trigger stands. **The decision to reach
for when the forge is built is still Rhai, and the reversal cost is unchanged** — "medium, because
the binding surface is the contract" was always about re-implementing a binding table, and there is
now simply no table to start from. Rebuilding is `cargo new crates/script`, restoring `kernel` and
`rhai` as its dependencies, and porting Spike B, which is where the real content always lived. The
frozen signatures are recoverable verbatim from git history at `ab3e14d`.

**What this does NOT decide.** Not that HARNESS will never forge modules — §7 L2 is unchanged and
`ADR-004`'s tier-1 logic reference still names a script source. It decides that the tier-1 substrate
does not ship until something calls it, and that `I9`'s uniform-modules promise is kept by the
built-in path alone until then.
