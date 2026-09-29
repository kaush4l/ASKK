# Next desk UI slice — 2026-09-29

Scope: presentation and interaction over the existing browser-owned runtime. This is a design proposal, not a release or browser-validation claim. No runtime or application code was changed during this review.

## Diagnosis and evidence

**Certain from code:** the trustworthy foundations already exist. `AgentTeam.jsx` projects real run IDs, matches approvals by run, separates definitions from instances, keeps live creation order, and exposes inspect/stop actions. `ToolCard.jsx` distinguishes pending approvals and missing outcomes. `RunInspector.jsx` offers retained prompts, typed tool records and trace export, explicitly as a manually refreshed snapshot. `controller.js` supplies the live roster through its existing subscription. Reuse these mechanisms.

**Certain from code:** the current dashboard puts a large launch section above live work, with a 304px connections/policy sidebar; its full transcript is on the separate coding surface. The dashboard still calls itself a workspace and advertises coding beside the main title. Generic task statuses are labeled “Verifying application.” Current run cards give IDs, relationship metadata and Instructions/Stop rows substantial space. These choices are accurate but make general goals and active work compete with setup/evidence.

**Likely design judgment:** the next useful slice is a persistent conversation beside a compact live team, with configuration behind a drawer and evidence available on demand. More loaders added to the existing long dashboard would increase visual activity without fixing the attention hierarchy.

The newer [Agent desk plan](AGENT-DESK-PLAN.md) governs this proposal. The older `UX.md` forbids dashboards and targets the legacy `src/ui` implementation; it should not be treated as the current screen specification.

## Concrete slice: a goal desk with an evidence view

Keep one task and the existing workflow/run selection semantics. This slice does not add concurrent independent tasks, agent editing, new artifact adapters or communication receipts.

1. **Top bar:** selected agent/workflow, a compact “2 active · 1 needs you” control, `Agents` (installed definitions/import), `Connections`, and an `Evidence` toggle. Connection failures affecting the selected task appear here; an unused disconnected companion stays quiet. Copy: “What should we accomplish?” and “The agent chooses from its available tools.” Owner grants and approval controls remain available in settings.
2. **Conversation:** original goal, actual replies, and bottom composer. During work the same composer sends a note using the existing handler. Keep its current distinction between notes and fixed-graph next-run drafts. In goal view, tool activity appears as compact factual rows expandable through `ToolCard`; do not replace the conversation with “Latest answer.”
3. **Live team:** compact stable tiles for real instances, then a collapsed recent-run list. Every tile has a 40px avatar/initial or dot, name, stable short run suffix, explicit state, and at most two lines of the current tool/assigned task. IDs remain fully available through its accessible name and inspector. Put `Stop run` in the opened details/action area rather than giving every tile a permanent red footer. Keep task membership readable. Stable creation slots persist for the selected task until the owner leaves or starts another task; completed tiles change state in place rather than disappearing under a keyboard or pointer.
4. **Needs you:** a compact queue above the stage and a badge on every narrow-screen surface. Activation opens the exact approval and focuses its heading/input review, not Approve. Do not move focus when a request arrives. A queued decision must remain visible even if another run is streaming.
5. **Results:** latest actual answer plus supported artifact links with producer/status. Reuse current viewers. “Complete” describes the run; “Verified” requires an actual verification receipt and must name what passed. No generic success claim for a completed model response.

`Evidence` changes information density, not execution, authority or agent prompts. It exposes run IDs, recorded parent relationships, exact tool receipts, prompts, model/route information, timing and counters. Existing `RunInspector` can remain a snapshot dialog for this first slice, with its current Refresh label. Do not imply a continuously updated inspector until implemented. Planned Communications/Memory tabs should not be empty promises; show them only when their records and operations exist.

## Responsive geometry and attention

- At 1440px: conversation 400px; at 1280px: 360px. Team takes the remaining width. An eventual 320px docked inspector is allowed only if the stage remains at least 480px; otherwise use the existing dialog/drawer. This first slice can retain the dialog everywhere.
- At 1024–1279px: conversation 320px, remaining team stage, inspection as overlay. Below 1024px: `Conversation / Team / Results` tabs; preserve selection, draft, scroll and disclosures between them. Coding tools remain in their established Files/Code/Preview/Commands surface.
- Stage tiles: 2 columns at 480–719px, 3 at 720px and above; single-column compact rows on phones. Target 6 useful live tiles in the initial desktop view. For larger teams show a real active count and an explicit Show more control; a clipped live run cannot be the only location of its approval/error.
- Use 14px body/labels for the goal view, 12px supplementary text, 16px composer text on iPhone. Keep 44px touch targets, safe-area padding and the composer visible with the software keyboard. Avoid hover-only actions and horizontal page scrolling at 320px.
- The neutral warm background and dark typography already provide a quiet base. Keep the current brand brown for selection/navigation; add semantic blue for active work, amber for a decision, red for a failure, green for recorded completion. Blue activity and amber attention then separate at a glance. Use pale fills sparingly, stronger text/icons, and always pair color with state wording and shape. Verify text and focus contrast in both themes before shipping. Agent identity is its avatar/name/suffix, never an arbitrary status color.

