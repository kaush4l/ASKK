# deepseek-harness — prior-art study

Study written for HARNESS. Read-only; no HARNESS source was touched.
All `path:line` citations are relative to the repo root of the clone described in §0.

---

## 0. Identification

- **URL:** https://github.com/deepseek-ai/deepseek-harness
- **Clone:** `git clone --depth 1` succeeded at that exact URL. The repo exists under the name the owner gave.
- **HEAD at time of reading:** `47f943859bef60e4160492346772ded9b24f765a` — `2026-08-13 19:38:46 +0800` — *"Merge pull request #2519 from deepseek-harness/feat/npm-public"*.
- **Alive:** yes, aggressively. PR #2519 on the day before this reading; `README.md:9` says *"currently in developer preview and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**"*
- **Size:** 7,404 tracked files. ~50 package groups under `packages/`, each containing several workspaces. TypeScript + pnpm monorepo, MIT.
- **Confidence it is the intended target:** high. The URL is exact, the repo is by `deepseek-ai`, and its own README describes it as *"an open-source agent harness developed by DeepSeek AI"* using an architecture where *"everything is a plugin"* — which matches the owner's phrasing verbatim.
- **Not thin.** This is the largest single agent-harness codebase in the reference set so far.

---

## 1. What it is

DeepSeek Harness (`dsh`) is a coding-agent harness built as a plugin tree on **Cordis**, a dependency-injection / effect-scoping framework the repo vendors (`vendor/`). Everything — the model adapter, the tool registry, the session log, and *the agent loop itself* — is a Cordis plugin row in a YAML composition file (`docs/architecture.md:11-13`: *"Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so every part is replaceable from configuration. There is no privileged core to patch"*). It runs on Node, ships a CLI (`dsh web`) that serves a browser UI from a local server, an ACP server, and a JSON-RPC SDK. Persistence is an append-only session event log; every view is a projection of it.

---

## 2. The loop

The default driver is one class, `ReactLoopAgent`, at `packages/core/agent-loop/src/agent.ts:64`. It is **not** a ReAct prompt pattern and **not** a graph — it is a two-level turn/step machine with waterfall hook points. The name is vestigial.

Pseudocode, with citations:

```
kick():                                       # agent.ts:210
  while (await turn()) {}                     # agent.ts:212

turn():                                       # agent.ts:246
  turn = phase.turn + 1
  session.append('turn/start', {turn})        # agent.ts:255
  loop:
    step = phase.step + 1
    decision = await preStep(target, {turn, step})       # agent.ts:266
      # preStep: claim inbox messages, assemble prompt,
      #          run the `agent/pre-step` WATERFALL       # agent.ts:229-240
      #          -> {kind:'reject'} | {kind:'enter', messages}
    if decision.kind == 'reject': turnEnds = {kind:'blocked'}; return false   # agent.ts:267-270
    if step==1 and decision.messages empty: turnEnds={completed}; return false # agent.ts:274-277
    session.append('step/start')                          # agent.ts:279
    for m in decision.messages: session.append('user/message', m)  # agent.ts:282-284
    stepEnd = await step(decision.assembly)                # agent.ts:287
    session.append('step/end')                             # agent.ts:292
    if turnEnds and inbox.nextStep empty:
        await dispatch.serial('agent/turn-stopping')       # agent.ts:296   <-- terminal checkpoint
        if still nothing owed: break                       # agent.ts:299
    target = 'next-step'                                   # agent.ts:300
  session.append('turn/end', {turn, reason: turnEnds})     # agent.ts:319
  if inbox.hasPending: reset step counter; return true     # agent.ts:324-329
  return false

step(assembly):                               # agent.ts:332
  loop:
    request = await buildRequest(...)         # agent.ts:340 — runs `agent/request` waterfall (agent.ts:438)
    for chunk in llm.stream(request):
       session.append('assistant/chunk', chunk)             # agent.ts:349
    if finish is error/aborted:
       action = await dispatch.waterfall('agent/request-error', ...)  # agent.ts:355
       if action.kind == 'retry': continue                  # agent.ts:370
       throw LlmError
    session.append('assistant/message', message)            # agent.ts:381
    if finish == max-tokens: return {kind:'max-tokens'}      # agent.ts:391
    toolCalls = message.content.filter(type=='tool-call')
    if toolCalls.length == 0: return {kind:'completed'}      # agent.ts:394   <-- normal stop
    {concluded} = await executeToolCalls(...)                # agent.ts:395
    return concluded ? {kind:'completed'} : null             # agent.ts:399   <-- tool-forced stop
```

**What ends a run.** Five things, all in `agent.ts`:

1. An assistant message with **no tool calls** — `agent.ts:394`.
2. A tool result carrying `concludesTurn` — the tool calls `exec.concludeTurn()` (`packages/core/tools/src/index.ts:420`, flag at `:565`), which propagates as `GroupOutcome.concluded` (`packages/core/agent-loop/src/tool-calls.ts:37`) and turns the step into `{kind:'completed'}`. This is how `update_goal(complete)` stops an autonomous round (`packages/goal/tool-goal/README.md`: *"An autonomous goal round that successfully reports `complete` or `blocked` marks that tool execution with `concludeTurn()` so the physical turn stops after the step"*).
3. `max-tokens` from the provider — sticky across later steps (`agent.ts:290`).
4. A plugin rejecting the step at the `agent/pre-step` waterfall → `turnEnds = {kind:'blocked'}` (`agent.ts:268`).
5. Abort / error (`agent.ts:302-315`).

