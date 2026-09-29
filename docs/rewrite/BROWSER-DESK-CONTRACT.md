# Browser desk and optional bridge

Decision record, 2026-09-29. This describes the target and identifies implementation gaps; it is not a new compatibility claim.

The browser owns agent lifecycle, configuration, context assembly, coordination and observable state. A companion supplies individually granted capabilities. It does not contain an agent, choose the task, or implicitly become the execution target. Agent folders contain declarative behavior; executable tool adapters belong to the desk. Importing instructions cannot grant authority.

## Three product responsibilities, seven implementation layers

1. **Mechanism:** kernel, capabilities, task coordination and observable state. Validate actions, enforce permissions/revisions, dispatch tools, persist observations, cancel jobs and record evidence.
2. **Behavior:** strategies and composition. Folder-defined soul, task instructions, templates, requested tools, memory/context sources, verification policy and budgets determine the configured workflow. The model chooses the next permitted action from current evidence.
3. **Presentation:** workbench. Project committed state and receipts into files, command output, artifacts, agent activity and human decisions. Models never have to issue animation or navigation instructions.

“No hardcoded agent” is the rule. Removing all conditionals is not: permissions, malformed responses, cancellation and verification require deterministic decisions. Configurable budgets bound runaway work; stopping at a budget must remain visibly incomplete. One worker per active agent isolates its loop, but does not imply unlimited CPU, memory or provider concurrency. Scheduling and resource limits belong to the desk.

## Environment choices

| Profile | Supplied capabilities | Honest limitation |
| --- | --- | --- |
| Browser only | Agent workers, editing, browser storage, reachable model APIs; Browser Linux when its actual readiness checks pass | Browser networking and device memory constrain operation; guest application-build acceptance is still pending |
| Browser plus local companion | Independently granted model relay, guest network relay, native jobs/PTYs and selected host files | Current bundled release targets Apple Silicon Mac; native jobs retain host privileges; trusted TLS setup remains manual |
| Browser plus remote capability service | Potential authenticated adapters for search, media, remote execution or browser automation | Proposed extension; requires explicit endpoints, scopes, credentials and operation contracts, not implied local access |
| Native Apple adapter | Potential device-model access advertised by a native provider | Proposed extension. Apple's documented Foundation Models interface is native; no verified Safari JavaScript exposure is established here |

Every shipped platform package should include its declared runtime and necessary adapter helpers, with versions, hashes, licenses and platform acceptance. Project-specific language toolchains remain explicit dependencies; do not promise that a small bridge contains every toolchain. A capability descriptor must distinguish implemented, granted, dependency-ready and operation-proven. An unavailable dependency should offer an actionable alternative without changing execution location.

Current implementation already includes authenticated versioned capability discovery, scoped model relay, a desk-owned credential/model broker, folder imports and workflow-selected checks. Do not rebuild those mechanisms. Current dependency readiness remains unchecked until tested; external browser automation is unsupported. Package distribution beyond Darwin ARM64 and trust onboarding remain work.

## Dashboard behavior

Simple mode prioritizes goal, active team, required decisions and delivered results. Developer mode exposes resolved configuration, prompt/request records, budgets, tool arguments/results and verification receipts. Show observable plans and delegation messages; do not promise access to private model reasoning.

Each agent is a live state view with a stable identity and textual status: generating, executing a named tool, waiting for approval/input, stopped, failed or completed. Color reinforces labels rather than replacing them. Results link to the changed file, command output or artifact. Completion and independently verified delivery remain separate facts.

Animate a recorded transition or arriving result briefly; never manufacture percentages, simulate typing, continuously move layout or steal focus. Reduced motion retains immediate state updates. Prefer existing CSS for simple transitions; add an animation dependency only for an interaction that needs it. LDRS is a loader library and Anime.js is an animation engine, not sources of runtime truth.

Fresh UX inspection found that current Goal mode simplifies only the team section, dashboard activity omits workspace callbacks on ToolCard, and narrow-screen status clipping needs actual Safari/Chrome and enlarged-text checks. These are priorities, not completed changes.

## Next bounded work

1. Shared budget validation is implemented in source: package import/restore, legacy folders and runtime now reject unsupported values with explicit ranges. See the module map for compatibility details. Cumulative run/team expenditure limits remain separate work; context-window bounds do not replace them.
2. Add adapter-specific readiness probes and retained receipts; keep model access, network relay and native execution independent.
3. Extend package targets with per-platform pins and real cancellation/PTY/TLS acceptance before listing a platform as supported.
4. Apply simple mode across the dashboard and connect result actions; verify iPhone-sized layouts, keyboard access and reduced motion in actual browsers.
5. Continue full-loop model evaluations and Browser Linux acceptance. One small-model script pass does not establish reliable scaffolding or repair.

References: [current module map](AGENT-SKELETON.md), [implementation evidence](IMPLEMENTATION-STATUS.md), [companion packaging](../../scripts/companion/README.md), [Apple Foundation Models](https://developer.apple.com/documentation/FoundationModels/), [LDRS](https://uiball.com/ldrs/), [Anime.js](https://animejs.com/).
