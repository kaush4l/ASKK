# Core audit — Checkpoint 1 (2026-11-04)

## ADDENDUM — component lifecycle completion (2026-11-04, feature/component-lifecycle)

The "twin work is paused" note below is SUPERSEDED. Work resumed
2026-11-04 13:06 EST and the component lifecycle was completed on
top of this audit, without moving files: `src/core/component.js`
(object + internal loop + UI + DOM equivalent in one thing),
per-kind live UI components (engine, tool, artifact incl.
script/watcher/goal kinds, agent as a derived kind), the
signal-subscribing dashboard/canvas, and the SSE transport
(`src/app/api/engine-stream/route.js` + `src/lib/component-transport.js`).
The audit's file/location verdicts below still stand; the
component layer reads the shapes this audit secured, it does not
replace them. See PR.md at the branch root for the full
completion record.

Scope: audit + secure the kernel core, and add its UI counterpart at
the same time (correction 2026-11-04 12:55 EST: core reorg and UI
are the same effort). No files were moved in this checkpoint
(moving breaks imports/tests inside a 40-minute cycle); the
standard below is DECLARED here and every file is matched to it
by this audit. Twin files were NOT edited, deleted, or built on
(twin work is paused; see Doubts).

## 1. The secured engine path — audit pick

Three engine constructors exist in this base. They are NOT three
copies of one thing; they are three layers, and the secured path
uses two of them:

| File | What it is | Verdict |
|---|---|---|
| `src/core/engine-by-name.js` — `loadEngineByName(name)` | Name-only load: per-agent instructions (personal else public), tool NAMES from `<name>.agent.md` looked up in the one kernel registry, live state from personal memory only, never invented. Step-1 verified (6 tests). | SECURED — the load path. New code (`engine-core.js`, `agent-render.js`) reads this shape natively. |
| `src/core/engine-object.js` — `createEngineObject(desk)` / `getEngineObject(location)` | The LIVE engine object: module-level singleton per location, live state, rendered prompt elements, signal, goal/history/skills. This is what the routes (`/api/engine-object`) and the harness actually run on. | SECURED — the runtime object. `renderAgentForScreen` reads this shape natively, and `/api/engine-object` now also returns its render tree as `agentRender`. |
| `src/core/engine.js` — `createEngine({ instructions, model, tools })` | Single-turn chat skeleton: one query in, one LLM reply out, tools loaded-but-not-called, model fallback to the desk default (first entry in `model.json`). Still used by `desk.js` (`createDesk` builds its engine from it) and covered by `engine.test.js`. | LEGACY — marked here, NOT deleted in this checkpoint. Deletion needs a desk migration + test updates; that is Doubt D1, not a guess. |

Why this pick: by-name is the direction Kaushal already verified
(name-only, registry tools, no invented defaults), and
engine-object is the object the server already runs. Picking
either one alone would have dropped a live path; the new
schema (`engine-core.js`) normalizes BOTH, so the UI renders
either shape from the same code. Unifying them into one
constructor is still open — Doubt D2.

## 2. Every kernel object → its ONE file/location

### Abstract elements — `src/core/` IS the kernel core

