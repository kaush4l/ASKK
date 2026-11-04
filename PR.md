# PR: Component lifecycle — object + internal loop + UI + DOM equivalent

- Branch: feature/component-lifecycle
- Base: askk-skeleton @ c9d73a7 (verified via `git ls-remote` before branching; parent 9709a1c, PR #18 merged)
- Status: complete, verified locally, pushed, NOT merged, no GitHub PR object (assistant never merges; Kaushal merges himself when perfect)
- Kind: Feature

## Why

Kaushal's exact point, stated 2026-11-04 13:05 EST: the work should
be like a React component lifecycle. A component, an object, or an
instance should have its UI. A live UI. Signals update the DOM as
the event happens.

The paused work (2026-11-04 13:01 EST) had built toward that point
but had not built it exactly: twins held a lifecycle *state* and a
snapshot, but no twin *ran* a loop; the dashboard component was
presentational (it took a render tree prop and never subscribed
to a signal); the twin header itself recorded push transport
across HTTP as UNDECIDED (in-process signals only); and per-kind
UI was a generic SnapshotValue for everything. This PR closes
those four gaps, on top of the paused work, re-verified as a whole.

## Governing philosophy (wins on conflict)

- Event-driven: as soon as the event happens, we understand what
  to do. Every UI update is driven by a kernel event.
- Core elements: engine, tool, artifact — watcher and scripts
  are also artifacts (artifact kinds), goal is an artifact kind
  where it fits. Other kinds are secondary/derived, not core bases.
- Component instance = object + internal loop + UI + DOM
  equivalent, in ONE thing. Mounted on initialization, updated
  by signals as events happen, unmounted on dismiss.
- Engine general state is a LOOP: doing tool calls, creating
  subagents. The engine component shows loop state, not a chat
  transcript.
- Interactive UI (dashboard space + canvas space, agent sent
  there, rendered dynamically from what the agent holds, no
  hardcoded panels/tools/elements) rather than a plan chat
  window. Chat is secondary input only.
- Core + UI together, same effort: no core element captured
  without its UI counterpart, no UI element added without its
  kernel core element.
- No hardcoding ever. Persistence belongs to the kernel
  (personal memory files), never to the twin or the component.

## Before → After (paused state → completed component lifecycle)

| Gap (from the 13:05 EST check) | Before (paused) | After (this PR) |
|---|---|---|
| 1. Internal loop inside the component | Twin held loopState read from elsewhere (engine-by-name applyLoopEvent); loop lived in loop.js/harness, not in the twin | `src/core/component.js`: the component RUNS its loop — `runLoop(actions)` (phase/tool/spawn, each step updating loopState + twin + signal) and `runModelLoop()` (the REAL loop.js runLoop, TOON by default, onEvent wired into loopState + twin + signal). Engine UI shows current phase, current tool call, subagents, waiting/running/done |
| 2. Signal → DOM, live | Dashboard component took a renderTree prop, never subscribed; twin D1: push transport UNDECIDED, in-process only | Dashboard/canvas subscribes to a signal itself (useLiveState). Named transport: SSE at `/api/engine-stream` (server push, verified by curl in dev), with polling fallback in `src/lib/component-transport.js` when EventSource is unavailable or errors. Components never refetch the desk |
| 3. Per-kind live UI, not generic snapshot only | Generic SnapshotValue for everything | EngineComponent (loop state), ToolComponent (name, description from the tool, last call/result/duration/error), ArtifactComponent (script, watcher, goal, generic kinds, each its own defined attributes), AgentComponent (derived subagent kind). SnapshotValue remains ONLY as fallback for unknown fields |
| 4. Mount / unmount | Twin registry had created/dismissed, but no component mount/unmount concept with a registry | Component registry: mount on initialization (twin created→initialized→idle, registered, signal holds first snapshot); dismiss unmounts (children dismissed first, registry entry removed, twin dismissed, signal holds dismissed snapshot). Keep-desk keeps twin + UI, stated plainly |
| 5. Core + UI together | Core audit (CORE-AUDIT.md) secured locations; UI was a separate Checkpoint 1 addition | Component layer reads the audited shapes (engine-core schema, engine-by-name, engine-object) and adds its UI counterpart in the same change. CORE-AUDIT.md carries a completion addendum; its verdicts stand |
| 6. No chat-first | Dashboard had chat above, legacy panels untouched | Dashboard/canvas space is not a chat window; chat stays secondary input elsewhere on the page. No chat was added, moved, or deleted in this PR |

## Component lifecycle table (mount / update / unmount per kind)

| Kind | Mount (on init) | Update (on event) | Unmount (on dismiss) | UI component |
|---|---|---|---|---|
| engine | loadEngineByName(name) → twin → component, twin idle, signal = first snapshot | tool:start/end, loop:phase, agent:spawn/dismiss/report → loopState + twin + signal | dismiss → children dismissed first, registry removed, twin dismissed | EngineComponent: phase, current tool call, subagents, waiting/running/done, tool-call counts, recent calls |
| tool | createToolTwin(tool) → component, twin idle | tool:start/end/error → lastCall, lastResult, lastDuration, lastError + signal | dismiss → registry removed, twin dismissed | ToolComponent: name, description (from the tool), lifecycle, last call/result/duration/error |
| artifact (generic) | createArtifactTwin → component, twin idle | artifact:state-change → attributes + history + signal; state saved to state.md exactly | dismiss → registry removed, twin dismissed | ArtifactComponent (generic): title, content, expanded, history fallback |
| artifact (script) | same, artifactKind "script" | state change (runStatus, doneNotification) + signal | same | ArtifactComponent (script): trigger, commands, runStatus, notify, doneNotification |
| artifact (watcher) | same, artifactKind "watcher" | state change (lastEvent, started) + signal | same | ArtifactComponent (watcher): watch, event, notify, started, lastEvent |
| artifact (goal) | goal.create → goal twin → component, twin running | goal:add-step/complete-step/add-evidence/phase/report/complete → snapshot + signal; file written on create and every mutation | dismiss → twin dismissed (file kept as kernel history); reload re-creates goal + component | ArtifactComponent (goal): statement, status, steps done/total, evidence, report |
| agent (DERIVED, not a core base) | spawn → agent twin → child component, mounted | agent:spawn/report/dismiss → parent loopState + child signal | dismissChild → child dismissed, removed from parent; parent dismiss dismisses all children first | AgentComponent: name, role, status, currentPhase, tool names |

## Signal → DOM transport (named, with interim status)

- **Named transport: SSE.** `GET /api/engine-stream` sends
  `event: engine` with the engine object's current snapshot +
  agentRender tree, on connect and every 2s, until disconnect.
  This is server push, verified in dev (curl received `event:
  engine` frames within 5s — see Tests). It is NOT claimed as
  browser-verified: no live-browser clicks were run.
- **Fallback: polling, in the transport only.**
  `src/lib/component-transport.js` prefers EventSource; when
  EventSource is unavailable or the stream errors, it polls
  `/api/engine-object` and delivers a new tree to the signal
  ONLY when the tree JSON actually changed, so a poll that
  finds nothing new does not re-render. Components never fetch:
  they subscribe to the signal (useLiveState) and re-render on
  signal change. Polling is the fallback, not the design.
- **In-process signals are not cross-HTTP.** The twin/component
  signal chain (twin emit → signal.set) is in-process; across
  HTTP it is the SSE stream (or its polling fallback) that
  feeds the client-side signal. The old twin D1 doubt
  (transport UNDECIDED) is now answered by this section.

## Progress

- Resumed paused work 2026-11-04 13:06 EST on Kaushal's go-ahead;
  paused state verified first (base c9d73a7 unchanged, branch
  feature/component-lifecycle did not resolve, workdir status
  matched the pause record exactly).
- Baseline at resume: `bun test src/core` 252 pass, 0 fail,
  44 files.
- Added `src/core/component.js` (component lifecycle + internal
  loop) and `src/core/component.test.js` (10 tests) +
  `src/core/component-chain.test.js` (1 real-chain test).
- Added per-kind UI: engine-component, tool-component,
  artifact-component, agent-component (derived), snapshot-value
  (fallback only); rewrote agent-dashboard-canvas to subscribe
  to a signal itself and render per-kind components.
- Added transport: `src/lib/component-transport.js` (SSE first,
  polling fallback) + `src/app/api/engine-stream/route.js`
  (SSE, ƒ dynamic in build); wired the home page to feed the
  agentRender signal through it (initial load unchanged,
  transport added, no panel rewritten, no chat moved/deleted).
- One build error found and fixed in-milestone: `export const
  dynamic = "force-dynamic"` is incompatible with this
  project's `cacheComponents: true` (Turbopack build failed);
  removed — a ReadableStream route is dynamic by nature.
- Biome: clean on all 12 new/changed files after fixes
  (formatting, one unused import, one exhaustive-deps entry,
  index keys replaced with stable keys).

## Tests

- `bun test src/core`: **263 pass, 0 fail, 1474 expects,
  46 files** (resume baseline 252 / 44; +11: component.test.js
  10, component-chain.test.js 1). No existing test was changed.
- Component tests prove, each with its own test:
  - mount on init: component present, twin idle, signal holds
    the snapshot;
  - signal updates as events happen: loop tool call changes UI
    state (phase, toolCalls.done, currentToolCall), signal
    fired on events, no refetch;
  - loop spawns a subagent: child component mounts, parent
    loopState lists it; dismissChild unmounts it;
  - unmount on dismiss: component absent, twin gone, registry
    empty; keep-desk is not dismissed (twin kept, UI stays);
  - tool component runs a real Tool instance inside the loop;
  - script and watcher are artifact kinds, not core kinds
    (runStatus update reaches the signal);
  - goal as artifact kind: mounts, state saves and restores
    on simulated restart (file → re-created goal + component,
    status/report/steps exact);
  - model loop owned by the component: mocked TOON reply
    drives loop state + signal through the real runLoop;
  - different agent renders different dashboard/canvas with
    no rendering-code change (developer vs default tool names).
- Real-chain test (component-chain.test.js, mocked model/tools
  only): goal.create statement-only (a smuggled `phases` key
  is refused) → goal artifact twin mounts → delivered to the
  developer component (kernel + twin snapshot, not the raw
  request) → developer loop plan → execute → critique with
  tool calls → spawn reviewer child → goal steps completed,
  evidence, report, status done → UI state driven by events
  (developer loopState, goal twin status/report) → goal file
  reload re-creates goal + component exactly → developer
  dismiss unmounts developer and reviewer.
- `next build`: compiles, **21 routes** (was 20 in this
  prototype's base count; the one added route is
  `/api/engine-stream`, ƒ dynamic; no route removed).
- Biome: clean on all 12 new/changed files (see Progress).
- Live dev check (started, checked, stopped):
  - `/` 200; `/models` 200;
  - `/api/engine-object` 200, agentRender present: dashboard
    12 entries, canvas 1 entry, agentRenderError none;
  - `/api/harness` POST with no model → honest 502 "no model
    configured: pass an inference to harness.ask(), or add a
    default inference";
  - `/api/engine-stream` (curl, 5s): real `event: engine`
    frames received — server push verified at the HTTP level.
  - Server confirmed down after the check (curl 000).
- No-hardcode grep proof (rendering path only):
  `files.list / files.read / terminal.run / goal.create` and
  model names (`gpt-`, `claude-`, `opus`, `sonnet`) — NONE
  FOUND in agent-dashboard-canvas, engine/tool/artifact/agent
  components, snapshot-value, component-transport, or
  component.js. Element ids ("tools", "artifacts", "agent")
  are schema ids from engine-core, not hardcoded tool lists.
- Pre-existing diffs untouched: `public/defaults/model.json`
  trailing newline and `src/app/models/page.js` paragraph
  (both pre-existing in the base, not this PR's).

## Changes

New files:
- `src/core/component.js` — component lifecycle: createComponent,
  createEngineComponent, createEngineComponentFromEngine,
  createToolComponent, createArtifactComponent, component
  registry (get/list/has/clear), internal loop (runLoop actions,
  runModelLoop via loop.js), mount/dismiss, signal.
- `src/core/component.test.js`, `src/core/component-chain.test.js`
- `src/components/engine-component.jsx`, `tool-component.jsx`,
  `artifact-component.jsx`, `agent-component.jsx`
  (derived), `snapshot-value.jsx` (fallback only)
- `src/lib/component-transport.js` — SSE-first, polling-fallback
  transport feeding a signal
- `src/app/api/engine-stream/route.js` — SSE route
- `PR.md` (this file, replacing the stale goal-artifact PR.md
  that the base carried at its root)

Changed files:
- `src/components/agent-dashboard-canvas.jsx` — subscribes to a
  signal itself (useLiveState), renders per-kind components,
  SnapshotValue only as fallback; still one renderTree prop
  plus an optional signal prop, still no hardcoded panels.
- `src/app/page.js` — agentRender signal + transport effect
  (SSE first, polling fallback) feeding it; initial load
  unchanged; chat and legacy panels untouched.
- `src/core/CORE-AUDIT.md` — completion addendum only; the
  audit's file/location verdicts stand.

Unchanged / carried over from paused work (not rebuilt):
- Paused workdir files (engine-by-name, engine-core,
  agent-render, kernel-twin, tool-artifact-twin, goal-artifact,
  loop, spawn, inference, response, harness, artifact, tool,
  engine-object route, page wiring for agentRender) — verified
  as the base for this completion, not rewritten.
- `PROTOTYPE.md` at the workdir root is a local step note and
  is NOT part of this push.

## Evaluation

- What this PR proves: a component is now one thing — object +
  internal loop + UI + DOM equivalent. Create it and its UI
  mounts; fire an event and its signal updates its DOM data;
  dismiss it and its UI unmounts. The engine component's UI is
  loop state (phase, current tool call, subagents, waiting /
  running / done), not a chat transcript. The dashboard/canvas
  is interactive (twins, canvas, live state) first; chat is
  secondary input elsewhere on the page.
- What it does not prove (state plainly, do not claim):
  - No real model call anywhere (mocked TOON model and fake /
    real Tool instances only, per spec).
  - No real CLI spawn in the chain (fake tools; core terminal
    tools exist but were not run in this chain).
  - No live-browser clicks: UI wiring is proven by build +
    dev HTTP 200 + route JSON + SSE frames via curl, not by
    clicking the dashboard, the canvas, or the chat.
  - No server push across a real browser session: SSE is
    verified at the HTTP level (curl), not in Kaushal's
    browser; the polling fallback exists for exactly that gap.
  - No second-instance / multi-worker machine state: the
    component registry and twin registry are per-process.
  - The legacy single-turn engine (`src/core/engine.js`) and
    the legacy `/api/chat` route still exist in this base;
    this PR does not delete them (deletion needs a desk
    migration — see Doubts).

## Changelog

- Component lifecycle: mount / signal-update / unmount for
  engine, tool, artifact (script, watcher, goal, generic)
  components; agent as a derived component kind.
- Internal loop inside the component: action-list loop and
  real TOON loop owned by the component, events driving UI state.
- Signal → DOM: dashboard/canvas subscribes to a signal itself;
  SSE transport (`/api/engine-stream`) with polling fallback.
- Per-kind live UI components; SnapshotValue demoted to fallback.
- Core + UI together: component layer reads the audited core
  shapes, adds its UI counterpart in the same change.
- No-hardcode proof for the rendering path (grep, see Tests).

## Doubts (recorded, not guessed)

1. Legacy engine + chat route: should `src/core/engine.js`
   (single-turn skeleton) and `/api/chat` be deleted now that
   the component engine exists, or kept until a desk migration
   moves `desk.js` off `createEngine`? (CORE-AUDIT Doubt D1,
   still open.)
2. Engine unification: should `loadEngineByName` (name-only)
   and `createEngineObject` (desk singleton) be unified into
   one constructor, or stay as two layers normalized by
   engine-core? (CORE-AUDIT Doubt D2, still open.)
3. SSE in the browser: is the SSE stream + polling fallback
   acceptable as the live transport, or should the client
   switch to WebSocket before this is considered done? The
   SSE route is implemented and HTTP-verified; browser
   verification is Kaushal's checkout step.
4. Keep-desk UI: a keep-desk component keeps its twin and UI
   on dismiss (it persists, it is not dismissed). If Kaushal
   wants kept components twin-less in-process until reload,
   that is a one-line change in component dismiss, not a
   redesign — ask, do not guess.
5. Multi-worker machine state: is a per-process component/twin
   registry acceptable, or must component state survive
   multiple workers / a second instance? Not addressed here.
6. Public-defaults fallback templates: `default` / `developer`
   agent files remain as read fallback templates; a spawned
   agent's instance is always its own personal record. If
   Kaushal wants even the fallback templates removed, that is
   a fallback change, not a redesign — ask, do not guess.

## Success criterion walkthrough (for Kaushal's checkout)

Checkout the branch, run the dev server, open `/`: the agent
dashboard + canvas render from what the agent holds (no
hardcoded panels). Configure a real provider (defaults ship
empty, no built-ins), ask the dashboard to adjust something:
harness → goal.create (goal artifact component mounts) →
developer component mounts, its loop runs plan → execute →
critique with tool calls and a spawned child component →
report → done, with the engine component showing loop state
(phase, current tool call, subagents) as events happen, and
the goal/artifact components showing their state from
personal memory. Dismissing an agent removes its UI. That
real-model run is still to be done by Kaushal — it is not
claimed here.
