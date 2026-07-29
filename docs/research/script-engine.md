# R5 — Script-engine bake-off for the L2 interpreter

> Status: **research input to ADR-003** (coordinator writes the ADR; this doc is evidence).
> Scope: the embedded interpreter of PROMPT §7 L2 / §10 Tier 1 — the substrate for
> agent-authored ("forged") modules inside the Rust→wasm32-unknown-unknown core.
> Every claim is tagged **true** (measured or verified), **uncertain** (best knowledge,
> not verified here), or **constrains** (a hard limit the architecture must absorb).

## 0. Method

Probe crates built OUTSIDE the repo (`/tmp` scratchpad, never committed), 2026-07-29,
Rust 1.96.0, `wasm-opt` 131. Each probe is a `cdylib` exporting one function that
constructs the engine, registers or calls a host function, and evals a script — so the
linker cannot strip the engine. Profile: `opt-level = "z"`, `lto = true`,
`codegen-units = 1`, `panic = "abort"`. Sizes are the whole `.wasm` file (`wc -c`),
raw and after `wasm-opt -Oz`. Dependency versions are whatever `cargo add` resolved
that day — recorded per row.

## 1. Does it compile to wasm32-unknown-unknown? Measured. **[headline]**

| Probe | Version | Builds? | .wasm raw | `wasm-opt -Oz` | Delta vs baseline (opt) |
|---|---|---|---|---|---|
| empty `cdylib` baseline | — | yes | 392 B | 326 B | — |
| **Rhai** | 1.25.1 | **yes**, with one documented flag (below) | 1,953,910 B | 1,301,448 B | **~1.30 MB** |
| **Koto** | 0.16.1 | **yes**, out of the box | 1,562,584 B | 1,123,360 B | **~1.12 MB** |
| **Steel** (`steel-core`) | 0.8.2 | **yes**, out of the box | 3,309,584 B | 2,423,565 B | **~2.42 MB** |
| **Boa** (`boa_engine`) | 0.21.1 | **yes**, same flag as Rhai | 3,430,078 B | 2,534,967 B | **~2.53 MB** |
| **QuickJS** (rquickjs) | 0.12.2 | **no** | — | — | — |
| **Lua** (mlua, `lua54,vendored`) | 0.12.0 | **no** | — | — | — |

Build notes, all **true** (logs kept in the scratchpad):

