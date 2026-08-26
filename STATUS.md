# HARNESS — rewrite status

> The lead agent's status page. One row per lane, updated at every increment.
> **Read this first.** `docs/RULINGS.md` is the architecture of record for the
> rewrite; `INVARIANTS.md` is still law, with the amendments listed below.

**Goal.** Rewrite HARNESS from the ground up: Rust → Wasm becomes vanilla
JavaScript on Bun 1.4, Dioxus becomes a Next.js static export. A faithful
translation of the parts that were right, and a deliberate correction of the
parts the rewrite exposes as wrong.

**Started.** 2026-08-25.

---

## Where things stand

| Lane | Owns | Increment | State |
|---|---|---|---|
| LEAD | workspace shell, `packages/kernel`, gates, the seam, this page | kernel · gates · seam freeze · deploy proven | ✅ landed |
| RESEARCH | 8 sweeps, 6 architecture attacks, one ruling | `docs/RULINGS.md`, 360 lines | ✅ landed |
| — | the component inventory | `docs/PORT-MAP.md` — CLOSED, and `crates/` deleted | ✅ landed |
| LEAD | signals, the four directions, the Rust deletion | 8 · a reactive primitive, six palettes, zero `.rs` | ✅ landed |
| A · PAPER | `packages/context` | 7 ✅ every modality on the wire, streamed == buffered, the receipts have readers |
| B · LOOP | `packages/agent` | 7 ✅ the stages walk, the critic gates, the lap re-enters `work` |
| C · SPINE | `packages/core`, `packages/adapters-web` | 7 ✅ delegation composed: one real Worker per agent, its own conversation |
| D · FACE | `apps/web` | 7 ✅ a contrast ratchet that measures every word on the screen |

## What exists

```
packages/kernel/src/        ids · status · errors · event · seam · capability · manifest · ports
packages/context/src/       types · slot · state
packages/agent/src/         state · effect · stages · shape
packages/core/src/          app · registry · dispatch · ctx · errors
packages/adapters-test/src/ every port, doubled, on the host
apps/web/                   the shell: four destinations, the token layer, the router
scripts-js/                 the gate, executable: size · purity · view-model · CORS · publish
```

**The gate.** `bun run gate` — and every line of it runs:

| Check | What it executes |
|---|---|
| `typecheck` | `tsc --checkJs` under `strict`, over the packages AND `apps/web` (I19) |
| `test` | 78 host tests, no DOM, no network, no clock (I3, I7) |
| `size` | every file ≤ 200 lines, every function ≤ 40 (I12) |
| `purity` | the five host-testable packages reach for no browser global (I3) |
| `viewmodel` | the interface words nothing itself, and never sets inner HTML (I5) |

Beside it, not in it: `bun scripts-js/check-cors.js` probes the search endpoints
from the real origin, because a third party being down must not block a deploy
of unrelated work. `bun run typecheck:pkg <name>` checks one package, so a lane
can tell its own error from a neighbour's half-saved file.

## Rulings so far

1. **Vanilla JS with JSDoc types, checked by `tsc --checkJs`.** Not TypeScript:
   the source that runs is the source that ships, there is no build step for any
   package below the UI, and Bun runs every file directly. Type safety without a
   compiler in the loop.
2. **The seam keeps its shape and changes its payload.** `handle(Request) ->
   Response` survives verbatim (I4). `Response.body` was an HTML fragment
   because the predecessor was htmx-with-no-server; it is now a NAMED TYPED
   PROJECTION, because shipping markup out of a state machine puts the design
   system inside the core. **I5 is amended**: the UI renders `data` and may not
   compute it — stricter than the original, not looser.
3. **Facts carry an envelope version.** `Event.v`, stamped at append, read at
   replay. The predecessor's closed enum bricked a browser on any field added
   without a default; a version plus a nested `fact` object makes additions
   structural instead of hopeful.
4. **`module` folds away.** Manifest types live in `kernel`, the registry lives
   in `core`. Six hundred lines of crate ceremony for one lookup table.
5. **Ports gain streaming and cancellation.** `ModelPort.call` takes
   `{signal, onDelta}`; a port that cannot stream never calls `onDelta` (I15).
   `ModelReply` separates `reasoning` from `text` so a reasoning model's scratch
   is never fed back as history.

