# ROADMAP — the seven increments, ruled

> Produced by the three-team round of 2026-08-22: four read-only researchers surveyed
> the tree, three team leads chartered one increment each, three team bar-raisers
> attacked their own team's charter, and one top-level bar-raiser ruled over the
> produce. The lead re-verified every load-bearing measurement below by hand before
> accepting it. This file is the plan of record; `docs/STATUS.md` records what has
> actually landed.

## RE-MEASURED 2026-08-23 — the survey below is dated, and these claims are now FALSE

**Read this before trusting anything under it.** The survey was taken on
2026-08-22 and four increments have landed since. Over two rounds, five teams
re-verified this file before relying on it and each found claims that no longer
hold — eleven were reported before this table was written, and re-running the
reports found errors in them too. What follows is every claim I could settle with
a command, with the command. Everything below this section is left as WRITTEN ON
2026-08-22, because a survey is a dated measurement and silently editing one
destroys the record of what was true when the plan was made; where a claim is
load-bearing for an increment that has not landed, it is corrected in place too.

**Increments 1, 2, 3 and 4 have LANDED.** Their acceptance criteria are marked at
each heading. 5 is in progress, 6 and 7 are not started.

| Claim below | Status | Command that settled it |
|---|---|---|
| "`grep -rn wasm_bindgen_test crates` returns 0" (twice) | **FALSE — 32 mentions, of which 20 are actual `#[wasm_bindgen_test]` TESTS.** Counting mentions is what the original claim did, so both numbers are given rather than the flattering one | `grep -rn wasm_bindgen_test crates \| wc -l`; `grep -rn '#\[wasm_bindgen_test\]' crates \| wc -l` |
| "`crates/script` is 155 lines of `todo!()` in `core`'s closure", "`rhai`" | **GONE** (commit `3033672`) | `ls crates` → 8 crates, no `script`; `grep -rn rhai crates/core/Cargo.toml` = 0 |
| "`crates/agent/src/forge.rs` … re-exported at `lib.rs:52-53`" | **GONE** | `ls crates/agent/src/forge.rs` → no such file |
| "25 `todo!()` across 14 files" | **9 in code** (rest are prose about them) | `grep -rn 'todo!' crates \| grep -v '///' \| grep -v '//!'` |
| "`origin/gh-pages` is `81d2826 deploy 187dc39` … `main` is `de10ca8`" (3 places) | **STALE** — `71022f8 deploy fab8f7c` / `9fe9542`; gh-pages is 5 commits behind, not six increments | `git log -1 --oneline origin/gh-pages`; `git log -1 --oneline main` |
| "`docs/STATUS.md` gate = four commands, none of them `publish.sh`" | **FALSE — six**, step 6 is `./publish.sh --dry-run` | `grep -n 'THE GATE' docs/STATUS.md` |
| "9 files sit at exactly 200 lines" | **16** | `find crates -name '*.rs' -exec wc -l {} \; \| awk '$1==200' \| wc -l` |
| "`crates/agent/src/environment.rs:76-94`, `:99`, `:54`" | **WRONG PATH** — it is a directory: `environment/mod.rs:83` (BINARIES[28]), `:101` (ABSENT[6]), `:55` (`DURABLE`) | `ls crates/agent/src/environment/` |
| "`crates/core/src/findfiles.rs` already caps at 60" | **WRONG PATH** — `crates/core/src/files/find.rs` | `find crates -name '*.rs' -path '*find*'` |
| "`read_range` … busybox-only (`dd`/`sed -n`)" | **LANDED, and the applets were wrong** — neither `dd` nor `sed` is in `BINARIES` | `grep -rn '"dd"\|"sed"' crates/agent/src/environment/` = 0; `grep -rn read_range crates/kernel/src/workspace.rs` |
| "`crates/ui` has no tests at all" / "3% of the tests" | **FALSE — 24 `#[test]` inside `src`.** What is absent is `crates/ui/tests/`, which is the bin-only fact the file states correctly elsewhere | `grep -rn '#\[test\]' crates/ui/src \| wc -l`; `ls crates/ui/tests` → no such directory |
| "zero touch-input media queries … `grep -c 'pointer: coarse\|hover: none' web/*.css` = 0" | **The grep is still 0 for real rules and the CLAIM is still false.** `d5b1cb0` landed the guard as `@media (hover: hover) and (pointer: fine)` at `web/base.css:107` — a pattern this grep does not match. `base.css`'s only `hover: none` is inside a comment at `:105`. A measure that cannot see the fix is not a measure | `grep -n 'pointer: coarse\|hover: none\|hover: hover' web/base.css` |
| "`@keyframes` = 3 (surfaces 1 + strip 2)" | **4 real rules** — chrome 2 (`:195,196`), strip 1 (`:109`), surfaces 1 (`:187`). `grep -c` says 5; `strip.css:106` is the words inside a COMMENT. This is the same comment-counting trap a prior team reported here, so I re-ran it by eye | `grep -n '@keyframes' web/*.css` (read each hit — do NOT use `-c`) |
| "4 `transition:` declarations" (body) | **6, all real** — base 1, chrome 1, controls 2, surfaces 2. The file's own evidence line already said 6; the prose beside it said 4, so this file disagreed with itself | `grep -n 'transition:' web/*.css` |
| "`grep -rn ROUTE_CHOSEN crates` hits ONLY `crates/agent`" (twice) | **FALSE** — also `core/src/board/flow.rs`, `core/src/debug/{route,turns}.rs`, `core/tests/route34.rs` | `grep -rln ROUTE_CHOSEN crates` |
| "`board/stage.rs` ≤ 130 (from 149)"; "`board/flow.rs` ≤ 90" | **LANDED** — 127 and 90; `flow.rs` did not exist when the plan was written | `wc -l crates/core/src/board/*.rs` |
| "`workers/spawn/reply.rs:138` keeps ONE slot per peer" (4 places) | **FIXED, and the path moved** — `workers/spawn/reply/turn.rs:116`, whose header records the overwrite it replaced | `grep -rn 'waiting.borrow_mut' crates/adapters_web/src` |
| "the word `quest` appears nowhere in `crates/`, `public/` or `docs/`" | **FALSE for `crates/` and `docs/`** — 4 hits in `crates` (a test fixture and a doc comment that use it as a deliberately UNKNOWN word), 13 in `docs` (this file). The substantive claim — no quest FLOW — still stands | `grep -rniE '\bquest\b' crates public docs` |
| T53 "Nothing in this tree tests the ROUTER" | **FALSE — 22 tests** across `agent/tests/{strategy,vote_shapes,route34}.rs` and `core/tests/route34.rs` | `grep -c '#\[test\]' crates/agent/tests/strategy.rs crates/agent/tests/vote_shapes.rs crates/agent/tests/route34.rs crates/core/tests/route34.rs` |
| "`crates/agent/src/strategy.rs:71-83` — any unparseable vote becomes `Route::React`" | **STALE LINE** — `route_of` is at `:162`; `:71-83` is now `Route::named`'s doc | `grep -n 'fn route_of' crates/agent/src/strategy.rs` |
| "`crates/agent/src/reply.rs:39` is a live `todo!("Plan/Verify contracts")`" | **DELETED 2026-08-23** with `ResponseContract::{PlanSteps,Verdict}`, the `Verdict` enum, five `ExitCondition` variants and `core::App.phases` | `grep -rn 'Verdict' crates` → 7 hits, all prose recording the deletion |
| "`Verdict::` has ZERO references" | **TRUE when written, and the TYPE is now gone too** | `grep -rn 'Verdict::' crates \| wc -l` = 0 |
| "`state.phase` is written once at `state/opening.rs:26` and never reassigned" | **STILL TRUE** — and `PhaseId::Verify`'s config was deleted for it (`9fe9542`) | `grep -rn 'state\.phase' crates` → two reads, one test, no assignment |
| "`grep -rn 'struct Artifact\|enum Artifact' crates` = 0" | **STILL TRUE** (increment 5 in progress) | `grep -rn 'struct Artifact\|enum Artifact' crates \| wc -l` |
| "`PendingAgents` in `adapters_test`" (increment 1's acceptance) | **LANDED UNDER ANOTHER NAME** — the rendezvous is inside `ScriptedAgents`; the test hangs into `block_on`'s panic under a serial loop, which is the control the criterion asked for | `grep -n 'rendezvous' crates/core/tests/delegation.rs` |
| "`crates/context/src/args.rs`" (increment 2's acceptance) | **LANDED** | `ls crates/context/src/args.rs` |

Two claims I could NOT settle and am leaving standing rather than deleting:
"~2.3 MB of wasm" and "the guest wants roughly 578 MiB" both need a build and a
running tab, which no command in this checkout produces. They are marked here as
unverified rather than quietly dropped.

## What the product is today

Open it on a phone today and here is what happens.

You get the six-increment-old build, because `origin/gh-pages` is `81d2826 deploy 187dc39` and `main` is `de10ca8`. The page loads well: it is genuinely responsive (breakpoints at 30rem / 48rem / 1099px, a 44px target floor, a nav sheet, a pre-paint skin script in `web/index.html`, a `#boot` fallback that names the one cause a person can fix, a real `<noscript>`), ~2.3 MB of wasm and ten stylesheets, no CDN, no third-party script. This is better mobile and better front-door work than most products ship.

Then you type a message and it fails. `public/models.json` defaults to `local` = `http://127.0.0.1:8873/v1` and `public/agents/main/agent.md:4` is `model: local`; Safari has never let a public page call loopback and does not even ask. On `main` that failure now speaks — `ModelError::LocalNetwork` naming Chrome, Safari, Local Network Access and both fixes — but that fix is on commit `8508f75`, which is not deployed, so what a phone actually gets is the silent version. Go to Settings, pick `openrouter`, paste a key, and chat works properly. That path is real and it is good.

Tap into the Workspace and you start pulling 47 MB of container2wasm (prewarm is behind mounting the Terminal, `crates/ui/src/terminal/mod.rs:87` — a good decision), you need cross-origin isolation that GitHub Pages cannot serve as headers so it comes from a service worker and a forced second load, and the guest wants roughly 578 MiB. My inference, not a measurement: that tab does not survive on iOS, and nothing on screen tells you the guest is desktop-first. Even where it boots, the machine is 28 busybox applets with python3, node, git, curl, make and a compiler explicitly absent (`crates/agent/src/environment.rs:76-99`), no network, `DURABLE = false`, one shared PTY, and whole-file base64 writes.

So, plainly: **HARNESS today is an unusually well-engineered single-agent chat client with a stage router, a first-class prompt-assembly system, and a Linux terminal you can look at but cannot build in.** Of the owner's eight goal sentences, two are genuinely delivered (agents-as-configuration for agents that are permutations of what ships; a message-selected loop, which nothing else in the surveyed field does), one is half-delivered (three flows exist as three stage lists; QUEST does not exist and the machinery for the other two is dead — `state.phase` is written once at `state/opening.rs:26` and never reassigned, and `Verdict::` has zero references in the tree), and five are at or near zero: ARTIFACTS have no type, agents cannot exchange anything mid-flight (one string in, one string out, depth 1 by construction at `worker/world.rs:59-62`), there is no one common application state but six stores, the environment cannot build anything, and "multiple parallel agents" is a wedge — the shipped roster is `main` plus a deliberately tool-less `critic`, so there is no configuration in which two agents do work at the same time, and if you ask one peer twice on a line the turn hangs forever (`workers/spawn/reply.rs:138`).

The distance from here to the ambition is not polish. It is that the capabilities the owner leads with all live in `crates/adapters_web`, which the gate only type-checks — and the one host test that claims to prove parallelism passes under fully serial execution.

## The hostile summary

A hostile reviewer would say: this is the best-documented single-agent chat client I have ever read, and I cannot verify that one of its headline claims is true. 37,660 lines across 312 files, 586 #[test] attributes, and not one of them runs in a browser — `grep -rn wasm_bindgen_test crates` returns 0. The three capabilities on the tin (multiple parallel agents, agents communicating across threads, an agent with an environment that does work) are implemented EXCLUSIVELY in `crates/adapters_web`, which the gate only `cargo check`s. The one test that claims to prove parallelism, `crates/core/tests/delegation.rs:180-201`, passes under fully serial execution, because `crates/adapters_test/src/lib.rs:27-29` returns `std::future::ready` and `agents.rs:46-63` pushes to `seen` synchronously — its own comment ("both sub-agents receive their goals before either result comes back, which is what 'at the same time' means") asserts a property it does not measure. That is the project's own T59 defect sitting on the owner's headline goal. Meanwhile the artefact a person can actually open is six increments old: `origin/gh-pages` is `81d2826 deploy 187dc39` while `main` is `de10ca8`, and no charter, no bar-raiser and no acceptance criterion in this entire packet mentions shipping. Structurally: `crates/script` is 155 lines of `todo!()` compiled into `core`'s dependency closure via `crates/core/src/error.rs:13`, `Verdict::` has ZERO references anywhere in the tree, `Tier::` resolves to `T0Rust` and nothing else in 11 sites, `state.phase` is written once at `state/opening.rs:26` and never reassigned, 9 files sit at exactly 200 lines and 55 within 20 of the ceiling, and 52 functions exceed the 40-line rule under a waiver with 32 of them in the crate that has 1.9 tests per thousand lines and no tests/ directory. And the word `quest` — one of three flows the owner named first-class — appears nowhere in `crates/`, `public/` or `docs/`. The prose discipline here is genuinely AAA. The verification and the delivery are not, and prose is the half a reviewer cannot audit.

### The blockers between here and AAA

**Verification — the gate cannot execute the claims**

Every capability the owner names as headline lives in the one crate the gate cannot run, and the host test double makes concurrency unobservable by construction. This is not a coverage gap; it is an inverted risk model. Three of three charters wrote their acceptance criteria against `cargo test --workspace --exclude adapters_web` — the exclusion that makes each of their own headline claims unfalsifiable.

*Evidence:* `grep -rn wasm_bindgen_test crates` = 0; `crates/adapters_test/src/lib.rs:27-29` `ready()` = `std::future::ready`; `crates/adapters_test/src/agents.rs:46-63` records synchronously then returns `ready`; `crates/core/tests/delegation.rs:180-201` asserts order only; tracker T51 (adapters_web gets `cargo check` only, twelve claims untestable), T59 (vacuous assertions)

**Delivery — the product does not reach the surface the owner named**

`gh-pages` is six increments behind `main`. The four-command gate has no publish step, so the app a phone loads is not the app any of the three surveys described — including the fix that makes the default model path fail loudly instead of silently.

*Evidence:* `git log -1 origin/gh-pages` = `81d2826 deploy 187dc39`; `git log --oneline -8` shows main at `de10ca8` with 51199eb, ca59db1, 9368d7e, c3f4855, b413ab6, 8508f75, de10ca8 landed since; `docs/STATUS.md` gate = four commands, none of them `publish.sh`

**Three flows — one of them does not exist**

QUEST is absent from the tree. The nearest thing, `goal:`, is three static frontmatter keys whose loop is bounded by ONE turn: `passes::again` caps at `state.passes` and `crates/agent/src/passes.rs:26-30` deliberately does NOT reset `max_rounds` per pass. There is no status, no `blocked`, no pause, no resume after reload, no lineage.

*Evidence:* `grep -rniE '\bquest\b' crates public docs` = 0; `crates/agent/src/goal/declare.rs:39-47` (three static keys); `crates/agent/src/passes.rs:20-30` ("the real ceiling stays `max_rounds`")

**Three flows — the machinery for the other two is dead**

`react` is the only live code path. `state.phase` is set once and never reassigned, so `ask.rs:23-27` always returns `v1_phases()[0]`; the Verify `PhaseConfig`, `ExitCondition`, `PhaseExit` and `Verdict` are unreachable, and `crates/agent/src/reply.rs:39` is a live `todo!("Plan/Verify contracts")` that is unreachable only by that accident. `Verdict` is the strategy flow's outcome type and it has zero references in the entire tree.

*Evidence:* `grep -rn 'state.phase' crates/agent/src` = two READS (`ask.rs:26,83`), zero writes; `grep -rn 'Verdict::' crates | wc -l` = 0; `crates/agent/src/phase.rs:111-121` comment says the Verify config is unreachable

**ARTIFACTS — no type**

`grep -rn 'struct Artifact\|enum Artifact' crates` returns nothing. Every one of the 23 `artifact` mentions outside `crates/ui` is a comment or the literal folder string. The one type that could carry one — `context::Part::{Image,Audio,File,Fragment}` — is never constructed in production code.

*Evidence:* `crates/ui/src/files/artifacts.rs:4-8` states it as the design; `crates/context/src/types.rs:14-37` `Part` constructed only in `crates/context/tests/paper.rs:274` and `tests/fixture/mod.rs:132,223`

**Multiple parallel agents — a live wedge, and no shipped configuration that could parallelise**

Two concurrent asks to the SAME peer overwrite one resolver slot and the lead's turn hangs forever with no timeout and no error card. Worse, the shipped roster cannot demonstrate parallelism at all: `main` is the only agent with tools, and the only other agent, `critic`, ships `engine: base` with an EMPTY toolbox because a Worker's `C2wWorkspace` refuses. So the entire multi-agent story in the shipped product is one lead blocking on one text-only reviewer, one level deep.

*Evidence:* `crates/adapters_web/src/workers/spawn/reply.rs:138` `*waiting.borrow_mut() = Some((resolve, reject))`; `crates/agent/src/step.rs:126-141` does not dedupe a batch line; `crates/adapters_web/src/worker/world.rs:52-62` (`C2wWorkspace` refuses in a Worker, `NoSubAgents` = depth 1); `public/agents/index.json` = [main, critic]; `public/agents/critic/agent.md:9-25`

**The environment cannot do work**

'The agent owns an environment that can really do work — build projects' is at zero and four independent things block it: 28 busybox applets with python3/node/git/curl/make/compiler explicitly absent, no network, no persistence, one shared PTY with a 180s watchdog that DISCARDS partial output, and whole-file base64 writes with no windowed read and no checked edit.

*Evidence:* `crates/agent/src/environment.rs:76-94` (BINARIES[28]), `:99` (ABSENT[6]), `:54` `DURABLE=false`; `crates/adapters_web/src/c2w.rs:24-28` (overlay on tmpfs); `crates/kernel/src/workspace.rs:74-96` (`cat --`, base64 whole-file); tracker T44/T45/T46/T47

**One common application state — there are six**

The owner's phrase is 'one common application state'. Today: IndexedDB `harness` (page), `harness-spaces` (shared), `harness-agent-<name>` per sub-agent, `askk-workspace`, localStorage for the skin, plus three in-memory authorities on `App` by design. The page only ever sees a CURSORED COPY of a Worker's facts. `crates/core/src/batch.rs:93-96` exists specifically to detect two of these disagreeing.

*Evidence:* `crates/adapters_web/src/lib.rs:93,96`, `worker/world.rs:18,25,36,40`, `leftovers.rs:47`, `web/index.html` inline skin script; `crates/core/src/app.rs:117-133` (`running`/`calling`/`booted` in-memory by design); locks gate the LOG only (`locks/mod.rs:44-60`, tracker T60 b/c)

**KISS — speculative generality in the shipping graph**

An entire crate of `todo!()` is compiled into the wasm bundle's dependency closure to serve an error variant nothing constructs, and a 12-variant pipeline enum has no producer. 25 `todo!()` across 14 files. This is the standard the owner calls paramount, violated at crate granularity in a 9-crate workspace the owner reads as the map of the system.

*Evidence:* `crates/script/src/lib.rs` (8 `todo!`, 0 tests) reached only by `crates/core/src/error.rs:13` `use script::ScriptError;`, with zero `CoreError::Script` or `ScriptError::` construction sites; `crates/core/Cargo.toml:11` pulls `rhai`; `crates/agent/src/forge.rs:60,68` `todo!("G4")` re-exported at `lib.rs:52-53` with no caller

**UI packs and the frontend as the highest-risk crate**

'Swappable UI packs' is structurally impossible and unfalsifiable: the markup a pack must restyle is generated inside `crates/core` and injected verbatim, the stylesheet set is compiled in by trunk, and every component is typed on the browser adapter rather than on the seam. It is also the crate with no tests, guarded by a static fixture that has already silently drifted once.

*Evidence:* 85 `.class("…")` calls / 51 distinct class names across `crates/core/src`; 13 `dangerous_inner_html` in `crates/ui/src`; 135 `WebApp` mentions across 40 of 84 ui files; `crates/ui/Cargo.toml` is bin-only, `ls crates/ui/tests` → no such directory; `scripts/check-layout.sh:4-8,23` (probe, and the recorded prior drift)

**Cinema and mobile — the owner's two adjectives**

'Cinematic and dramatic' is 4 `transition:` declarations and 3 `@keyframes` in ten stylesheets, with the one piece of drama the product had (the tinted glow) demoted to opt-in and OFF by default. 'Must work on MOBILE' has zero touch-input media queries — `grep -c 'pointer: coarse\|hover: none' web/*.css` = 0 across all ten files while most transitions paint hover states — and no stated posture on the guest tier, which is desktop-first in fact and silent about it on screen.

*Evidence:* measured: transitions = base.css 1, controls.css 2, chrome.css 1, surfaces.css 2 (4 files, 6 declarations); `@keyframes` = surfaces.css 1 + strip.css 2 = 3; touch queries = 0/10 files; `web/index.html` inline script: absence of `glow` means `data-skin=plain`

**The router nobody measures**

Every deep-path mechanism the owner asked for is downstream of one cheap call to a small local model whose failure mode is SILENT degradation to the shallowest flow, and nothing in the tree measures its accuracy. On the shipped agent this is the first decision of every single turn.

*Evidence:* `crates/agent/src/strategy.rs:71-83` — any unparseable vote becomes `Route::React`; `public/agents/main/agent.md:22` `stages: [strategy]`; tracker T53 ("Nothing in this tree tests the ROUTER, and the router is the mandate's first sentence")

## The increment nobody chartered

NONE OF THE THREE PROPOSED MAKING A CLAIM EXECUTABLE OR MAKING THE PRODUCT SHIP — and the owner's goal cannot be reached without both.

The class, stated once: **a claim the gate cannot execute is not a verified claim**, and this project has been landing increments whose headline capabilities are structurally outside its gate. That is I16 one level up — I16 says a truth the system holds and does not state is a defect; the converse defect is a claim the system states and cannot check. The project wrote the first law and never wrote the second.

Four measurements, all taken this session:

1. **Zero browser tests.** `grep -rn wasm_bindgen_test crates` = 0. `adapters_web` gets `cargo check` only (T51 names twelve claims untestable by construction and nobody owns it). Every mechanism behind 'multiple parallel agents', 'agents communicate across threads' and 'an environment that can really do work' is implemented ONLY there — Workers, IndexedDB, Web Locks, the c2w PTY. 586 tests measure the half that cannot fail in the ways that matter.

2. **The test double makes concurrency unobservable BY CONSTRUCTION.** `crates/adapters_test/src/lib.rs:27-29` is `std::future::ready`, and `agents.rs:46-63` pushes to `seen` synchronously before returning it. So `join_all` in `crates/core/src/batch.rs:139` drives delegation 1 to completion before delegation 2 exists. `crates/core/tests/delegation.rs:180-201` asserts an ORDER that a fully serial `for … .await` loop would produce identically — and its own doc comment says 'both sub-agents receive their goals before either result comes back, which is what "at the same time" means'. The comment asserts the opposite of what the test measures, on the owner's headline capability. This is exactly the T59 vacuous-assertion class the project opened a tracker item for, and it is load-bearing.

3. **`crates/ui` has no tests at all** and the visual gate deliberately measures a hand-maintained static fixture rather than the app (`scripts/check-layout.sh:4-8`), a fixture whose sibling hardcoded list already drifted once and printed LAYOUT CHECK OK over a broken deployed page (`:23`). The crate the owner judges the product by is 27% of the source and 3% of the tests.

4. **Nothing ships.** `origin/gh-pages` is `81d2826 deploy 187dc39`; `main` is `de10ca8`. Six increments — including the fix that stops the default model path failing silently on exactly the device the owner named — exist only on a developer's machine. Not one charter, not one bar-raiser, and not one of the ~40 acceptance criteria in this packet mentions deploying. 'On gh-pages' is in the owner's first sentence.

The increment: **the gate grows two commands and gains one test double.** (a) A `PendingAgents` double in `adapters_test` whose delegation resolves only when the test releases it, so overlap becomes observable on the host and 'parallel' becomes assertable at all — proved by reverting `run_effects` to a serial loop and watching the rewritten test go red (T59's positive-control rule). (b) A `wasm-bindgen-test` suite for `adapters_web` under the `chrome-headless-shell` this repo ALREADY resolves at `scripts/check-layout.sh:15-17` — the infrastructure is installed and pointed at the wrong target. (c) `scripts/publish.sh` becomes a gate step, so a green round reaches the phone.

It is cheap, every piece of it already exists somewhere in the tree, and it is the precondition for every acceptance criterion the three teams wrote. Building artifacts, a rail or an argument door on top of a gate that cannot execute them is how this project accumulates another six increments of unfalsifiable green.

## The ordered plan

### 1. ✅ LANDED. [backend] Two agents at once actually works, and a test can tell: key the sub-agent waiter, make concurrency observable in the test double, and grow the gate to six commands — one that executes the browser half, one that deploys.

> **Landed by 2026-08-23.** `grep -rn wasm_bindgen_test crates` = 32 (was 0); the
> gate is six checks (`docs/STATUS.md`), step 6 `./publish.sh --dry-run`; the
> one-slot-per-peer wedge is fixed at `workers/spawn/reply/turn.rs:116`; the
> rendezvous double is inside `ScriptedAgents` rather than a new `PendingAgents`.
> One criterion was NOT taken as written: step 6 is the DRY RUN, not the push —
> `docs/STATUS.md` records why a gate step may never change the world.

**Why here.** It unblocks everything and is blocked by nothing. Three charters wrote ~40 acceptance criteria against `cargo test --workspace --exclude adapters_web`, which is the exclusion that makes each of their headline claims unfalsifiable; two bar-raisers found one instance each and nobody named the class. It also fixes a live product wedge on the owner's headline capability: `crates/adapters_web/src/workers/spawn/reply.rs:138` keeps ONE `Some((resolve, reject))` slot per peer, `crates/agent/src/step.rs:126-141` does not dedupe a batch line, and `crates/core/src/runtime/requests.rs:101` gives a person a second route to the same collision — the dropped promise never settles, `state.pending_tools` never reaches 0, and the turn hangs with no error and no card. And it ships: `origin/gh-pages` is six increments stale.

**Unblocks.** Every acceptance criterion in increments 2-7 becomes falsifiable. Closes T51's mechanism half and T59's headline instance. Makes 'multiple parallel agents' a measured claim for the first time. Puts six increments of finished work in front of the owner.

**Amended from the charter.** Not chartered by any team. Assembled from the backend survey's two deferred gaps (the duplicate-`ask` hang, 'nothing proves parallelism'), the backend bar-raiser's finding 10 (which correctly showed the pure half IS host-gateable and then deferred it anyway), and my own reading of `adapters_test/src/lib.rs:27-29`. I OVERRULE the backend bar-raiser's deferral: this is P0, not a ride-along.

**Acceptance.**

- `crates/adapters_test` gains `PendingAgents`: a delegation that records entry and resolves only when the test releases it. `crates/core/tests/delegation.rs::one_line_of_delegations_is_one_batch_and_the_next_line_follows_it` is rewritten to hold BOTH delegations pending and assert both were ENTERED before either resolved.
- POSITIVE CONTROL, recorded in the commit message (T59's rule): revert `crates/core/src/batch.rs:139` `join_all` to a serial `for … .await` and the rewritten test goes RED. Today it stays green, which is the defect.
- `ask` keys its waiters (by request id) or refuses a second concurrent ask to the same peer in words. A host test drives two calls to the SAME agent on one batch line and asserts neither hangs, both results are appended in written order, and `pending_tools` reaches 0. Zero such test exists today.
- FIFTH GATE COMMAND, own exit code, never piped: a `wasm-bindgen-test` suite over `adapters_web` under the `chrome-headless-shell` already resolved at `scripts/check-layout.sh:15-17`, exiting 0 with at least six tests — `IdbStore::open` round-trip; two `App`s on one `harness-spaces` seeing each other's writes; `locks::` `ifAvailable` returning follower for a second holder; a real `Worker` answering one `run`; a Worker's `C2wWorkspace` returning `WorkspaceError::Unavailable` (the fact three later increments depend on); the duplicate-`ask` case. Baseline: `grep -rn wasm_bindgen_test crates` = 0.
- SIXTH GATE STEP: `scripts/publish.sh` runs and `git log -1 origin/gh-pages` names the current `main` sha. `docs/STATUS.md` records the gate as six, not four.
- `cargo test --workspace --exclude adapters_web` still exits 0 (baseline 559 passed / 0 failed / 5 ignored); `python3 scripts/check-size.py` exits 0; `git diff --exit-code scripts/function-baseline.txt` exits 0.

### 2. ✅ LANDED. [standards] One non-trimming typed reader in `crates/context` owns every argument on the INVOKE PATH, `ToolHost::run` stops seeing the raw string — and the same round deletes `crates/script` and `agent::forge` out of the shipping dependency graph.

> **Landed by 2026-08-23.** `crates/context/src/args.rs` exists; `crates/script`
> and `crates/agent/src/forge.rs` are deleted (`3033672`), `rhai` has left
> `core`'s closure, and the workspace is 8 crates.

**Why here.** Sequencing: three of the next four increments add a tool argument (`record_artifact`/`read_artifact`, a delegation handle, a quest status). Without this each adds another hand-rolled reader and inherits whichever semantics it pasted. The deletion rides here and nowhere else because `crates/core/src/error.rs:13` `use script::ScriptError;` is the ONLY thing keeping `crates/script` in the graph, and this is the only increment that opens `core::error`.

**Unblocks.** Increments 5 and 6 each add tool arguments against a decided semantics table instead of a 17th and 18th copy. Removes the largest KISS violation in the tree from the wasm bundle's dependency closure.

**Amended from the charter.** Scope roughly halved per the standards bar-raiser: the false 'skills.rs does not trim' justification is struck (verified myself at `crates/agent/src/skills.rs:159`), the data-corrupting unconditional trim is split into `name()`/`text()`, the six projection read-back sites are removed, and the self-contradicting gate is deferred. I OVERRULE the bar-raiser on ONE point: it accepted `crates/kernel` as the home. `context` is correct and costs nothing. I ADD the `crates/script` + `forge` deletion, which the standards lead argued for and then declined — it belongs here because this is the only round that opens `core::error`.

**Acceptance.**

- `crates/context/src/args.rs` ≤ 200 lines, ≤ 40 per function. NOT `crates/kernel`: `crates/kernel/Cargo.toml` has one dependency and `scripts/check-layering.py:22` gives it an empty allowed-set, while `crates/context/Cargo.toml:12` already carries `serde_json` with a justification and is reachable from both `core` and `agent`. `git diff --exit-code -- '**/Cargo.toml' Cargo.toml` shows NO new dependency anywhere.
- `name(key)` trims and refuses empty; `text(key)` returns the value VERBATIM. `crates/context/tests/args.rs` ≥ 14 tests including `{"contents":"a\n"}` → `Ok("a\n")` byte-identical and `{"contents":"  "}` → `Ok("  ")`.
- A `crates/core/tests/` round-trip: `write_file` of a value with a trailing newline, read back through `read_file`, byte-identical. This is the regression the charter would have shipped (`crates/core/src/workspace/gate.rs:118`).
- SCOPE IS THE INVOKE PATH ONLY: `websearch.rs`, `workspace/gate.rs` (plus the duplicated `&dyn Fn` parameter in `observe.rs` and `proc/convention.rs`), `space/shared.rs`, `memory/host.rs`, `tools.rs`, `agents/roster.rs`, `agent/src/subagent.rs`, `agent/src/skills.rs`, and the `faculty::ToolHost::run` + `faculty::run_hosted` signatures. `grep -c serde_json crates/core/src/faculty/mod.rs crates/core/src/faculty/run.rs` = 0. Projection read-back of a recorded `ToolInvoked.args` (`proc/rows.rs`, `files/listing.rs`, `trace/requested_by.rs`, `trace/row/args.rs`, `terminal/row.rs`, `failure/from_worker.rs`) is OUT — those parse facts we wrote, with deliberate per-site defaults the reader cannot express.
- `crates/core/tests/faculty.rs::FakeBrowser` compiles against the new `ToolHost::run` signature — the second implementor, proving the seam is still implementable from outside `core`.
- `crates/core/src/proc/convention.rs`'s refusal example stays hand-written or carries its example through: `crates/agent/tests/stated.rs` asserts it against the shipped guest inventory and must stay green.
- DELETION: `crates/script/` gone, `crates/agent/src/forge.rs` gone. `grep -rn 'script' Cargo.toml crates/*/Cargo.toml` = 0; workspace crate count 9 → 8; `todo!()` count 25 → ≤ 11; `scripts/check-layering.py` updated and exits 0. `rhai` leaves `core`'s closure.
- NO `scripts/check-args.py` this round. Its rule as written is unsatisfiable — 65 `serde_json::from_str` sites exist in `crates/*/src`, 48 outside the migrated files — and the gate must not hold the correct half hostage. It follows in its own increment once the rule is measured.

### 3. ✅ LANDED. [backend] The environment stops losing work: a windowed read and a checked edit on the port, partial output surfaced when the watchdog fires, `exec` capped into the window with the cap stated, and a non-interactive boot environment.

> **Landed by 2026-08-23** (`0a99e9f`, `e27a387`). `WorkspacePort::read_range`
> exists at `crates/kernel/src/workspace.rs:87` and `read` is `read_range(…,0,0)`.
> TWO of this section's own facts were wrong and are corrected in the table at the
> top: `dd`/`sed -n` are NOT in `environment::BINARIES` (the applets the landed
> window is built on are), and `crates/agent/src/environment.rs` / 
> `crates/core/src/findfiles.rs` are both wrong paths.

**Why here.** Largest MEASURED capability delta in the tree (`docs/PARITY.md` gap 1: nothing else on the list pays off while `exec` runs in a guest that loses what it saw), it is NOT owner-gated (unlike the image rebuild and network egress, T9/T27), and increment 5's `read_artifact` needs `read_range` to exist or it must ship a sentence claiming a ranged read that `cat -- path` performed. The backend bar-raiser identified exactly this convergence in its `better_increment` and I am taking it.

**Unblocks.** Increment 5's `read_artifact` (no second reader, no false window sentence). Closes tracker T44, T45, T46, T47 as one round, which T47 itself asks for. Moves the owner's 'an environment that can really do work' off zero without touching the owner-gated image size or network questions.

**Amended from the charter.** Not chartered by any team — all three declined the environment (backend: 'blocked on an owner gate'; frontend and standards: 'not mine'). That deferral is half wrong: the image rebuild and egress ARE owner gates (T9/T27), but T44/T45/T46/T47 are pure code against the guest we already ship and nothing gates them. The backend bar-raiser named this as the one rival it seriously weighed; I am ruling it in, ahead of artifacts.

**Acceptance.**

- `WorkspacePort::read_range(cwd, path, offset, limit)`, one implementation, busybox-only (`dd`/`sed -n` — every applet used is in `crates/agent/src/environment.rs:76-94`), and `read_file` is its first caller. Size measured with `wc -c`, not by reading the file.
- A checked edit: `write_file` stops being the only way to change a file. The refusal quotes the mismatch back, per the `relative_path` law at `crates/agent/src/workspace.rs:150-200`.
- `crates/adapters_web/src/c2w.js`'s `until()` returns the partial buffer instead of `null` when the 180s watchdog fires; `Execution` carries the fact, and the model is told what was withheld rather than handed silence. Covered by increment 1's browser suite.
- `exec` and `read_file` output is capped into the Document with the cap STATED, the way `crates/core/src/findfiles.rs` already caps at 60 and says so. Today both are uncapped (`grep -E 'truncat|MAX_OUTPUT|max_len' crates/agent/src crates/core/src/workspace/gate.rs` = nothing).
- `PAGER=cat GIT_PAGER=cat EDITOR=true` set at guest boot; asserted by `crates/core/tests/guest_truth.rs` against the shipped `c2w.js`, not against a comment.
- `crates/agent/tests/stated.rs` extended: every new capability sentence is checked against `environment::BINARIES`, so no sentence describes an applet this guest does not have (I16).
- All six gate commands green, including the browser suite from increment 1.

### 4. ✅ LANDED. [backend] The route becomes a fact the core owns: decide `ROUTE_CHOSEN`'s ownership, fold it, hang `data-route` / `data-walk` / `data-stage` / `data-lap` and the rendered lap clause on the board row, and fix `stage::said` so the walk comes from the route rather than the declared list.

> **Landed by 2026-08-23** (`2f3af83`). `ROUTE_CHOSEN` is read in `crates/core`
> (`board/flow.rs`, `debug/route.rs`, `debug/turns.rs`, `tests/route34.rs`), so
> this section's own "`grep -rn ROUTE_CHOSEN crates` hits only `crates/agent`" is
> now false where it appears TWICE below. `board/stage.rs` is 127 (target ≤ 130)
> and `board/flow.rs` is 90 (target ≤ 90) — it did not exist when this was
> written, which is why the "from 149" is unrecognisable today.
>
> Its `Route::named` criterion also landed, and 2026-08-23 finished the parser it
> sits beside: `unmarked` now strips the CLOSED CommonMark set of block prefixes
> (heading, blockquote, bullet, ordered marker, nesting), so `## ROUTE: project`
> and `> ROUTE: project` stop being silent `react`s. See
> `crates/agent/src/strategy.rs` and `crates/agent/tests/vote_shapes.rs`.

**Why here.** It fixes a LIVE defect on the one shipped agent and it is the prerequisite the frontend charter assumed it already had. `public/agents/main/agent.md:22` declares `stages: [strategy]` and `crates/agent/src/stages/mod.rs:137-142` rewrites the walk at runtime, so `stage::said` counts a position against a list of one and every post-vote stage prints bare. And `ROUTE_CHOSEN` is not folded by core for anybody: `crates/core/src/failure/loop_note.rs:19` lists only STAGE_ENTERED/PASS_SPENT/GOAL_CHECKED, `crates/core/src/chat/fold.rs:77` catches the rest with `_ => false`, and `grep -rn ROUTE_CHOSEN crates` hits only `crates/agent`. Small, gateable today, and it is the half that can actually fail.

**Unblocks.** Increment 7's Flow Rail (which has nothing to draw without this) and any quest surface. Gives the three-flows story its first machine-readable representation outside `crates/agent`.

**Amended from the charter.** Extracted from the frontend charter and REASSIGNED to backend, per the frontend bar-raiser's own condition ('get the backend lead's ack in writing … the fold ownership change is not presentational'). I go further than the bar-raiser: this is not an ack, it is a different team's increment, because the frontend charter priced a fold-ownership decision as four `data-*` attributes.

**Acceptance.**

- `ROUTE_CHOSEN`'s ownership rule DECIDED IN WRITING and implemented — either added to `is_loop_fact` (accepting that it becomes a rendered loop note in chat, a behaviour change that must be costed) or given `board/flow.rs` its own `who == me` test rather than routing through `belongs_to`.
- `crates/core/tests/` drives a `project` turn and asserts the row carries `data-route="project"` and `data-walk="plan,work,verify,critique"` NON-EMPTY. This assertion is impossible today and is the whole point of the increment.
- For shipped `main`, `stage::said` resolves a position after the vote. A test pins it; today it prints bare.
- The rendered lap clause (`pass {n} of up to {of}`) is hung as an attribute by `crates/core/src/board/row.rs` — ONE author, one fact — so no second surface can fork the wording. `crates/core/src/board/stage.rs` ≤ 130 lines (from 149) and `crates/core/src/board/flow.rs` ≤ 90.
- A sub-agent's row states what this process CANNOT see rather than rendering it as not-started: stage and pass facts are owned by `who == me`, and `crates/core/src/board/stage.rs:66-70` already says a sub-agent's stages live in its Worker's log (I16).
- `crates/agent/src/strategy.rs` gains `Route::named(&str) -> Option<Route>` beside `as_str`, deliberately NOT falling to `React` — `route_of` fails toward the middle because a turn must run; a projection must not, because drawing the wrong flow is worse than drawing none.
- `shell()` in `board/row.rs` stays ≤ 40 lines; `python3 scripts/check-size.py --functions` reports no new entry.

### 5. ⏳ IN PROGRESS (Team ARTIFACT, 2026-08-23). [backend] An artifact becomes a typed, addressable, cross-thread object: a third faculty whose record lives in the shared space, whose catalog renders for every route, and whose reader is increment 3's `read_range`.

**Why here.** The owner named artifacts by name and said they are under-built; `grep -rn 'struct Artifact\|enum Artifact' crates` = 0. It is the substrate under increment 6 (a quest needs somewhere to put a deliverable that outlives a turn) and under any `returns:` shape on delegation. It comes FIFTH, not first, because two of its three mechanisms depend on work above it: the window needs increment 3's port, and the cross-thread claim is only checkable with increment 1's browser suite.

**Unblocks.** Increment 6's deliverable. A delegation `returns:` shape. The frontend's artifact surface. The overflow-offload increment (a large `exec` result becoming an artifact rather than being capped away) needs no new type after this.

**Amended from the charter.** Backend charter, with all eight bar-raiser conditions imposed, plus three amendments of mine: `read_artifact` is built on increment 3's `read_range` rather than half-building a window at the wrong layer (condition 3(b), converged); the cross-thread claim is gated on increment 1's browser suite rather than a host fake that succeeds everywhere; and the `why_this_one` grep claim is restated as 'there is no artifact TYPE', which is what `grep -rn 'struct Artifact' crates` = 0 actually shows.

**Acceptance.**

- `Artifact { uri, name, kind, description, audience, revision, by, bytes }` in `crates/agent/src/artifact/`; registry at `space/<space>/a/<name>` in `harness-spaces`, one key per artifact, one store op per mutation (the `crates/core/src/space/shared.rs:1-20` rule, for the same reason).
- `artifact_parts(&shelf, &tools)` — TOOLBOX-DERIVED, exactly as `crates/core/src/space/sense.rs:47-55` passes `of.tools` into `space_parts`. An agent holding no reader is told what is on the shelf and never offered a call it does not have.
- NO durability sentence in `artifact_parts` and NO `WorkspacePort` on `ArtifactSense`. `crates/agent/src/environment.rs:158-165` records that a TEST put that wording in `components::space` and nowhere else.
- `read_artifact` resolves a name to a path and calls increment 3's `read_range`. No second file reader, no second path rule, no sentence claiming a window the port did not perform.
- CROSS-THREAD, EXECUTED not simulated: increment 1's browser suite runs two real Workers on one `harness-spaces`, agent A records, agent B's next prompt renders the name and description in its `## artifacts` section. The host test alone cannot see this — `crates/adapters_web/src/worker/world.rs:52-58` gives a Worker a `C2wWorkspace` that refuses, so `record_artifact`'s existence check is DEAD in every thread but the page's, and the headline sentence is false without either storing the text alongside the record or gating the words on the port's real answer. Pick one and write it in the module header.
- `public/agents/main/agent.md` gains `artifacts` in `faculties:` AND `record_artifact` + `read_artifact` in `tools:` — the file carries a non-empty allowlist and `crates/agent/tests/faculty.rs::a_faculty_only_widens_the_allowlist_it_never_grants` proves a faculty grants nothing. Assert `unresolved_tools` is empty and both names are in the adopted toolbox.
- ANTI-ONE-FLOW TEST WITH A POSITIVE CONTROL: render under each of `Route::{Answer,React,Project}`'s stage lists and assert the `## directive` block DIFFERS while `## artifacts` is byte-identical. Without the control the assertion is true by construction (T59).
- `crates/agent/tests/window.rs` pins the rendered cost of a full `SHELF_LIMIT` shelf, so the cap has a number behind it.
- `grep -rn artifact crates/kernel/src` = 0; no new `EventKind`; the delta to `crates/core/src/tools.rs` and `crates/core/src/faculty/run.rs` is one line each.

### 6. ⬜ NOT STARTED. [backend] QUEST becomes the third first-class flow: a durable objective with a lifecycle that outlives the turn, survives a reload, can report BLOCKED, and whose termination rule is that a reply is an update rather than an ending.

**Why here.** One of the owner's three named first-class flows does not exist — `grep -rniE '\bquest\b' crates public docs` = 0 — and all three teams deferred it. It comes sixth because everything it needs now exists: a typed deliverable (increment 5), an environment that does not lose its check output (increment 3), a route fact a surface can read (increment 4), and a browser gate that can prove the reload (increment 1). Building it earlier means inventing a second registry for its outputs and then reconciling it.

**Unblocks.** The skeleton mandate's 'long-running agents, research agents, cron jobs' finally has something to hang on. Gives increment 7 a fourth thing to render and proves the rail is not react-shaped.

**Amended from the charter.** Not chartered by any team. Backend deferred it explicitly ('artifacts is the substrate under quest, so it goes first' — correct, and now satisfied); frontend refused to build a surface for a flow the runtime lacks ('a UI for a flow the runtime does not have would be a mock' — also correct). The mechanism is taken from the prior-art survey's cleanest finding, Agent Zero's `_goal` plugin, narrowed: the termination swap and the four statuses, and NOT the model-written ledgers, which would be prose where this tree wants facts on a log.

**Acceptance.**

- The standing goal gains a RUNTIME RECORD — `status ∈ {active, paused, blocked, complete}`, `started_at`, `lineage` — stored in `harness-spaces` beside the artifact registry, not in `AgentState`. Today `crates/agent/src/goal/declare.rs:39-47` is three static frontmatter keys with no status, no elapsed and no blocked.
- THE TERMINATION SWAP, host-tested: while an objective is `active`, a prose reply is an intermediate update and does NOT end the run. This is the one sentence of mechanism that makes a quest a quest, and it is one predicate in `crates/agent/src/ending`.
- `blocked` is reachable and reported, and the model may only create / complete / block. Pause, resume and delete are PERSON controls, never model ones.
- RESUME, PROVED IN A BROWSER (increment 1's suite): a page reload leaves the objective `active` and the loop picks it up. Today `crates/adapters_web/src/locks/mod.rs:14-27` makes the unit of durability the live context and a reload is a new run with no relation to the old one.
- `max_rounds` stops silently capping a quest: `crates/agent/src/passes.rs:26-30` deliberately does not reset it per pass, so the real ceiling is `max_rounds`, not `max_rounds × passes`. The budget for a quest is stated in the prompt and in the UI, and the test that pins the product stays.
- NO new entry in `crates/agent/src/stages/mod.rs:44-56` and NO fourth `Route` variant unless the route work in increment 4 made one free. A quest is a LIFECYCLE on the standing goal, not a fifth stage name — 'declare policy and budget, never topology' is a standing ruling in `tracker.md` and it holds here.
- `docs/PARITY.md` updated with what this does and does not claim: resumability and auditability, never quality (the tracker's own DFAH ruling).

### 7. ⬜ NOT STARTED. [frontend] The Flow Rail: every agent's route, the stage walk it is actually taking, and which lap it is on, rendered as one component built from typed reads of facts core already publishes — mounted in Chat and on the Dashboard, and costing zero files when a fourth flow lands.

**Why here.** Last because it is the only increment in the plan that is pure surface, and because every fact it draws is published by increment 4 and every flow it must represent exists only after increment 6. Shipping it earlier would render `data-route=""` for every agent on every turn, which is what the frontend charter would have done.

**Unblocks.** Makes the three flows visible for the first time — today `grep -rin 'quest\|strategy' crates/ui/src` returns 100 hits and every one is the substring inside `Request`. It is also the first brick of the UI-pack contract: one component whose props are data, which a pack could replace without importing the browser adapter.

**Amended from the charter.** Frontend charter minus its core half (now increment 4), minus the `crates/ui/tests/` + `dioxus-ssr` pillar (the crate has no lib target — the bar-raiser was right and I verified it), minus the `ui::flow::Route` copy and its `UnknownRoute` refusal (which would make the rail vanish on the owner's fourth flow), and with the keyframe baseline corrected from 1 to 3. The 'words do not fork' criterion is replaced with a mechanism that cannot fork, because a ui test cannot call core's formatter.

**Acceptance.**

- `crates/ui/src/flow/{mod,read,rail}.rs`, all ≤ 200 lines, all functions ≤ 40. Tests are `#[cfg(test)] mod tests` INSIDE `read.rs` and `rail.rs` — no `crates/ui/tests/`, no `[lib]` target, no `dioxus-ssr`. `crates/ui/Cargo.toml` is bin-only (`[[bin]]`, no `[lib]`, no `src/lib.rs`), so an integration test cannot link it; the lib extraction is its own increment if anyone wants it.
- NO `ui::flow::Route` enum. The route is a `String` used only for the badge word and the `data-route` attribute; the WALK is the authoritative fact and a valid walk is never discarded because the route word is unrecognised. Asserted: a fourth route (quest, from increment 6) costs the frontend ZERO files. That assertion replaces the charter's 'three-flow symmetry' criterion, which measured the parser rather than the person.
- WHAT A LENGTH-1 WALK RENDERS is decided in writing and matches `crates/core/src/board/stage.rs:96-99`, which refuses to write `stage 1 of 1` for exactly this reason (I15). `Route::Answer` and `Route::React` each yield one step (`crates/agent/src/strategy.rs:43-57`), so this decides whether the rail makes three flows visible or one.
- The lap clause is printed VERBATIM from the attribute increment 4 hangs — never re-formatted in `crates/ui`, which cannot depend on `core` (`crates/ui/Cargo.toml` lists kernel + adapters_web only) and therefore cannot test the two copies against each other.
- `FlowDeck` says in words what it cannot see for a sub-agent, rather than drawing every step Ahead for an agent that is working.
- `grep -c 'WebApp\|Signal' crates/ui/src/flow/read.rs crates/ui/src/flow/rail.rs` = 0 for both — the first components in the tree typed on DATA, against 135 `WebApp` mentions across 40 of 84 ui files. `grep -rc dangerous_inner_html crates/ui/src/flow/` = 0.
- `web/flow.css` ≤ 110 lines, tokens only, added to `scripts/check-selectors.py` EXPECTED. It carries the product's FIRST `@media (hover: hover)` guard (baseline: `grep -c 'pointer: coarse\|hover: none' web/*.css` = 0 across all ten sheets), one `prefers-reduced-motion` guard, one keyframe on the one moment the product is about — a stage advancing — taking the tree from 3 keyframes to 4 (measured: surfaces.css 1 + strip.css 2), and `overflow-x: auto` so the rail scrolls rather than wraps below 48rem.
- All six gate commands green, `bash scripts/check-layout.sh` included.

## Conflicts, ruled

Where two charters touched the same code, or a team bar-raiser was soft on its own
team, the top-level bar-raiser ruled. Each ruling is recorded with the fact that
settled it, because an argument that gets re-litigated every round is not a ruling.

**Backend charter's `read_artifact({name, offset})` + `window()` vs tracker T44's windowed `read_file` on `WorkspacePort`**

The backend bar-raiser was RIGHT and I extend it. `WorkspacePort::read` is `cat -- {path}` (`crates/kernel/src/workspace.rs:74-77`) with no offset, so the charter's `window()` would drag a whole file through the one shared PTY, slice it in Rust, and print a sentence asserting a ranged read nothing performed — against a real build log that is T45's 180s watchdog discarding the output. The offset belongs on the PORT, once, serving `read_file`, and it is increment 3 of my plan. Artifacts get NO second file reader: `read_artifact` resolves a name to a path and calls the same `read_range`. This also resolves the charter's own DRY inconsistency, which refused `list_artifacts` on DRY grounds and then proposed the larger duplicate.

**Backend charter's `artifact_parts(shelf, durable)` vs `components::space` owning the durability sentence**

Honour the bar-raiser without amendment. `crates/agent/src/environment.rs:158-165` records that a TEST, not an argument, put that wording in `components::space` and nowhere else, and `components/space.rs:126-133` renders it. A second phrasing at Slot 57, two slots from Slot 55, in the same prompt, for the same agent, is precisely the drift I16 exists to forbid. Drop the `durable: bool` parameter — and with it the only reason `ArtifactSense` holds a `WorkspacePort` at all.

**Backend charter's `artifact_parts(shelf, durable)` vs `SpaceSense`'s toolbox-derived precedent**

Honour the bar-raiser. `crates/core/src/space/sense.rs:47-55` passes `of.tools` into `space_parts` because `crates/agent/src/components/space.rs:36-44` states the rule: naming a capability the agent was not granted is 'the one failure this product may not ship'. The signature is `artifact_parts(&shelf, &tools)`. This is not a style preference; it is the same law the charter claims to be copying.

**Frontend charter edits `crates/agent/src/strategy.rs`, `crates/core/src/board/{flow,stage,row}.rs` and implicitly `chat/fold.rs`, which the backend team owns and priced as untouched**

Split, and give the core half to backend as its own increment. The frontend bar-raiser found the blocking fact and I verified it: `ROUTE_CHOSEN` is not in `crates/core/src/failure/loop_note.rs:19`, `crates/core/src/chat/fold.rs:77` catches it with `_ => false`, and `grep -rn ROUTE_CHOSEN crates` returns hits ONLY in `crates/agent`. Core has never read this fact, so `data-route` would ship permanently empty and the rail would draw nothing. The frontend charter priced a FOLD-OWNERSHIP change as presentational. It is not. Increment 4 of my plan is the core half alone, owned by backend, gateable today; the Rail lands on facts already proven.

**Standards charter puts `Args` + `serde_json` in `crates/kernel`; the standards bar-raiser accepted that placement**

OVERRULE both, on layering. `crates/kernel/Cargo.toml` has exactly one dependency (`serde`) and `scripts/check-layering.py:22` gives kernel an EMPTY allowed-set — it is the leaf, and giving the leaf a JSON parser to serve a convenience type used in `core` and `agent` inverts the one structural rule this project gates on. The correct home already exists and costs nothing: `crates/context` is reachable from both `core` (`core/Cargo.toml:10`) and `agent` (`agent/Cargo.toml:10`), and `crates/context/Cargo.toml:12` ALREADY carries `serde_json` with a written justification. `agent` cannot depend on `core`, which is the constraint that ruled out the obvious answer; `context` satisfies it. Zero new dependency in any crate.

**Standards charter's `text()` always trims vs `write_file`'s `contents` and `remember`'s `value`/`note`**

Honour the bar-raiser, unconditionally — this was the single most valuable finding in the whole packet. `crates/core/src/workspace/gate.rs:118` is `port.write(root, &path()?, &arg("contents"))`; an unconditional trim silently strips the trailing newline off every file an agent writes. The existing design is the opposite of what the charter called it: the reader does not trim and each site trims where trimming is correct (`gate.rs:116`, `proc/convention.rs:71`, `observe.rs:29`). Split into `name()` (trims, refuses empty) and `text()` (verbatim), with a byte-identical round-trip test through `write_file`/`read_file`.

**Standards charter's headline justification — that `skills.rs` does not trim while `subagent.rs` does — vs the code**

The bar-raiser was right and I verified it independently. `crates/agent/src/skills.rs:159` is `let asked = asked.trim();` and every match below uses the trimmed binding; `crates/core/src/tools.rs::read_agent` does the same. The charter's acceptance criterion #6 passes on `main` unmodified. The increment survives on DRY and on unblocking three downstream teams; the bug framing is struck.

**Backend bar-raiser DEFERRED the duplicate-`ask` resolver hang as a 'ride-along' that 'does not deserve a charter'**

OVERRULE — the bar-raiser was soft on its own team here, and it half-knew it (its own finding 10 correctly demolishes the charter's stated reason for deferring, then defers anyway). A wedge with no timeout, no error and no recovery, reachable by the first thing an owner does with two agents (`crates/adapters_web/src/workers/spawn/reply.rs:138`, one slot per `Live`; `crates/agent/src/step.rs:126-141`, no dedupe on a batch line; `crates/core/src/runtime/requests.rs:101`, a person messaging that agent from Threads), sitting on the goal sentence 'multiple parallel agents', is not a ride-along. It is increment 1 and it lands with the test infrastructure that makes it provable.

**Backend bar-raiser's GO-WITH-CONDITIONS vs what survives its own eight conditions**

OVERRULE the verdict LABEL, keep every condition. After conditions 1, 2 and 3 the charter loses its cross-thread mechanism, its durability sentence and its window — three of its four named mechanisms — and its headline sentence is rewritten. That is not a conditioned GO on the chartered increment; it is a GO on a smaller, different one, and the verdict should have said so plainly rather than leaving the lead to discover it while implementing. The narrowed artifacts increment is worth building and it is increment 5, after the two things it actually depends on.

**Frontend charter's `crates/ui/tests/flow.rs` + `dioxus-ssr` vs `crates/ui` being a bin-only crate**

Honour the bar-raiser; I verified it. `crates/ui/Cargo.toml` declares only `[[bin]]`, there is no `crates/ui/src/lib.rs`, and every proposed type is `pub(crate)` — a Cargo integration test links the LIBRARY target, so `cargo test -p ui --test flow` cannot resolve anything. The test story for increment 7 is `#[cfg(test)] mod tests` inside `flow/read.rs` and `flow/rail.rs`: same coverage of every DECISION, no lib extraction, no new dev-dependency. The lib-target extraction is real work and gets its own increment when someone wants it, not a '+3 lines to Cargo.toml'.

**All three charters' acceptance gates end at `cargo test --workspace --exclude adapters_web`**

The gate grows. Two of the owner's headline goals (parallel agents, cross-thread communication) and the entire environment live behind that exclusion, so the exclusion is what makes all three charters' headline claims unfalsifiable — and each bar-raiser caught exactly one instance of that class (backend finding 1: the artifact catalog is dead in a Worker; frontend finding 5: `FlowDeck` draws every step Ahead for a working sub-agent) without any of them naming it. From increment 1 the gate is SIX commands: the existing four, plus a browser suite over `adapters_web`, plus `scripts/publish.sh`.
