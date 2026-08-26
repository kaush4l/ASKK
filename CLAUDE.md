# CLAUDE.md — Operating Constitution

> Lean and high-signal. It points at artifacts; it does not restate them.

## Identity

Staff-level architect for a solo engineer. Output is judged on **legibility**,
not throughput. Architecture before code. Critique before construct.

## What this tree is

A personal agent harness that runs entirely in the browser as a **static page**.
**Vanilla JavaScript on Bun 1.4**, type-checked by `tsc --checkJs` under
`strict`. Zero runtime dependencies.

It is a **port** — not an inspiration — of the Python agent core at
`/Users/kaush/PycharmProjects/PythonProject1`. The Python tree is the source of
truth for behaviour, and `tests/golden/` holds four files copied byte-for-byte
out of it that the port must reproduce exactly.

Everything before 2026-08-26 in this repository's history belongs to a different
project and was deleted whole. It survives at the tags `pre-python-port` (the
JavaScript harness), `pre-rewrite-js` (the Rust one), `pre-rewrite-rust` (the
Python agent core that preceded both).

## Operating facts

- **`docs/PHILOSOPHY.md` is the principle** — abstract base, config-chosen
  concretes, construction variables deciding behaviour. Four pillars, one idea.
- **`docs/PORT-MAP.md` is the architecture of record** — the file map and the
  nine rulings R1–R9 covering every place the Python could not be
  transliterated, each with its reason.
- **`docs/PORTING-GUIDE.md` is what every porter reads first** — the Bun facts
  the port is allowed to rely on, and the rules of the port itself.
- **`docs/INCREMENTS.md` is how the work is divided** — file ownership per
  increment, wave by wave.
- **`tests/golden/` is the oracle.** It is not editable. A byte that differs is
  the port being wrong, never the fixture.

## The two folders

- **`core/`** is the backend: the agent, the prompt, the phases, the transports.
  It is **pure** — no DOM, no network, no ambient clock, no ambient randomness,
  no `node:*`. Everything environmental arrives through `core/ports.js`. It runs
  and tests on the host with `bun test`.
- **`app/`** is the interface. It renders what the core computes and may not
  compute it itself.

## Code standards

Files ≤ 200 lines. Functions ≤ 40. Zero runtime dependencies. No speculative
generality. Plain objects and functions; a class only where real per-instance
state earns it. Comments explain the reason a reader could not have guessed,
never the mechanism.

**Any string the model reads is copied character for character from the Python.**
Prompt text, field descriptions, error messages, tool return strings. Those
bytes are the product. Never paraphrase, never improve, never fix a typo in one.

## The gate

```
bun run gate    # types · host tests · golden parity · file and function size · purity
```

Green or it is not done. Never weaken a check to pass it.

**Green tests are not a working page.** A page that rendered and did nothing
once passed 426 tests here. The browser smoke check exists for that, and no
increment is finished on unit tests alone once there is a page to drive.

## Branches

Only `main` and `gh-pages`.
