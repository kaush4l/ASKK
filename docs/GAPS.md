# Known gaps

Found by wave 3 while integrating; rows 1-8 were fixed by wave 5. What remains
below is accepted, not pending.

## Accepted deviations

9. Confirmations inside a delegated run degrade to denial observations (a nested call can't
   pause its parent's tool call). Accepted: revisit only if delegated mutating tools matter.
10. Engine runs execute on the main thread in `web` (async, network-bound) — ADR-010 worker
    hosting is a seam, not yet a worker. Accepted: flip when a compute-heavy tool or a local
    model lands.
15. Kiln-fidelity deviations in the web shell (wave 6): no Steer button (the runtime has no
    mid-run steering input); the Agents view is a flat newest-first forest, not a delegation
    tree (`RunStarted` carries no parent run id); phase/boot loaders are CSS pulse dots, not
    the ldrs web components; the Inspector's Skills/Supplies tabs are stubs that show the
    active run's raw messages (kiln's glass-box rendered-prompt inspector deferred); no model
    profiles UI (one BYOK provider profile).

## Wave-7 live-e2e findings (gemma-4-12B @ omlx, 2026-07-08)

16. Delegation authority narrowing (child = parent ∩ child) means an orchestrator must
    list every transitive tool or sub-agents run with empty allowlists; orchestrator.md
    now carries the superset. Revisit if the tool count grows.
17. Cancel sets the per-iteration token but does not abort an in-flight fetch; a slow
    local-model prefill (observed: minutes at ~22 prompt-tok/s) keeps the run "busy"
    until the call returns. Fix = AbortController plumbed through send_stream.
18. Every LlmDelta notify refolds all runs in the UI; with a fast stream the main
    thread saturates (long evals time out mid-run). Fix = fold incrementally or
    throttle notify.
19. Chat renders both the raw TOON reply and the parsed answer as assistant bubbles
    (fold keeps both); cosmetic duplication.
20. Small local models sometimes re-delegate the same goal redundantly; max_tokens
    default (2048) bounds each turn, prompt diet for nested sheets would help more.

## Known-minor (wave 4 findings, queue for next iteration)

11. `ProviderRegistry` caches instances per model id with no profile-update invalidation —
    web boot rebuilds the resolver per call as a workaround; add `replace_profile()`.
12. `RunSession.submit` emits `RunStarted` before a host is installed, so the web live buffer
    misses it mid-drive (fold tolerates; full stream appears once the run parks).
14. Contract `version` rides the wire but has no parse-time mismatch check (risk-register
    row 12 mitigation is aspirational until contracts actually evolve).