| Kernel object | ONE location | Duplicate / second copy found | Action |
|---|---|---|---|
| Engine (abstract + live) | `engine-core.js` (schema) + `engine-by-name.js` + `engine-object.js` (see §1) | `engine.js` legacy constructor (see §1) | Kept, marked legacy. No deletion. |
| Tool (abstract contract) | `tool.js` (`Tool`, `createToolRegistry`) | None as a contract. `agent-tools.js` is NOT a duplicate: it is agent-created tools in memory folders, loaded shared-first/agent-specific-wins — a different layer, kept. | Kept both, roles stated. |
| Artifact (abstract + live) | `artifact.js` (`LiveArtifact`, `createLiveArtifact`, `loadLiveArtifact`) | None. Artifact wraps the per-location files singleton — the SAME files instance, not a second files state. | Kept. |
| Goal (artifact kind) | `goal-artifact.js` (NOT edited here) | None in core. Its twin test (`goal-twin.test.js`) is twin-layer, paused. | Untouched. Placement question → Doubt D4. |
| Live state | `live-state.js` (registry per location+id, one object) | None. `engine-object.js` cache is the engine cache, not a second state copy; `server-desk.js` is a thin redirect to `getEngineObject`, not a second singleton. | Kept. |
| Elements (render-prompt units) | `elements.js` (`DeskElement`, element builders) + `template-order.js` (ordering) + `render-template.js` | `engine-core.js` does NOT duplicate these: it is the element/attribute SCHEMA (what the engine holds), while `elements.js` is the prompt-string rendering of elements. Different jobs. | Kept both, roles stated. |
| Lifecycle | `lifecycles.js` | None. | Kept. |
| Loop / phases | `loop.js` (`runLoop`, `runPhase`) + `spawn.js` (agent spawn, developer internal phases) | None. | Kept. |
| Harness | `harness.js` (translate → one goal.create → developer → report) | None. | Kept. |
| Desk / snapshot reading | `desk.js` (desk assembly) + `desk-reader.js` (per-file personal-else-public reads) + `agent-md.js` (agent document shape) | Overlap checked, not a duplicate: `desk-reader.js` reads files with fallback, `agent-md.js` shapes/renders the agent document. Kept; no merge attempted. | Kept. |
| Snapshot (shape vs state vs store) | `snapshot.js` (pure shape + `deepCopy`) + `snapshot-state.js` (state shape v2) + `snapshot-store.js` (fs storage only) | Three layers, not three copies: the store imports its shape from `snapshot.js`. | Kept. |
| Skills | `skills.js` | None (names/shapes only in this base; skill-as-phase twin is paused twin work). | Kept. |
| Activity / loop state | `activity.js` + `live-state.js` events + `loopState` on the by-name engine | `loopState` (by-name engine) and live-state events describe loop progress from two angles (engine-local vs desk-wide); `engine-core.js` reads both under the single `activity` element. No copy was removed. | Kept, unified under one schema element. |

### Tools / defaults — `core-tools.js` ONLY

Verified: `createCoreTools()` returns exactly 16 tools, no web,
no invented tools — 9 files tools + 7 terminal tools
(`CORE_TOOL_NAMES` in `core-tools.js` is the single list, and the
factory throws if a `web.*` tool ever appears). Tool
implementations live in `files.js` and `terminal.js` — those are
the implementations the registry wraps, not a second registry.
No default tool was found duplicated elsewhere; no duplicate was
removed, because none existed. (`loop.js` and `spawn.js` name
tool names only as phase allow-lists — that is narrowing, not a
second registry.)

### Inference — `inference.js` (+ registry in the same file)

`inference.js` had NO identifier-keyed registry before this
checkpoint (`createInference` is a per-provider object). Added:
`createInferRegistry()` IN `inference.js` — one file only, no new
`infer-registry.js`. Register by identifier, retrieve by
identifier, unknown identifier throws plainly, empty registry
throws (NO hardcoded model, NO silent default). See Doubt D3 for
the pre-existing desk-default behavior this does NOT yet replace.

### Structured response — NEW `response.js`

No response base class existed before this checkpoint (grep for a
response class/base found nothing; `toon.js` is a format
parser/formatter, not a base). Added: `response.js`
(`StructuredResponse`: configuration = keys in order, each with a
description; `generate()` reads keys in order; a new method is a
configuration, no engine change — proven by test with a dummy
method). `toon.js` is reused as ONE configuration
(`toonResponseMethod()` delegates generate/parse to
`formatReply`/`parseReply`); no TOON parsing was duplicated.
Configuration-shape question → Doubt D6.

### Core utils — all in `src/core/`