There is **no round counter in the loop itself.** No `max_rounds`. A turn runs as many steps as the model asks for. Round caps live entirely outside the loop, in the goal domain (`maxGoalRounds`) and in the Ralph tool (`maxRounds`).

**The pluggability seam is the hook set, not a mode enum.** `docs/architecture.md:82`: *"`agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls, whose listeners must call `next()` to delegate; `agent/turn-stopping` is serial and has no `next()`."* Everything phase-like in the product is written as a listener on one of those:

- compaction listens on `agent/pre-step` (pressure) and `agent/request-error` (context overflow) — `packages/compaction/compaction-basic/README.md`, "Lifecycle" bullet.
- `AGENTS.md` instruction loading folds itself into the first `agent/pre-step` batch — `packages/context/agent-instructions/README.md`, "Lifecycle".
- the goal driver reserves and injects `<goal_round>` prompts, and verifies its own record on `agent/pre-step` — `packages/goal/goal-round-driver/README.md`, "Round contract".

---

## 3. Plan / work / verify / critique

**Blunt answer: two of the four exist as machinery, one exists only as prompt prose, and one does not exist at all and is explicitly deferred four separate times.**

### 3a. PLAN — exists, as a logged mode, not a stage

`packages/plan/plan-mode/`. Plan mode is a boolean in the session log (`plan/mode`, `{active: boolean}`), a system-prompt section injected while active, and one exit tool gated on human approval.

- **Where the prompt lives:** in **data**. It is the `section` config field of the `plan-mode` plugin row in the preset YAML. Required, non-empty; *"The package does not accept arbitrary named modes, tool filters, sandbox settings, or approval policy."* (`packages/plan/plan-mode/README.md`, Configuration.)
- **Tool set in plan mode:** *unchanged*, deliberately. `apps/cli/config/agent-presets/standard/agent.cordis.yml:118`: *"The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged."* Plan mode is **soft guidance**: *"Plan mode is soft guidance; sandbox mode and approval policy enforce restrictions independently and do not read or write plan state."* (`packages/plan/plan-mode/README.md:5`.)
- **Exit condition:** a human approves via `exit_plan_mode`. Verbatim schema description (`docs/tool-catalog.md:155`):

  > Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. Send the COMPLETE plan as markdown, starting with a # heading that names it. The user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise and present again.

  Parameters: exactly one, `plan: string` — *"The complete plan, as markdown, starting with a # heading that names it."* No structured fields. No paths, no verification commands, no acceptance-criteria array.

### 3b. WORK — exists, twice, in two mutually independent packages

**(i) Same-session goal rounds** — `packages/goal/`. Durable objective state (`ctx.goals`) + a continuation driver that keeps waking the same agent. Phases are `active | paused | blocked | complete` (`packages/goal/goal/src/types.ts:44-48`) — note these are *lifecycle* phases of an objective, not loop stages.

The retained round prompt, verbatim (`packages/goal/goal-round-driver/src/prompt.ts:12-25`):

```
<goal_round>
Objective: "<json-quoted objective>"
Round: <n>/<maxGoalRounds>

Continue working toward the objective in this same session. Treat the current workspace,
tool results, and durable session state as authoritative; inspect them instead of assuming
earlier narration is still current. Make concrete progress and verify the result. Before
claiming completion, gather evidence that the whole objective is achieved, read the current
goal, and mark it complete. If work remains, leave the goal active for the next round. Follow
the configured goal-tool policy before reporting a blocker.
</goal_round>
```

That prompt is **in code**, a TypeScript string constant. Only `maxGoalRounds` and the blocked threshold are data (`defaultMaxGoalRounds: 256`, `blockedAfterConsecutiveRounds: 3`).

**(ii) Ralph loop** — `packages/workflow/tool-ralph/`. A fixed, deployment-owned script that hands one immutable objective to a sequence of **fresh child agents** with no conversation seed, using the workspace as the only memory. `packages/workflow/tool-ralph/src/index.ts:86-89`:

> *"Fixed, deployment-owned orchestration. The model supplies data only; it cannot alter the loop, provider route, schema, or handoff validation."*

The whole loop is a JavaScript string constant `RALPH_SCRIPT` (`src/index.ts:90-177`) executed in a worker thread. The per-round child prompt, verbatim (`src/index.ts:155-162`):

```
You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and
no prior child session. Do not call the ralph tool: this round already is its worker.

Immutable objective:
<objective>

Ralph round: <n> of <max>.

The shared workspace and its current working tree are the long-term memory and source of
truth. Inspect them before acting, preserve existing work, perform concrete in-scope work,
and verify what you change. Treat the previous report only as a bounded handoff; confirm it
against the workspace.

Previous structured handoff:
<json of previous report | "(none — this is the first round)">

Return one report with exact normalized strings. Use status continue with at least one
nextSteps entry while useful work remains; complete only with concrete evidence and no
nextSteps; blocked only when no meaningful progress is possible without human input or an
external-state change. blocker must be empty unless blocked.
```

Its handoff schema — the single most reusable artifact in the repo (`src/index.ts:91-102`):

