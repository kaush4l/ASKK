# elizaOS — prior art

Read from source at commit `d3d5114` (2026-08-13), shallow clone of
`https://github.com/elizaOS/eliza`. All `file.ts:line` citations below are relative to
`packages/core/src/` unless a package is named.

## 1. What it is

A TypeScript multi-agent framework (formerly ai16z/eliza), MIT, monorepo `eliza@2.0.4` /
`@elizaos/core@2.0.3-beta.7`. Very much alive: 19,041 stars, 5,668 forks, last push
2026-08-14T02:30Z, 474 open issues, 23,944 tracked files, 16,931 `.ts`/`.tsx`. `packages/core/src`
alone is 1,230 files / 266,161 non-test lines, with single files at 14,059
(`services/message.ts`), 12,967 (`runtime.ts`) and 5,518 (`runtime/planner-loop.ts`). 24 workspace
packages, 30 runtime deps in core (`drizzle-orm`, `handlebars`, `zod`, `ai` + three `@ai-sdk/*`,
`unpdf`, `mammoth`, `underscore`). **The shape has changed since v0.x**: there is no
`packages/plugin-bootstrap`, the turn loop lives in core as a two-stage Stage1→planner pipeline,
and the character file has been demoted from "the thing you author" to "the thing a config/UI
builds" (`packages/agent/src/runtime/build-character-config.ts:37`). Blog-post-era descriptions
of eliza are wrong about this repo.

## 2. The agent loop

Entry: `DefaultMessageService.handleMessage` — `services/message.ts:11056`
(class `:10975`, interface `types/message-service.ts:169`), delegating to private
`processMessage` at `services/message.ts:11726`.

```
handleMessage()  ALWAYS_BEFORE; RUN_STARTED; StreamingContext  message.ts:11056
  turnControllers.runWith(roomId, () => processMessage())      :11594

processMessage()                                               :11726
  persist inbound memory; queue embedding; mute/noise gates    :11794 / :11867
  state = composeResponseState(msg)                 ← §4       :12079
  outcome = runV5MessageRuntimeStage1(state)                   :12290
  deliver → egress audience check → persist barrier            :12725 / :12752
  allSettled([callback(content), persist]); MESSAGE_SENT       :12809
  DETACHED: runPostTurnEvaluators + ALWAYS_AFTER               :12993

runV5MessageRuntimeStage1()                                    :7058
  tools = [HANDLE_RESPONSE]; toolChoice = "required"           :7237 / :7357
  raw = useModel(RESPONSE_HANDLER, params)          ← LLM #1   :7399
  retry while shouldRetryStage1Generation(raw)                 :7405-7434
  parse: native tool call → JSON → plain-text synthesis        :7436 / :5965
  injection gate; detach FACTS_AND_RELATIONSHIPS               :7591 / :7628
  runResponseHandlerEvaluators (deterministic patches)         :7782
  route = routeMessageHandlerOutput()                          :7847
    ignored/stopped → terminal, no second call                 :7851
    final_reply     → Stage 1's replyText IS the answer        :7936 ← no LLM #2
    planning_needed → tools = collectPlannerTools + terminals  :8215
                      runPlannerLoop(...)                      :8371
                      egress-verify reply vs action receipts   :8608

runPlannerLoop()                                         planner-loop.ts:226
  config = merge(DEFAULT_CHAINING_LOOP_CONFIG)           :260 / limits.ts:111
  for (iteration = 1; ; iteration++)                     :419
    if queue empty: callPlanner()           ← LLM #2..n  :420 / :1862
      no toolCalls → finish with messageToUser           :723
      all terminal → finish (REPLY text | silence)       :732
      else enqueue non-terminal calls                    :1023
    call = queue.shift()            # ONE call per iter  :1050
    executeQueuedToolCall(call)                          :1057
      assertTrajectoryLimit(tool_calls ≤ 16); ≤2 repeats :2792 / :2856
    continueChain === false → finish                     :1077
    maybeCompactBeforeNextModelCall()                    :1104
    tryGateEvaluator() → finish if decisive (no LLM)     :1139
    runEvaluator()                          ← LLM        :1183 / evaluator.ts:93
      FINISH → done; NEXT_RECOMMENDED → pick; else loop  :1238
  ensureFailedTurnFinalMessage / ensureToolTurnFinalMessage    :229-230
```

