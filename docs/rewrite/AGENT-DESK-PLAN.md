# ASKK: portable agents and an observable agent desk

Status: implementation plan requested by the owner on 2026-09-28 (America/New_York), updated on 2026-09-29 for the unified package source implementation. The earlier live-team baseline was source `82c7c73`, published as deployment `a7e04f0`; its browser checks do not validate the newer compiler migration. This document makes no new build, publication or browser-acceptance claim. [Implementation status](IMPLEMENTATION-STATUS.md) records release evidence separately.

Updated during planning to reflect the revised goal: a customizable browser desk that bridges code and visual operation without overwhelming configuration or a growing feature monolith. The later extension sections describe architectural compatibility; they are not a requirement to ship every domain in the next increment.

## Current position and next increment

**Certain:** folder import, explicit model/tool binding, selection of an included lead, browser workers, and a dashboard of actual run instances are implemented. Hosted Chrome and Safari have completed imported-agent tool turns through the trusted HTTPS model relay. The earlier team/inspector release passed 631 tests, with one opt-in CLI skip. Its normal Pages reload restored separate run records in both browsers. These checks do not establish that all agent behavior is configuration-driven or validate the newer package migration.

The current source closes the bundled/imported definition split: both use the declarative validator/compiler, and lead identity, session residency and optional compaction/retrospective services are explicit configuration. The [unified contract](UNIFIED-AGENT-PACKAGES.md) documents the implementation and preservation rules. Portable strategies, imported execution/check bindings and a complete scoped broker remain the next architectural work; another demonstration agent alone would not close those gaps.

| Priority | Concrete change | Acceptance |
| --- | --- | --- |
| 1. One compiler | Implemented in source: shipped and imported folders use `PackageSource → validated package → AgentSpec`; trusted executable tools stay in the desk registry. | Shared contract fixtures cover identical semantics apart from namespace. Owner imports need no app rebuild; changing shipped assets still requires publication. New release/browser acceptance remains separate. |
| 2. Explicit lifecycle | Implemented in source: configured default lead, task/agent sessions and package-local optional service references replace special agent names and writer-implies-residency. | Renamed-role fixtures cover session restoration, fresh compaction, service authority and cancellation. Old identity/history keys remain preserved, not silently migrated. Declarative scheduling remains unsupported. |
| 3. Portable workflows and checks | Resolve strategies and templates within the verified package. Replace coding fallbacks, imported `workspace:false`, and unconditional `workspace.acceptance` with declared execution requirements and named check adapters. | An imported coding lead can explicitly bind execution; an imported research lead runs without a guest. Neither acquires authority from its declaration. |
| 4. Scoped broker | Bind model, individual tools, resources, memory and delegation at the desk; enforce requests there. Move credentials out of agent workers. | Forged calls, undeclared delegates, cross-installation memory and revoked grants fail; parallel child workers remain independently cancellable. |
| 5. Editable packages | Add browser folder creation, shared visual/source editing, immutable revision upgrades, removal and backup export over the existing installer. | Invalid drafts remain recoverable; running instances keep their pinned revision; reload and quota failure never report a save that did not commit. |
| 6. Recorded collaboration | Add delegation/message dispatch, delivery, consumption, reply and cancellation records. Extend prompt records with inclusion sources and budgets. | A lead delegates two instances, receives their evidence, requests a bounded repair and concludes against configured checks. Every shown communication has a record. |
| 7. The agent desk | Place conversation beside the team and a selected-run inspector; progressively expose customization and domain viewers. Subscribe to committed effects and sequenced records. | Keyboard, focus, draft, narrow-screen and reduced-motion checks pass during concurrent tool activity. No prompt text is needed to tell the UI to update. |

Priorities 1–2 now have source implementations; priority 3 extends that foundation. Continue separate tracks for package editing, broker/coordination, and desk UX/results, with integration and browser acceptance owned centrally. Existing engine, worker, editor, command and artifact modules stay in use.

The first integrated proof is a newly imported, renamed package on the existing Pages deployment: connect Qwen through the HTTPS relay in Safari, choose any included lead, delegate two distinguishable runs, approve one exact tool call, inspect prompt and communication records, and reload/export retained evidence. No Linux boot is required for this general-agent proof. The browser-built task board remains a separate required coding gate.

## Product contract