6. **Bun's batteries are BUILD-TIME, and that is measured.** `Bun.markdown`
   (`.html`/`.ansi`/`.react`), `Bun.YAML`, `Bun.TOML`, `HTMLRewriter` and
   `Bun.SQL` all exist in Bun 1.4 — and `bun build --target=browser` emits
   `Bun.markdown.html(...)` **verbatim**, so none of them exists in the page.
   Measured, not assumed. Therefore:
   - Markdown a person reads is parsed by ours into a TYPED BLOCK TREE in
     `packages/context`, and the UI renders that tree to React elements. No
     HTML string, no `dangerouslySetInnerHTML`, so a model cannot inject markup
     into the page it is talking to — the safety is structural, not a sanitizer.
   - Agent files are parsed by ours too, because a person may author one in the
     browser and a build-time parse cannot see it.
   - Bun's own batteries are used where they belong: the gate, the scripts, and
     anything that runs before the page ships.

## What the ruling changed

`docs/RULINGS.md` is the architecture of record. Eight attacks; three changed law.

- **I20 Bounded boot** (new). Boot read one IndexedDB record per event, in its
  own transaction, against a real browser holding **39,237** of them — and every
  seam request then deep-cloned the whole log, making a session O(history²) with
  four panes polling. Facts now persist as SEGMENTS (~512 per record, NDJSON)
  with periodic SNAPSHOTS, and every projection is a registered reducer folded
  incrementally. No handler ever receives the event array.
- **I21 Turn identity** (new). A tool result from an abandoned turn silently
  billed a model call. Every effect carries its `turnId`; the reducer drops what
  is not live; every outstanding call has a deadline and an `AbortController`.
- **I5 gains the view-model clause.** A projection carries the already-worded
  string beside the machine field, because the moment two panes word one fact
  for themselves they word it differently.
- **The phase machine is retired.** `state.phase` was assigned nowhere in 67,476
  lines and the exit table had zero readers. Stages survive.
- **The budget is derived, never declared.** Every catalogue entry now carries
  `context_tokens`; an entry without one is a configuration error at install.
- **Head-of-string truncation is banned.** The Rust kept the FRONT 200 characters
  of an oldest-first history — on any constrained turn it kept the greeting and
  lost the message.
- **The emulator does not come back.** 47 MB to serve four file operations, and
  `durable()` returned false, so every file was lost on refresh. OPFS instead,
  and `durable()` finally returns true.
- **Search ships working.** Firecrawl keyless is verified CORS-`*` with no
  Authorization header. Two things this project's own memory believed are
  measured FALSE: public SearXNG (60 of 76 instances 429, two emit any
  `access-control-allow-origin`) and `r.jina.ai` keyless (hard 401 against
  consumer residential ISPs — exactly where a browser agent lives).
- **Reasoning passback is provider-conditional**, and one detail bricks a whole
  session: an assistant turn with only reasoning or only tool calls must
  serialise `content` as `""` and never `null`.
- **Dependencies below the UI stay at zero.** Refused by name: zod, Tailwind,
  framer-motion, charting, marked + dompurify, any public CORS proxy.

## The Rust is gone — 2026-08-25

The previous version of this section said `crates/` stayed because
`docs/PORT-MAP.md` was a live work order citing every file in it, and that
deleting the source of the plan while the work was unfinished destroyed the plan
and preserved nothing the `pre-rewrite-js` tag did not already hold. It also
said what would end that: **every row either landed or recorded as refused,
then out in one commit.** That is what this is.

**Deleted, tracked:** `crates/` (468 files, 67,476 lines), `Cargo.toml`,
`Trunk.toml`, `.cargo/`, `spikes/` (four Rust spike crates), `web/` (the Wasm
page's own HTML and its seventeen stylesheets), `scripts/` (twenty-one Python
and Node probes, all replaced by `scripts-js/`), `public/` (a byte-identical
duplicate of `apps/web/public/`), `publish.sh`, `serve.py`, `image/` (the
container2wasm Dockerfile), `MODULES/` (one document per Rust crate),
`DECISIONS/` (52 ADRs for two systems that no longer exist), and the eleven
root and twenty-two `docs/` files that described them. `git ls-files '*.rs'`
answers zero.

