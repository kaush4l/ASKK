# Testing strategy

## Principle

Everything below `web` runs on the host (`cargo test`), no browser needed — that is why core is
pure and transports/stores/sleepers are injected. Tests before the next feature; a feature
without tests is unfinished.

## Layers

1. **Unit** (inline `#[cfg(test)]`, per module) — element render/absorb, contract parse cascade
   (JSON, TOON, repair, missing-field), tool gate, action verdicts, fold reducer, phase routing.
2. **Contract tests** (`core`) — every named contract: instructions() golden text, parse of
   well-formed + malformed + truncated replies, version mismatch behavior.
3. **Provider adapter tests** (`inference`) — pure body-builder goldens per adapter; reply/SSE
   parsing from recorded fixtures; error mapping (401 → Auth, timeout → Timeout, CORS hint).
   Mock transport, zero network.
4. **Config tests** (`runtime`) — every agent.md in `agents/` parses and validates in CI
   (the "smoke test that constructs every agent" — LocalAgents shipped a SyntaxError in its live
   path because nothing imported it; never again). Unknown tool/skill/phase refs fail loudly.
5. **Workflow tests** (`runtime/tests/`) — full runs against MockProvider with scripted replies:
   happy path, tool loop, action confirm/deny, gate phase fail→revise→pass, budget exhaustion,
   interrupt, malformed reply repair, delegation depth cap. Assert on the **signal stream**
   (the log is the observable behavior), then on the fold.
6. **Failure-mode tests** — one test per row of the risk register (docs/ROADMAP.md).
7. **Structure tests** — file-size cap (~500 lines), dependency-rule assertions (no
   `dioxus`/`web-sys` outside `web`; no workspace imports in `core`), every doc-listed module
   exists (docs may not outrun code — kiln's docs-ahead-of-code drift).
8. **Web/UI** — thin: UI logic stays in projections (host-tested); components render
   projections. No wasm-bindgen tests exist yet (an earlier claim here outran the code —
   docs/findings/code-vs-claims.md); the gate compiles wasm32
   (`cargo check -p askk-frontend --target wasm32-unknown-unknown`) so web-only breakage can't
   slip through, and browser-lane behavior is verified manually via `dx serve`.
9. **Acceptance benchmark** (`runtime/tests/acceptance.rs` + `bench/acceptance/ROWS.md`) —
   the v0 termination rows (ADR-020), driven through the real loop against
   `MockProvider::from_script` fixture files; `scripts/bench-status.sh` regenerates
   `bench/acceptance/STATUS.md` inside the gate.

## Gate (every merge)

```
cargo fmt --check && cargo clippy --workspace -D warnings && cargo test --workspace
```

Sub-agents run the same gate before handing work back. No green gate, no merge.