ASKK supplies a desk where independently defined agents run, collaborate, retain state, and use explicitly bound capabilities. Each agent is an importable folder. A workflow chooses a lead; the lead is an ordinary configured agent, never a privileged filename. Coding is one workspace adapter. Research, media production, and other workflows use the same execution and evidence contracts.

Configuration owns instructions, context selection, tool requests, delegation targets, strategy selection, limits and completion criteria. Code owns parsing, scheduling, authorization, persistence, transport and rendering. “No hardcoded agents” means changing or adding an agent requires no engine or UI edit; it does not mean removing versioned protocols or implementing arbitrary behavior from prose alone.

The browser owns the agent loop. Inference can still run on the selected local or remote model server. Workers permit concurrent work; admission limits protect memory, UI responsiveness and provider capacity. A browser-only desk cannot promise continuous ingestion after its page closes. Always-on operation requires an explicitly selected host or remote service and must remain visibly distinct.

## Configuration without a configuration wall

The product has three entry points over the same definition and runtime:

- **Use:** choose an installed agent, state a goal, see work and respond to requests. No graph, prompt-template or budget editor is required.
- **Customize:** edit name/instructions, choose available tools and optionally add collaborators. Inherit the desk's model and sensible bounded defaults; advanced fields remain collapsed and show their effective values on demand.
- **Source:** open the exact `agent.md` and supporting files in the existing editor. Source edits and visual edits produce the same validated definition and runtime binding. There is no separate hidden UI configuration.

The visual editor makes targeted source edits, preserving Markdown body, comments and unrelated fields. Unsupported extension fields remain intact and are labeled source-managed. Invalid source stays a recoverable draft with file/field diagnostics; running continues to use the last valid pinned revision. Show a diff before replacing an installed revision. Test visual → source → visual round trips, including advanced fields the UI cannot edit.

Starter agent definitions now use the same validator/compiler as owner packages, with explicit published bindings. Making those packages editable in-browser and moving workflow definitions into them remain planned work. Defaults belong to packages or the versioned desk contract, never to agent-name branches. A workflow can remain one agent with collaborators; a visual graph is an optional advanced view of already-supported strategy data.

Every tool participates through one invocation/receipt contract: identity, input schema, declared effects, required authority, progress events, result references and actual outcome. The default UI can display any conforming tool without custom UI code. A capability's trusted implementation emits committed resource changes; file editors, media shelves and other viewers subscribe to those changes. The LLM supplies the tool action and arguments, not instructions to animate or update the frontend. Custom result viewers are optional adapters; a generic receipt remains available.

Use a small browser application core plus lazily loaded capability and viewer modules. Loading the dashboard does not boot Linux, load video tooling or connect a trading-data service. Keep module boundaries even when code shares one browser deployment; shared location does not remove trust, scheduling or storage boundaries.