One turn is therefore **providers → state → Stage-1 intent call → (planner call → one action →
evaluator call)\* → deliver → post-turn evaluators.** Providers run before Stage 1 only; the
planner recomposes selectively. Evaluators appear twice and are two different systems (§6). A
pure chat answer costs exactly one model call.

## 3. Modes

- **No plan/act toggle.** `features/advanced-planning/` is a service plus one `PLAN` router action
  (`actions/plan.ts:533`, sub-actions create/update/review/finalize, `roleGate: minRole ADMIN`),
  not a runtime mode. Plans (`types.ts:63-73`, `executionModel: "sequential"|"parallel"|"dag"`)
  live in an in-memory `Map` (`planning-service.ts:298`) and are **not persisted**; `adaptPlan`
  (`:578`) re-prompts to revise mid-flight.
- **Reply-driven is the default.** `shouldRespond` (RESPOND/IGNORE/STOP) is a field of the Stage-1
  envelope, so "say nothing" is a first-class outcome of the call that would have answered.
- **Autonomy is a recurring section, not a loop.** `features/autonomy/service.ts:962` registers
  one section with the prompt batcher: `minCycleMs = intervalMs` (default 30_000, clamp 5s–600s at
  `:1170`), `maxRetries: 1`, `fallback {actions:["IGNORE"]}`, `model: "large"`, temp 0.2 / 512
  tokens. `minCycleMs` is a floor, not a period (`utils/prompt-batcher/batcher.ts:901`). It never
  terminates on a goal — only `disableAutonomy()`/`stop()` (`:1271`). Modes `continuous`|`task`
  pick different templates (`:90`, `:630`). The self-prompt gets a dedicated world/entity/room
  whose id is `stringToUuid(uuidv4())` per process (`:387`) — that history dies on restart.
- **Scheduled work** is `types/task.ts` + `services/task.ts:42` (1s tick, dirty-flag) or the
  process-global `services/task-scheduler.ts` daemon. Recurrence, backoff and auto-pause live in
  `TaskMetadata` (`types/task.ts:67-119`): `updateInterval`, `baseInterval`, `notBefore/notAfter`,
  `failureCount`/`maxFailures` (default 5), `blocking`, `orphanedNoWorker`.

## 4. Context window

`AgentRuntime.composeState(message, includeList, onlyInclude, skipCache, refreshProviders)` —
`runtime.ts:4864`.

1. **Cache**: `stateCache` keyed on `message.id` plus a per-`Memory` public-provider cache, both
   invalidated when the delivery-audience key changes (`:4888-4907`).
2. **Selection**: default set is `providers.filter(p => !p.private && !p.dynamic)` (`:4926`),
   narrowed by each provider's declared `contexts` against the turn's active routing contexts.
   `onlyInclude` names bypass role gates deliberately (`:4913-4921`); `alwaysInResponseState` is
   the opt-in for dynamic providers.
3. **Ordering**: `sort((a,b) => (a.position||0)-(b.position||0) || name.localeCompare)` (`:5003`)
   — an integer on the provider governs both execution list and prompt order
   (`-10` UI context … `100` recent messages … `150` action state).
4. **Execution**: all selected providers run **concurrently** in one `Promise.all` (`:5052-5220`),
   coalesced per `(messageId, providerName, audience)`. Per-provider `timeoutMs`
   (`withProviderDeadline`, `:529`) aborts the provider's signal; `timeoutMode: "fail"` (default)
   makes composeState **throw the whole turn** (`:5471-5489`), `"degrade"` substitutes
   `"[Provider X unavailable this turn: exceeded Nms deadline.]"` (`:5185`).
5. **Assembly**: non-blank `result.text` in position order, `join("\n")`, secret-redacted twice
   (`:5302-5324`) → `state.text`, `state.values.providers`, per-provider rows in
   `state.data.providers`. `values` is the flat Handlebars bag (later provider wins on collision);
   `data` is the structured side-channel.
6. **Templates**: Handlebars (`utils.ts:22`) with every `{{x}}` rewritten to `{{{x}}}` to defeat
   HTML escaping (`:144`); under a no-`eval` CSP it silently degrades to regex substitution with
   **no conditionals or loops** (`:107`). `composePromptFromState` builds the context as
   `{...state, ...state.values}` (`:289`). `Character.templates` has **no central resolver** —
   only call sites that wrote `templates?.x || x` are overridable.