`gitignore.js`, `parallel.js`, `context.js`, `checks.js`,
`placement.js`, `signals.js`, `snapshot.js`, `snapshot-state.js`,
`snapshot-store.js`, `template-order.js`, `template-skin.js`,
`desk-reader.js`, `providers.js`, `engine-models.js`,
`restart.js`, `activity.js`, `ui-data.js`, `server-desk.js`,
`harness-route.js`. (See Doubt D4 for `harness-route.js` and
`ui-data.js` boundary questions.)

### New files this checkpoint

- `src/core/engine-core.js` — `defineEngineElements(engine)` +
  `ENGINE_ELEMENTS` schema + `validateEngine(engine)`.
- `src/core/agent-render.js` — `renderAgentForScreen(agentOrEngine)`
  → `{ dashboard, canvas }`, read live at call time.
- `src/core/response.js` + `response.test.js` — response base.
- `src/core/engine-core.test.js`, `src/core/agent-render.test.js`,
  `src/core/inference.test.js` — tests for the above; infer
  registry tests live with the file they cover.
- `src/components/agent-dashboard-canvas.jsx` — dashboard space +
  canvas space, ONE prop (the render tree), iterated, no
  hardcoded names. NOT a chat window; no chat added.
- `src/app/api/engine-object/route.js` — EDIT only: added
  non-breaking `agentRender` field (+ `agentRenderError` only on
  failure). No new route, no existing field changed.
- `src/app/page.js` — EDIT only: minimal wiring (fetch
  `agentRender`, render `AgentDashboardCanvas` in the live-agent
  section). Existing chat and `CombinedView` untouched.

## 3. Declared standard folder structure (no moves this checkpoint)

```
src/core/  = kernel core (the kernel/core/ of this app)
  abstract elements : tool.js, engine-core.js, engine-by-name.js,
                      engine-object.js, engine.js (legacy, §1),
                      artifact.js, goal-artifact.js, live-state.js,
                      lifecycles.js, elements.js, loop.js, spawn.js,
                      harness.js, desk.js, skills.js
  tools/defaults    : core-tools.js (16 only) over files.js,
                      terminal.js (implementations, not a registry)
  inference         : inference.js (createInference +
                      createInferRegistry, no default)
  structured response: response.js (base) + toon.js (one configuration)
  core utils        : gitignore.js, parallel.js, context.js,
                      checks.js, placement.js, signals.js,
                      snapshot*.js, template-order.js,
                      template-skin.js, desk-reader.js, agent-md.js,
                      providers.js, engine-models.js, restart.js,
                      activity.js, ui-data.js, server-desk.js,
                      harness-route.js
src/components/agent-dashboard-canvas.jsx = dashboard + canvas space
  (renders the render tree; twin-layer UI for engine/tool/artifact
  kinds follows after core, on top of this — not in this checkpoint)
```

Any file that does not fit this declaration is listed under
Doubts, not silently moved.

## 4. No-hardcode check

NEW code (grep over `engine-core.js`, `agent-render.js`,
`response.js`, `agent-dashboard-canvas.jsx`,
`api/engine-object/route.js`): NO hardcoded tool names, NO
hardcoded element/panel lists, NO model defaults found. (One
comment line in the component mentions the concept of tool names
in prose; it names no tool and sets no default.) The schema
(`ENGINE_ELEMENTS`) is the single element list by design — that
is the point, not a violation: UI code reads it, it does not
carry its own.

PRE-EXISTING hardcoded lists — listed, NOT rewritten (removal
candidates for Kaushal):

- `src/components/combined-view.jsx:400,402` — mock feed entries
  literally titled "Tool call: files.open" with a fixed result
  string; `:603,604,607,611` — verification strings hardcoding
  "3 files.open" and a feed check on it; `:651` — a mock
  "terminal.run build failed…" verification string.