[AutoGen Studio already supports visual editing, direct JSON editing and Python-exported configuration](https://microsoft.github.io/autogen/0.4.9/user-guide/autogenstudio-user-guide/usage.html). The opportunity is therefore not simply to offer both code and UI. The intended difference is a low-friction browser-owned desk where a portable definition, actual execution and visible evidence remain the same inspectable system. This is a product hypothesis to test with owner tasks, not a demonstrated market advantage.

**First vertical slice:** repair Safari model access; import or create one agent; edit it visually and in source; choose a configurable lead and collaborator; render real tool/communication receipts; persist and export. Reuse existing coding components. Media pipelines, an extension marketplace, arbitrary custom browser code and always-on services stay outside this first slice. Validate that a new user can start from an installed agent without opening advanced configuration and that a developer can change its behavior without editing the harness.

## Findings to address

- Resolved in source: `src/runtime/desk-packages.js` loads explicit `public/desk.json` entries through the same `agent-package.js` validator and `package-spec.js` compiler as owner imports. Global soul/template lookup and implicit nested delegates are absent from this production package path. The old folder reader remains for explicit low-level legacy/trusted-extension fixtures.
- Resolved in source: Hub uses an explicit default, task/agent sessions and pinned local service references. Compaction is fresh and tool-free; retrospective targets carry hashes. Bundled/installed memory scopes are isolated. Old session/history keys remain intact and are not automatically reassigned.
- Declarative package JavaScript is rejected for both sources. Trusted application modules still load in workers, and workers receive model/host configuration. A credential-isolating broker and a safe optional script capability remain pending; these workers are not a sandbox for arbitrary imported extensions.
- Hub operations need uniform authorization independent of worker-side wrappers, including delegation targets and memory scopes.
- `src/runtime/strategy-hub.js` still resolves published global strategy/template paths. Imported folders cannot yet supply an executable role graph and remain `workspace:false`. The controller now requires explicit workflow configuration instead of a coding/main fallback; package-defined execution requirements and named completion-check bindings remain pending.
- `AgentTeam.jsx` now displays distinct runs, and `RunInspector.jsx` reads retained prompts, guidance, tool events and provider attempts. Its inspection is a manual snapshot, not an incremental live subscription. Configured dependency and parent links do not prove a communication occurred.
- `board.tell` still lacks durable source/target run delivery and consumption receipts. A received note is retained evidence, but is not a full acknowledgement protocol.
- Model listing and bounded inference checks are now separate and actual HTTPS relay inference is demonstrated. Fresh-profile Safari trust/pairing, denied permissions, comprehensive transport failures and distribution remain acceptance work.
- Browser Linux full Next builds and current Safari acceptance remain unresolved. General agent work must not depend on guest startup.

## Seven layers retained

| Layer | Contract and responsibility |
| --- | --- |
| Kernel | Existing framework-independent Engine: assemble, infer, validate, act, observe, stop. |
| Strategies | Single-agent loop, lead delegation, bounded role graph, and bounded evaluate/repair behavior. |
| Composition | Verified folder sources resolve agent definitions, templates, skills, context and response contracts. |
| Capabilities | Desk broker binds tools, models, storage, executions and external services; enforces each invocation. |
| Coordination | Task briefs, run admission, instance identities, mailboxes, cancellation, budgets and completion. |
| Observable state | Sequenced events and immutable prompts, communications, tool, artifact and verification receipts. |
| Workbench | Agent desk, evidence inspector, conversation and optional workspace adapters project recorded state. |

## 1. Restore the Safari model path first

The reported HTTPS Pages to HTTP loopback failure is consistent with [WebKit's loopback mixed-content issue](https://bugs.webkit.org/show_bug.cgi?id=171934). The error alone cannot distinguish mixed content, CORS, connectivity or an unreadable authentication response.

The route below has now completed actual Pages inference and imported-agent tool turns using existing trusted certificates. It is not a new-user certificate-installation proof. [Chrome's Local Network Access policy](https://developer.chrome.com/blog/local-network-access) adds a separate permission step for local services; successful TLS and CORS alone are not an all-browser connection guarantee. [Apple documents certificate trust as an explicit system setting](https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac).

Provide **Connect local model** inside Model settings, with inline HTTPS companion pairing. Display the actual route:

```text
https://kaush4l.github.io/ASKK/
  → trusted https://127.0.0.1:7717
  → http://127.0.0.1:8873/v1
```

Keep the upstream model URL unchanged. Grant only `model-relay` for this flow. Pairing does not grant filesystem, commands, terminals, network relay or browser automation. The execution selection stays unchanged and the guest remains unloaded.

Reuse the existing companion and package. Its certificate date/SAN/key checks do not establish Safari trust. The connection wizard must state the existing manual trust requirement, link precise setup instructions, and report that step as unfinished until browser access succeeds. Do not suggest disabling certificate or browser protections. A signed installer with explicit OS trust setup remains a separate distribution gate.

Expose separate checks: route reachable, authenticated, relay capability available, provider models readable, selected model listed, and actual streamed inference completed. A successful models request means **Model listed**. A short user-triggered generation establishes **Reply verified** and records its time, model and route identity. This probe has bounded output and wall time, executes no agent or tool, requires a complete stream receipt, and propagates cancellation upstream. Allow inference when a provider does not support model listing; label that stage unsupported only for an explicit provider contract or recognized unsupported-endpoint response. Authentication, transport failure, malformed data and a missing selected model are separate failures.

Add bounded timeouts/cancellation and structured errors for browser-unreadable, relay authentication/grant, upstream transport, provider HTTP, missing model and incomplete stream. Do not convert an opaque browser failure into a confirmed CORS diagnosis. Retry known transient failures within bounds; unchanged grant/auth/configuration errors require a correction. Do not silently resend an ambiguous generation through another route. Invalidate checks when model, endpoint, companion session or capability grants change.

**Gate:** actual Pages in current Safari lists Qwen where supported and receives a complete streamed reply through trusted HTTPS, with native execution absent. Exercise cancellation, stopped relay/provider, wrong token, denied grant, provider 401, incomplete stream and grant revocation. Preserve the goal through reload. Save redacted receipts.

## 2. Portable folder packages

Keep `agent.md` as the authoritative authored definition. The current schema provides stable IDs, names, sessions, requested tool groups, model aliases, context providers, delegation/services, budgets and the existing verification flag. Portable strategy and completion-check bindings are still planned. The root also declares package ID/version. Explicit prompt/skill paths are package-root-relative; adjacent soul/learned files are role-local, with no global fallback. Planned export of a selected child must include its verified dependency closure. Cross-package references would require explicit pinned revisions; they are not currently supported.

Target structure; `workflows/`, `checks/` and executable script descriptors below remain planned, not an activation contract. Folder names carry no special behavior:

```text
my-team/
  agent.md                 # entry agent definition and instructions
  soul.md                  # optional identity/principles
  prompts/                 # literal prompt fragments and templates
  skills/                  # Markdown procedures and reference material
  tools/                   # descriptors and optional execution scripts
  workflows/               # strategy configuration
  checks/                  # declarative completion checks
  assets/                  # avatar and supporting resources
  agents/                  # optional bundled agents, each with agent.md
  askk.lock.json           # generated package inventory and content digests
```

A minimal agent needs only `agent.md` and explicitly referenced resources. The implemented importer generates a missing lock in memory; it does not rewrite source. An existing lock is verified and mismatches rejected, never silently regenerated. The lock excludes itself; the revision digest covers canonical package identity and a full SHA-256/byte-length inventory. Published delivery has a separate index integrity check and a bounded package-load deadline, detailed in the unified contract. A future editor can save generated locks alongside source. Hashes identify content and corruption; they do not authenticate an author.

`PackageSource.list/read`, directory/file selection and the shared staged validation path are implemented. ZIP import and an in-browser folder editor remain planned; they should feed that same process. Keep the Safari-compatible file-input path rather than requiring `showDirectoryPicker`. Any ZIP implementation must reject traversal, duplicate normalized paths and oversized expanded content.

Lifecycle: import → validate → inspect requirements → bind capabilities → atomically install → activate. Unsupported requirements leave an intelligible disabled package. Required capabilities block preparation; optional unavailable capabilities are omitted from callable tools and explained in the UI. Export provides portable configuration; memory export is an explicit separate choice. Credentials never enter package exports.

Separate `packageId`, `revisionDigest`, `installationId`, `agentId`, `instanceId`, `conversationId`, `taskId` and `runId`. Display names and filesystem paths are labels. Pin each run to a package revision and effective bindings. Editing creates a new revision for future runs; it cannot change a running prompt or historical receipt. Retain referenced revisions while active runs or evidence need them.

Store immutable knowledge separately from writable memories. Namespace private memory by installation and agent, conversation history by conversation ID, and task-shared memory by explicit task scope. Carrying learned instructions across revisions is an explicit migration. Durable save means the storage transaction succeeded; quota failures cannot report success. Offer backup export and explain browser storage limits, which remain subject to [browser storage policy](https://www.webkit.org/blog/14403/updates-to-storage-policy/).

**Gate:** import and run an arbitrary new folder on the existing deployed page without rebuilding it. Two packages with identical display/folder names remain isolated. Reload restores definitions, histories and drafts without replaying processes. Renaming lead, summarizer and retrospective agents changes no engine behavior. Test corrupted imports, missing references, quota failure, revision upgrades and removal during an active run.

## 3. Desk-owned capability and prompt binding

Effective authority is the intersection of package requests, owner grants, adapter availability and the task's binding. Distinguish the owner-authorized task delegation envelope from each role's callable tool subset: a lead can coordinate a video specialist without receiving video tools in its own prompt. A child receives only its own requested subset within that envelope and explicit resource scopes; delegation cannot expand the envelope. Every broker request validates its run identity, operation, resource scope and current authorization. Delegation also validates the configured target. Risk labels come from trusted capability implementations, not package-authored claims.

Imported Markdown, templates, assets and tool descriptions are inert. Do not automatically execute imported JavaScript in the agent worker. Optional script descriptors specify a file, interpreter, input schema and limits; execution requires an explicit Browser Linux or Local Bun binding. These existing adapters are not per-script OS sandboxes. Trusted application modules remain a separate extension class until a real isolated plugin runner exists.

Move transport credentials behind a desk-owned model broker. Workers receive scoped bindings and opaque model references; prompts receive tool schemas and capability facts, never tokens. Preserve streaming, cancellation and exact redacted ProviderRequest receipts through the broker.

Compile eligible prompt layers in configured order; this is not a requirement to include every layer on every turn:

1. Stable identity, job instructions and relevant procedures.
2. Effective tool/agent schemas, concrete action examples and response contract.
3. Owner's unchanged goal/constraints, task brief, selected memories and evidence.
4. Relevant conversation/tool observations, current budget and pending input.

Package templates control presentation; the desk enforces required protocol/policy information. Preserve the original goal durably, but inject the role's bounded brief, necessary constraints, next-action state and selected evidence instead of repeating the entire task archive. Explicit context budgets retain provenance and signal omissions. Large evidence and omitted context remain available through references with bounded retrieval. Do not broadcast every agent transcript or all installed tool schemas. Record each resolved layer's source/revision, inclusion decision and size in PromptSnapshot, then separately record every transmitted request and repair. This extends the established [prompt research](PROMPT-RESEARCH.md); extra prompt text is not a substitute for measured task success.

**Gate:** forged worker RPCs, undeclared delegation, cross-agent memory access and revoked capabilities fail at the broker. A package cannot obtain secrets or host execution by changing its prompt, tool description or risk label. Prompt inspection shows exactly what was sent and why each context layer was included.

## 4. A configurable lead and observable collaboration

Select the lead in workflow configuration. A visible lead picker beside the workflow selector shows its bound model and available tools before starting. The lead is replaceable and uses the same engine as every other agent. Execution configuration is pinned during a run; customization applies to a later run. Fixed graphs retain their configured roles. Preserve the user's original request alongside a structured task brief containing deliverables, constraints, dependencies, completion criteria, budget and requested capabilities. Any lead interpretation remains inspectable and cannot silently overwrite the goal.

Reuse the existing agent loop for **plan → delegate → await evidence → evaluate → request bounded repairs → conclude**. Keep the existing DAG for fixed parallel roles; a graph's output role is not automatically a supervisory lead. Summarization and optional retrospective services now use package-local references, with no special agent names or writer-implies-residency behavior. The broader task/communication contract below remains planned.

A delegation record contains sender/recipient run IDs, instruction, selected context references, expected output/checks and budget. Separate dispatch, delivery acknowledgment, response and cancellation receipts. A communication edge only appears when such a receipt exists. A dependency edge only describes scheduling. Deduplicate by IDs and reject stale acknowledgments; do not claim exactly-once external effects.

Multiple instances of one definition can run concurrently with separate histories. Configure global, task and provider admission limits, queue reasons, cumulative budgets and cancellation propagation. Steering enters the lead inbox at a safe boundary; revised child instructions create visible task revisions instead of rewriting an in-flight request. Approval and human-input waits pause only the relevant work. Reload preserves their ownership as historical evidence but marks unfinished requests interrupted and non-actionable. Continuing requires an explicit new attempt with new call and approval identities; an old approval never authorizes a new operation.

The lead proposes completion. The desk evaluates configured checks against the delivered artifact/evidence revision. LLM critique is advisory judgment, not independent proof. Expose passed, failed, unsupported and unverified checks. Failed checks can feed a bounded repair loop; budget exhaustion remains incomplete.

**Gate:** a renamed lead delegates two parallel instances, receives evidence, requests one bounded repair and produces a checked result. Verify shared budget accounting, approval routing, stale messages, stop propagation, late results, reload and concurrent independent tasks.

## 5. Agent desk UX

The opening surface contains the lead conversation and a live team stage. Installed definitions live in a team drawer; each stage token represents an actual instance/run. A configurable avatar or dot has a stable position, name, role, state and wait reason. Display “Generating reply”, “Running search”, “Waiting for approval”, “Waiting for researcher”, “Stopping”, “Checking result”, “Complete” and “Interrupted” from recorded state.

Selecting a token opens Overview, Prompts, Tools, Communications, Memory and Results. Show full persisted tool receipts, not the truncated activity-card copy. Show plans and concise decision summaries where recorded; never fabricate private reasoning. Selecting a message edge opens the exact instruction and acknowledgment. Selecting an artifact opens its typed viewer. Automatic updates preserve keyboard focus. Explicit inspection moves focus into the inspector; Escape closes it and restores the initiating token or edge. Composer text and scroll survive both operations.

Retain the approved layout constraints: conversation 400px at 1440px and 360px at 1280px. Dock the 320px inspector only while the team stage retains at least 480px; otherwise use a drawer. Below 1024px use Conversation / Team / Results surfaces preserving state, with an approval badge on each surface and the composer reachable above the software keyboard. Coding adds its existing Files / Code / Preview / Commands surfaces. Use accessible DOM controls with a list alternative to the team diagram, visible focus, keyboard navigation, explicit labels and touch targets.

Use the Pokémon reference for recognizable characters and legible discrete states. No wandering sprites, invented emotions or animated typing. Use approximately 120–160ms transitions only when helpful, allow immediate input throughout, and remove movement for reduced motion. Streaming cannot reorder agents or move layout. Batch/coalesce screen updates while retaining the complete evidence stream; virtualize large lists.

The lesson drawn from the [historical Cyanogen theme template](https://github.com/LineageOS/android_packages_themes_Template/blob/cm-13.0/README.md) is replaceable, packaged customization with explicit structure. This is a design analogy, not a claim about current LineageOS theme-engine support. OnePlus's own [design description](https://www.oneplus.com/at/press/press-release/oxygenos-14-empowers-oneplus-devices-with-upgraded-fast-and-smooth-experience) emphasizes resource scheduling and responsive interactions and also includes animation. Our interpretation is immediate feedback and low interruption, not an unsupported claim that removing every animation explains speed.

**Gate:** distinguish two runs of one agent; trace every message edge to a receipt; approve only the selected call; retain focus/draft during tool streams; complete keyboard-only and VoiceOver paths; verify reduced motion, 320×400 and 390×844 screens, including the software keyboard. Target visible input feedback under 100ms and p75 interaction latency below 200ms on named test hardware; report measurements rather than claiming them in advance.

## 6. General artifacts and workflows

Keep the existing verified coding renderer as one artifact profile. Extend records with media type, producer, immutable content reference, provenance, revision and check receipts. Provide text/report, table, image, audio and video viewers; unknown formats offer a download. Untrusted HTML continues to use an opaque sandbox. Rendering media must not expose harness credentials or automatically fetch arbitrary remote resources.

A media workflow can configure a lead, generator, reviewer and editor; the desk supplies generation-job polling/cancellation, files, timeline manifests and composition tools. A research workflow can configure source collection, independent analysis, contradiction review and report assembly. External model/media/data services need real adapters, access and costs; declaring a tool does not implement it. Financial research output must distinguish dated evidence, assumptions, backtests and unverified claims; it must not imply guaranteed outcomes.

First general-purpose proof uses a research/report workflow with a real lead and tools, without starting Linux. A second proof exercises a media job lifecycle and typed artifact viewer; fixture tests are labeled, and an end-to-end generation claim requires a real available adapter. Keep the task-board goal as the independent coding gate, with Browser Linux's performance/build issues reported honestly.

## Delivery order and ownership

1. Preserve the now-working trusted HTTPS model route, folder installation and team inspector; complete fresh-user Safari connection checks alongside the architectural work.
2. Validate and publish the implemented unified compiler/session/service foundation, then add portable strategies, execution requirements and completion-check references. Preserve old evidence read-only; any memory/history migration must be explicit and non-destructive.
3. Freeze the shared package revision, run binding, capability RPC and communication event schemas with executable contract fixtures.
4. Parallel tracks: package creation/editing/storage; broker/lead coordination; desk UI/evidence; adapters/checks. The UI uses shared records rather than an invented second event model. A research/report adapter establishes the first noncoding proof; media follows through the same job/artifact contract.
5. Run the integrated gate above in Chrome and Safari, retain failures and interventions, then publish the exact tested export to GitHub Pages with existing `/ASKK` isolation and integrity checks. Preserve deployment history and existing local work. Measure repeated fresh goals before claiming one-shot reliability.

Completion of this milestone means: import a new agent folder in Safari, bind the local model through HTTPS, choose any configured lead, watch distinguishable parallel agents and real communications, approve an action, inspect exact inputs/results, and reload without losing acknowledged state. It does not mean arbitrary workflow support, one-shot reliability, always-on browser execution or Browser Linux build readiness has been proven.
