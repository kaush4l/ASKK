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
| 0.4 | Old tree deleted whole and tagged; **`CLAUDE.md` rewritten** to match `ARCHITECTURE.md` | DONE |

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
| 1.1 | Barebones Bun + Next app that runs | `bun run dev` serves a page with one identifying string | +80 | DONE |
| 1.2 | Static export | `bun run build` emits `out/`, zero server code in it | +20 | DONE |
| 1.3 | Subpath-correct export | `scripts/serve-subpath.ts` serves `out/` under `/ASKK/` and the page loads with **zero** console errors and **zero** 404s — the failure mode that has bricked this project before | +90 | DONE |
| 1.4 | Deploy path proven | The hosted URL loads and shows the identifying string | +60 declared · **+231 actual** | DONE |
| 1.5 | Worker emission, as a repo-owned regression guard | A worker started from the **built** export at a subpath replies with its sentinel: zero console errors, no 404 for the worker chunk. Reproducible locally via `scripts/serve-subpath.ts`, not only on the deployed URL. The same probe **asserts** the three Web Lock behaviours §7.3's election rests on: it grants in a worker, `{ifAvailable:true}` grants when free, and — the one the election actually rests on — a second `{ifAvailable:true}` request made **while the first callback is still pending** receives `null`. MEASURED M5 did not prove this: its callback returned, so the lock released (`ARCHITECTURE.md` §7.3) | +70 declared · **+340 actual** | DONE |
| 1.6 | The gate exists, and it fails | `bun run gate` runs; someone breaks one rule on purpose and it goes red **naming that rule**. It invokes **every** check that exists at that moment — `checks/purity.ts` from 2.1 included, whatever order the waves land in — plus `checks/size.ts` (**reporting** `max`; the ratchet arms at the end of wave 2), the export/no-server-code assertion, and `verify-export.ts` in the deploy path. It ships `checks/gate-coverage.ts`, which fails if any `scripts/checks/*.ts` is not invoked, and it **prints the count of checks it ran** | +220 declared · **+320 actual** | DONE |

| 1.7 | The documents join the gate | `checks/docs.ts` runs inside `bun run gate` and is watched red on each of its six rules. **every §4 file-map entry that does not exist yet is tagged with the increment that creates it** — that tagging pass is the bulk of this increment's work; every file under `src/` and `scripts/` is named in §4; every §4 entry exists iff its increment is `DONE`; every `DONE` increment has a PROGRESS entry with the gate's check count; every `§N.M` resolves; every `scripts/**` path cited in `docs/` exists or is scheduled; every PROGRESS entry citing a verdict has a `docs/rulings/` file | see wave budget | TODO |

**1.7 reopens wave 1 for one increment**, because the gate 1.6 built was
incomplete in a way that eleven increments of documents then demonstrated: six
documented facts that were not facts, in 3,741 lines of docs against 360 lines
of source. `ARCHITECTURE.md` §8.7 is the design and is honest about the limit —
five of the six are mechanically catchable, the sixth was well-formed and only a
reader found it. Wave numbers here are ordering, not chronology; 6.x already
runs in parallel with 2–5.

**Wave 1 shipped.** `https://kaush4l.github.io/ASKK/` serves the scaffold: six
requests, six 200s, zero console errors, React hydrated.

**1.4 overran its budget: +60 declared, +231 actual.** Accepted, and recorded
rather than waived. The overrun is `scripts/verify-export.ts` (113 lines), which
1.4 needed because its acceptance is *the hosted URL* and a browser check inlined
in a heredoc cannot be pointed at one. Per `ARCHITECTURE.md` §8.3 that is a
conversation, and this is it: the increment bought a permanent, URL-addressed
artifact gate that every later deploy reuses, which is why the budget was the
wrong number rather than the work being wrong. `ARCHITECTURE.md` §8.4 now rules
on it and on its overlap with `smoke.ts`.