7. **Recent messages**: window capped at 50; the real cut is `.slice(-conversationLength)`, with a
   comment recording that adapter paths returned whole room histories and blew one
   HANDLE_RESPONSE call to 220K chars (`recentMessages.ts:53`, `:453-482`). Compaction is external
   and persisted — `room.metadata.lastCompactionAt` becomes the query `start`, a 4000-char
   `priorLedger` is prepended, and core defines only the hook
   (`runtime/conversation-compaction-hook.ts:12`).
8. **RAG**: documents default to hybrid — one shared query embedding per turn
   (`features/documents/recall-embed.ts`, keyed on runId+messageId, fails open to keyword),
   `queryDocumentFragments({limit:40, matchThreshold:0.05})`, min-max normalize, blend
   `0.6*vector + 0.4*bm25`, take 20, render 5 (`features/documents/service.ts:1414-1497`).
   `FACTS` uses **no vector search at all**: 120 candidates per table, local BM25 + per-kind time
   weighting, top 6 per kind (`providers/facts.ts:61, 247, 369`).
9. **Trimming**: four unrelated mechanisms, no global one. `runtime/model-input-budget.ts`
   estimates tokens as `chars/3.5` and reserves `max(10_000, window*0.20)`; the only complete trim
   loop is the evaluator's, quartering tool-result caps 30k→7.5k→2k then throwing
   `EVALUATOR_INPUT_OVER_BUDGET` (`runtime/evaluator.ts:112-149`). The tokenizer-accurate
   `trimTokens` (`utils.ts:1011`) has **zero callers**, and the provider-text join is unbudgeted.

## 5. Tools

Actions *are* tools. There is no separate tool concept.

- `Action` (`types/components.ts:349`): `name` (must match `/^[A-Z_][A-Z0-9_]*$/`),
  `description`, `handler`, `validate`, plus `parameters: ActionParameter[]`,
  `routingHint`, `tags` (`capability:write|delete|execute`, `effect:idempotent`),
  `private`, `similes`, `examples`, `priority`, `override`, `suppressEarlyReply`,
  `asyncHandoff`, `allowAdditionalParameters`, `toolSchemaStrict`.
- **Calling convention**: `actionToTool` (`actions/to-tool.ts:600`) emits
  `{type:"function", function:{name, description, parameters: JSONSchema, strict}}`. Stage 1 gets
  exactly one forced tool, `HANDLE_RESPONSE` (`to-tool.ts:39`, schema `:47`). Stage 2 gets one
  native tool per action plus the always-present terminals `REPLY`/`IGNORE`/`STOP` (`:586`), so
  the model can end a turn even when the action surface was narrowed. Tier-A parents get their
  sub-actions promoted to first-class tools; tier-B parents stay parent-only (`:465-490`).
  `routingHint` is prepended **verbatim, uncompressed** to the tool description (`:212`). The
  legacy parsed action-name list (`extractPlannerActionNames`, `services/message.ts:668`) is dead.
- **Registration**: `Plugin` (`types/plugin.ts:1354`) carries `actions`, `providers`,
  `evaluators`, `services`, `models`, `events`, `routes`, `views`, `widgets`, `componentTypes`,
  `adapter`, `schema`, `dependencies`, `priority`, `contexts`, `autoEnable`, and
  `mode: "direct" | "remote"`. `runtime.registerPlugin` (`runtime.ts:2327`) fans out to
  `registerAction/Provider/Evaluator` (`:3919/:3887/:3997`). Collisions are **first-wins + WARN**;
  `override: true` makes supersession explicit, but is downgraded to first-wins across plugin
  boundaries because hot-unload cannot restore a displaced incumbent
  (`types/components.ts:358-378`).