```js
const reportSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'nextSteps', 'blocker'],
  additionalProperties: false,
}
```

with a **cross-field validator** that is real machinery, not prose (`src/index.ts:125-143`): `complete` requires `evidence.length > 0` **and** `nextSteps.length === 0` **and** empty blocker; `continue` requires at least one `nextStep` and empty blocker; `blocked` requires non-empty blocker. An invalid report **fails the workflow** rather than being coerced.

### 3c. VERIFY — no stage. Prompt text only.

The strings *"Make concrete progress and verify the result"* (goal prompt) and *"verify what you change"* (Ralph prompt) are the entire verification mechanism. There is no verify phase, no verification-command field, no exit condition tied to a passing check, and no tool that runs one. The only structural pressure toward verification is Ralph's `complete ⇒ evidence.length > 0` schema rule — which checks that the model *wrote strings into an array*, not that anything was executed.

### 3d. CRITIQUE — absent, and deliberately so

`grep -riE 'critique|self-review|verifier|evaluator'` over `packages/`, `apps/`, `docs/` returns **zero** product hits. What it returns instead is four separate "Deferred Work" entries saying the same thing:

- `packages/workflow/tool-ralph/README.md:88` — *"**Completion is worker self-declaration** — there is no independent evaluator or verifier deciding whether the objective is actually complete; evaluator policy and evaluator-driven continuation are deferred."*
- `packages/goal/goal-round-driver/README.md:60` — *"**No independent evaluator** — the model-facing goal policy decides when evidence is sufficient for completion and whether a blocker is semantically unchanged; evaluator-backed certification remains deferred."*
- `packages/goal/goal/README.md:56` — *"**No independent evaluator** — the caller that records completion or blocking is authoritative; evaluator-backed certification is deferred to a separate policy layer."*
- `packages/goal/tool-goal/README.md:77` — *"**Same-condition blocking remains model judgment** — the runtime enforces distinct admitted-round count, not semantic equivalence of obstacles; an independent evaluator is deferred."*

The nearest thing to a critique gate is mechanical and crude: a model may not self-report `blocked` until the *same* condition has persisted for N consecutive rounds (`blockedAfterConsecutiveRounds: 3`), and the runtime enforces only the round count, not the sameness.

### 3e. So where does a stage's definition live?

| Stage | Prompt | Tool set | Exit condition | Lives in |
|---|---|---|---|---|
| plan | preset YAML (`plan-mode.config.section`) | unchanged by design | human approval via `exit_plan_mode` | **data** (prompt) + **code** (tool) |
| work (goal) | TS constant `prompt.ts` | unchanged | model calls `update_goal complete/blocked`, or round cap | **code**, cap in data |
| work (ralph) | JS constant `RALPH_SCRIPT` | child inherits parent preset | structured report `status` + schema validation, or round cap | **code**, cap in data |
| verify | — | — | — | nowhere |
| critique | — | — | — | nowhere |

**A declared agent cannot choose its loop.** There is no `engine:` field. What a preset chooses is *which policy plugins are mounted* — `plan-mode` on/off, `tool-goal` on/off, `tool-ralph` on/off. That is a real and useful degree of freedom, but it is composition of independent policies, not selection of a loop shape.

---

## 4. Agents as plugins

**An agent is a directory holding a YAML file.** `packages/preset/agent-presets/README.md:5`: *"A **preset** is a directory holding one `agent.cordis.yml`; the roster mounts it ONCE per process under a standing scope, and each session that names it joins by having its agent scope key parented to the mount's."*

Layout on disk (`apps/cli/config/agent-presets/`):

```
<preset-id>/                 <- directory name IS the id, must match [a-z0-9][a-z0-9-]*
  agent.cordis.yml           <- required: a top-level YAML LIST of plugin rows
  preset.yml                 <- optional: display metadata only
  skills/<name>/SKILL.md     <- optional: skills that travel with the preset
```

Four ship: `standard`, `code`, `cordis`, `minimal`.

**Adding an agent = dropping a directory.** No registration call, no class, no index file. Discovery is unmemoized filesystem scan on every `list()`/`resolve()` — *"a preset authored while the process runs is visible immediately and a deleted one disappears from the next read"* (`README.md`, Service section; `src/discovery.ts:4-7`). Roots are configured plus a derived `<dshHome>/.agent-presets`. Authoring from the UI is **copy-only**: `copy(from, id, name?)` duplicates a whole directory; *"no caller ever supplies composition text and a copy grants nothing the roster did not already carry."*

**A real one, verbatim** — `apps/cli/config/agent-presets/minimal/preset.yml`:

```yaml
name: 极简模式
description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。
order: 3
```

and `apps/cli/config/agent-presets/minimal/agent.cordis.yml` in full:

```yaml
# The `minimal` agent preset: a fixed-prompt, two-tool coding-agent composition.
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: You are a helpful software engineer assistant.
    complete: true
    includeRuntimeContext: false

- id: persistent-shell
  name: cordis:group
  group: true
  isolate:
    terminals: true
  config:
    - id: pty
      name: '@deepseek-ai/dsh-terminal'
    - id: terminal-bash
      name: '@deepseek-ai/dsh-terminal-bash'
      config:
        timeoutMs: 300000
    - id: persistent-bash
      name: '@deepseek-ai/dsh-tool-bash-persistent'
      config:
        timeoutMs: 300000
        description: |-
          Run commands in a bash shell
          * ... (8 more lines of tool description, inline in the agent file)

- id: filesystem
  name: cordis:group
  group: true
  isolate:
    fs: true
  config:
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'
      config:
        cwd: !!js process.env.DSH_CWD ?? process.cwd()
    - id: str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
```

