# Known gaps

Found by wave 3 while integrating; rows 1-8 were fixed by wave 5. What remains
below is accepted, not pending.

## Accepted deviations

9. Confirmations inside a delegated run degrade to denial observations (a nested call can't
   pause its parent's tool call). Accepted: revisit only if delegated mutating tools matter.
10. Engine runs execute on the main thread in `web` (async, network-bound) — ADR-010 worker
    hosting is a seam, not yet a worker. Accepted: flip when a compute-heavy tool or a local
    model lands.

## Known-minor (wave 4 findings, queue for next iteration)

11. `ProviderRegistry` caches instances per model id with no profile-update invalidation —
    web boot rebuilds the resolver per call as a workaround; add `replace_profile()`.
12. `RunSession.submit` emits `RunStarted` before a host is installed, so the web live buffer
    misses it mid-drive (fold tolerates; full stream appears once the run parks).
13. `RunHost::interrupted` has no UI wiring — a Stop button needs a shared flag or
    `session.cancel` plumbing.
14. Contract `version` rides the wire but has no parse-time mismatch check (risk-register
    row 12 mitigation is aspirational until contracts actually evolve).