- **Permissions**, four independent layers: (a) role gates OWNER>ADMIN>USER>GUEST scoped to a
  World (`roles.ts:42`); (b) `Action.private` — selectable only on turns carrying
  `metadata.isAutonomous === true` (`runtime/private-action-gate.ts:25`,
  `runtime/action-gate.ts:72`), with inbound forgery stripped at
  `security/incoming-message-security.ts:86`; (c) tool groups `group:fs`, `group:runtime`,
  `group:web`, … each with `riskTags` (`host_execution`, `workspace_write`,
  `external_side_effect`) and profiles `minimal|coding|messaging|full` (`types/tools.ts:35`,
  `:151`); (d) `DisclosureGate {require:"owner_exclusive"}`, re-validated *after* composition so a
  mid-turn audience change throws `OWNER_PRIVATE_AUDIENCE_CHANGED` (`runtime.ts:5490`).

## 6. Loop strategies

- **Every failure mode is a named, typed budget.** `runtime/limits.ts:111`: `maxToolCalls: 16`,
  `maxRepeatedFailures: 2`, `maxRequiredToolMisses: 3`, `maxUnavailableToolCallRetries: 3`,
  `maxTerminalOnlyContinuations: 2`, `maxRepeatedToolCalls: 2`,
  `maxTrajectoryPromptTokens: 1_500_000`. Breaching one throws
  `TrajectoryLimitExceeded {kind, max, observed}`; coding mode raises calls to 80
  (`planner-loop.ts:245`). `maxRepeatedToolCalls` exists because a model was observed re-issuing
  an identical *successful* `WEB_FETCH` 17 times (`limits.ts:19-27`).
- **Verification is a receipt check, not a second opinion.** `evaluatePlannedReplyEgress`
  (`services/message.ts:3602`) + `plannedReplyHasClaimGroundingReceipt` (`:3543`) reject replies
  claiming an action happened with no receipt to prove it, on the direct reply, the early ack and
  the planner final (`:7926`, `:7985`, `:8608`).
- **In-loop evaluator** = reflection *during* the turn: one `RESPONSE_HANDLER` call after each
  tool returning `{decision: FINISH|CONTINUE|NEXT_RECOMMENDED, success, thought, messageToUser}`
  (`runtime/evaluator.ts:93`), skipped when `tryGateEvaluator` (`planner-loop.ts:1139`) can decide
  deterministically.
- **Post-turn evaluators** = reflection *after* delivery, detached and non-blocking
  (`services/message.ts:12993`). Contract `types/evaluator.ts:54`:
  `shouldRun → prepare → prompt → parse → processors[]`, priority-sorted, `shouldRun` in parallel,
  then **all active evaluators merged into ONE prompt and one small-model call**
  (`services/evaluator.ts:975`, 120k-char cap), each parsing its own section. Core ships
  `factMemory`, `relationships`, `identities`, `success`, `preferences`, `experiencePatterns`,
  `skillProposal`, `skillRefinement`.
- **Self-authored skills.** Two of those evaluators curate on-disk `SKILL.md` files from recorded
  trajectories: `skillProposal` drafts one under `skills/curated/proposed/<name>/` (with the
  `trajectoryId` in frontmatter) when a completed ≥5-step run used no curated skill;
  `skillRefinement` rewrites the active skills a *failed* run used, re-staging them under
  `proposed/` after `MAX_AUTO_REFINEMENTS = 3` (`skill-items.ts:1-44`, `:409`, `:490`).
- **Multi-agent** is out-of-process, not peer chat. `RemotePluginConfig.subAgent`
  (`types/plugin.ts:1261`) names a `runner: "claude-code"|"codex"|"opencode"|"eliza"`, and
  `role: "sub-agent"` **forces `isolation: "isolated-process"`** (`:1206-1230`); results return as
  a `ChildAgentResultBundle {childSessionId, transcript, artifacts[], result}`
  (`features/sub-agent-credentials/types.ts:46`). `types/swarm-coordinator.ts` is types only.
- **Trajectories are first-class**: `withActionStep`/`withProviderStep`/`withEvaluatorStep` wrap
  every call site, `recordLlmCall` is the single generative entry point, and
  `ELIZA_TRAJECTORY_STRICT` fails a generative call made outside a step
  (`trajectory-utils.ts:1-22`); `features/trajectories/` persists steps, model calls and reward
  metadata for replay and training export.

## 7. Configuring a new agent