**What metadata an agent carries.** Not a fixed schema — the union of every mounted plugin's config schema. In practice:

- identity: a `dsh-persona` row (`text`, `complete`, `includeRuntimeContext`). `complete: true` makes that text the *entire* system prompt, suppressing harness identity, tool guidance, and every later assembly listener (`packages/preset/persona/README.md`).
- tools: one row per tool package, each with its own config (`tool-todo.allowParallelInProgress`, `tool-web.fetch: false`, …).
- policy: `plan-mode.section`, `compaction-basic`, `tool-result-pruner` thresholds.
- delegation: `tool-subagent` rows, one per provider, each naming its own `toolName`, `maxDepth`, `backgroundMode`, optional per-child `persona` and `toolFilter`.
- prompt variables: `{{model}}` / `{{cwd}}` resolve at render (`standard/agent.cordis.yml:27-28`).

**What is NOT in the agent definition.** The model route. `standard/agent.cordis.yml:6-9` states the host composition *"keeps everything a preset must not own: the registries themselves, the sandbox and approval stack, persistence, and the model route."* There is no `model:` or `temperature:` field in a preset. Model comes from `AgentOptions.provider/model` resolved on the host (`packages/core/agent-loop/src/agent.ts:421`) or from the `agent/request` waterfall (`agent.ts:438-445`).

**Two structural rules a preset must obey:**

1. A row that *publishes a service* must sit inside a `cordis:group` carrying an `isolate:` realm, or the service goes global and the second preset publishing the same name collides. `mount()` rejects this at mount time (`README.md`, "What a mount rejects").
2. A preset file is an *input, never a persistence target* — the mounted subtree overrides Cordis's `write()` as a no-op, because the loader otherwise writes runtime state back into the file every session shares.

**Sub-agents are not declared agents.** There is no `subagents/<name>.md`. A child is created by a `tool-subagent` row: each plugin instance binds one provider to one tool name (`subagent`, `subagent_fork`, `subagent_codex`, …), and the child's persona / tool filter come from *that row's config*, not from a named child definition. The child joins the parent's standing composition through `composeFrom()` rather than remounting by id, so it runs the exact generation the parent ran (`packages/subagent/subagent/README.md`, Capabilities). Roles like "reviewer" or "tester" therefore have no home: you write them into the delegation prompt at call time.

**The agent can also mint plugins at runtime.** `packages/extensions/tool-cordis/` exposes `cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine` / `cordis_inspect`: the model writes a Cordis plugin (host half plus optional browser half), it is syntax-checked, shown to the user as a card with a start control, and evaluated in a vm sandbox. These live in process memory only — *"They create no Plugin file, install no package, change no `cordis.yml` … and cannot be promoted automatically."*

---

## 5. Goal → plan

**Yes, but only through plan mode, and only as prose.** There is no goal-decomposition pass, no planner agent, no structured plan object.

The one prompt that converts a loose human goal into a technical plan is the `section` config of the `plan-mode` row. Verbatim from `apps/cli/config/agent-presets/standard/agent.cordis.yml:113-124`:

> You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.
>
> Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.
>
> The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.
>
> Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.
>
> Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.
>
> When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.

**What it fills in:** goal, success criteria, changes grouped by subsystem, public API / schema / data-flow changes, edge cases, failure modes, tests, acceptance criteria, explicit assumptions. **All of it as free markdown in one `plan: string` parameter.** Nothing downstream parses it. There are no path fields, no verification commands, no machine-readable acceptance criteria, and no artifact the work loop later reads. The approved plan simply sits in conversation history.

The only structured task list is `todo_write` (`packages/todo/tool-todo/`), and the plan prompt explicitly forbids using it during planning. `todo_write` replaces the whole list every call, has exactly two fields per item (`content`, `status ∈ {pending, in_progress, completed}`), rejects any extra key, and belongs to exactly one session — *"There is no subagent/shared/swarm scope."*

---

## 6. Tools and skills

**Catalogue: 52 model-facing tools across 24 packages** (`docs/tool-catalog.md:18-41`). Grouped: `bash`/`pwsh`/`bash` (persistent) · `read`/`write`/`edit`/`read_image`/`str_replace_editor`/`glob`/`grep` · `terminal_{open,read,send,signal,list,close}` · `web_search`/`web_fetch` · `lsp` · `job_{list,output,kill}` · `schedule_{create,list,delete}` · `todo_write` · `ask_user_question` · `exit_plan_mode` · `create_goal`/`get_goal`/`update_goal` · `subagent`/`subagent_fork`/`interrupt_agent`/`list_agents`/`send_message`/`report` · `workflow`/`ralph` · `skill` · `session_{search,trace,event_read,event_search,event_trace}` · `run_code` (reserved Code Mode transport) · `cordis_{define,run,stop,undefine,inspect_*}` (not in any shipped preset). MCP servers register dynamically as `mcp__<server>__<tool>` (`packages/mcp/mcp-client/src/tools.ts:129-163`).

