# PLAN

> The ordered increments. One increment = one coder invocation = one revertable
> commit. Nothing is coded that is not an increment here.
>
> **Status legend:** `TODO` · `IN PROGRESS` · `DONE` (proof recorded in
> `docs/PROGRESS.md`) · `CUT` (with the reason).
>
> Every increment has: an **intent** (one sentence), **files** (exact ownership),
> and **acceptance** (a falsifiable observation, not "it works"). An increment
> with a UI surface is never accepted on unit tests alone.

---

## Wave 0 — Ground

| # | Intent | Status |
|---|--------|--------|
| 0.1 | Recon: read powerhouse, inventory old ASKK, research reference agents | DONE |
| 0.2 | Team defined (`.claude/agents/*`), `.gitignore` culled, NORTH-STAR written | DONE |
| 0.3 | Architecture of record drafted and ringmaster-approved | DONE |
| 0.4 | Old tree deleted whole and tagged; **`CLAUDE.md` rewritten** to match `ARCHITECTURE.md` | TODO |

**0.4 acceptance:** `git tag` shows the recovery tag; the working tree contains
only the new skeleton; the tag's tree still contains the old files; and
`CLAUDE.md` names `docs/ARCHITECTURE.md` as the architecture of record, states
TypeScript, and no longer mandates 200-line files.

**0.4 is blocking, not housekeeping.** As checked in, `CLAUDE.md` names
`docs/PORT-MAP.md` as the architecture of record, mandates vanilla JS under
`tsc --checkJs`, and mandates files ≤ 200 lines. All three contradict
`ARCHITECTURE.md` (§8.3, §10.1). Until 0.4 lands, the coder's first instruction
and the architecture disagree about the language of the tree — the most
expensive disagreement available. No wave-1 increment starts before it.

---

## Wave 1 — It builds and it ships

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 1.1 | Barebones Bun + Next app that runs | `bun run dev` serves a page with one identifying string | +80 | TODO |
| 1.2 | Static export | `bun run build` emits `out/`, zero server code in it | +20 | TODO |
| 1.3 | Subpath-correct export | `scripts/serve-subpath.ts` serves `out/` under `/ASKK/` and the page loads with **zero** console errors and **zero** 404s — the failure mode that has bricked this project before | +90 | TODO |
| 1.4 | Deploy path proven | The hosted URL loads and shows the identifying string | +60 | TODO |
| 1.5 | Worker emission, as a repo-owned regression guard | A worker started from the **built** export at a subpath replies with its sentinel: zero console errors, no 404 for the worker chunk. Reproducible locally via `scripts/serve-subpath.ts`, not only on the deployed URL. The same probe **asserts** the three Web Lock behaviours §7.3's election rests on: it grants in a worker, `{ifAvailable:true}` grants when free, and it yields `null` when already held (MEASURED M5) | +70 | TODO |
| 1.6 | The gate exists, and it fails | `bun run gate` runs; someone breaks one rule on purpose and it goes red **naming that rule**. Ships only the wave-1 checks: `checks/size.ts` (arming the `max` ratchet), the export/no-server-code assertion, and the smoke harness | +180 | TODO |

**1.5 is a guard, not a discovery.** `docs/scratch/MEASURED.md` already settled
all of it: M1 a worker loads, runs and replies from a static export at a subpath
with zero console errors; M2 webpack emits it as a **classic** worker
(`{type: void 0}`); M5 `navigator.locks` grants there and yields `null` when
held. Nothing in this increment is expected to fail.

That is exactly why it exists. Four separate architectural commitments —
§3.2's no-runtime-ESM rule, §7.3's single-writer election, §8.1's bundle check
and the whole realm map — now rest on facts measured **once, in a scratch probe,
outside this repo**. A toolchain upgrade expires all four silently and at the
same moment. 1.5 is what converts a measurement into a standing assertion.

**1.6 ships wave-1 rules only.** The checks that need a core, a protocol or a
bundle to inspect (`purity`, `realm`, `layers`, `protocol`, `orphans`,
`bundle`, `design`) arrive with the thing they check. A check written before its
subject is a check that gets written wrong.

---

## Wave 2 — The core, part by part

