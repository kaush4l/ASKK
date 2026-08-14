# INVARIANTS

Hard invariants. Reference by ID in every module spec. Source: `docs/PROMPT.md` §12.

- **I1 Static.** Builds to static assets; no server runtime required to function.
- **I2 Local.** All user data lives in browser storage; outbound traffic only to configured endpoints.
- **I3 Pure core.** Core crates test on the host with no browser, no Wasm, no network.
- **I4 One seam.** All UI interaction goes through `handle(Request) -> Response`.
- **I5 Dumb frontend.** No application logic in JS. A behavior needing JS needs a reason in writing.
- **I6 Capability-gated, default deny.** Modules receive nothing they were not granted; secrets never
  enter a module's environment.
- **I7 Deterministic core.** `step()` is pure; time, randomness, IDs, and network are injected.
- **I8 Observable.** Every transition emits an event; every view is a projection of the log.
- **I9 Uniform modules.** Built-in and forged modules are indistinguishable to the system.
- **I10 Reversible.** Every installation, migration, and improvement can be undone.
- **I11 Updatable.** Any release is reachable by refresh, with migrations, without data loss.
- **I12 Small.** Files ≤ 200 lines. Functions ≤ 40 lines. Enforced by
  `scripts/check-size.py` over `crates/*/src` (files; `--functions` reports the
  function rule, not yet gated) and by `scripts/check-selectors.py` over `web/`.
  Integration tests under `crates/*/tests` are out of scope, as they have been
  since G4.
- **I13 Sectioned context.** Nothing reaches a model except as an assembled Document. No ad-hoc string
  building anywhere in the codebase.
- **I14 Pure assembly.** `assemble` is deterministic and golden-tested; declared-static sections render
  byte-identically.
- **I15 Degradable.** Every capability may be absent; the environment advertises only what is actually
  available and never breaks when a substrate is missing.
