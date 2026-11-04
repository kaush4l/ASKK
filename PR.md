# PR: Goal artifact + harness agent — step-by-step prompt anatomy

- Branch: feature/goal-artifact-harness
- Base: askk-skeleton @ fa1e388 (verified via `git ls-remote` before branching; parent 47d3460, PR #16 merged)
- Status: ready for Kaushal to test on his Mac and merge himself (assistant never merges)
- Kind: Feature

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

## Changes

New core modules (13, one test file each, except providers-ext):

- `src/core/toon.js` — TOON parser/formatter, JSON fallback
- `src/core/live-state.js` — singleton live desk object per location+id,
  snapshot, live events (`llm:*`, `tool:*`, `goal:phase`, `agent:*`,
  `compaction`). Note: this bus is its own module because
  `src/lib/live-events.js` validates against a fixed list without `goal:` /
  `agent:` types, and that file was deliberately not changed.
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

Modified (5):

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

Untouched by design: `src/core/engine.js` single-turn chat, `package.json`
(no dependencies added), `public/defaults/model.json` (pre-existing trailing
newline issue left alone), `src/lib/live-events.js`.

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
- Models persistence caveat: this clone has no `personal/` folder, so the
  route's persistence path (write to `personal/memory/model.json`) is
  code-complete but was NOT live-verified here; in this checkout actions are
  in-memory for the server process and the response says so plainly
  ("not persisted" note). The page and the route each seed from the desk
  snapshot, so they can drift if the template file changes mid-session.
- Harness nuance: non-critique internal-phase exit gates are evaluated and
  recorded in `phaseResults[].gatePassed`, but only the critique gate decides
  loop-back/done; a failed execute gate does not by itself halt the attempt —
  critique remains the judge. If a failed execute gate should halt, that is a
  one-line harness change, not a redesign.
- No SSE stream is claimed: live events are the in-process bus plus the
  existing client bus; a server push stream remains future work.
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
  build 18 routes.