*(This paragraph closed with "Wave 1 total: +421 against +500 declared, so the
wave came in under budget." That was written before 1.5 and 1.6 landed and was
never revisited. Wave 1 finished at **1,137 against +540**. See the line-budget
section: the sentence survived because nothing recomputed it, which is the
argument for reporting a measured number rather than narrating an estimate.)*

**1.6 is now blocking for 2.1's product, not just for wave 1.** 2.1 shipped
`checks/purity.ts` with `bun run purity` as its only caller, because `gate.ts`
does not exist yet. That was right for 2.1 and is wrong to leave standing: a
check outside the gate is the defect this project has caught three times in
other forms. `ARCHITECTURE.md` §8.6 adds the standing rule — an increment that
adds a check adds it to `gate.ts` in the same commit — and
`checks/gate-coverage.ts` enforces it by enumerating the directory.

**1.3's "zero 404s" was weaker than it read, and 1.4 is what actually proved
it.** `serve-subpath.ts` shipped a catch-all 302 that answered every missing
path with the document at 200, so the local server could not produce the failure
1.3 asserts the absence of. The deployed run in 1.4 is authoritative because
GitHub Pages returns real 404s. `ARCHITECTURE.md` §8.4 now requires every
browser check to open with a control — a known-missing path must 404 — so a
server that cannot fail aborts the run instead of passing it.

**1.5 is a guard, not a discovery.** `docs/scratch/MEASURED.md` already settled
all of it: M1 a worker loads, runs and replies from a static export at a subpath
with zero console errors; M2 webpack emits it as a **classic** worker
(`{type: void 0}`); M5 `navigator.locks` grants there and yields `null` when
held. Nothing in this increment is expected to fail — **except the lock hold,
which M5 did not test and which is the one thing here that can ship broken.**

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
| 2.1 | Ports seam — the one place the environment enters | `checks/purity.ts` fails on a core file that references any ambient global; **and** `tests/ports.test.ts` proves all four `stubPorts()` members throw the literal `no <name> port configured` | +260 declared · **+347 actual** | DONE |
| 2.2 | Inference base — the abstract contract, one fake concrete | A scripted fake drives a full turn in a host test | +220 | TODO |
| 2.3 | Inference real — one HTTP concrete, streaming | Tokens arrive incrementally from a real endpoint; the test asserts **>1 chunk**; `describeRequest` returns the literal body | +260 | TODO |
| 2.4 | The react loop — the smallest cycle that terminates | The loop runs, emits every lifecycle event, and ends on a **declared terminal**. No `FLOWS`, no driver, no `MAX_TRANSITIONS` — those are 4.5 | +300 | TODO |
| 2.5 | Structured response — parse the model's reply into typed parts | Golden cases parse exactly; a malformed reply degrades, never throws | +340 | TODO |
| 2.6 | Prompt assembly — components, ordering, the identity file | The rendered prompt is **byte-identical to `tests/golden/render-*.prompt`** and printable for inspection. **And the `max` ratchet arms here:** 2.6 writes `scripts/checks/lines.json` seeded from a tree that contains real modules, after which `size.ts` reports a delta and `max` may only go down. Shell counts (`ARCHITECTURE.md` §8.3) | +520 | TODO |

**2.6 arms the `max` ratchet** and writes `scripts/checks/lines.json`. This
previously read "end of wave 2", which is a season and not an owner — a
deliverable assigned to a date is a deliverable nobody is accountable for, and
it sat unowned for three increments while the number it arms was quietly
excluding `deploy.sh`.