The character file is a JSON (or in-process TS) object validated by a zod schema
(`schemas/character.ts:253`), `.strict()` at the top level — unknown keys are **rejected** —
while `settings` is `.passthrough()` with unknown keys folded into `settings.extra` (`:212-238`).
Normalization (`character.ts:129`) coerces `bio: string → string[]`, folds legacy `knowledge`
into `documents` only when `documents` is empty, and accepts message examples in either
`MessageExample[][]` or `{examples: […]}[]` form. Failures surface as
`"Character validation failed: <path>: <message>"` (`character.ts:211`).

Full field list (`types/agent.ts:69`): `id?`, `name` (required), `username?`, `system?`,
`templates?: Record<string, string | ({state}) => string>`, `bio?: string|string[]`,
`messageExamples?`, `postExamples?`, `topics?`, `adjectives?`, `plugins?: string[]`,
`settings?`, `secrets?`, `style?: {all[], chat[], post[]}`, `documents?`/`knowledge?` (path or
directory, `shared?`), `advancedPlanning?`, `advancedMemory?`. `CharacterSettings`
(`types/agent.ts:35-66`) holds the knobs: `shouldRespondModel`, `defaultTemperature`,
`defaultMaxTokens`, `maxReplyTokens`, frequency/presence penalties, `providersTotalTimeoutMs`,
`maxWorkingMemoryEntries`, `alwaysRespondChannels/Sources`, `enableRelationships`,
`enableTrajectories`, ~10 `ENABLE_*` capability booleans, `useMultiStep`,
`maxMultistepIterations`, `secrets`, `extra`.

Verbatim, `plugins/plugin-vision/characters/visual-assistant.json`, abridged only where marked:

```json
{
  "name": "Visual Assistant",
  "bio": [
    "I am a visual AI assistant that can see through cameras and screens, hear through microphones, and act autonomously.",
    "I act proactively based on what I observe, offering help when appropriate."
    /* two more bio lines elided */
  ],
  "system": "You are a helpful visual AI assistant with multiple sensory capabilities:\n- You can see through both camera (physical environment) and screen (digital environment)\n- You act autonomously based on what you perceive\n\nYour personality:\n- Friendly and proactive\n- Privacy-conscious\n\nWhen you see someone new, greet them warmly.",
  "messageExamples": [
    [
      { "name": "user", "content": { "text": "Hello, can you see me?" } },
      { "name": "Visual Assistant", "content": { "text": "Yes, I can see you! You appear to be sitting in front of your computer. Is there anything specific you'd like help with today?" } }
    ]
    /* two more example pairs elided */
  ],
  "topics": ["visual perception", "face recognition", "screen analysis", "autonomous assistance"],
  "clients": ["direct"],
  "plugins": ["@elizaos/plugin-message-handling", "@elizaos/plugin-vision"],
  "settings": {
    "voice": { "model": "en-US-Neural2-F" }, "VISION_MODE": "BOTH",
    "ENABLE_FACE_RECOGNITION": "true", "PIXEL_CHANGE_THRESHOLD": "30",
    "VLM_UPDATE_INTERVAL": "5000", "OCR_ENABLED": "true"
  }
}
```

Note this shipped file **fails the current schema**: `clients` is not a top-level key and the
object is `.strict()`. That is the state of the repo, not a transcription error.

### Head to head