## State and motion contract

Apply this precedence: cancelling/interrupted or delayed state, exact pending owner decision, recorded tool/wait state, ordinary generation, terminal outcome. A child waiting on its owner does not make every sibling look blocked.

| Actual evidence | Label | Visual behavior |
| --- | --- | --- |
| queued/starting | Queued / Starting | Hollow static dot; show admission reason only if recorded |
| thinking | Generating reply | Small low-amplitude opacity pulse, without moving avatar/text |
| calling plus current recorded call | Running tool · readable tool name | One small ring beside the action; indeterminate |
| waiting plus recorded child/tool dependency | Waiting for [recorded name] | Static wait icon; no busy spinner that implies local computation |
| waiting without a typed reason | Waiting | Do not infer a child or owner wait from prose |
| exact pending approval | Needs your decision | Static amber diamond/badge and actionable queue |
| compacting | Organizing context | Same modest active marker; no progress percentage |
| cancelling | Stopping | Static stop glyph until terminal receipt |
| unresponsive | Response delayed | Static warning; outstanding work may still complete |
| done/failed/interrupted | Complete / Failed / Interrupted | State changes once; at most a 140ms opacity transition, then still |

Library recommendation: [LDRS](https://uiball.com/ldrs/) supplies HTML/CSS/SVG React/web-component loaders; choose **one small ring** for actual pending tool work. Avoid decorative Orbit/Quantum/Chaotic Orbit patterns across every agent. [Anime.js scope media queries](https://animejs.com/documentation/scope/scope-parameters/mediaqueries) support responsive and reduced-motion branching; [scoped roots](https://animejs.com/documentation/scope/scope-parameters/root) keep component animation queries local. If coordinated transitions need the library, use a scoped lifecycle with cleanup. Its [WAAPI entry](https://animejs.com/documentation/web-animation-api) is a modular option for transform/opacity transitions. The first slice can use CSS alone; do not add both dependencies merely to display dots.

Use motion to locate a new recorded instance (120–160ms opacity/4px entry), acknowledge explicit selection, or reveal an inspector. Never animate each stream token, reorder tiles from activity, loop a success celebration, or draw message traffic from parent links. Parentage is not delivery acknowledgment. Pause loops when the page is hidden; reduced motion renders static state icons with identical text. Neither seconds nor loop/step budget is a completion percentage. No “almost done,” simulated typing or inferred private reasoning.

## Implementation boundaries and acceptance

Extract the existing conversation body/composer from `Workbench.jsx` for reuse; keep its single goal state and handlers. Compose it with a denser `AgentTeam` in `Dashboard.jsx`. Preserve `projectAgentTeam`, `toolPresentationStatus`, `projectRunTools`, `Modal`, keyboard-navigation helpers and the controller subscription. A presentation helper can centralize currently duplicated status labels. It must take structured state/IDs, not parse model prose or introduce an LLM-authored UI command protocol.

Acceptance on latest Safari and Chrome, recorded with browser/device versions:

- Two same-name instances are distinguishable and open their own exact run; unrelated task history is not presented as current work. Stream updates and terminal transitions do not move focused controls.
- An actual delegation creates a tile; defined-but-unused agents appear only in the library. Parent links never display invented message delivery.
- One pending approval becomes visible from every surface; Approve affects only its call ID. Stop shows Stopping until the runtime records the outcome. Missing outcomes remain missing.
- Keyboard-only and VoiceOver users can navigate tabs, select a run, read exact input, close inspection with Escape, and return to the initiating control. If that control no longer exists, focus lands on the team heading. Automatic updates never steal focus.
- Switching goal/evidence, stage/conversation, or opening inspection preserves draft, IME composition and scroll. Focused input responds immediately during streams; measure interaction latency rather than claiming it from animation duration.
- At 320×400 and 390×844, including software keyboard: no horizontal overflow or hidden Send/Stop; pending decisions remain reachable. Test light/dark and reduced-motion modes; reduced motion removes loops and movement without removing state.
- Reload retains recorded state and marks unfinished work interrupted; it does not restart agents or make historic approval buttons actionable. A general task can start without Browser Linux or native execution.

This is a UI acceptance slice. General completion checks, typed human-input requests beyond current approvals, live inspector pagination, and delivery/read receipts need their own runtime contracts before richer visuals can claim them.