**2.1 overran: +260 declared, +347 actual.** Accepted. The overrun is the
tokeniser in `checks/purity.ts`, and it is accepted **on a condition that is
falsifiable**: `checks/realm.ts` must *import* that tokeniser, not write a second
one. If it re-implements, the trade was never made and the overrun was just an
overrun — so realm's increment carries that as an acceptance, and
`ARCHITECTURE.md` §4 names purity.ts as the tokeniser's owner. The check was
also proven both directions: it named file, line and identifier on a planted
violation, and stayed green on a file containing the oracle's own
`self-contained` bytes — which is the false positive §2.1's tokeniser rule was
written to prevent, now measured rather than argued.

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
| 3.1 | Engine hosted in a Web Worker | The main thread stays responsive during a long turn — **measured**, not assumed. The single-writer election refuses a second tab with `fatal{reason:'another-tab'}` rather than corrupting the store. **`src/client/worker-probe.ts` and `src/engine/probe.worker.ts` no longer exist** — 179 lines of wave-1 scaffold that ran on every production page load, replaced by the real worker, with `verify-worker.ts` re-pointed at it | +320 | TODO |
| 3.2 | The worker message protocol, typed both ways | `checks/protocol.ts` proves `REPLY_OF` total against both unions, every `ToEngine` has a non-empty handler, and every `FromEngine` is emitted **and** written into client state; `src/protocol/**` holds no behaviour | +380 | TODO |
| 3.3 | Streaming across the worker boundary | Tokens render as they arrive, through the worker, **in the built export served at a subpath** | +180 | TODO |
| 3.4 | Transcript + persistence, worker-owned (was 2.7) | Reload the page mid-session and the history is intact. The store allocates every `seq`; a tab closed mid-stream reopens as a turn **labelled interrupted**, never as a spinner that never resolves | +420 | TODO |

---

## Wave 4 — Agent, tools, environment

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 4.1 | Agent identity file — who it is, read verbatim | Editing the identity file visibly changes behaviour with no code change | +260 | TODO |
| 4.2 | Tool contract — declare, describe, execute, feed back | A tool call round-trips end to end in the page. A tool returning 4MB is capped and the model reads the elision sentence | +340 | TODO |
| 4.3 | The first real tools — the minimum set that makes it useful | Each tool is exercised by a **real turn**, not a unit test alone. One deliberately slow tool measures whether serialised turns are acceptable. **`docs/scratch/REFERENCES.md` is deleted here** — its recon of loop, prompt and tool mechanics was input to this increment and has no reader after it | +300 | TODO |
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
build and a real browser and run in the deploy path beside `verify-export.ts`. Like it, they take a **URL, not a directory** (`ARCHITECTURE.md` §8.4).

| # | Intent | Acceptance | Lines | Status |
|---|--------|-----------|-------|--------|
| 6.1 | Design law + tokens | `checks/design.ts` runs in `bun run gate` with a **named sub-check per rule**, each with its own failure message; its scan roots are one exported constant covering `src/ui/**` and `src/app/**`. **`DESIGN.md` needs no reconciliation — it was already correct** (see the note below) | +240 | TODO |
| 6.2 | Primitives and the addressed shell | Every primitive renders all its states in the built export; every `surfaces.ts` entry has a unique `?panel=` address honoured **on load**; `Shell.tsx` sets `data-panel-ready="<id>"` and the browser checks wait on it, never on a delay. Seeds `contrast-ratchet.json` from a real build | +520 | TODO |
| 6.3 | The Workbench — watch a turn happen, in ONE scroll | A person follows a full turn without a debugger. All eight row kinds hang off one spine; there is no second panel holding the messages | +560 | TODO |
| 6.4 | The evidence surfaces — Prompt, Context, Tools | Context renders the **literal request body that left the tab** and it is byte-comparable to what the endpoint received; Tools lists every declared tool and nothing else | +440 | TODO |
| 6.5 | Cold-open journey | A first-time user reaches a streaming token without documentation. `scripts/browser/coldopen.ts` counts **≤ 2 clicks local, ≤ 3 BYOK** against the built export at a subpath | +300 | TODO |

**6.1's second half was struck: it scheduled the repair of a contradiction that
never existed.** This paragraph used to assert that `DESIGN.md` stated a
destination count contradicting its own section list, pointed its token check at
`app/`, and named seven superseded scripts. **All three were false, and had been
from the beginning.** `git show 711a958:docs/DESIGN.md` line 253 reads *"Six
surfaces, one address each"* in DESIGN's **first commit**, which also names
`src/ui/tokens.css` and `checks/design.ts` twelve times.

