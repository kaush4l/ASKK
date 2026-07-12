# Acceptance benchmark — the v0 termination condition (brief v4 §5)

v0 is DONE when every row is green **and** the gate is green **and** the manual
checklist passes on a real phone + laptop. Nothing else counts. "All rows green"
is not license for scope — v0 ends there (brief v4 §8).

Policy: CI (scripts/gate.sh) gates on the **ScriptedLlm lane only**
(`MockProvider::from_script`, fixtures in `crates/runtime/tests/fixtures/`).
The live local model is a manual/nightly smoke layer — findings logged, never
gating. Budgets below are proposals; freeze them with the human at GATE time.

Lanes: **native** = runs in `cargo test` (scripted provider, `ScriptedShell`
guest twin) · **browser** = needs the real v86 guest, manual/nightly via
`dx serve` · **blocked** = a named prerequisite is missing.

| Row | Task (end-to-end through the agent loop) | Pass condition | Budget | Lane | Status | Test |
|---|---|---|---|---|---|---|
| A1 | Agent writes + runs a JS snippet (fast lane, `js_eval` worker tool) | correct stdout in observation + answer | < 2 s; 2 turns | native + browser check | green (native twin; browser verified 2026-07-11) | `a1_fast_lane_js_eval` |
| A2 | Write a Python script in the VM, run, read failure, fix, rerun | second run exits 0 | < 90 s; 5 turns | native twin (real guest browser-lane: **blocked** — no python3 in committed images, no guest net, GAPS 25/30) | twin green; guest red | `a2_write_run_fix_rerun` |
| A3 | Shell task in VM: create files, grep them | expected matches observed | < 60 s; 3 turns | native twin + browser | twin green; guest green (wave-10/11 live-verified `shell`+`write_file`) | `a3_shell_files_grep` |
| A4 | gcc hello-world in VM | binary runs, exits 0 | < 120 s | blocked — no compiler in committed images + no guest net; needs a baked toolchain image (asset work, zero Rust) | red | — |
| A5 | Kill tab mid-A2; reopen; resume | run completes; zero duplicate effects in log | — | native (foundation only) | **red** — no resume: reopen fences non-terminal runs to Interrupted (log.rs epoch fence), boot discards replayed signals. Foundation green: deterministic replay, unique effect ids (`{run}-call-{seq}`) | `a5_foundation_replay_dedup_fence` |
| A6 | Second device takes the lease and continues a run | A5 across devices | — | blocked — no cross-device store (OPFS is device-local); lease type alone cannot pass this | red | — |
| A7 | Two loops in parallel under budgets; one exhausts | `Paused(BudgetExhausted)` event; sibling unaffected | — | native (foundation) | **red** — exhaustion is a TERMINAL status today (ADR-008); terminal→paused is a human-gate semantics change. Foundation green: concurrent drives, BudgetExhausted signal, sibling isolation | `a7_budget_exhaustion_sibling_isolated` |
| A8 | VM snapshot export → wipe OPFS → import → state intact | pre-wipe file still present | < 30 s restore | browser — `saveState`/state-boot exist in the JS bundle (entry.js), zero Rust callers; needs ~100 lines of glue + OPFS blob persistence | red | — |
| A9 | Cold load on throttled 4G, fast lane ready | interactive + A1 passes | < 10 s; < 15 MB before lazy VM | manual — facts favorable (assets/vm 73 MB + speech 26 MB are fetch-on-demand; rest KB-scale) but unenforced; needs a release-build size check in the gate | red (unmeasured) | — |
| A10 | `mvn package` hello-world in VM (exploratory, allowed to fail) | records the number; verdict → ADR | 5 min ceiling | blocked — same prerequisite as A4 plus a JVM-capable image; never in CI | red | — |

## Row ↔ code contract

- Native rows live in `crates/runtime/tests/acceptance.rs`, one `#[test]` per
  row, named in the Test column; `rows_md_test_names_exist` fails CI if this
  table names a test that does not exist.
- `STATUS.md` in this directory is **generated** by `scripts/bench-status.sh`
  (run by the gate) — hand edits get overwritten; this file is the frozen
  definition, that file is the current truth.