**Calling convention.** `ctx.tools.register(definition: ToolDefinition): () => void` (`packages/core/tools/src/index.ts:1031`). The layer is the calling context's scope — a plain plugin context registers globally, `agent.ctx` registers for that agent alone and shadows a same-named global. Registration returns its own disposer and unwinds with the fiber. Authoring DSL: `defineTool({ name, description, parameters, output: { schema, render }, execute })` (`packages/core/tools/src/schema.ts:545`). `output` is **mandatory** — every tool declares a canonical JSON value separate from its model-facing rendering, and the registry validates the returned value before presentation.

**Registering a new tool = writing a plugin. There is no data-declared tool.** Nothing in the repo parses a JSON/YAML/markdown file into a tool. The three near-misses are MCP (schemas arrive as data, the executor is synthesized by the mcp-client plugin), config-level renaming (`toolName: subagent_fork`), and `cordis_define`, where the model writes plugin *code* into a vm sandbox.

**Skills are separate from tools, and they ARE data.** `packages/skill/`. A skill is `<name>/SKILL.md` (or flat `<name>.md`) with YAML frontmatter — `name` (required, kebab-case), `description` (required), `whenToUse?`, `disable-model-invocation?`, `user-invocable?`, `metadata?` (opaque). Parsed at `packages/skill/skill-filesystem/src/index.ts:810-834`; camelCase legacy spellings hard-fail; malformed files are warned-and-skipped, not fatal. Verbatim (`.agents/skills/dsh-code-review/SKILL.md:1-4`):

```
---
name: dsh-code-review
description: Use when reviewing a pull request in the deepseek-harness repo — orients the reviewer to this codebase's standards (AGENTS.md conventions, defensive patterns, ADRs, quality gates) and the review-specific checks that code alone can't show
---
```

Discovery is rank-ordered roots, lower wins: 100 `<projectRoot>/.dsh/skills`, 200 `<projectRoot>/.agents/skills`, 300 configured dirs, 400 `<dshHome>/skills`, 500 `<agentsHome>/skills`, 600 bundled. Nested `**/SKILL.md` recursion is **not** supported. Chokidar watches the roots; a successful `write`/`edit` tool call synchronously invalidates the cache.

The token discipline is the point: `tool-skill` publishes one durable `<available_skills>` catalog message carrying **name + description only**, and the `skill(name)` tool loads one body on demand and injects it as instructions context (`packages/skill/tool-skill/src/index.ts:29-41, 161-176`). Skills are inert instructions — *"Skills are optional instructions, not session events"* (`docs/subsystems/skills.md:5`). Skill directories travel inside a preset directory, so an agent ships with its own skills.

**Execution pipeline** (`docs/subsystems/tools.md:172`): `tool/call` logged → `tools/pre-execute` waterfall (hooks, permission, sandbox) → `ctx.approval` on `ask`, **fail-closed to deny** when absent → monotonic guards (a guard may deny, nothing can force-allow) → `tools/execute` around-wrapper (timeout/retry/metrics; may replace only `exec.signal`) → tool body → `tools/post-execute` (accept/block/replace/add-context) → registry normalization (thrown errors become `isError`) → definition-owned `finalizeContent` → `tools/result` notification → `tool/result` session event. Per-call `additionalContexts` are injected FIFO as user messages **after** all recorded tool results in the batch, preserving call/result adjacency.

**Per-agent tool scoping:** `ctx.tools.restrict(filter)` — agent-scoped allow/deny mask, throws from an unscoped context, rejects `{}` and unknown names loudly, multiple masks intersect, and the agent's own registrations stay exempt. Subagent `toolFilter` config applies exactly this in the child's creation window. All of it is *visibility composition, explicitly not an authority boundary* (`.agents/notes/.../2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals`).

---

## 7. Sandboxing and environment

**Assumes a Node host, hard.** `package.json:8-10`: `"engines": { "node": "^22.19.0 || >=24.0.0" }`. Not cosmetic — it uses `node:sqlite`'s `DatabaseSync`, `stripTypeScriptTypes` from `node:module`, `node:worker_threads`, `node:vm`, `node-pty` with a `postinstall` that chmods a prebuilt `spawn-helper`, `bash -c` literally (`packages/shell/bash-local/src/index.ts:212`), and `node:fs/promises` hardlinks for JSONL session files.

**Sandboxing is real, OS-native, per-platform, and file-effects-only.** `packages/sandbox/sandbox-local/src/index.ts:159-166`: `linux: ['bwrap','landlock'], darwin: ['seatbelt'], win32: ['windows-acl']`. Enforcement level is a reported fact — `bwrap/landlock/seatbelt: 'full'`, `'windows-acl': 'partial'` (`:178-186`) — and an unavailable chain raises `SandboxUnavailableError` rather than running unconfined. Landlock ships as a ~300-line static musl C binary (`native/landlock-run/`). *"`SandboxMode` governs filesystem effects only … Network and process visibility are outside this vocabulary."* (`docs/subsystems/sandbox.md:9`). No Docker. E2B exists but is not a `ctx.sandbox` provider — it swaps `ctx.fs`/`ctx.subprocess` wholesale.

**Worker threads and `node:vm` are explicitly NOT security boundaries** — *"an escaped script can recover Node capabilities with the host process's privileges"* (`packages/workflow/workflow-worker-thread/README.md:13`).