`ARCHITECTURE.md` §10.2 had already retracted the claim — *"all six were
executed by the ui-director; DESIGN.md as it stands agrees with every one"* —
and PLAN never received the correction. A coder arriving at 6.1 would have
edited a correct document to match a misreading, or marked a no-op done.

It cost more than that: the retro's ringmaster read this paragraph and proposed
cutting `DESIGN.md` to a stub on the grounds that it "has been wrong for eleven
increments." One untrue sentence here nearly cost a correct 660-line document
(`ARCHITECTURE.md` §10.5). §10.2's tense convention — *a ruling states the
decision, not the state of the other document* — was written into ARCHITECTURE
and never applied to PLAN. It is now.

**6.4 is not polish.** It is the instrument for "the harness never tells the
model something it has not done". The prior tree told its model it had a
container that did not exist, and the lie survived testing because nothing
rendered what was actually sent — the prompt inspector cannot cover this,
because assembly can be entirely correct while the transport sends something
else. See `ARCHITECTURE.md` §10.2 ruling 5.

---

## The line budget — per wave, reported per increment

**Per-increment budgets were tried for eleven increments and are abandoned.**
The measured record, `src/**` + `scripts/**`, counted at the retro:

| | Declared | Actual | |
|---|---|---|---|
| Wave 1 (1.1–1.6) | +540 | **1,137** | 2.1× |
| Wave 2 so far (2.1) | +260 | **334** | 1.3× |
| **Total** | **+800** | **1,471** | **1.84×** |

A sustained 84% over — not three isolated overruns — and **the number never once
changed a decision.** Every overrun was reviewed and ruled correct work on a
wrong estimate: 1.4 bought a URL-addressed artifact gate, 1.5 bought a standing
assertion for four measured facts, 2.1 bought a tokeniser `checks/realm.ts` will
reuse. A number that is always wrong and never binding is ceremony wearing a
check's clothes — which is `ARCHITECTURE.md` §8.3's own diagnosis of `total`,
never applied to itself.

> **Struck:** this section previously read *"Wave 1 total: +421 against +500
> declared, so the wave came in **under** budget."* Wave 1 was **1,137 against
> +540**. The claim was wrong by 2.7× and was the only budget figure anyone
> would have read. It is one of the six untrue sentences the retro found, and
> the most consequential, because it made an 84% overrun look like discipline.

**What replaces it.** A budget is declared **per wave**, in the wave's heading,
and `checks/size.ts` **reports** the actual total. Increments no longer carry a
Lines column for new work; the DONE rows keep their declared-vs-actual figures
as the record of why per-increment was abandoned. Exceeding a wave budget is a
ringmaster conversation. Relocating source out of `src/` or `scripts/` to move
the number is a violation, not a refactor.

**Wave budgets.** Wave 2: **+2,000** (2.0–2.6, plus 1.7). Wave 3: **+1,400**.
Wave 4: **+1,600**. Wave 6: **+2,200**. Wave 5 declares nothing — it is a
measurement, not a build. These are estimates by the same method that ran 84%
over, so they are stated as *the number a wave should be argued against*, not as
a number anyone should expect to hit.

## Housekeeping, scheduled

Small debts that are real, owned, and would otherwise be discovered by whoever
trips on them. Each names the increment that clears it.

| Debt | Cleared by |
|---|---|
| Eleven stale `.claude/worktrees/*` registrations in this repo | 1.7 |
| `scripts/verify-worker.ts`'s header says "the four facts"; it asserts **seven** | 1.7 |
| `docs/scratch/REFERENCES.md` — wave-0 recon, input to wave 4 | 4.3 |
| `src/client/worker-probe.ts` + `src/engine/probe.worker.ts` — 179 lines of wave-1 scaffold on every page load | 3.1 |
| `isConfigured` returns with its first real caller | 3.x, with the inference catalogue |

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