The core is pure: no DOM, no `fetch`, no clock, no randomness, no `node:*`.
Everything environmental arrives through an explicit port.

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 2.0 | **The oracle lands first** — `tests/golden/` copied byte-for-byte, with an md5 assertion per fixture | Editing one byte of a fixture turns the suite red. The pinned date's weekday is **wrong on purpose** and a test that "fixes" it has broken the oracle | +120 | TODO |
| 2.1 | Ports seam — the one place the environment enters | `checks/purity.ts` fails on a core file that references any ambient global; **and** `tests/ports.test.ts` proves all four `stubPorts()` members throw the literal `no <name> port configured` | +260 | TODO |
| 2.2 | Inference base — the abstract contract, one fake concrete | A scripted fake drives a full turn in a host test | +220 | TODO |
| 2.3 | Inference real — one HTTP concrete, streaming | Tokens arrive incrementally from a real endpoint; the test asserts **>1 chunk**; `describeRequest` returns the literal body | +260 | TODO |
| 2.4 | The react loop — the smallest cycle that terminates | The loop runs, emits every lifecycle event, and ends on a **declared terminal**. No `FLOWS`, no driver, no `MAX_TRANSITIONS` — those are 4.5 | +300 | TODO |
| 2.5 | Structured response — parse the model's reply into typed parts | Golden cases parse exactly; a malformed reply degrades, never throws | +340 | TODO |
| 2.6 | Prompt assembly — components, ordering, the identity file | The rendered prompt is **byte-identical to `tests/golden/render-*.prompt`** and printable for inspection | +520 | TODO |

**2.0 is new and it is first.** `ARCHITECTURE.md` §10.1 rules TypeScript, which
makes every salvaged module a transliteration of 1453 lines of code — and the
only thing standing between a transliteration and a silently changed prompt byte
is a golden fixture. The oracle must exist before the first module that can
break it, which is 2.5, not 2.6.

**2.4 lost the flow table.** It moved to 4.5, where the second flow earns it —
see `ARCHITECTURE.md` §5.6 and §10.3.

**2.7 moved to 3.4.** Persistence in wave 2 would mean building IndexedDB access
in the main realm and migrating it into the worker in wave 3 — the exact
migration this architecture exists to prevent. Wave 2 persists through
`StorePort` against `adapters/test/store.ts`, which is a swap and not a rewrite,
because the port seam already exists at 2.1.

---

## Wave 3 — Off the main thread

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 3.1 | Engine hosted in a Web Worker | The main thread stays responsive during a long turn — **measured**, not assumed. The single-writer election refuses a second tab with `fatal{reason:'another-tab'}` rather than corrupting the store | +320 | TODO |
| 3.2 | The worker message protocol, typed both ways | `checks/protocol.ts` proves `REPLY_OF` total against both unions, every `ToEngine` has a non-empty handler, and every `FromEngine` is emitted **and** written into client state; `src/protocol/**` holds no behaviour | +380 | TODO |
| 3.3 | Streaming across the worker boundary | Tokens render as they arrive, through the worker, **in the built export served at a subpath** | +180 | TODO |
| 3.4 | Transcript + persistence, worker-owned (was 2.7) | Reload the page mid-session and the history is intact. The store allocates every `seq`; a tab closed mid-stream reopens as a turn **labelled interrupted**, never as a spinner that never resolves | +420 | TODO |

---

## Wave 4 — Agent, tools, environment

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 4.1 | Agent identity file — who it is, read verbatim | Editing the identity file visibly changes behaviour with no code change | +260 | TODO |
| 4.2 | Tool contract — declare, describe, execute, feed back | A tool call round-trips end to end in the page. A tool returning 4MB is capped and the model reads the elision sentence | +340 | TODO |
| 4.3 | The first real tools — the minimum set that makes it useful | Each tool is exercised by a **real turn**, not a unit test alone. One deliberately slow tool measures whether serialised turns are acceptable | +300 | TODO |
| 4.4 | Tool errors are first-class | A failing tool produces a recoverable turn, never a dead session — and the assertion is on the tool's **own sentence**, not a generic failure | +140 | TODO |
| 4.5 | The second flow, and the flow table that it earns | Both `react` and `full` complete a turn from the page; a **deliberately mistyped edge fails at load naming the offending edge**, not on turn 40 | +480 | TODO |