- `src/components/combined-view.jsx:1221,1225` — tool counts by
  `tool.name.startsWith("files.")` / `startsWith("terminal.")`
  (grouping by hardcoded prefix, not by the tool's own kind).
- `src/components/combined-view.jsx:989,1112,1215` — "0 web tools"
  / "web: 0" / "none — 0 web tools shipped" baked into copy.
- `src/components/tools-panel.jsx:151,168` — panels rendered only
  when `tool.name.startsWith("files.")` /
  `startsWith("terminal.")`; `:80-94` — files/terminal detail
  sections keyed to those two groups.
- `src/components/combined-view.jsx:810` — "Model: {model} · Tools:
  N core tools" status line (model shown as a single slot, not
  from the infer registry).
- `src/core/spawn.js:59,66-67,74,82` and `src/core/skills.js`
  comments — developer phase allow-lists naming tools. These are
  phase NARROWING (a rule about what a phase may call), not UI
  panels; listed here so the distinction is explicit, not because
  they are UI hardcoding.

## 5. Doubts (recorded, not guessed)

- D1 — Legacy engine deletion: `engine.js` still feeds `desk.js`
  (`createDesk` builds `desk.engine` from it) and `engine.test.js`
  covers it. Delete only with a desk migration + test updates.
  Listed, not done.
- D2 — One engine constructor? By-name (plain, load-time) and
  engine-object (singleton, runtime) are both secured but not
  unified. `engine-core.js`/`agent-render.js` normalize both;
  whether one constructor should replace both is Kaushal's call.
- D3 — Silent default vs no-default: `desk.js` sets
  `desk.defaultInference` to the first entry in `model.json`,
  and `engine.js` falls back to the desk default — while the new
  infer registry refuses any default. Reconciling the desk
  default with the registry's no-default rule is open.
- D4 — Files that do not fit the declared structure cleanly:
  `kernel-twin.js`, `goal-twin.test.js`, `tool-artifact-twin.js`
  (twin layer — paused, untouched, resumes on top of secured
  core); `goal-artifact.js` (goal as an artifact kind — confirm
  it stays a top-level core file vs moving under an artifacts
  family); `providers.js` + `engine-models.js` (TWO models lists
  by design per the `engine-models.js` header — providers
  template store vs desk inference list — confirm the split
  stays); `harness-route.js` (route adapter living in core);
  `ui-data.js` (UI data shaping living in core).
- D5 — Pre-existing UI hardcoding (§4) is listed for removal,
  not removed: `combined-view.jsx`, `tools-panel.jsx` (and
  `skills-panel.jsx`, `live-canvas.jsx`, `engine-live.jsx` were
  not re-audited line-by-line this checkpoint) stay as-is until
  Kaushal approves their replacement by the dynamic component.
- D6 — Response configuration shape: generic methods render
  one line per key; TOON needs repeated `call:` lines, so it
  delegates to `toon.js`. Confirm multi-value keys (repeated
  lines) should stay a per-method delegation, not a base feature.
- D7 — Infer registry method signature is `fn(messages)` only;
  a method needing endpoint/model config closes over it.
  Confirm no standard method-config shape is wanted.
- D8 — Scope tension, resolved by following the correction:
  the original brief said UI was out of scope; the 12:55 EST
  correction (core + UI same effort) superseded it, so this
  checkpoint ships BOTH. Confirm no further UI (e.g. replacing
  the combined view) is expected in this checkpoint.
- D9 — Scripts/watchers on the engine: the by-name engine
  carries no scripts/watchers fields (the desk reader lists
  definition NAMES only). Whether they should load as live
  objects on the engine is open; the schema lists them as
  absent/empty until then.
- D10 — "Snapshot, not a copy" reading: `agent-render.js`
  re-reads live fields on every call and returns fresh plain
  data for transport — it does not hand the UI a live reference
  (HTTP cannot). If "not a copy" is meant as reference identity,
  that reading conflicts with transport; plain-data-per-call is
  the meaning used here.