**There is no browser-only mode.** `dsh web` is a Node `http.createServer` plus a Vite-built UI it serves; the browser talks typed RPC over HTTP POST + two downlink WebSockets. `apps/web/vite.config.ts:7-9` throws on bare `vite serve`: *"apps/web is not a standalone application"*. `apps/web/src/node-module-stub.ts:7-9` stubs `node:module` with a throwing `createRequire`. No client package depends on `@deepseek-ai/dsh-agent-loop`. The only browser-safe module is the session **data model** (`packages/core/session/src/surface.ts:271` — "keep this module browser-safe").

**What it would take to run with no host at all: a rewrite.** Every tool that matters is a `child_process`/`node-pty` shell, persistence is `node:sqlite` or POSIX-hardlink JSONL, subagents default to same-process `agents.create()` (portable) but workflows and Code Mode are `new Worker(...)` with `resourceLimits`. The transferable parts are the session-log data model, the prompt-assembly registry, the skill format, and the preset format — i.e. exactly the parts HARNESS would want, and none of the parts HARNESS would have to port.

**Persistence.** Sessions are an append-only `SessionEvent` log; *"the LLM message history is derived from it"* (`packages/core/session/README.md:5`). Compaction is a `replace` **operation appended to the log**, never a mutation. Non-session data (workspaces, settings) lives in a separate mutable last-write-wins KV family — the split is deliberate and documented.

**Subagents:** default `spawn`/`fork` run in the **same process, same event loop** (`packages/subagent/subagent-in-process-driver/src/index.ts:132` `parent.ctx.agents.create(...)`, then `child.followup()` + `await child.whenIdle()`). Out-of-process backends (`dsh-sdk`, `codex`, `claude-code`, `acp`) are stdio child processes. Worker threads carry workflow *scripts*, not agents — child agents stay on the host and are reached over a typed protocol.

---

## 8. What it gets RIGHT that HARNESS lacks

Ranked by value-per-line-of-Rust.

1. **The structured round handoff with cross-field validation.** `{status: continue|complete|blocked, summary, evidence[], nextSteps[], blocker}` where `complete` is *rejected* unless `evidence` is non-empty and `nextSteps` is empty, and `continue` is rejected unless `nextSteps` is non-empty (`packages/workflow/tool-ralph/src/index.ts:91-148`). This is the cheapest possible way to make `crates/agent/phase.rs`'s documented-unreachable `Verify` phase reachable: a phase transition becomes a typed parse of the model's own report rather than a prompt hope. **Lands in:** `crates/agent/ending.rs` (or a new `handoff.rs`) + `crates/agent/phase.rs`. **Size: S.**
2. **`concludes_turn` as a flag on a tool result.** A tool's execution marks itself as ending the physical turn; the loop's only involvement is `return concluded ? completed : null` (`agent.ts:399`; flag at `packages/core/tools/src/index.ts:565`). This is how a *declared* tool ends a run without adding a branch to the loop — which is exactly the "core just runs them" property the owner asked for. **Lands in:** `crates/agent/tools.rs` (`ToolOutcome` gains the flag) + `crates/agent/stop.rs`. **Size: S.**
3. **Objective state as durable log state, owned outside the loop.** `ctx.goals` holds one objective with `phase ∈ {active,paused,blocked,complete}`, a revision counter, a compare-and-set `GoalRef{id,revision}` fence, and `roundsStarted/maxGoalRounds`. Every mutation appends a `goal/change` event carrying the **complete post-mutation snapshot**; strict replay rejects discontinuous revisions and illegal transitions. Continuation *authority* ("armed") is process-local and deliberately **never persisted**, so resume/fork restores the objective without restarting work. HARNESS's `max_rounds` is agent-file config with no durable objective behind it. **Lands in:** `crates/kernel` (new `EventLog` variant) + `crates/core` (projection) + `crates/agent/ending.rs`. **Size: M.**
4. **Plan mode as a logged boolean with a constant tool catalogue.** The non-obvious half: the tool schemas do **not** change when entering plan mode, purely for KV-cache prefix stability, and the prompt section instead says *"those tools remain listed to keep the tool catalog unchanged"* while forbidding their use. Exit is a tool call gated on real human approval, and rejection feedback comes back **in the tool result** so the model revises in place. **Lands in:** `crates/agent/phase.rs` + `crates/context` (section injection) + a `plan_section:` key in `agent.md` frontmatter. **Size: M.**
5. **Stage prompts owned by the agent file, not by code.** The entire plan-mode policy — six paragraphs, quoted in §5 — is a `config.section` string in `standard/agent.cordis.yml`. HARNESS's `agent.md` already carries the system prompt in its body; extending frontmatter to `phases: {plan: "...", work: "...", verify: "...", critique: "..."}` with a code-side default is the single change that most directly satisfies *"the agents details fully present in the agents folder."* **Lands in:** `public/agents/<name>/agent.md` + `crates/context`. **Size: M.**
6. **Prompt assembly as ordered named sections with strict interpolation.** `PromptSection {name, order, text, complete?}` with published order bands (−100 harness identity, 0 persona, 100–199 tool guidance), scoped shadowing, and `renderPrompt` that **throws** on an unknown `{{var}}`, a registered-but-valueless var, or `{{{model}}}` — *"fail loud beats shipping a malformed prompt"* (`packages/core/system-prompt/README.md`). Plus `complete: true`, which lets one agent declare its persona is the *entire* prompt and suppress every other contributor. **Lands in:** `crates/context`. **Size: S/M.**
7. **Per-package runtime invariant companions.** 219 `src/invariant.ts` files. Each registers under its exact package name with `ctx.invariants` and validates candidate events against the durable prefix **before** they enter the log — e.g. `goal-round-driver`'s companion re-derives the goal fold and re-renders the prompt to prove the queued `<goal_round>` message matches the state it claims (`packages/goal/goal-round-driver/src/invariant.ts:28-42`). Toggleable by allow/blocklist regex. HARNESS has `INVARIANTS.md` I1–I15 as prose; this is how you make them executable without polluting the modules they check. **Lands in:** `crates/kernel` (registry + `EventLog::append` hook) + one `invariant.rs` per crate. **Size: M.**
8. **Skills as a second data plane with a two-stage token cost.** Catalog message carries name+description only; one `skill(name)` tool loads a body on demand. Frontmatter can mark a skill human-only (`disable-model-invocation`) or model-only. Skills live *inside* the agent directory and travel with it. HARNESS's `tools: [...]` frontmatter has no equivalent for "instructions this agent can pull up but shouldn't pay for by default." **Lands in:** `public/agents/<name>/skills/*/SKILL.md` + `crates/agent/toolbox.rs`. **Size: M.**
9. **Fresh-agent-per-round with the workspace as the only memory.** Ralph: each round gets a brand-new child with zero conversation seed, the immutable objective, its round number, and the previous bounded report. HARNESS already has per-subagent Web Workers and a durable Alpine workspace; this is a policy, not infrastructure. **Lands in:** `crates/agent/subagent.rs` + a `loop: ralph` option in `agent.md`. **Size: M.**
10. **Broken agents are listed, not skipped.** A preset directory whose composition is unparsable is returned from `list()` with a `broken: <human reason>` field, because *"a skipped directory would still occupy its id on disk while every surface shows nothing to delete"* (`packages/preset/agent-presets/README.md`). A bad `public/agents/<name>/agent.md` in HARNESS should appear in the UI as a broken row with its parse error, not vanish. **Lands in:** `crates/core` (agent-roster projection) + `crates/ui`. **Size: S.**
11. **A generated tool catalogue that boots the plugins.** `docs/tool-catalog.md` is produced by a script that mounts each tool package on a real context and reads `ctx.tools.schemas()`, *"because a tool schema is not statically knowable"*, with a glob-based completeness guard so a new tool package cannot go undocumented. **Lands in:** a HARNESS build script + `docs/`. **Size: S.**

