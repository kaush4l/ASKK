# ADR-003 — Script engine for forged modules

**Status:** Accepted (PROVISIONAL — decided unattended per PROMPT §17 from Spike B + R5 evidence;
human review pending)
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
