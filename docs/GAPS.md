# Known gaps

Found by wave 3 while integrating; rows 1-8 were fixed by wave 5. What remains
below is accepted, not pending.

## Accepted deviations

9. Confirmations inside a delegated run degrade to denial observations (a nested call can't
   pause its parent's tool call). Accepted: revisit only if delegated mutating tools matter.
10. Engine runs execute on the main thread in `web` (async, network-bound) — ADR-010 worker
    hosting is a seam, not yet a worker. Accepted: flip when a compute-heavy tool or a local
    model lands.