**4.5 is where `core/flow/**` and `core/agent/driver.ts` land.** A validated
edge table with one flow in it is a table with nothing to decide; the second
flow is what makes `validateFlow` worth having. Phases need tools, which is why
this sits at the end of wave 4 and not in wave 2.

---

## Wave 5 — The sandbox

| # | Intent | Acceptance | Status |
|---|--------|-----------|--------|
| 5.1 | Decide the isolation substrate on measured evidence | A written comparison with real numbers, ringmaster-approved | TODO |
| 5.2 | Build the smallest viable Alpine image | Size recorded in bytes; build reproducible from a script in-repo | TODO |
| 5.3 | Boot it in the page | A command runs in the sandbox from the UI and its output returns | TODO |
| 5.4 | The agent can use it as a tool | A model-initiated command executes and the result re-enters the loop | TODO |

---

## Wave 6 — The interface

Runs in parallel with waves 2–5 from 1.4 onward. Owned by ui-director and
ui-builder, gated by `docs/DESIGN.md`. Six surfaces in **one** document,
addressed by `?panel=<id>` — not six routes (`ARCHITECTURE.md` §10.2 ruling 4).
The four browser-driven checks are **not** part of `bun run gate`; they need a
build and a real browser and run in the deploy path beside the smoke check.

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 6.1 | Design law + tokens — theme, type, colour, motion, states | `checks/design.ts` runs in `bun run gate` with a **named sub-check per rule**, each with its own failure message; its scan roots are one exported constant covering `src/ui/**` and `src/app/**` | +240 | TODO |
| 6.2 | Primitives and the addressed shell | Every primitive renders all its states in the built export; every `surfaces.ts` entry has a unique `?panel=` address honoured **on load**; `Shell.tsx` sets `data-panel-ready="<id>"` and the browser checks wait on it, never on a delay. Seeds `contrast-ratchet.json` from a real build | +520 | TODO |
| 6.3 | The Workbench — watch a turn happen, in ONE scroll | A person follows a full turn without a debugger. All eight row kinds hang off one spine; there is no second panel holding the messages | +560 | TODO |
| 6.4 | The evidence surfaces — Prompt, Context, Tools | Context renders the **literal request body that left the tab** and it is byte-comparable to what the endpoint received; Tools lists every declared tool and nothing else | +440 | TODO |
| 6.5 | Cold-open journey | A first-time user reaches a streaming token without documentation. `scripts/browser/coldopen.ts` counts **≤ 2 clicks local, ≤ 3 BYOK** against the built export at a subpath | +300 | TODO |

**6.4 is not polish.** It is the instrument for "the harness never tells the
model something it has not done". The prior tree told its model it had a
container that did not exist, and the lie survived testing because nothing
rendered what was actually sent — the prompt inspector cannot cover this,
because assembly can be entirely correct while the transport sends something
else. See `ARCHITECTURE.md` §10.2 ruling 5.

---

## The line budget

Every increment from 1.1 onward declares a **Lines** figure: its expected net
addition to `src/**` plus `scripts/**`. `checks/size.ts` reports the real total
and its delta; **exceeding a declared budget is a ringmaster conversation, not a
gate failure** (`ARCHITECTURE.md` §8.3). The one ratcheted number is `max`, the
largest single file, which only goes down and which arms at 1.6.

Relocating source out of `src/` or `scripts/` to move the total is a violation,
not a refactor.

Declared total for waves 1–6 (wave 5 undeclared — it is a measurement, not a build): **+7,400 lines.** The old tree was 7,143 lines of
`core/` alone. If this one arrives at the same place with a page, a worker, a
protocol and an interface included, the budget did its job.

---

## Standing rules

- **Retro every ten increments.** The junior writes the comprehension pass, the
  critic runs the five attacks over the whole tree, the ringmaster rules on
  drift, and the architect cuts what did not earn its place. A retro that
  deletes nothing is a retro that did not happen.
- **The three docs are the only channel between agents.** `ARCHITECTURE.md` is
  what is true, `PLAN.md` is what is next, `PROGRESS.md` is what was proven.
  Nothing is coordinated in anyone's head.
- **NO-GO returns to the architect, never to the coder.**