- **Rhai and Boa share one out-of-box failure that is not theirs:** transitive
  `getrandom 0.3` refuses wasm32-unknown-unknown without opting into a backend.
  Fix is documented and mechanical — depend on `getrandom = { version = "0.3",
  features = ["wasm_js"] }` and build with
  `RUSTFLAGS='--cfg getrandom_backend="wasm_js"'`. Any wasm project (including
  HARNESS's core) hits this once, globally, regardless of engine choice. Not a
  differentiator; recorded so ADR-003 doesn't rediscover it. **constrains** only in
  the trivial sense that the build recipe must carry the cfg.
- **rquickjs fails at bindgen**: `fatal error: 'stdio.h' file not found` — QuickJS is
  C and wasm32-unknown-unknown has **no libc, no sysroot**. This is the predicted
  C-in-wasm toolchain wall, hit exactly where expected. rquickjs upstream targets
  wasm via **WASI + wasi-sdk**, not unknown-unknown. `quickjs-rusty` wraps the same
  C core and inherits the same wall (**uncertain** — not probed separately; same
  `*-sys` build model). **constrains**: QuickJS cannot live *inside* the HARNESS
  core wasm module. It could only ever be a **Tier 3 WASI module** (PROMPT §10) — a separate
  instance behind a message boundary. That route was probed too and is **true, measured**:
  the same rquickjs probe builds for `wasm32-wasip1` on this machine at **721,711 B
  raw** — notably *smaller than Rhai in-core*. Shopify's Javy ships QuickJS exactly
  this way, which corroborates it as a production pattern.
- **mlua is unambiguous**: `lua-src` build script panics with *"don't know how to
  build Lua for wasm32-unknown-unknown"*. Same C wall, stated by the vendor. The
  `wasm32-wasip1` build was probed as well and **also failed** on this machine
  (clang errors compiling `lauxlib.c` under lua-src 550.1.1's wasi flags).
  **constrains**: Lua is out in-core, and its Tier 3 route is not free either.

The size stakes: HARNESS ships to phones; the whole core should stay in single-digit
MB. Rhai's ~1.3 MB and Koto's ~1.1 MB are affordable one-time, cached costs. Steel
(~2.4 MB) and Boa (~2.5 MB) are tolerable but roughly double Rhai — and Boa at 2.5 MB
is a genuine surprise worth flagging: **in-core JS is size-viable**, which makes the
argument against it rest on engine surface and limits, not bytes (below).

## 2. Sandboxing by construction

The decisive structural fact first: **any C engine compiled into the same wasm
instance as the Rust core shares one linear memory with it.** Wasm sandboxes the
*instance* from the host; it does nothing *inside* the instance. A heap overflow in a
C interpreter is free to corrupt the Rust core's state — the event log, capability
tables, everything. This is not hypothetical for QuickJS: heap overflows reachable
from pure JS input were published against quickjs-ng ≤0.11.0 in 2026
(CVE-2026-0822, CVE-2026-1144 use-after-free, CVE-2026-1145; also CVE-2024-13903
against ≤0.8.0) — **true**, see sources at the end. Running QuickJS as a separate
WASI instance (Tier 3) restores the boundary, at the price of instance spin-up,
serialization at the boundary, and a second artifact to ship.

Pure-Rust engines get the opposite default: memory-safety bugs surface as `Err` or
panic, not silent corruption. A panic under `panic = "abort"` kills the whole core
instance — a real DoS lever — so whatever engine is chosen, the module runner needs a
recovery story (worker-hosted execution for untrusted-heavy work, or
`panic = "unwind"` + `catch_unwind` at the eval boundary). **constrains**, applies
to every candidate.

Per engine:

- **Rhai — sandboxed by construction, and it is the project's stated design goal.**
  No filesystem, network, env, or clock unless the host registers a function for it —
  zero ambient capability, which is precisely I6 (default deny). First-class limits:
  `max_operations` (fuel), `max_call_levels`, `max_expr_depths` (parser bomb
  protection), `max_string_size` / `max_array_size` / `max_map_size` (memory caps),
  `on_progress` for cooperative interruption, `Engine::new_raw` to start from an
  empty prelude. The docs explicitly target "untrusted third-party user-land
  scripts". No RUSTSEC advisory or CVE found for Rhai (**true** — searched
  2026-07-29; absence of advisories is weaker evidence than presence, noted).
- **Koto** — pure Rust; extra capabilities (json, regex, etc.) live in separate lib
  crates, but the core prelude ships `io`/`os` modules that would have to be actively
  stripped rather than being absent (**uncertain** on how cleanly). And **no
  fuel/operation limit mechanism equivalent to Rhai's** as far as could be
  established (**uncertain**);
  a hostile `loop {}` would need a Worker-level watchdog instead. That pushes a
  by-construction guarantee up a layer.
- **Steel** — pure Rust, embeddable, sandbox-able by not registering I/O builtins;
  fine-grained fuel/limit knobs are less documented than Rhai's (**uncertain**).
  Notable adoption signal: chosen as the Helix editor's plugin language
  (**uncertain**).
- **Boa** — pure Rust JS. Has `RuntimeLimits` (loop iteration, recursion, stack)
  — coarser than per-operation fuel (**uncertain** on exact coverage). Bigger
  concern: a full ECMAScript engine is an enormous attack/complexity surface to
  strap onto a default-deny kernel, and Boa's conformance-driven pace means a large
  unsafe-adjacent GC core evolving fast.
- **QuickJS** — ironically good *knobs* (`JS_SetMemoryLimit`, `JS_SetMaxStackSize`,
  interrupt handler) and a poor *substrate*: the CVE record above, inside shared
  linear memory, is disqualifying for in-core use. As Tier 3 WASI the knobs plus the
  instance boundary make it respectable.

## 3. Host-binding ergonomics

- **Rhai**: `engine.register_fn("name", |a: i64| ...)` with plain Rust closures;
  `#[derive(CustomType)]` for structs; `rhai::serde` gives `to_dynamic`/`from_dynamic`
  for structured data — serde types cross the boundary directly, which matches a
  serde-heavy core. Script errors return `EvalAltResult` (typed, position-carrying);
  host errors propagate as `Err` into the script and back out. Best-in-class here.
- **Koto**: solid — `KValue`, derive macros, but structured data crosses via its own
  value types; serde interop is thinner (**uncertain**).
- **Steel**: `register_fn` in the same style as Rhai; Scheme↔Rust value conversion
  is workable but the value model (cons cells, symbols) maps less directly onto
  JSON-shaped module data.
- **Boa**: `NativeFunction` registration plus `JsValue` conversions; historically the
  roughest API of this set, improving via `boa_interop` (**uncertain**).
- **QuickJS/rquickjs**: good typed `FromJs`/`IntoJs` traits — but moot in-core, and
  as Tier 3 the binding surface becomes your own message protocol anyway.

## 4. Language fit for LLM-authored code — weighed honestly

This is the strongest argument **against** Rhai, so it gets the space.

- **JavaScript** is the single best-represented language in every model's training
  data. A frontier model writes correct idiomatic JS on the first try at a rate no
  other candidate approaches. Every forge-pipeline failure (PROMPT §7) costs a full
  propose→generate→validate round-trip through a paid model; generation accuracy is
  not a soft preference, it is latency and money.
- **Lua** is second-best represented among the candidates; moot in-core (§1).
- **Rhai** is Rust-flavored and *close* to the JS/Rust family, but it is a
  low-resource language: models emit Rust-isms (traits, `match` ergonomics,
  borrows) and JS-isms that Rhai rejects. Mitigation exists and is cheap in this
  architecture specifically: the Context Document (PROMPT §8) can carry a static,
  golden-tested "Rhai primer + house idioms" section for forge phases, and the
  forge already has a static-validate phase that catches syntax rejects before
  anything runs. **uncertain** in degree, real in direction.
- **Koto** is *more* obscure than Rhai — same mitigation needed, smaller corpus,
  no offsetting benefit.
- **Scheme (Steel)**: models write passable Scheme, but paren-balance and
  macro-hygiene errors under generation are common, and the user must read forged
  modules (legibility rule, PROMPT §1) — a Scheme module corpus is a harder read for a
  Rust-fluent solo engineer than Rhai.

Net: JS is the only language that *beats* Rhai here, and both JS routes carry a
structural penalty (Boa's size/surface; QuickJS's Tier 3 exile). The honest framing:
**choose Rhai and pay a prompt-engineering tax on every forge call, or choose JS and
pay a memory-safety/size/architecture tax once.**

## 5. Maintenance, bus factor, license

| Engine | License | Maintenance signal | Bus factor |
|---|---|---|---|
| Rhai | MIT / Apache-2.0 | steady releases (1.25.1 current), years of history | effectively one primary maintainer (**uncertain**) |
| Boa | MIT / Unlicense | active org (boa-dev), multiple contributors | healthiest of the set (**uncertain**) |
| QuickJS / quickjs-ng | MIT | quickjs-ng is the maintained fork; upstream slow | small core team (**uncertain**) |
| mlua / Lua | MIT | mlua very active; Lua core glacial-but-stable | mlua ~1 maintainer (**uncertain**) |
| Koto | MIT | active, pre-1.0 (0.16.1) | ~1 maintainer (**uncertain**) |
| Steel | MIT / Apache-2.0 | active; Helix plugin adoption is a longevity signal | ~1 primary author (**uncertain**) |

Single-maintainer risk is endemic to this niche; it argues for keeping the engine
behind a narrow internal trait (one `eval`-shaped seam) so a future swap is a
bounded rewrite — which I9 (uniform modules) wants anyway.

## 6. Verdict

**1. Rhai** — the only candidate that simultaneously: compiles in-core (measured,
~1.3 MB opt), is sandboxed *by construction* with per-operation fuel and memory caps
that map one-to-one onto I6/I7, has the best host-binding + serde story, has no known
CVE/RUSTSEC history, and is readable by a Rust-fluent owner. Spike B is proving it
concretely; nothing found here contradicts that bet.

**Strongest argument against Rhai** (PROMPT §1 rule 2, stated before the recommendation
stands): *LLMs write mediocre Rhai.* Every forged module is authored by a model, so
the engine we can sandbox best is also the language models write worst among viable
options. If forge round-trip failure rates in practice stay high despite a primer
section and static-validate, the correct move is not more prompting — it is revisiting
QuickJS as a Tier 3 WASI module and eating the boundary cost. ADR-003 should name
that as the explicit reversal trigger, with a measurable threshold (e.g. >N% of forge
generate phases failing static-validate after the primer lands).

**2. QuickJS via WASI (Tier 3)** — the JS fallback. Cannot be in-core
(measured toolchain failure); as a separate WASI instance it gets the language models
love plus a real isolation boundary, and the artifact is small — **0.72 MB raw,
measured here on wasm32-wasip1**. Costs: second shipped artifact, instance
lifecycle, serialize-everything boundary, C CVE cadence (mitigated but not erased by
the instance boundary).

**3. Boa** — the sleeper. Measured at 2.53 MB opt, in-core JS is *size*-viable after
all, and it is the one candidate that combines memory-safe Rust with the language
models write best. It loses to Rhai on sandbox granularity (`RuntimeLimits` is
coarser than per-operation fuel; ambient surface of a full ECMAScript global must be
actively stripped rather than being absent by construction) and on sheer engine
surface a solo owner must trust. If the LLM-fluency reversal trigger ever fires, Boa
deserves re-evaluation *alongside* Tier 3 QuickJS — in-core beats a boundary if its
limits story has matured by then.

**4. Koto** — builds clean and small, pleasant language, but obscurer than Rhai for
models *and* humans, thinner limit story, no compensating advantage.

**5. Steel** — 2.4 MB for a language the owner and the models are both worse at.

**6. mlua** — eliminated by measurement for in-core *and* failed the wasip1 probe on
this machine; even where it builds, Tier 3 Lua is dominated by Tier 3 QuickJS
(better language fit for LLMs, same boundary cost).

Sources: [quickjs-ng CVE-2026-0822](https://www.sentinelone.com/vulnerability-database/cve-2026-0822/),
[CVE-2026-1145](https://www.sentinelone.com/vulnerability-database/cve-2026-1145/),
[CVE-2026-1144 (UAF)](https://security.snyk.io/vuln/SNYK-UNMANAGED-QUICKJSNGQUICKJS-15035875),
[CVE-2024-13903](https://www.cvedetails.com/cve/CVE-2024-13903/),
[RustSec advisory DB (no Rhai entries)](https://rustsec.org/advisories/),
[rhaiscript/rhai](https://github.com/rhaiscript/rhai).

## 7. Five lines for RESEARCH.md

- R5 measured wasm32-unknown-unknown builds: Rhai 1.30 MB opt (needs the standard `getrandom wasm_js` cfg), Koto 1.12 MB, Steel 2.42 MB, Boa 2.53 MB; QuickJS (rquickjs) and Lua (mlua) **fail the target outright** — C, no libc.
- C engines in-core would share linear memory with the kernel anyway: quickjs-ng has 2024–2026 heap-overflow/UAF CVEs from pure JS input — in-core JS-via-C is disqualified, not just inconvenient.
- Rhai is the only candidate with by-construction default-deny **plus** per-operation fuel, depth, and size caps — a direct match for I6/I7; no known Rhai CVE/RUSTSEC.
- Verdict: **Rhai #1** (Spike B's prior stands); strongest counter-argument is LLM fluency — models write JS ≫ Rhai — mitigated by a golden-tested Rhai-primer context section + forge static-validate.
- Named reversal trigger for ADR-003: if forge static-validate failure rates stay high post-primer, move to **QuickJS as a Tier 3 WASI module** (measured here: 0.72 MB on wasm32-wasip1; the Javy pattern), never in-core.