| Concern | elizaOS `Character` | HARNESS `agent.md` | Verdict |
|---|---|---|---|
| Format | JSON/TS object, prompt as an escaped `system` string | YAML frontmatter + markdown body **is** the prompt | HARNESS. A multi-paragraph prompt with `\n` escapes is unreviewable in a diff. |
| Identity | `name`, `username`, `id?` | `name`, `description` | Draw. HARNESS's `description` is what a *parent agent* reads to route — eliza has no equivalent (`routingHint` is per-action). |
| Model | **role, not id**: character names `shouldRespondModel` / `defaultTemperature`; `useModel(ModelType.TEXT_LARGE)` is late-bound by whichever plugin registered that role (`types/model.ts:59`) | `model: local`, a concrete id | **elizaOS.** 20 model roles (NANO/SMALL/MEDIUM/LARGE/MEGA, EMBEDDING, TRANSCRIPTION, IMAGE, RESEARCH…) let one character run on any provider. HARNESS pins the agent to a deployment. |
| Sampling | `defaultTemperature`, `defaultMaxTokens`, `maxReplyTokens`, penalties, per-model-type overrides (`TEXT_LARGE_TEMPERATURE`) | `temperature` only | elizaOS, mildly. Most of it is over-specification. |
| Capabilities | `plugins: string[]` — coarse; a plugin brings actions+providers+services+models together. **No per-agent tool allowlist in the character.** Narrowing is via tool profiles/role gates elsewhere | `tools: [...]` — explicit per-agent allowlist, empty = all builtins, names sub-agents and builtins in one list | **HARNESS, decisively.** Least-privilege belongs in the agent file. |
| Loop control | none in the character (`useMultiStep`/`maxMultistepIterations` are declared and have zero readers in core) | `max_rounds`, `compact_at`, `keep_recent` | **HARNESS.** eliza's real budgets are global constants in `limits.ts`, not per-agent. |
| Shared state | none | `space:` | HARNESS. |
| Persona | `bio[]`, `adjectives[]`, `topics[]`, `style.{all,chat,post}`, `messageExamples[][]`, `postExamples[]` rendered by the `CHARACTER` provider | prose in the body | elizaOS for few-shot examples specifically; the rest is prose eliza chose to structure. |
| Knowledge | `documents`/`knowledge`: file or directory paths, `shared?` flag, auto-chunked into FRAGMENT rows | nothing | **elizaOS.** Attaching a folder of reference material to an agent is one line. |
| Secrets | `secrets{}` separate from `settings{}`, encrypted at rest (`settings.ts:462`), redacted from every provider text (`runtime.ts:5283`) | nothing | elizaOS. |
| Prompt overrides | `templates: {key → string | fn}` | nothing (phases own the prompt) | Neither. eliza's is half-wired — no central resolver, only ~7 honored keys. |
| Validation | zod `.strict()`, path-qualified errors, machine-readable schema a UI editor renders from | frontmatter parse | elizaOS. |
| Install | write JSON + wire a plugin list + a DB row | drop a folder, add a line to `index.json` | HARNESS. |

**What HARNESS is missing:** model *roles* instead of model ids; a `knowledge:`/`documents:` field;
`secrets:`; few-shot `examples:`; a machine-readable schema for the frontmatter.
**What elizaOS over-specifies:** `adjectives`, `postExamples`, `style.post`, `username`, `topics`,
`templates`, and ~25 `ENABLE_*` settings booleans that are really deployment config wearing a
character's clothes.

## 8. Spaces and artifacts

- **World > Room > Participant > Entity** (`types/environment.ts`). A `World` (`:76`) is the
  server/tenant and the access-control boundary, carrying `metadata.roles`; a `Room` (`:84`) is a
  channel inside it; a `Participant` (`:103`) is an entity's membership. An `Entity` (`:27`) is
  **agent-scoped** — `createUniqueUuid` = `stringToUuid("<baseId>:<agentId>")`
  (`entities.ts:548`), so the same human is a different entity id to each agent.
- **Memory** (`types/memory.ts:509`) is `{entityId, agentId?, roomId (required), worldId?, content,
  embedding?, metadata}` in a named table (`"messages"`, `"facts"`, `"documents"`, …).
  **Two agents on the same adapter and roomId see the same rows** — `runtime.getMemories` injects
  no `agentId` (`runtime.ts:11063`). Optional guards: `AccessContext` (no filtering at all when
  omitted, `types/access-context.ts:20`), `MemoryScope`
  (`shared|private|room|global|owner-private|user-private|agent-private`,
  `access-control/filter.ts:84`), opt-in Postgres RLS. Shared by default with subtractive
  privacy — the opposite of HARNESS's default-deny.
- **Artifacts** are `Content.attachments: Media[]` (`types/primitives.ts:155`, `Media` at `:233`)
  built by an action handler and passed to `HandlerCallback` (producer example:
  `features/advanced-capabilities/actions/generateMedia.ts:435`). Bytes are content-addressed and
  **the sha256 URL is the capability**: `trustedLocalMediaUrl` accepts only exact
  `/api/media/<sha256>.<ext>`, rejecting query strings and credentials
  (`media/local-store.ts:4-34`). Disclosure is decided on the *referencing record*, never on the
  byte serve — one function returning `full | redacted | none`
  (`access-control/artifact-disclosure.ts:1-22`), grants additive in `metadata.share.grants` and
  parsed fail-closed (`:76-113`). Delivery is the `SendHandler` contract with typed receipts
  (`types/messaging.ts:37-115`).

