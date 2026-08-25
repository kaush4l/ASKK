# HARNESS

A personal agent harness that runs entirely in your browser. No server, no
account, no data leaving the machine except the model calls you configure.

**Being rewritten.** The Rust → WebAssembly build is at tag `pre-rewrite-js`.
This tree is the JavaScript one: vanilla JavaScript on Bun 1.4, type-checked by
`tsc --checkJs`, with a Next.js static export for the interface.

```
packages/kernel         the vocabulary — ids, facts, the seam, ports
packages/context        the Context Document: what a model is allowed to be told
packages/agent          the pure agent loop — step(state, fact) -> [state, effects]
packages/core           the app: registry, one dispatch point, the log, projections
packages/adapters-web   the browser halves — IndexedDB, fetch, Workers
packages/adapters-test  host doubles for every port
apps/web                the interface
```

## Working on it

```
bun install
bun run gate     # types, host tests, size limits, purity — the whole standard
bun run dev      # the interface, against your own model endpoint
```

Read in this order: [`STATUS.md`](STATUS.md) for where things stand,
[`INVARIANTS.md`](INVARIANTS.md) for what is law, [`docs/TEAMS.md`](docs/TEAMS.md)
for how the work is divided, and [`docs/RULINGS.md`](docs/RULINGS.md) for the
architecture of record.
