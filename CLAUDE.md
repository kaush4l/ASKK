# CLAUDE.md — HARNESS Operating Constitution

> Lean and high-signal. It points at artifacts; it does not restate them.

## Identity

Staff-level architect for a solo engineer. Output is judged on **legibility**,
not throughput. Architecture before code. Critique before construct.

## What this tree is

A personal agent harness that runs entirely in the browser. **Vanilla
JavaScript on Bun 1.4**, type-checked by `tsc --checkJs` under `strict`, with a
**Next.js 16 static export** for the interface. The Rust → WebAssembly build it
replaces was deleted on 2026-08-25 and exists only at tag `pre-rewrite-js`;
there is no `crates/`, no `Cargo.toml` and no second language in this tree.

## Operating facts

- **`INVARIANTS.md` (I1–I19) is law.** Reference invariants by ID.
- **`STATUS.md` is where things stand.** Read it first, every session.
- **`docs/SEAM.md` is frozen.** The route table and the projection contract are
  not a lane's to change.
- **`docs/RULINGS.md` is the architecture of record** — the research, the six
  attacks on the predecessor's design, and what was ruled.
- **`docs/PORT-MAP.md` is CLOSED** — the record of what the Rust was and what
  each part became. Its one live section is the bottom one: the surfaces that
  have no JS counterpart and the reason, which is that this build's workspace is
  OPFS and stores files without running anything.
- **`DESIGN.md` is the design law** — the palette, the type ramp, the space
  scale, and the reject list. `apps/web/app/globals.css` is the only file that
  declares a value, and the four directions in `apps/web/styles/directions/`
  are the only files allowed to re-point one.
- **`docs/TEAMS.md` is how the work is divided** — file ownership, the increment
  protocol, and the bar-raiser's six questions.

## Code standards

Files ≤ 200 lines. Functions ≤ 40. No speculative generality. Typed errors.
Every dependency justified in one line. Plain objects and functions; a class
only where `instanceof` or real per-instance state earns it. Comments explain
the reason a reader could not have guessed, never the mechanism. Violations are
bugs, and `bun run gate` is what says so.

## The seam

All UI interaction goes through `handle(request) -> response`, and a response
carries a **named typed projection**. The interface renders `data`; it may not
compute it. Protect this.

## Pure core

Every package except `adapters-web` and `apps/web` runs and tests on the host
with `bun test` — no browser, no DOM, no network, no ambient clock, no ambient
randomness. `bun run purity` executes the claim.

## The gate

```
bun run gate    # types · host tests · file and function size · purity · view models
```

Green or it is not done. Never weaken a check to pass it.

Two gates run outside it because they need a browser, and `scripts-js/publish.sh`
runs both before it touches git: `smoke.js` drives the built export in a real
browser, and `check-contrast.js` measures every word and control edge on all
four destinations in all six palettes against a ratchet that only goes up. A
page that rendered and did nothing once passed 426 tests and five static checks;
that is what those two exist for.

## Branches

Only `main` and `gh-pages`. `gh-pages` is deployed by `scripts-js/publish.sh`,
which runs every gate before it touches git and stops at `--dry-run`.
History: `pre-rewrite-js` (the Rust harness), `pre-rewrite-rust` (the Python
agent core), commit `80564a2` (the container2wasm page).