---

## 9. What would be a MISTAKE to copy

- **Cordis, and the whole "everything is a plugin" apparatus.** 7,404 files, a vendored DI framework, entry-local realms, scope parent chains, single-flight standing mounts, generation stamps, `write()` overridden to a no-op so the loader doesn't burn runtime state into a shared file. HARNESS gets the same replaceability from `handle(Request) -> Response` plus port traits, at roughly 1% of the size. Copying the *mechanism* would end the 200-line file rule on day one.
- **Declaring an agent as a list of DI plugin rows.** This is the study's central irony: the preset file is a *wiring* file that happens to describe an agent. To author one you must know that a service-publishing row needs an `isolate:` realm or it collides process-wide, which rows are "host-plane" and must NOT be moved into the agent, and why `tokenMeter` is deliberately outside the compaction realm. `standard/agent.cordis.yml` is 251 lines of which most are comments explaining these hazards. HARNESS's existing `agent.md` frontmatter — flat keys plus a markdown body — is strictly better for the owner's stated goal. Steal the *contents* (stage prompts, per-tool config, per-child persona) into that frontmatter; do not steal the shape.
- **`!!js process.env.DSH_CWD ?? process.cwd()` inside the agent data file.** The composition YAML evaluates arbitrary JavaScript, and preset *health checking* has to parse "with the loader's own dialect, `!!js` included". A data file that executes code is not a data file. HARNESS should keep frontmatter inert and resolve environment in `adapters_web`.
- **Model-written JavaScript as an orchestration primitive.** The `workflow` tool takes a `script` string the model authors and runs it in a worker the README calls *"not a security boundary"*. It also carries a *"substantial fixed schema cost on each request where the tool is visible."* The Ralph *result schema* is worth stealing; the arbitrary-script engine under it is not.
- **Four unrelated long-running-work subsystems.** `goal` (same-session rounds), `ralph` (fresh children), `workflow` (model-written scripts), `plan-mode` (a boolean), plus `todo_write` — with no shared vocabulary, and the plan prompt explicitly *forbidding* `todo_write` during planning so the two never meet. The four separate "no independent evaluator is deferred" notes are the symptom: nobody owns the verify step because there is no place for it to live. HARNESS's `phase.rs` is already that place; do not scatter it.
- **Verification as prompt prose.** *"Make concrete progress and verify the result"* is not verification. If HARNESS adds a Verify phase, it needs a data-declared check the workspace actually runs (`verify: cargo test` in the agent file) whose exit code — not the model's summary — gates the transition. Nothing in dsh does this.
- **Copy-only agent authoring.** A new preset is a byte-identical directory copy, so a broken source yields a broken copy, and the README concedes *"A copy is a snapshot that drifts — upgrading the deployment does not update copies of shipped presets, and there is no patch semantics at this layer."* The shipped `cordis` and `code` presets are full copies of `standard`.
- **Naming.** `ReactLoopAgent` implements no ReAct. Do not inherit vocabulary that lies about the mechanism.
- **The prose volume.** `packages/goal/goal/README.md` is longer than `packages/goal/goal/src/` is instructive. The "Model Experience / What the model sees / Token effect / KV Cache effect" template on every package is genuinely good discipline — the doc-per-package *volume* is not something a solo engineer can sustain.