**Kept, and each for a reason:** `DESIGN.md` (design law, cited 26 times from
the JS tree), `docs/SEAM.md` (frozen, 32 citations), `docs/RULINGS.md` (19),
`docs/TEAMS.md`, `docs/PORT-MAP.md` (closed, with a banner saying so),
`docs/research/` and `reference/` (the sweeps of Hermes, Agent Zero, the
DeepSeek harness and the rest — research about other people's systems, which
this port's deletion has nothing to say about).

**Four rows were refused rather than landed, and it is one fact.** This build's
`WorkspacePort` is OPFS: it stores files and runs nothing, because the only
Linux that ever ran in this page was a 47 MB emulator whose own `durable()`
returned false. So C20's exec half, C21, C22 and C23 have no runner, C67 is
refused on the record, and `apps/web/public/agents/main/agent.md` does not name
the tools they would have provided —
`packages/adapters-web/test/tools.test.js` executes that, and the list of names
the shipped file owes the model is empty.

**What the deletion left on disk, untracked:** `target/`, `dist/`, `docs/bin/`
and `docs/wasm/` — the Rust build, the Trunk output, and the toolchain shelf and
guest image of the deleted emulator. `.gitignore` lists them with that sentence
beside it. They are large, they are in no history, and removing a gigabyte from
somebody's disk is theirs to do.

## SHIPPED — 2026-08-25

`https://kaush4l.github.io/ASKK/` serves the JavaScript build. The static export
boots in a browser, the composer is on screen, a typed message crosses the seam,
and what the model port answered comes back to the transcript without a reload —
all four asserted by `scripts-js/smoke.js`, which drives the real artifact in a
real browser and which `publish.sh` runs before it touches git.

**What is true of the live page, measured, not described.** It boots over
IndexedDB, takes a message, runs the loop, delegates to another agent in its own
Worker and gets the answer home, survives a reload with the transcript intact,
renders all four destinations, and refuses honestly what it cannot do — a local
model endpoint is unreachable from a public origin and it says exactly that.
`bun run smoke` asserts every clause of that sentence. `bun run contrast`
measured 2,248 things across two rooms and four destinations: worst text 4.54:1
against a 4.5 floor, worst control edge 3.94:1 against 3, both ratcheted in
`scripts-js/contrast-floor.json` so they can only go up.

**A deploy prerequisite, stated because it is one.** `smoke.js` drives gstack's
`browse` binary at `~/.claude/skills/gstack/browse/dist/browse`, overridable with
`HARNESS_BROWSE`. It is not vendored, and when it is absent the gate FAILS rather
than skipping — a gate that quietly does not run is the defect it exists for.
`bun run gate` does not require it, so a contributor without gstack can still
work; `scripts-js/publish.sh` does.

## The page did not come up, and nothing said why

Built, exported, served, rendered — and stuck on its pre-boot sentence forever,
with every chunk 200, no console error, no warning and no rejection. Two causes
found by bisection against the real artifact in a real browser, both landed:

1. **A manual `<head>` in the App Router root layout stops Next's client runtime
   from starting.** `window.next` was `undefined` while the Turbopack runtime had
   run. Removing the element put it back and React hydrated.
2. **`reactStrictMode: true` stops this build flushing any PASSIVE effect.**
   Reduced to one page with one client component holding a `useLayoutEffect` and
   a `useEffect`: the layout effect ran, the passive one did not — in the static
   export, headless and headed alike. Every effect in this application is
   passive, boot included.

A third is still open and is round 5's whole increment for the FACE lane:
`useSession`'s effect still does not run in the real tree, while the same two
effects in a minimal page do.

**Two things learned the hard way, written down so nobody pays twice.** A
Turbopack build cache will serve you a chunk without your edit in it — `rm -rf
apps/web/.next apps/web/out` before every rebuild, and grep the chunk for your
probe before concluding anything from its absence. And `document.title` is not
a probe channel: React re-applies the metadata title over it. `localStorage` is.

**The gate did not catch any of this**, and that is the deeper finding: 426
tests, five checks, and a page that renders and does nothing passed all of them
(I17). A smoke test that drives the built artifact in a browser lands with the
fix.

## Cross-lane rulings — round 7

| Request | Ruling |
|---|---|
| D: wire the contrast gate in | **Done.** `bun run contrast` exists, and `publish.sh` runs it after the smoke test on the same build. Not in `bun run gate`, and that is deliberate: the gate must run for a contributor who has no gstack browser. |
| D: a `next build` took over fifteen minutes | **Contention, not cost.** Four lanes were building concurrently on one machine. Measured alone: about ten seconds. No rule needs changing. |
| C: `CapabilityError` still has zero construction sites | **Deleted.** A class nothing throws cannot be matched on. |
| C: confirm the `DelegateError` mapping | **Confirmed, and the six names now carry their reasons in the file.** `abandoned` is right to add: a caller cannot tell a person's Stop from a sub-agent's failure off one name, and "the agent refused" is a wrong sentence to show somebody who stopped it themselves. |
| C: the CONVERSATION reducer went 1→2, so a deployed browser replays once | **Accepted, and it is I20 working.** A reducer version that invalidates its own snapshot is the mechanism; one full replay on one release is what it costs, and the alternative is a projection quietly disagreeing with the log. |
| C: four directed edits fell outside its ownership | **Recorded.** A bar-raiser may direct a change into a neighbour's file, and when it does, the lane says so in its report — which this one did. The rule is that nobody reaches across UNASKED. |
| B: `stageIn` lives in `stages.js`, not `state.js`, because I12 | **Upheld.** I12 is law and the alternative was gutting the reasoning or moving a storage codec unasked. One spelling, one answer, and the constraint is named in the comment. |

## Cross-lane rulings — round 2

| Request | Ruling |
|---|---|
| D: the `problem` projection needs an `id`, or a list of failures reconciles wrongly | **Granted, and done.** Two agents missing from the manifest is two 404s with identical prose; `kind` cannot key them because two occurrences of one kind is exactly the case. `id` is WHAT THE FAILURE IS ABOUT — the agent's name, the file's path — and empty means the failure is the whole response. In `kernel/seam.js` and `docs/SEAM.md`, with the test that would have caught it. |
| D: the empty note must tell a folder that never held files from one a reload emptied | **Upheld, and it is C's.** The interface renders whichever sentence it is handed and composes neither. Which is true is a fact only the log knows, and `durable()` is the thing that decides it. |
| A: an image reaching a `sonnet` entry is billed on OpenAI's arithmetic (~3× under) | **Assigned to lane A, in the provider-adapter increment.** The rule belongs beside `buildRequest`, because the adapter is the only thing that knows how this provider counts. Stated in `image.js` today, gated when A4 lands — and it must be gated in A4, not later. |
| A: `modelCards` is alphabetical; should it be the file's order? | **The file's order.** `models.json` is curated — `local` is first because a person who has a local server should see it first — and sorting silently overrides a decision somebody made. Drop the `.sort()`; make the first refusal deterministic by naming the first entry in file order. |
| B: a signal-less reply leaves a turn awaiting the model forever | **The loop ends it.** A reply carrying no finish signal is a MALFORMED reply, and malformed is an ending, not a wait. Waiting on a deadline for something already known to be broken spends the person's time to learn nothing. Lane B, next increment. |
| B: a refused fact never meets a pending Stop | **Correct as-is.** A refused fact starts no work, so there is nothing for a stop to halt. Keep the comment that says so. |
| C: `log.persist()` can now reject | **Confirmed.** A projection that cannot round-trip JSON is a build assembled wrong, not a runtime condition — no message repairs it and no retry helps. Throwing is right; document it on `flush`'s contract as the stated exception. |
| C: `packSegment`'s unreachable assertion | **Keep it.** An assertion the type checker needs, on a path construction cannot reach, is narrowing — not ceremony. The alternative is returning `''` silently, which is the defect this project keeps finding. |

## Cross-lane rulings — round 1

Every request the four lanes filed, ruled once, by the lead.

| Request | Ruling |
|---|---|
| A: a lane cannot tell its own type error from a neighbour's half-saved file | **Granted.** `bun run typecheck:pkg <name>` checks one package. The whole-workspace check stays the gate — three lanes importing a fourth's broken export is exactly what a gate is for — but a signal a lane does not trust is a signal it stops running. |
| A: no package declares its `@harness/*` dependencies | **Granted.** Every package now declares them. Bun resolved them either way; a package that imports what it does not declare is lying about the dependency graph, and the layering the pure core depends on is read off that graph. |
| B: `phase.js` cannot pass a done-when that greps for the word | **Granted, and done.** The file is `stages.js`. The word survives only where it names what was retired and why — a rename that erases the reason is how the same machine gets rebuilt in two years. |
| B: `TurnId` is a local alias in one lane | **Granted.** It is in `kernel/ids.js` beside `AgentId`. Two packages touch it — the loop stamps effects, the spine mints one per message — and an id spelled twice is an id that will differ once. |
| — | **Not asked for, ruled anyway:** `PhaseId` is gone from the kernel and `StageId` replaces it; `phase_entered` is `stage_entered` and carries its `turnId`. Leaving a retired machine's vocabulary in the shared dictionary is how it comes back. |
| C: `createApp` now requires the capability list | **Upheld.** A build states what it offers or does not start. This is the same defect as `durable()` defaulting to `true`. |
| D: 76 type errors in `apps/web` were invisible to the gate | **Granted.** `@types/react`, `@types/react-dom` and a CSS-module declaration are installed, and `apps/web` is now in both halves of the gate — its typecheck and its tests. The 76 became one real error, which is fixed. |
| D: the ground colour is written three more times in `themeColor` | **Ruled, for round 2.** Not a JS palette module: a meta tag cannot read a custom property, so one of the two spellings is unavoidable. What is avoidable is that they can DISAGREE — lane D adds a test that parses `globals.css` and asserts the literals match (I16). |

## Open questions

- Which of the nine ports survive (the `ports` critique decides).
- Whether the emulated-Linux workspace survives, or becomes OPFS + a Worker.
- The compaction ladder's shape under a 200k-context model.

## Cross-lane requests

| # | From | Ask |
|---|---|---|
| 1 | B · LOOP | **`docs/PORT-MAP.md` row B6 and `docs/RULINGS.md` 274/310 disagree, and B11 is about to depend on the answer.** PORT-MAP B6 sends `crates/agent/src/phase.rs` to `packages/agent/src/phase.js`; RULINGS:274 retires `PhaseId` and `PhaseConfig` by name, and RULINGS:310 states B8's done-when as an executable check — `grep -rn phase packages/agent` returns only stage names — which a file called `phase.js` cannot pass. The lane has deleted `PhaseConfig.phase` and stopped exporting `PhaseConfig`; what remains in the file (`ToolScope`/`grant`/`RESPONSE_CONTRACTS`/`WORK_BUDGET`) is read every call. **Rule on the NAME before B11 (`ask.js`) reads `WORK`**, so the import is written once. The lane will not resolve this itself. |
| 2 | A · PAPER | **`packages/agent/src/paper.js` and `packages/context/src/blocks/` are two vocabularies for one prompt, and the one on the wire is the older one.** `ask.js:31` imports `soul`/`affordances`/`observations`/`directive`/`contract`/`taskBlock` from `paper.js`, and `ask.js:components()` is the only site in this build that assembles a prompt for a model — so lane A's fourteen block files have zero production callers and the 48 goldens landed this round pin bytes nothing sends. The wordings also DIFFER: `soul` floors at `full` there and `summarized` here, `observations` floors at `pointer` with no stated absence there and `elided` with `No actions taken yet.` here, `task` renders `''` when idle there and `Idle; awaiting a task.` here. Worse, `paper.js` still emits the retired text call protocol verbatim — `HOW_TO_CALL` ("separated by commas… Results come back labelled") and `ENVELOPE` ("exactly as the `## affordances` block shows them… lines beginning `Result:`") — which is the protocol whose hand-rolled scraper corrupted a file (`docs/RULINGS.md` §1 row 3). **Ask: order lane B to import those six from `@harness/context` and delete `paper.js`'s copies**, keeping `sensed`, which has no counterpart here and is what fills `memory` and `space`. Lane A cannot make this edit; until it lands, no test in `packages/context` is evidence about the prompt a model receives. |
