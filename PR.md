# PR: Goal artifact + harness agent — step-by-step prompt anatomy

- Branch: feature/goal-artifact-harness
- Base: askk-skeleton @ fa1e388 (verified via `git ls-remote` before branching; parent 47d3460, PR #16 merged)
- Milestone 0 merged as PR #17 at askk-skeleton @ 9709a1c; the
  addendum diff (Milestones 1–2) is measured against 9709a1c,
  verified by diffing the workdir against a fresh clone of
  askk-skeleton @ 9709a1c (excluding .git/node_modules/.next).
- Status: Milestone 2 — checkpoint, refining continues (assistant never merges; Kaushal merges himself when perfect)
- Kind: Feature

## GOVERNING ARCHITECTURE — PLANNED ARCHITECTURE AND IDEOLOGY — LIVE OBJECT (correction 2026-11-04, wins on conflict)

Planned architecture and ideology, in one list (the rest of
this section is the mechanism for each point):

- One live engine object: `getEngineObject` is the only
  engine/desk cache in the server process; every route and the
  UI read the same object.
- No backend/frontend split: there is no backend state and
  frontend state as separate states — the UI is the twin/view
  of the engine object, not a second copy kept in sync.
- Right context only: the prompt renders only the elements the
  run needs, in insert order, with a meter summing to the
  prompt length and left-out elements listed with reasons.
- Goal = a single statement call: `goal.create` takes a
  statement only (+ id/name) and refuses phases/plans/tools;
  the harness makes exactly one such call per request.
- The executing agent owns plan → execute → critique: the
  developer plans, executes, and critiques internally, looping
  back on critique failure; the harness never plans for it.
- Everything configuration-driven: element lifecycles, tool
  narrowing per phase, and the render template order are data
  (registries, tables, insert order), not hardcoded branches
  in the engine or the loop.
- Lifecycles defined: every element type has a defined default
  lifecycle in `src/core/lifecycles.js`; a step not in the
  lifecycle table is not defined and must not be built.
- Live state never missed: UI priority is state visibility
  over polish — a simple UI that never misses a state change
  beats a polished UI that hides state.
- No hardcoding ever: agents, tools, prompts, and defaults
  come from desk/memory files and configuration, never from
  invented fallbacks (a missing definition is an honest null
  or a labelled "default", never a silent invention).

One engine object. The UI is its twin/view, not a second copy.
There is no backend state and frontend state as separate states.

One engine object. The UI is its twin/view, not a second copy.
There is no backend state and frontend state as separate states.

- ONE engine object per location in the server process:
  `getEngineObject(location)` (`src/core/engine-object.js`) returns
  the SAME object for every call — `{agent, state, elements, tools,
  artifacts, goal, history, skills, signal, ...}`. `live-state.js`
  is NOT a competing singleton: it is the state container the
  engine object owns (one `createLiveState` id `"engine"` per
  location). `src/core/server-desk.js` is NOT a second singleton
  either: it is a thin redirect to `getEngineObject`
  (`getServerDesk` IS `getEngineObject`, same cache, same object).
  Canonical file: `src/core/engine-object.js`. Nothing else caches
  a desk or an engine object separately.
- ALL routes that previously created a fresh desk now use it:
  `/api/chat` (legacy single-turn, see Milestone 2),
  `/api/desk-snapshot`, `/api/engine`, `/api/agent`,
  `/api/artifact`, `/api/desk`, `/api/soul`, `/api/tools`,
  `/api/snapshots`, `/api/snapshots/[id]`, `/api/models`
  (Milestone 2: through the engine object's models store),
  `/api/harness` (Milestone 2: the dashboard chat entry).
  New routes: `/api/engine-object` returns the same object's
  current state/elements/prompt on every call (route count
  18 → 19 in Milestone 1); `/api/harness` runs the harness
  chain on the same object (route count 19 → 20 in
  Milestone 2). See the route audit in Milestone 2 for the
  two routes that do NOT go through the engine object and why.
  Response shapes are unchanged, EXCEPT `/api/desk-snapshot`
  `elementStrings` sub-keys now match the engine template
  (soul/instructions/tools/artifact/request/owner-guidance/
  earlier-runs/work-done/response); watchers/scripts/models/
  history remain available via the route's twin/scripts/
  watchers/providers top-level fields.
- The chat prompt IS the engine object's rendered elements:
  `askEngine()` sends `engine.renderPrompt()` (insert order) as
  the system prompt, and the harness loop phases use the same
  `engine.renderPrompt()` (plus the phase line `runPhase`
  appends). The motivating bug, fixed and tested: the card
  showed Soul/Instructions/Agent/History/Tools/Artifacts, but
  the old chat sent only instructions + history, so the model
  answered "What tools do you have?" generically and denied
  connected tools. Now a mocked model asked that question
  through the engine-object path names the engine's actual
  tools, and the test asserts the captured prompt equals
  `renderPrompt(engine.elements)`.
- UI as twin: the home page's live-agent section subscribes to
  a client-side signal fed by `/api/engine-object` plus the
  existing client live-event bus; card, canvas, and live status
  render from that one signal snapshot. Milestone 2: the
  dashboard chat's send() posts to `/api/harness`, not to the
  legacy single-turn `/api/chat` route, and refreshes the
  engine signal from `/api/engine-object` after the run, so
  the report shown and the card/canvas/status shown come
  from the same object. The client bus no longer drops
  goal:/agent: events (Milestone 2: its allowed list now
  includes goal:phase, goal:complete, agent:spawn,
  agent:report, agent:dismiss, tool:start/end/error, and
  compaction); a goal:/agent: event triggers a route refetch
  into the engine signal — refetch-on-event, never a server
  push. Canonical bus for the live-agent section is the
  state-based signal (`src/lib/signals.js`); the client bus
  is kept for the legacy chat flow only, and now forwards
  goal:/agent: events instead of dropping them. The older
  CombinedView panels (fetch-once into React state) are still
  present and are explicitly marked LEGACY in a code comment
  — they are not silently left as a divergent copy, and the
  live-agent section no longer derives anything from them.
- Honest boundary, stated plainly: the signal chain is
  IN-PROCESS. Across HTTP there is NO server push — no SSE, no
  WebSocket, none claimed. The next route call returns the same
  engine object's current state. A second tab / reload sees the
  same server object, but a client page that never re-calls a
  route does not get pushed updates.
- Singleton trade-off, stated plainly: desk config (instructions
  / models) is now loaded once per server process, not re-read
  per request as the old chat route did. Editing desk config
  takes effect on server restart, not per request.

## ADDENDUM — seven items (2026-11-04, on top of the above)

1. RENDER TEMPLATE, INSERT ORDER — done. `src/core/template-order.js`:
   `createTemplate()` (`insert` / `insertAt` / `remove` / `move` /
   `render`), `defaultTemplate()` inserting in the old order
   (soul → YOU ARE → TOOLS → artifacts → REQUEST → OWNER
   GUIDANCE → EARLIER RUNS → WORK DONE → RESPONSE).
   `elements.js renderPrompt()` delegates to the ordered template;
   no hardcoded segment sequence remains in the renderer.
   `render-template.js` re-exports the template. New builders:
   `requestElement`, `ownerGuidanceElement`, `earlierRunsElement`,
   `workDoneElement`, `textElement`.
2. DEFAULT AGENT, CURATED TO DEEPSEEK SUPER AGENT — done.
   `public/defaults/memory/default.agent.md`,
   `default.instructions.md`, `default.tools.md`, and
   `scripts/default/dispatch.shortcut.script.md`. The goal
   philosophy is NOT duplicated: it stays in `goal-default.md`,
   which the harness loads as before. `harness.loadDefaultAgent()`
   loads personal else public/defaults; the fallback, used only
   when the files are missing everywhere, is labelled `"default"`
   and carries no tools and no invented instructions.
   `harness.defaultAgent` is set on every harness.
3. UI STATUS LIKE A TYPING ICON — done (code-level verification
   only: build + dev HTTP, no live-browser clicks claimed).
   `src/components/live-status.jsx`: glyph + word + current
   step/call + animated dots while running, settled when
   idle/done, steps list below (stable ids, parallel groups,
   partial, failed visible), driven by `liveStatusData()` in
   `src/core/ui-data.js`. Wired into `src/app/page.js`'s
   live-agent section via the engine signal. Owner guidance:
   `createGuidanceChannel()` in `loop.js`, `harness.guide()`
   delegates to the engine's channel; guidance is consumed
   exactly once at the next loop step, recorded in history, and
   never repeated (tested). NOT done as UI: there is no guide
   text box or guide route in the page — guidance is a code-level
   channel (`harness.guide(text)`), not a shipped UI input.
4. SINGLE INSTANCE — done, via the governing engine object
   above (this supersedes a separate server-desk singleton).
   Two `getEngineObject` calls return the same reference; a
   mutation through one is visible through the other (tested,
   including through the `server-desk.js` redirect).
5. UI REACTIVITY VIA STATE-BASED SIGNALS — done in-process.
   `src/core/signals.js`: `createSignal` (`get`/`set`/`subscribe`/
   `peek`, updater form, notify on actual change only,
   configurable equality, unsubscribe), `computed`, and
   `subscribeToLiveState`. `src/lib/signals.js` re-exports it
   for components; `src/lib/use-live-state.js` is the React
   hook; `LiveStatus` subscribes when given a signal. Tested:
   subscribe → change → notified; same value → not notified;
   unsubscribe → not notified; engine identical snapshot →
   not re-notified (JSON equality). Boundary: see the no-push
   statement above.
6. SUCCESS FLOW, NARROWED TOOLS, MESSAGE BACK — done.
   `harness.spawnDeveloper()` passes goal + rules on
   `agent.rules` (curated tool subset, lanes, gates, soul
   reference); the developer works its plan → execute →
   critique loop and messages back via `report`, recorded in
   the developer history AND the harness history, labelled
   separately (`"owner request:"` vs `"report from
   developer:"`). Fail by design, tested: `createAgent` refuses
   a spawn that would give a subagent ALL caller tools, and
   refuses lanes wider than the caller's. One documented
   exception: a caller holding exactly one tool may give that
   one tool (refusing it would make single-tool delegation
   impossible). The spawned developer's tools are a strict
   subset of the kernel tools (8 of 16 in the default desk).
7. MANUALLY CREATED DEVELOPER AGENT — done.
   `public/defaults/memory/developer.agent.md` rewritten as a
   hand-curated v2 (was a 7-tool template skin: role/goal only;
   now identity as developer, DeepSeek honesty, its own
   plan → execute → critique loop, what it does and does not
   do, gates, report-back rule), plus `developer.instructions.md`,
   `developer.tools.md` (explicit 8-tool subset + excluded list
   with reasons), and `scripts/developer/dev-checks.shortcut.script.md`.
   Change to the old file, stated: `files.open` was ADDED to the
   tool list because the execute phase opens files; close/focus
   and terminal session tools stay excluded. The success test
   uses THIS curated developer (loaded from the files, via
   `loadDeveloperAgent()`), not a test-created skin; a missing
   developer definition makes `spawnDeveloper` throw plainly
   instead of falling back to a generic skin.

## LIFECYCLES — defined, configuration-based (2026-11-04, wins on conflict)

Perfection is defined lifecycles. Every element type carries its
lifecycle in its definition (`src/core/lifecycles.js`, the ONE
canonical registry — `elements.js` and `loop.js` hold no second
registry, and the engine holds no `switch(type)` branches: it
runs hooks from configuration). `defineElementLifecycle(type,
{steps, onCall, onStateChange, onRender, onPersist, onStop})`,
`runLifecycle(engine, element, event)`, `runLifecycleSequence`,
`removeElementLifecycle`. A new type runs with no engine change
(tested with a test-only `"note"` type); removing its
definition removes its lifecycle (tested). The loop emits tool
events; the engine runs lifecycles from them via the
`TOOL_ELEMENT_KIND` table (artifact-affecting file tools →
`live-artifact`, everything else → `function`).

Completeness rule, tested both ways: a live-artifact call that
only returns a value, without updating state + view + prompt,
is INCOMPLETE by definition. `engine.applyArtifactCall()` runs
the full lifecycle and returns the completeness report
(state/view/prompt/recorded/signal); `artifactCallComplete()` is
the predicate and `assertArtifactCallComplete()` rejects an
incomplete call (tested: a bare return scores all-false and is
rejected, a real call scores all-true).

UI priority — live state never missed: `lifecycleTwins(engine)`
in `src/core/ui-data.js` gives every lifecycle type a UI twin
(data-level; the JSX stays simple on purpose — no new visual
system, no glass, no added animations in this change). The test
iterates the lifecycle registry, mutates each type's state
through its lifecycle, and asserts the twin reflects exactly
that change immediately, with no refetch or sync step — and the
coverage gate fails if a registered type has no twin key.

Lifecycle table (accurate to the code; a step not here is not
defined and must not be built):

| element | lifecycle steps | what triggers the next step | what is recorded | what the UI shows | what the prompt sees |
|---|---|---|---|---|---|
| function tool call | call → run → return → record → next-step | loop stage runs the call; result returns; record step runs | `tool call:` + `tool result recorded:` in history; trace entry | calls list: stable id, status, partial, parallel group | tools element (specs, unchanged by the call) |
| live artifact | call → update-state → render-view → re-render-prompt → record | artifact tool called; state updated; view refreshed; prompt re-rendered; record step | `artifact call:` + `artifact updated:` in history; state + signal + prompt all changed (else incomplete) | artifact twin: open, focus, modified; artifact element string | artifact element with the NEW open/focus/modified |
| soul | load → render → version-change | desk load; render; a new soul element set (version change) | load is a fact, not history; version change re-renders | soul element string | soul element (stable mid-run unless version changes) |
| instructions | load → render → phase-change | desk load; render; phase change re-renders | phase-change refresh (no history rewrite) | instructions element string | YOU ARE element, current phase's instructions via phase line |
| history | append → clip | every record appends; compaction clips at 90% ctx | append-only entries; clip recorded as `history clipped by compaction` | history entries (goal-clipped in context) | goal-clipped history segment |
| goal | create → plan → execute → critique → report-back → complete | one goal.create; developer internal phases; report; done status | `goal create/phase/report-back/complete` in history; snapshots at transitions; trace entries | goals list: statement, status, steps | goal is a harness/engine property; request + work-done elements carry its statement/steps |
| subagent | spawn → quest → report → ask → dismiss → update | spawn; work; report/ask channel; dismiss/update | `agent spawned/reported/...` in history; trace entries; report in both histories | agents list: name, status, phase, goal | agents are not a prompt segment; their work reaches the prompt via artifact/history |
| watcher | subscribe → event → notify → halt | watcher subscribed; watched event fires; notify; halt rule | `watcher subscribed/event/notified/halted` in history | watchers list (names, status; empty = none) | watchers are desk-reader data, not an engine prompt segment |
| script | sequence → done | on-demand trigger; commands run; done notification | `script sequence/done` in history | scripts list (names; shared + agent, agent wins) | scripts are desk-reader data, not an engine prompt segment |
| skill-phase | entry-gate → run → exit-gate → handoff | phase entry gate; run with phase tools; exit gate; handoff packet | phase transitions; gate results in phase results | phases list: id, duty, status | current-phase instructions + phase tools (via runPhase narrowing) |
| model call | infer → record-timings → update-meter | infer called; timings/counts recorded; meter refreshed | `model call/timings recorded` in history; llm events in event log | activity word (thinking/tool call/working/idle), llm events | prompt meter segments summing exactly to prompt length |
| snapshot | deep-copy → store | transition (status/phase change); copy stored, never mutated after | `snapshot stored` in history; snapshot file (restart) | snapshot count + latest reason (goal snapshots) | snapshots are history, not prompt text |

Also in `src/core/README.md`: the same table (lifecycle section
appended at the end).

## Tests (updated)

- `bun test src/core`: baseline before changes 160 pass, 0 fail,
  671 expect() calls, 29 files; after Milestone 2 changes
  **197 pass, 0 fail, 954 expect() calls, 36 files** (+7 tests,
  1 new test file `src/core/milestone2.test.js`).
  No existing test was changed. (The older "Tests" section
  further down is the prior checkpoint record, kept as history;
  the counts here are current.)
- `bun run build` (Next.js 16.4.5): compiled successfully,
  **20 routes** (19 + new `/api/harness`; the Milestone 1
  addition was `/api/engine-object`).
- Biome on Milestone 2 files: clean on all new files (via
  `--write`) and on all touched old files except one
  pre-existing formatting diff in `src/app/models/page.js`
  (a paragraph untouched by Milestone 2, already failing in
  the 9709a1c base — left untouched per the old-files rule).
- Live route check (dev server, started, checked, stopped):
  `/` 200, `/api/engine-object` 200 (engine state + element
  strings with real tools), `/api/desk-snapshot?agent=developer`
  200 (curated developer twin, version 2, 8 tools),
  `/api/tools` 200, `/api/engine` 200, `/api/models` GET 200
  (empty list — defaults ship empty, no built-ins),
  `/api/harness` POST with a request and no model configured
  → honest 502 "no model configured" (defaults ship empty, so
  the HTTP chain cannot complete without a real provider; the
  chain itself is proven function-level with a mocked model,
  see Milestone 2 gap 1). Server confirmed down afterwards
  (port check + no next processes). No `personal/` folder was
  created in the clone by any check.
- NOT verified, stated plainly: no live-browser clicks (UI
  wiring verified by build + dev HTTP only); no real model call
  (mocked TOON model + mocked terminal only); no server push
  across HTTP (see the boundary above); the page's legacy
  CombinedView panels still use fetch-once React state and are
  marked legacy, but the dashboard chat send path is now the
  harness route, not the legacy single-turn route.


## Milestone 1 — checkpoint, refining continues

Milestone 1 is a checkpoint commit on the same branch, not the final PR.
Refining continues per milestone, each checkpoint re-running tests + build
before pushing; a milestone that breaks tests/build is not pushed.

- Milestone 1 state: core tests 177 pass, 0 fail (758 expects, 33 files),
  up from 160 in the first push; `next build` 19 routes (was 18 — the new
  route is `/api/engine-object`, see below).
- Included in Milestone 1 (in addition to the first push): insert-order
  render template, curated default agent files, live status + guidance,
  single server-desk/engine object, state-based signals, narrowed-tools
  success flow, hand-curated developer agent, lifecycle registry, and the
  single-engine-object + prompt-from-same-object chain. These were still
  being refined when this checkpoint was taken; see "Milestone 2"
  above, where all seven of those gaps are resolved.
- Route count, corrected: build is 19 routes, NOT 18. The added route is
  `○ /api/engine-object` (from `src/app/api/engine-object/route.js`). The
  earlier "18 routes, no route added/removed" line is superseded by this
  section for Milestone 1 onward.

## Milestone 2 — refinement (this checkpoint)

Milestone 2 state: core tests 197 pass, 0 fail (954 expects,
36 files), up from 190 in Milestone 1; `next build` 20 routes
(was 19 — the new route is `ƒ /api/harness`, see gap 1).
No existing test was changed. The eight gaps from Milestone 1
are resolved as follows (proof level stated per gap — a gap
is not claimed done beyond what its test proves):

1. CHAT NOW HARNESS-FIRST — done, function-level + wiring.
   New route POST `/api/harness` (body `{ request }`) runs
   `runHarnessRequest` (`src/core/harness-route.js`): it builds
   a harness on the SAME engine object the route resolved and
   calls `harness.ask()` — translate → exactly one goal.create
   (statement only) → developer plan → execute → critique →
   complete → report back. The dashboard chat (`src/app/page.js`
   send()) now posts to `/api/harness` and shows the
   developer's report as the assistant reply, then refreshes
   the engine signal from `/api/engine-object`. The old
   single-turn `/api/chat` route is kept but marked LEGACY in
   its file header and in this PR, and the dashboard no longer
   calls it. Proof: `src/core/milestone2.test.js` runs the
   exact route function end-to-end with a mocked TOON model
   and mocked terminal (goalCreateCalls = 1, no phases on the
   goal, report starts "Done:", file edited, developer tools
   a strict subset, engine.goal done) and asserts the route
   file calls `runHarnessRequest` + `getEngineObject` and the
   page posts to `/api/harness` and not to `/api/chat`.
   NOT route-handler-level: the Next handler itself is not
   executed in bun (Next Request/Response imports); the
   handler is a thin wrapper around the proven function, and
   that distinction is stated here, not blurred.
2. CHANGES LIST — done, verified by diff, not guessed.
   The Changes section below is rewritten grouped by
   milestone. Verification: Milestone 0 list = `git diff
   --name-only fa1e388 9709a1c` in a fresh clone;
   Milestone 1 list = `diff -qr` workdir vs fresh clone @
   9709a1c (excluding .git/node_modules/.next) before
   Milestone 2; Milestone 2 list = the files this checkpoint
   touched. Correction to the earlier brief: against 9709a1c,
   `agent-card.jsx`, `live-canvas.jsx`, `providers.js`, and
   the models route/page were NOT Milestone 1 changes — they
   were already in #17 (Milestone 0); the models route/page
   change AGAIN in Milestone 2, so they appear in both lists.
3. ROUTE COUNT — done: 20 routes, with both additions named
   (`○ /api/engine-object` in Milestone 1, `ƒ /api/harness`
   in Milestone 2). No "18 routes, no route added/removed"
   claim remains as a current-state statement; the old line
   survives only in the prior-checkpoint "Tests" section below,
   annotated as superseded.
4. MODELS THROUGH THE ENGINE OBJECT — done, with persistence
   verified. New `src/core/engine-models.js`: one store on the
   engine object (`engine._models`), seeded once from the desk
   snapshot; `applyEngineModelsAction` mutates it, syncs the
   engine signal, and persists to `<desk>/memory/model.json`
   when the desk folder exists, else in-memory + persisted:
   false. `/api/models` GET + actions now use it (its own
   module-level memoryStore and seed are removed); the models
   page now loads GET `/api/models`, not `/api/desk-snapshot`.
   Proof: temp personal folder test — use/edit persist to the
   temp file and a second read through the SAME engine object
   sees them; a vanished desk folder degrades to in-memory
   only with persisted: false. Route audit (all routes):
   every route except the two below goes through
   `getEngineObject`. `/api/desk-snapshot` still reads the
   template snapshot fresh for its twin data — its providers
   field is a READ-ONLY template view, not the action store,
   and the models page no longer reads it, so it cannot drift
   the page. `/api/inferences` and `/api/inferences/default`
   do NOT go through the engine object: they manage a
   DIFFERENT list — the chat inference list in
   personal/model.json (order = chat default) — reading and
   writing that one file directly, never seeding a copy. They
   are a separate store by design, not a second models copy;
   one honest consequence, stated plainly: models-page "Use"
   sets the providers-template default, NOT the chat default
   (that is `/api/inferences/default`'s job). Unifying them
   would change chat-default semantics and is not done here.
5. LIVE EVENTS / SIGNALS — done, bus extended, canonical bus
   named. `src/lib/live-events.js` now accepts goal:phase,
   goal:complete, agent:spawn, agent:report, agent:dismiss,
   tool:start/end/error, and compaction, with a state mapping
   for each (tested: emit + subscribe + map, unknown still
   refused). The live-agent section's canonical bus is the
   state-based engine signal (`src/lib/signals.js`, fed by
   `/api/engine-object`); the client bus is kept for the
   legacy chat flow only, and goal:/agent: events on it now
   trigger a refetch into the engine signal (page.js
   subscriptions) instead of being dropped. No second bus
   silently drops the new events anymore.
6. HARNESS GATE NUANCE — decided as a DESIGNED RULE, not a
   bug: critique is the judge, the execute gate is advisory.
   `runDeveloper` records every phase's `gatePassed` in
   `phaseResults`, but only the critique gate (plus the
   critique-failure text rule) decides loop-back/done. Rationale:
   an execute phase that reports completion without a done
   tool call (e.g. a no-change verdict) must not veto a
   passing critique — the judge, not the worker's own gate,
   decides. Proof: a test where the execute gate fails (no
   tool calls) and critique passes → done, report "Done:".
   If Kaushal wants a failed execute gate to halt instead,
   that is a one-line change in `harness.runDeveloper`
   (done = done && execute gate), not a redesign — but it is
   NOT the current rule, and no test claims otherwise.
7. LIFECYCLE TABLE — verified accurate in BOTH places. The
   table in this PR (above) and in `src/core/README.md`
   (lifecycle section at the end) lists all 12 types with
   steps matching `src/core/lifecycles.js` exactly; a new test
   asserts every registered type's steps equal the documented
   steps, so a future registry change without a table change
   fails the suite. No undocumented lifecycle step exists in
   the code: `runLifecycle` throws for an unknown type/step.
8. ARCHITECTURE + IDEOLOGY — done: the Governing
   Architecture section above is now explicitly titled
   "Planned architecture and ideology" and states all nine
   points (one live engine object, no backend/frontend split,
   right context only, goal = single statement call,
   executing agent owns plan/execute/critique, everything
   configuration-driven, lifecycles defined, live state never
   missed, no hardcoding) as the governing list, not only in
   chat.

## Known gaps, remaining after Milestone 2 (not yet perfect)

- No live-browser clicks: page wiring is verified by build +
  dev HTTP 200 + route JSON only, not by clicking the
  dashboard chat or Models buttons in a browser.
- No real model run: the harness chain is proven with a
  mocked TOON model only. Kaushal's real-model run (a real
  provider configured — defaults ship empty — a real edit +
  real `bun test` / `next build` through the loop) is still
  the unproven part of the success criterion.
- Pre-existing, noticed during Milestone 2 dev checks, not
  fixed here (shape change, out of this milestone's scope):
  `/api/engine-object`'s state snapshot includes the
  `location` field (an absolute desk path), although that
  route file's header comment says "no absolute paths". The
  field comes from `live-state.js` (location = desk.location)
  and predates Milestone 2; removing it changes the route
  shape and is left for Kaushal to approve, not silently done.

## Why

The retelling had the pieces but not the chain: a rendered prompt the chat never
sent, tools the UI showed but the model could not call, a goal that was a
phases statement written by the harness, and no single live state the UI could
reflect. This PR makes one exact structure: startup loads a desk folder, the
harness translates an owner request into one goal call, the executing agent
owns its own loop, and the UI reflects the exact snapshot of one live object.
No hardcoding ever: everything is configuration-driven from desk/memory.

## Before → After

Before: `engine.js` chat sent only `instructions.md` + history, no tools field;
no loop, no parser, no spawn tool; desk-reader and legacy desk coexisted;
models page buttons were disabled templates; goal had no defined artifact.

After: harness (`src/core/harness.js`) discovers a desk folder, loads desk
config + kernel tools, and `ask()` makes exactly one `goal.create` call and
passes it to the developer; developer owns plan → execute → critique, looping
back on critique failure; loop (`src/core/loop.js`) parses TOON, runs parallel
stages, compacts at 90% ctx, gates on dev checks; context selection renders
only the right elements with a meter that sums to the prompt length; card +
canvas render from the same live snapshot; models actions work (mocked test).

## Progress

- [x] Startup / desk discovery / harness agent
- [x] One single live state object + live events
- [x] Card UI + canvas live loop, data-driven from the same snapshot
- [x] Desk tools in core, agent tools in agent memory folders
- [x] Skills as a phase
- [x] Goal artifact (corrected model, see below) + developer subagent
- [x] Context optimization with left-out listing and prompt meter
- [x] Parallel rendering + parallel tool calls (not stop-the-world)
- [x] Compaction at 90% of model ctx length
- [x] Models with labelled defaults, Use/Test/Edit/Delete actions
- [x] Memory + restart (checkpoint, health, rollback, markdown restore)
- [x] Gitignore-filtered file artifact (explicit open is the documented exception)
- [x] Default goal from DeepSeek philosophy, loaded from a template file
- [x] Default response format TOON, dev-check gate
- [x] No-hardcoding proof test

## CORRECTION (2026-11-04, supersedes phases-in-goal)

Goal is a SINGLE tool call. The agent will ONLY write the goal statement.
It cannot plan. Execution is always the task of the executing agent.

- `goal.create` accepts: `statement` only, plus `id`/`name` for addressing.
- `goal.create` REFUSES (throws, never silently ignores): `phases`, `plan`,
  `tools`, `toolList`, `allowedTools`, `steps`, and a missing/blank statement.
- The goal artifact has NO `phases` field, NO `goal.set-phase`, NO
  `goal.next-phase`. It keeps statement, status, live folder, steps added
  during execution, evidence, decisions, openQuestions, history, snapshots.
  Goal tools are `goal.set-statement`, `goal.set-status`, `goal.add-step`,
  `goal.complete-step`, `goal.add-evidence`.
- Harness duty ends at: translate owner request → exactly one `goal.create`
  call (asserted `goalCreateCalls === 1` in test) → pass to developer → return
  its report. It does not plan and does not write phases.
- Developer loop is plan → execute → critique → done, owned by the developer.
  Internal phases live only on the developer agent record
  (`agent.internalPhases`, `agent.currentPhase`) and in its history, never in
  the goal. The old implement → build → critique → review → done graph is
  gone; review is not a harness phase. Critique failure (answer text
  `fail|needs work|not ready` without a pass, plus the critique exit gate)
  loops back to plan/execute, max 3 attempts.

## Tests

- `bun test src/core`: baseline before changes 110 pass, 0 fail; after changes
  **160 pass, 0 fail, 671 expect() calls, 29 files** (+50 new tests, all new
  files). No existing test was changed. Verified independently by the
  coordinator, not only by the writer.
- `bun run build` (Next.js 16.4.5): compiled successfully, **18 routes**
  (same route set as before, no route added/removed).
  (Superseded record — see Milestone 2: current count is 20 routes,
  with `/api/engine-object` and `/api/harness` added.)
- `bunx biome check` on all new files: clean (new files only, old files not
  reformatted).
- Live route check (dev server, started, checked, stopped): `/` 200,
  `/models` 200, `/api/desk-snapshot?agent=developer` developer twin,
  `/api/tools` core tool specs, `/api/engine` engine twin, `/api/models`
  action with unknown id → honest `{"error":"no provider with id none"}`.
  Server confirmed down afterwards.
- Real-chain tests (mocked TOON model only, no real model, no real CLI):
  harness → one goal.create (statement only) → developer plans, executes,
  critiques, loops back on failure, completes, reports; cold start from a
  temp desk folder → config → kernel tools → harness → developer → goal;
  context (implement-phase prompt contains implement tools, not review tools;
  meter segments sum exactly to prompt length; left-out listed); parallel
  (two independent calls in one stage overlap in time; a `$result.<name>`
  dependency defers to the next stage); compaction (≥90% ctx folds older
  steps, last 2 kept, recorded in history); restart (kept agent + goal survive
  from markdown, run-only does not respawn); UI data (adding a tool/phase/
  agent to a snapshot makes it appear, removing it removes it, no cycles
  panel when there are no cycles); skills-as-phase (review skill runs through
  the loop with only its tools); TOON (valid parsed, malformed → JSON/answer
  fallback, zero invented calls); goal refusal tests (phases/plan/tools
  refused, missing statement refused, no phases field on the goal).

## Changes — every file, grouped by milestone (verified by diff, not guessed)

Verification method: Milestone 0 = `git diff --name-only
fa1e388 9709a1c` in a fresh clone of askk-skeleton;
Milestones 1–2 = `diff -qr` (excluding .git/node_modules/.next)
of the workdir against that fresh clone @ 9709a1c, before and
after Milestone 2. A file that changed in two milestones
appears in both lists. The old "Modified (5)" list is
superseded by this section — it understated the diff.

### Milestone 0 — first push, merged as PR #17 (base 9709a1c)

New core modules (one test file each, except providers-ext):

- `src/core/toon.js` — TOON parser/formatter, JSON fallback
- `src/core/live-state.js` — singleton live desk object per location+id,
  snapshot, live events (`llm:*`, `tool:*`, `goal:phase`, `agent:*`,
  `compaction`). Note: this bus is its own module because
  `src/lib/live-events.js` validated against a fixed list without `goal:` /
  `agent:` types, and that file was deliberately not changed in Milestone 0.
- `src/core/context.js` — right-context selection, left-out with reasons/
  chars, prompt meter summing to prompt length
- `src/core/parallel.js` — parallel rendering, cacheKey skip, changed-only
  re-render
- `src/core/loop.js` — TOON loop, parallel stages, stop at next step
  boundary, maxSteps 12, compaction, checks gate
- `src/core/checks.js` — dev checks recorder `{name, command, status, exit,
  tail}`; loop refuses a final answer when files were modified with no
  passing test/build run
- `src/core/skills.js` — skill as a phase
- `src/core/goal-artifact.js` — goal artifact, corrected model above,
  markdown round-trip, gitignore-filtered live folder
- `src/core/spawn.js` — agent.spawn/dismiss/update, children registry,
  report/ask (ask = exactly one question), soul immutable, keep run|desk
- `src/core/agent-tools.js` — agent tools from memory folders, shared-first /
  agent-wins, agent-only visibility, lane narrowing, personal-only writes
  (missing personal dir is an error, never a public fallback)
- `src/core/harness.js` — desk discovery, harness agent, one goal.create,
  developer dispatch, DeepSeek default goal loaded from template
- `src/core/restart.js` — kept vs run-only, checkpoint (bounded 200 files,
  newest 5 kept), healthCheck, rollback, markdown restore
- `src/core/ui-data.js` — card/canvas data from the same snapshot

New components and templates:

- `src/components/agent-card.jsx` — status, stable call IDs, parallel
  groups, partial first-class, failed visible, only snapshot-present fields
- `src/components/live-canvas.jsx` — node-graph (agents, goal artifact,
  tool calls; edges: spawn, report, phase-transition) from the same snapshot
- `public/defaults/memory/goal-default.md` — DeepSeek super-agent philosophy,
  fetched from
  https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md
  (matched the retained summary on the core principle), loaded from disk,
  short fallback labelled "default" only if the file is missing; nothing
  about it is hardcoded in `engine.js` / `harness.js`
- `public/defaults/memory/skills/shared/review.skill.md` — example skill-phase

Modified in Milestone 0:

- `PR.md` — created (this file, Milestone 0 content)
- `src/core/providers.js` — `getModelDetails` (absent stays null),
  `defaultsFor` (ctx 128000 explicitly labelled "default"), `setDefaultProvider`,
  `updateProvider`, `removeProvider`, `applyProviderAction`; existing kinds/
  tests untouched
- `src/core/README.md` — new modules, correction, supervisor interface
- `src/app/page.js` — live-agent section below existing chat/snapshot
  sections, which are untouched
- `src/app/models/page.js` — Use/Test/Edit/Delete wired
- `src/app/api/models/route.js` — action handling added before the existing
  models-list proxy, which is preserved

### Milestone 1 — addendum: live object + lifecycles (diff vs 9709a1c)

Modified:

- `PR.md` — Governing Architecture, lifecycle table, Milestone 1 section
- `public/defaults/memory/developer.agent.md` — rewritten as hand-curated v2
- `src/app/api/agent/route.js`, `src/app/api/artifact/route.js`,
  `src/app/api/chat/route.js`, `src/app/api/desk-snapshot/route.js`,
  `src/app/api/desk/route.js`, `src/app/api/engine/route.js`,
  `src/app/api/snapshots/route.js`, `src/app/api/snapshots/[id]/route.js`,
  `src/app/api/soul/route.js`, `src/app/api/tools/route.js` — all switched
  to the single engine object (`getEngineObject`)
- `src/app/page.js` — live-agent section (engine signal, card, canvas,
  live status) below the legacy chat section
- `src/core/README.md` — lifecycle section + table appended
- `src/core/elements.js`, `src/core/render-template.js` — insert-order
  template delegation, new element builders
- `src/core/harness.js` — engine-object harness, guidance channel, curated
  developer spawn, narrowed tools, message back
- `src/core/loop.js` — guidance channel, phase narrowing notes
- `src/core/spawn.js` — developer internal phases (plan → execute →
  critique), critique-failure rule
- `src/core/ui-data.js` — live status data, lifecycle twins

New:

- `public/defaults/memory/default.agent.md`,
  `public/defaults/memory/default.instructions.md`,
  `public/defaults/memory/default.tools.md` — curated default agent
- `public/defaults/memory/developer.instructions.md`,
  `public/defaults/memory/developer.tools.md` — curated developer agent
- `public/defaults/memory/scripts/default/dispatch.shortcut.script.md`,
  `public/defaults/memory/scripts/developer/dev-checks.shortcut.script.md`
- `src/app/api/engine-object/route.js` — new route `○ /api/engine-object`
  (route count 18 → 19)
- `src/components/live-status.jsx` — typing-icon live status
- `src/core/engine-object.js`, `src/core/engine-object.test.js` — the ONE
  engine object, `askEngine` prompt-from-same-object
- `src/core/server-desk.js` — thin redirect to `getEngineObject`
- `src/core/lifecycles.js`, `src/core/lifecycles.test.js` — lifecycle
  registry (12 types), completeness rule
- `src/core/template-order.js`, `src/core/template-order.test.js` —
  insert-order render template
- `src/core/signals.js`, `src/core/signals.test.js` — state-based signals
- `src/core/addendum.test.js`, `src/core/loop-guidance.test.js` — Milestone 1
  coverage (template, default agent, status, guidance, singleton, signals,
  success flow, developer agent)
- `src/lib/signals.js` — UI re-export of the core signal system
- `src/lib/use-live-state.js` — React hook for engine signals

### Milestone 2 — this refinement (diff vs 9709a1c, on top of Milestone 1)

New:

- `src/core/harness-route.js` — `runHarnessRequest`, the exact function
  `/api/harness` calls (testable in bun without Next imports)
- `src/app/api/harness/route.js` — new route `ƒ /api/harness`, the
  dashboard chat's harness entry (route count 19 → 20)
- `src/core/engine-models.js` — models actions through the single engine
  object (`getEngineModels`, `applyEngineModelsAction`)
- `src/core/milestone2.test.js` — 7 tests: harness-route chain + wiring,
  engine-models persistence (temp personal folder + no-folder case),
  client-bus goal:/agent: events, gate rule, lifecycle-table accuracy

Modified:

- `PR.md` — Governing Architecture retitled "Planned architecture and
  ideology" with the nine-point list, Milestone 2 section, route audit,
  gate rule, corrected Changes (this section), route count 20
- `src/lib/live-events.js` — allowed list extended with goal:phase,
  goal:complete, agent:spawn, agent:report, agent:dismiss, tool:start/end/
  error, compaction, with state mappings
- `src/app/api/chat/route.js` — marked LEGACY single-turn (dashboard no
  longer calls it; kept for single-turn compatibility)
- `src/app/api/models/route.js` — actions + GET through the engine
  object; own memoryStore/seed removed
- `src/app/models/page.js` — loads GET `/api/models` instead of
  `/api/desk-snapshot`
- `src/app/page.js` — chat send() posts to `/api/harness` and refreshes
  the engine signal; goal:/agent: bus subscriptions refetch into it

Untouched by design: `src/core/engine.js` single-turn chat, `package.json`
(no dependencies added), `public/defaults/model.json` (pre-existing trailing
newline issue left alone). `src/lib/live-events.js` was untouched
through Milestone 1 and was EXTENDED in Milestone 2 (goal:/agent:
types added) — it is no longer in the untouched list.

## Evaluation

- Automated: tests + build above, all passing at verification time.
- Agent: this structure meets the step-by-step prompt anatomy as specified,
  including the 2026-11-04 goal correction, except for the caveats below,
  which are limits of verification, not hidden failures.
- Owner: decision pending — Kaushal tests on his Mac and merges himself.

## Caveats — NOT verified, stated plainly

- No live-browser clicks: page wiring is verified by build + dev HTTP 200 +
  route JSON only, not by clicking Models buttons or the dashboard in a
  browser. Click through Use/Test/Edit/Delete once with a real provider list
  present (defaults ship empty, so a provider must be added first).
- No real model call, no real CLI spawn anywhere in tests (mocked model and
  mocked terminal only, per spec). `runChecks`' non-mocked runner (real
  `bun test` / `next build` via child process) was not exercised; the real
  commands were run directly as verification instead.
- Models persistence, Milestone 2 update: persistence through the
  engine object IS now verified — in a test using a temp personal
  folder (use/edit write the temp `memory/model.json`, and a second
  read through the same engine object sees them). In this clone,
  which has no `personal/` folder, actions remain in-memory for the
  server process and the response says so plainly ("not persisted"
  note) — that behaviour is unchanged, only now it is tested.
  The models page no longer seeds from `/api/desk-snapshot`.
- Harness gate rule, Milestone 2 decision (designed, not a nuance):
  non-critique internal-phase exit gates are evaluated and recorded
  in `phaseResults[].gatePassed`, but only the critique gate decides
  loop-back/done; a failed execute gate does not by itself halt the
  attempt — critique is the judge, the execute gate is advisory,
  and a test asserts failed-execute + passing-critique → done.
- No SSE stream is claimed: live events are the in-process bus plus
  the existing client bus (now extended with goal:/agent: types);
  a server push stream remains future work. The live-agent
  section's canonical reactivity is the state-based engine signal.
- No supervisor running process: supervisor is documented as a separate
  process only (it does not exist as a running process here, and the worker
  never restarts itself), matching the spec's "documented" requirement.
- File artifact + gitignore: tree/list/search/expand filtering is the
  existing `files.js` / `gitignore.js` behaviour, untouched and still passing
  its tests; explicit open of a named path is the documented exception, not a
  filter bypass through a view.

## Success criterion — walkthrough

Kaushal checks out this branch, runs his model, asks the agent to adjust
something with the application, the agent should pass a goal statement to
the developer, and the developer works to complete the feature.

- Proven by test (mocked model): harness → one goal.create (statement only)
  → developer plan → execute → critique → loop back on failure → complete →
  report to harness → report to owner, with files edited and mocked tests run.
  Milestone 2 adds the route-level proof: the exact function
  `/api/harness` calls, run end-to-end with a mocked model and mocked
  terminal, plus wiring assertions that the route calls it and the
  dashboard chat posts to it (the Next handler itself is not executed
  in bun — see Milestone 2 gap 1 for the exact boundary).
- Still needs Kaushal's real model run: the same chain with a real model
  returning real TOON calls, a real provider configured (defaults ship
  empty), and a real edit + real `bun test` / `next build` through the loop.
  That part is NOT claimed as proven here.

## Changelog

- 2026-11-04 — Goal artifact + harness agent: desk-folder startup, one live
  state, card + canvas from the same snapshot, agent tools in memory, skills
  as a phase, goal.create statement-only (corrected), developer plan →
  execute → critique, right-context selection, parallel rendering/calls,
  90% compaction, labelled model defaults, restart with checkpoint/rollback,
  TOON default, dev-check gate, no-hardcoding proof — 160 core tests pass,
  build 18 routes. (Milestone 0 record only; current count is 20 routes —
  see Milestone 2.)
