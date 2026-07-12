# Code vs claims — where documents lied and the code told the truth

One row per discrepancy; the code always wins (CLAUDE.md §2).

| Date | Claim (source) | Code truth | Action |
|---|---|---|---|
| 2026-07-11 | docs/TESTING.md layer 8: "`wasm-bindgen-test` for OPFS stores + fetch transport" | Zero wasm-bindgen tests exist in any crate (no dep, no test); `crates/web` tests are host-target `#[test]`; gate never even compiled wasm32 | TESTING.md corrected; `cargo check -p askk-web --target wasm32-unknown-unknown` added to gate.sh |
| 2026-07-11 | Brief v4 §4: "a crashed VM **Worker** is a failed effect" | v86 runs on the MAIN thread by explicit decision (scripts/vm/entry.js:11); containment still holds — every VM failure → `ToolResult::err`, run survives | No change; premise noted in brief-v4-gap.md |
| 2026-07-11 | Brief v4 §1 implies the ExecutionBackend seam must be built | `trait ShellExec` (shell.rs:19) already is that seam: injected, 3 impls, nothing above it knows v86 | No rename (ADR-021); brief's concept mapped, not rebuilt |
| 2026-07-11 | Brief v4 §5 A5 "zero duplicate effects" reads as a dedup gap | Dedup is trivially green today only because resume doesn't exist (epoch fence kills non-terminal runs on reopen, log.rs) — the honest gap is RESUME | ROWS.md marks A5 red with foundation pinned by test |