## 9. What it gets RIGHT that HARNESS lacks

Ranked. Sizes assume the ≤200-line/≤40-line rules.

1. **A named budget per failure mode, not one `max_rounds`.** `limits.ts:111` separates tool
   calls, repeated identical *failures*, repeated identical *successes*, unavailable-tool retries,
   terminal-only continuations, and a token budget — each its own counter, all raising one typed
   `TrajectoryLimitExceeded {kind, max, observed}`. `max_rounds` collapses six pathologies into
   one number. **`crates/agent/src/state.rs` (counters) + `error.rs` (the variant), enforced in
   `step.rs`. Small.**
2. **Grounding receipts on outgoing text.** Reject a reply claiming an action happened when no
   tool result this turn proves it (`services/message.ts:3543`, `:3602`). HARNESS already logs
   every tool result, so this is a fold over the turn's events, not new plumbing.
   **`crates/agent/src/reply.rs`, gated in `step.rs` before the Answer exit. Small.**
3. **Model roles, not model ids.** `ModelType.{NANO,SMALL,MEDIUM,LARGE,MEGA}` +
   EMBEDDING/TRANSCRIPTION/IMAGE, bound late by whichever plugin registered the role
   (`types/model.ts:59`) — the portability HARNESS says it wants and `model: local` defeats.
   **`crates/kernel/src/ports.rs` (`ModelPort` keyed by role) + `spec.rs`. Medium.**
4. **Self-authored skills from trajectories.** After a successful ≥5-step run that used no
   existing skill, write `SKILL.md` under `proposed/` carrying the originating trajectory id;
   after a failed run refine the skills it used, demoting back to `proposed/` after 3
   auto-refinements (`skill-items.ts:409`, `:490`) — HARNESS's stated `skills/` folder, closed
   loop, human promotion gate. **New `crates/agent/src/skill.rs` + `StorePort` write; the
   trajectory is already the event log. Medium.**
5. **One merged evaluator call.** Every post-turn evaluator contributes a schema fragment to a
   single prompt and one small-model call, then parses its own section
   (`services/evaluator.ts:975`). N reflections for one round-trip. **`crates/context/src/
   assemble.rs` (fragment merge) + a phase in `crates/agent/src/phase.rs`. Medium.**
6. **Terminal sentinels always in the tool surface.** `REPLY`/`IGNORE`/`STOP` appended to every
   planner call regardless of narrowing (`to-tool.ts:586`); HARNESS's `ToolScope::Only(...)` can
   produce a phase with no legal exit. **`crates/agent/src/toolbox.rs`. Small.**
7. **`shouldRespond` as a field of the answering call** — RESPOND/IGNORE/STOP for zero extra
   round-trips (`to-tool.ts:52`). Matters the moment an agent observes a space instead of only
   answering a human. **`reply.rs` + a `ResponseContract` variant. Small.**
8. **Per-source deadline with an explicit `degrade` sentinel** — a slow context source either
   fails the turn or renders as `"[Provider X unavailable this turn]"`, never silently missing
   (`runtime.ts:5185`). HARNESS's fidelity ladder degrades on *size*, nothing on *time*, and a
   hanging `WorkspacePort` read stalls the turn. **`crates/context/src/state.rs`, an
   `Unavailable` section source. Small.**
9. **`position`-ordered sections with a declared integer** (`runtime.ts:5003`) — HARNESS orders
   sections by assembly code; an integer makes prompt order reviewable in a diff.
   **`crates/context/src/types.rs` + `assemble.rs`. Small.**
10. **Content-addressed artifacts where the sha256 URL is the capability**
    (`media/local-store.ts:4`), disclosure decided on the referencing record
    (`artifact-disclosure.ts:1`). The right model for OPFS. **`crates/kernel/src/workspace.rs` +
    `StorePort`. Medium.**
11. **Prompts as a separate versioned unit** (`packages/prompts`, ~60 templates, secrets-scanner
    and doc generator in CI) instead of inline in Rust. **`crates/context/src/render.rs` → a
    `prompts` module, one `const` each + snapshot test. Small.**
