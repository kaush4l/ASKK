# Brief v4 vs the code — gap map (2026-07-11)

Five parallel readers compared brief v4 (VM-first execution, acceptance
benchmark, ScriptedLlm rig) against the repo. Verdict: **the brief is ~80%
already built under different names.** What follows is the delta, with the
name-mapping made explicit so nobody builds a duplicate.

## Name map (brief → code)

| Brief v4 concept | Already exists as | Where |
|---|---|---|
| `ExecutionBackend` trait | `trait ShellExec` — injected, 3 impls (serial / stub / mock), emulator-agnostic | `crates/runtime/src/tools/shell.rs:19` |
| `__OD_BEGIN__ <effect_id> … __OD_END__ <exit>` framing | `__ASKK_BEG_{n}__ … __ASKK_DONE_{n}__` + `[exit N]`, collision-proof, echo-suppressed | `scripts/vm/entry.js` exec() |
| `effect_id` on run events | `call_id = {run_id}-call-{seq}`, deterministic, on ToolRequested/ToolCompleted | `crates/runtime/src/run/turn.rs`, `core/src/signal.rs` |
| ScriptedLlm | `MockProvider` (FIFO script, request recording, typed exhaustion) + now `from_script` fixture files | `crates/inference/src/mock.rs` |
| Benchmark-through-the-agent-loop | `runtime/tests/workflows.rs` (full RunSession over the mock) + now `tests/acceptance.rs` | `crates/runtime/tests/` |
| Emulator ADR (v86 default, CheerpX rejected) | ADR-016, decided wave 9 with the same reasoning | `docs/adr/ADRS.md` |
| Fast lane (~1 MB QuickJS) | **not needed**: browser IS the JS engine — `js_eval` Worker tool (ADR-021) | `crates/web/assets/agents/js_eval.js` |
| VM crash = failed effect | every VM failure path → `ToolResult::err` observation, run survives | `shell.rs`, `web/src/host/vm.rs` |
| Per-command wall-clock timeout | 30 s, passed from Rust, enforced JS-side | `web/src/host/vm.rs:28` |

## Real gaps (ranked; the wave-12+ queue)

1. **Resume machinery (A5)** — the honest gap behind "zero duplicate effects".
   Replay is deterministic and effect ids exist, but reopen FENCES non-terminal
   runs to Interrupted (`state/log.rs` epoch fence) and boot discards replayed
   signals (`web/src/host/boot.rs`). Needed: `RunState::rebuild(signals)` +
   dedup-on-dispatch consulting seen ToolCompleted call_ids + fence opt-out.
2. **Paused(BudgetExhausted) (A7)** — today a TERMINAL status (ADR-008).
   Terminal→resumable-pause is a semantics change = human gate. The
   confirmation park (`awaiting`/`resolve_action`) is the in-repo template.
   Sibling isolation + the signal already hold (test: acceptance.rs a7).
3. **EnvSnapshot wiring (A8)** — `AskkV86.saveState()` + state-boot exist in
   the JS bundle with ZERO Rust callers. ~100 lines: save → OPFS blob keyed by
   sha-256 (content-addressed for free), restore = boot `imageType:"state"`.
4. **Toolchain image (A4/A2-guest/A10)** — no compiler/python3 in committed
   images, no guest NIC, so `apk add` can't fetch. Asset work (bake apks into
   the cdrom), zero Rust. A10 (JVM) rides the same pipeline, exploratory.
5. **Output cap on exec** — the serial tap buffers unboundedly (`buf += text`);
   only the 30 s timer bounds a `cat /dev/urandom`. Cap in the tap + truncate
   harness-side, ~5 lines.
6. **Harness-side timeout race** — Rust awaits the JS promise with no
   independent timer; a wedged page-side exec hangs the future.
7. **Lease / A6** — BLOCKED on a cross-device store; OPFS is device-local.
   A lease type alone cannot pass A6; do not build it until a synced
   KvStore/BlobStore exists. Same-device multi-tab lease is buildable anytime.
8. **A9 size budget** — favorable facts (vm 73 MB + speech 26 MB are lazy,
   rest KB-scale) but zero enforcement; needs a release-build size assertion.

## Explicitly rejected / deferred (per brief §8 + ponytail)

- QuickJS wasm fast lane — duplicate of the host JS engine; Worker + terminate
  covers sandbox/timeout/capture (ADR-021).
- 9p/OPFS-VFS mount — quoted-heredoc `write_file` is byte-safe today; 9p buys
  bulk/binary + persistence, which no current row needs.
- Renaming `ShellExec` → `ExecutionBackend` — churn with no behavior; the seam
  already satisfies the trait's purpose. Revisit only if a second live backend
  (native connector) lands.
- Building a CPU emulator — brief §3.3, with prejudice.
- Worker-hosted VM — v86 runs on the main thread by explicit choice
  (entry.js:11); failure containment already holds via error results.