---

## 10. Citations


Sections 1–9 carry inline `path:line` citations throughout. This table covers claims whose evidence is a command result, a cross-file grep, or a path not spelled out above.

| Claim | Evidence |
|---|---|
| HEAD / date / activity | `git log -1` → `47f943859bef60e4160492346772ded9b24f765a`, 2026-08-13 19:38:46 +0800, "Merge pull request #2519 from deepseek-harness/feat/npm-public" |
| Repo size | `find . -path ./.git -prune -o -type f -print \| wc -l` → 7404 |
| "everything is a plugin"; no privileged core | `README.md:7`; `docs/architecture.md:11-13` |
| Which hooks are waterfalls vs serial | `docs/architecture.md:82` |
| No critique / verifier / evaluator anywhere in the product | `grep -riE 'critique\|self-review\|verifier\|evaluator' packages apps docs` returns only the four "deferred" notes at `tool-ralph/README.md:88`, `goal-round-driver/README.md:60`, `goal/README.md:56`, `tool-goal/README.md:77` — plus unrelated TypeScript-compiler hits in `packages/typert` and `packages/extensions` |
| Shipped presets | `apps/cli/config/agent-presets/{standard,code,cordis,minimal}/` — only four `agent.cordis.yml` files ship |
| `standard` preset length | `apps/cli/config/agent-presets/standard/agent.cordis.yml` = 251 lines, majority comments |
| Preset composition-file constant and health check | `packages/preset/agent-presets/src/discovery.ts:26`, `:4-13`, `:44-60` |
| Preset id regex, copy-only authoring, `remove()` refusal rules | `packages/preset/agent-presets/README.md`, "Authoring" |
| 219 runtime-invariant companions | `ls packages/*/*/src/invariant.ts \| wc -l` → 219; registry contract in `packages/runtime-diagnostics/invariants/README.md`; worked example `packages/goal/goal-round-driver/src/invariant.ts:28-42` |
| Tool catalogue is generated by booting each plugin | `docs/tool-catalog.md:8`; completeness guard globs `packages/*/tool-*` |
| 52 tool sections in the catalogue | `grep -c '^### ' docs/tool-catalog.md` → 52 |
| MCP tools registered dynamically | `packages/mcp/mcp-client/src/tools.ts:129-163` |
| No data-declared tools exist | no parser from JSON/YAML/markdown to `ToolDefinition` in `packages/`; the three near-misses are enumerated in §6 |
| Skill root ranks and no nested recursion | `packages/skill/skill-filesystem/src/index.ts:36-40`, `:246-254`, `:672,683,724-728`; `docs/subsystems/skills.md:68-85` |
| Approval fails closed to deny | `packages/core/tools/src/index.ts:1693-1706` |
| `restrict()` is visibility, not an authority boundary | `packages/core/tools/src/index.ts:1071-1097`; `.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals` |
| Node engine floor is enforced by builtin usage | `package.json:8-10`; `node:sqlite` at `packages/session/session-persistence-sqlite/src/index.ts:13`; `stripTypeScriptTypes` at `packages/code-runtime/code-runtime-worker-thread/src/index.ts:10,302` |
| `bash -c` literally | `packages/shell/bash-local/src/index.ts:212` |
| Sandbox chains, enforcement levels, fail-closed | `packages/sandbox/sandbox-local/src/index.ts:159-166`, `:178-186`, `:489`; profiles in `src/profiles.ts:16-57` |
| Sandbox is file-effects only | `docs/subsystems/sandbox.md:9` |
| Workers / `node:vm` are not security boundaries | `packages/workflow/workflow-worker-thread/README.md:9,13`; `packages/code-runtime/code-runtime-worker-thread/README.md:5` |
| No browser-resident agent loop | `apps/web/vite.config.ts:7-9`; `apps/web/src/node-module-stub.ts:7-9`; `packages/host/webserver/src/index.ts:11,170,218`; no `packages/client/*/package.json` depends on `@deepseek-ai/dsh-agent-loop` |
| Only the session data model is browser-safe | `packages/core/session/src/surface.ts:6,271` |
| Append-only log, derived history, compaction as an appended `replace` | `packages/core/session/README.md:5`, `:109`; `packages/session/session-persistence/README.md:7`; JSONL append at `packages/session/session-persistence-jsonl/src/index.ts:654` |
| Subagents default to same-process | `packages/subagent/subagent-in-process-driver/src/index.ts:132`, `:177-178` |
| Prompt order bands, strict `{{var}}` rendering, `complete` sections | `packages/core/system-prompt/README.md`, "Key types"; `packages/preset/persona/README.md` |