12. **Trajectory strict mode** — a flag that *fails* any generative call made outside a recorded
    step (`trajectory-utils.ts:1`). HARNESS has the log but no such invariant.
    **`crates/kernel/src/event.rs` + a debug assertion in `crates/core`. Small.**

## 10. What would be a MISTAKE to copy

- **The size.** 266k lines in one package; `services/message.ts` is 14,059 lines, `runtime.ts`
  12,967. A HARNESS file is capped at 200. Port ideas, never structure.
- **The dependency surface.** Handlebars (with an `eval`-less CSP fallback that silently drops
  every `{{#if}}` — `utils.ts:107`), drizzle-orm, `unpdf`, `mammoth`, `underscore`. HARNESS has no
  database and cannot afford a template engine that degrades silently in the one environment it
  ships to.
- **The Stage-1 mega-prompt.** `messageHandlerTemplate` (`packages/prompts/src/index.ts:691`) is
  ~27KB of accreted negative instruction — bans on "as of my last update", on claiming a search
  happened, on inventing content filters, a personal-crisis deferral policy, injection resistance,
  domain routing for Calendly. Every line is a scar. Copy the *mechanism* (one structured envelope
  per turn), never the text.
- **`.strict()` schema plus a shipped character that fails it.** `visual-assistant.json` carries a
  `clients` key the schema rejects — the format drifted away from its own authors.
- **Vestigial config.** `useMultiStep`/`maxMultistepIterations` are declared in `CharacterSettings`
  and read by nothing; `trimTokens` is exported and uncalled. Dead knobs are worse than absent
  ones.
- **Shared-by-default memory.** `getMemories` applies no `agentId` filter and `AccessContext` does
  nothing when omitted (`types/access-context.ts:20`). Take the `MemoryScope` vocabulary, not the
  default.
- **Ten escape hatches per component.** `Action` alone has `suppressPostActionContinuation`,
  `suppressEarlyReply`, `suppressActionResultClipboard`, `asyncHandoff`,
  `allowAdditionalParameters`, `toolSchemaStrict`, `override`, `private`, `routingHint`,
  `summarize`. Each was one incident. This is what "no speculative generality" prevents.
- **Autonomy as an unbounded 30s timer** with no goal and no termination
  (`features/autonomy/service.ts:962`) — on hosted LLMs that is a standing bill.
- **Env-var behaviour switches inside the loop** — `ELIZA_PLANNER_FULL_ACTION_SURFACE`,
  `ELIZA_CODING_MAX_TOOL_CALLS`, `ELIZA_TRAJECTORY_STRICT`, `ELIZA_COMPOSE_PROVIDER_TIMEOUT_MS`
  read from `process.env` deep inside `planner-loop.ts`. A browser build has no env; these belong
  in the agent spec.
- **The two-cache, audience-keyed `composeState`** (`runtime.ts:4888-4907`). HARNESS assembles
  deterministically from state (I14) — that property is worth more than the cache hit.

## 11. Citations

Every non-obvious claim above carries its `file.ts:line` inline, all under `packages/core/src/`
unless a package is named. The load-bearing files: `services/message.ts` (turn entry, Stage 1),
`runtime/planner-loop.ts` (act loop), `runtime/limits.ts` (budgets), `runtime.ts:4864+`
(`composeState`), `actions/to-tool.ts` (tool surface),
`types/{components,agent,plugin,evaluator,memory,environment,task,tools}.ts` (contracts),
`schemas/character.ts` + `character.ts` (character file),
`features/advanced-capabilities/evaluators/{reflection,skill}-items.ts`,
`features/autonomy/service.ts`, `runtime/evaluator.ts` + `services/evaluator.ts` (the two
evaluator systems), `packages/prompts/src/index.ts` (every prompt),
`plugins/plugin-vision/characters/visual-assistant.json` (the quoted character). Repo metadata
from GitHub API `repos/elizaOS/eliza` at commit `d3d5114` (2026-08-13); LOC from `git ls-files`
and `find packages/core/src -name '*.ts' -not -name '*.test.ts' | xargs cat | wc -l`.

Unverified: the swarm-coordinator implementation (outside `packages/core`); whether any package
outside core reads `useMultiStep`/`maxMultistepIterations`; whether
`services/message.ts:7260`'s `buildModelInputBudget` call compacts or only annotates.
