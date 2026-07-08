# Known gaps (wave-5 hardening queue)

Found by wave 3 while integrating; each is small, none blocks the web wave. Delete rows as fixed.

1. `ToolCtx` lacks a slice iterator — lift-back sees only pre-known keys; new keys tools write are invisible.
2. `ToolRegistry` lacks `names()` / `get(name)` — callers filter via `contains()` or abuse `build_tool_set(&[name])`.
3. `FormatNegotiator` lacks `with_mode(OutputMode)` — a `format: json` agent starts TOON, honored-telemetry misaligned until escalation.
4. `assemble()` has no per-phase contract/directive params — turn loop patches the sheet post-assembly.
5. `askk_core::phase::route` not re-exported at crate root (siblings are).
6. TOON-path tool calls all derive id `"call_0"` — ActionId collision if two confirmations park concurrently across runs.
7. `Provider::infer` `on_delta` is sync — LlmDelta signals batch post-reply instead of streaming into the log.
8. Per-phase `LoopMode::Loop{max_turns}` clamp not enforced — global Budgets owns termination (deviation, maybe fine; decide).
9. Confirmations inside a delegated run degrade to denial observations (nested call can't pause parent). Revisit if delegated mutating tools matter.
10. Engine runs execute on the main thread in `web` (async, network-bound) — ADR-010 worker hosting is a seam, not yet a worker. Flip when a compute-heavy tool or local model lands.
