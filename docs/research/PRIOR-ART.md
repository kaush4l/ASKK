# PRIOR-ART — the sweep against the phase mandate and the skeleton mandate

> T5. Research unit, 2026-08-20. Read against `main` as of this session.
> Every claim about another project cites a URL opened this session. Every claim about this
> repo cites `path:line` read this session. Anything I could not reach a primary source for is
> marked **UNVERIFIED** and should be treated as a lead, not a fact.
>
> This does **not** repeat `docs/research/prior-art-prompts.md` (R4, prompt sectioning for
> ElizaOS / OpenClaw / Hermes / Ada-SI), `docs/research/phase-cut.md` (R6, whether
> Plan/Work/Verify is the right cut), or `docs/prior-art/three-layer.md` (a pre-rewrite
> proposal, now historical). Where this sweep contradicts one of them, it says so.

---

## 1. The verdict

The sweep does not change what we are building; it changes **which half of the phase mandate is
hard**. Routing by difficulty is settled prior art and we already ship it — GPT-5 ships a
"real-time router" that picks a fast model or a thinking model per message
(https://openai.com/index/introducing-gpt-5/), Anthropic names *Routing* as one of five workflow
patterns (https://www.anthropic.com/engineering/building-effective-agents), smolagents puts a
router at agency level ★☆☆ below tool-calling
(https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents), and
`crates/agent/src/strategy.rs:43-57` already votes `answer` / `react` / `project` and fails to the
middle. That row is closed; do not spend an increment re-deriving it. The **open** half is that
our verifier and our critic are *stages in the same window as the work*
(`crates/agent/src/stages.rs:12-17`: "one instruction pushed into the paper and one more call,
taken by the same `step` against the same window"), and the entire published case for a separate
verifier is that the separation is of **context**, not of role-name: CoVe's *factored* variant
beats its *joint* variant precisely because the verification questions are answered without the
draft in view (https://arxiv.org/abs/2309.11495), and LLM judges measurably prefer their own
generations (https://proceedings.neurips.cc/paper_files/paper/2024/file/7f1f0218e45f5414c79c0679633e47bc-Paper-Conference.pdf).
`docs/GOAL-AND-LOOP.md:581` rejected an LLM judge on cost grounds — "two models grading one
piece of work" — and that reasoning is *wrong on the mechanism*: the value was never the second
grade, it was the second window. The grounder is even clearer: nobody in open source ships one,
but Anthropic's research product ends every run by passing findings "to a `CitationAgent`, which
processes the documents and research report to identify specific locations for citations"
(https://www.anthropic.com/engineering/multi-agent-research-system), Google sells the same thing
as an API that returns a 0–1 support score per claim
(https://docs.cloud.google.com/generative-ai-app-builder/docs/check-grounding), and the academic
form is RARR — retrofit attribution by a separate research-then-revise pass
(https://arxiv.org/abs/2210.08726). On the skeleton mandate the sweep is blunter: **nobody
declares the loop**, and the one company that tried to declare arbitrary topology is switching it
off — OpenAI's Agent Builder is deprecated and shuts down 2026-11-30, with the recommendation to
use the SDK "for workflows that should continue as code"
(https://developers.openai.com/api/docs/guides/agent-builder). The survivable line is: **declare
policy and budget; never declare topology.** Our `stages:` is on the right side of that line
because it is a fixed four-node sequence, not a graph. And the durability that Temporal and
LangGraph charge a server for is, per DBOS's own architecture page, only a transactional KV store
plus a step-keyed memo table (https://docs.dbos.dev/architecture) — which IndexedDB is. That is
the largest unclaimed win in this document.

---

## 2. Per project

### 2.1 DeepSeek Harness — *everything is a plugin*

- **Philosophy.** There is no privileged core; the product is a composition you assemble from
  plugins mounted into a shared Cordis context.
- **The one feature that forces.** Every capability — model adapter, tool registry, session log,
  **and the agent loop itself** — must be replaceable from configuration
  (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/architecture.md).
- **Mechanism.** `cordis.yml` is a plugin list with per-plugin config: `llm-deepseek`,
  `agent-spine`, `subprocess/bash`, `persistence` (compressed JSONL in `./.sessions`),
  `compaction-basic` (summarise at 80% of context, retain 16%, cap 8 192 tokens), `subagent` +
  `tool-subagent` (max depth 1) + `tool-subagent-fork`, `workflow-worker-thread`, `tool-ralph`,
  `tool-todo`, `fs-observation-policy`
  (https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/headless-agent/cordis.yml).
  Tools register on `ctx.tools`; sandboxing is `ctx.sandbox`, "consumers wrap argv before
  spawning". The design rule worth stealing verbatim: **"Model-visible means logged"** — anything
  that reached the model must be reconstructible from the session log.
- **The finding that matters, and it cuts against us.** A DeepSeek *workflow* is not a
  declaration. It is a `WorkflowStartRequest` carrying "the plain-JS script body (top-level await
  allowed; ends with `return <json-value>`)" that the **model writes**, and which spawns
  subagents via `agent()` calls. Its `phases` field is explicitly inert: *"`phases` is progress
  vocabulary only: `phase()` calls match titles for observers; no execution structure is
  implied"*
  (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/workflow.md).
  So the state-of-the-art answer to "how does an agent do a long multi-step job" is *let the model
  emit a program*, and the word "phase" there means the opposite of what it means here.
- **Cost.** Realm isolation you must understand to author an agent file (already recorded in
  `docs/PARITY.md`), and a model-authored script is unverifiable before it runs.
- **Browser-reachable?** The plugin framework, no — it is a Node composition runtime. The
  *model-writes-a-script* idea, **yes**, and cheaply: `docs/research/script-engine.md` already
  measured Rhai at ~1.30 MB and Koto at ~1.12 MB `wasm-opt -Oz` on
  `wasm32-unknown-unknown`. A model-written orchestration script running in Koto inside the pure
  core would be a workflow engine with no server, no guest, and no new seam.

### 2.2 Hermes Agent — *the agent grows with you*

Largely covered by `docs/PARITY.md`; only the new part is recorded here.

- **Philosophy.** Capability arrives as documents the agent reads on demand, not as code.
- **Feature.** Skills as progressive disclosure, with three explicit levels: `skills_list()` →
  name/description/category (~3k tokens), `skill_view(name)` → full content, `skill_view(name,
  path)` → a reference file (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).
- **The detail worth taking.** The SKILL.md template contains a **`## Verification — How to
  confirm it worked`** section. A skill therefore ships its own success test. That is exactly the
  shape T2 wants (a continue-condition that is an observed exit code, not an opinion), and it puts
  the test where the instruction is instead of in the agent file.
- **Cost.** A skills index is a standing prompt tax; Hermes pays for it with a two-layer cache.
- **Browser-reachable?** Yes. We already have `list_skills` / `read_skill`
  (`public/agents/main/agent.md`), so this is a format change to skill bodies, not a build.

### 2.3 Eliza OS — *the agent is a personality document*

- **Philosophy.** An agent is a character; capability arrives by naming plugins.
- **Feature.** A four-part plugin taxonomy — actions, providers, evaluators, services — and a
  fixed registration order (https://docs.elizaos.ai/plugins/architecture).
- **Mechanism.** `Character` requires only `name` and `bio`; optional `system`, `templates`,
  `adjectives`, `topics`, `knowledge`, `messageExamples`, `style`, `plugins`, `settings`,
  `secrets` (https://docs.elizaos.ai/agents/character-interface). A plugin declares `priority`
  (load order) and `dependencies` (prerequisite plugins). At runtime the character acquires
  `enabled` / `status` / `createdAt` — the file becomes a database row.
- **The one thing to steal:** plugin `priority` + `dependencies`. Our faculties
  (`crates/agent/src/faculty/`) have neither a declared order nor a prerequisite relation, and
  `Slot` already proves we believe order is a declaration.
- **The one thing to refuse:** `secrets` in the character file. That is an I6 violation by
  construction. Letta nulls secrets on export for exactly this reason (§2.9).
- **Skipped:** the persona surface (`adjectives`, `postExamples`, `style`). It controls tone and
  nothing else, and R4 already ruled on Eliza's template-with-holes assembly.

### 2.4 Docker's agent story — *an agent is a distributable artifact*

- **Name check.** `github.com/docker/cagent` now 301-redirects to `github.com/docker/docker-agent`
  ("AI Agent Builder and Runtime by Docker Engineering"). Treat `cagent` as the old name.
- **Philosophy.** An agent should be a YAML file you can push like an image — "no code required".
- **Feature it forces.** Everything must be nameable, so every capability becomes a `type:` in a
  `toolsets` list. There are **26** of them: `filesystem`, `git`, `shell`, `background_jobs`,
  `scheduler`, `think`, `plan`, `session_plan`, `todo`, `memory`, `tasks`, `fetch`, `script`,
  `lsp`, `api`, `openapi`, `rag`, `model_picker`, `user_prompt`, `open_url`, `transfer_task`,
  `background_agents`, `webhook`, `handoff`, `a2a`, `mcp_catalog`
  (https://docs.docker.com/ai/docker-agent/reference/toolsets/). Agent keys include `model`,
  `instruction`, `toolsets`, `sub_agents`, `max_iterations`, `num_history_items`, `commands`,
  `skills` (https://docs.docker.com/ai/docker-agent/reference/config/).
- **Two ideas worth taking.** (a) `sub_agents` **auto-enables** `transfer_task` — delegation is a
  *derived* tool, not one you remember to list. (b) `permissions` is a **separate top-level
  block** from `toolsets`: authority is not capability.
- **What to refuse.** The 26-type enum. That is a registry, not an architecture, and it is what
  "no speculative generality" was written to prevent.
- **The isolation is a different product.** Docker Sandboxes (`sbx`) runs "each agent inside a
  dedicated microVM" with "no access to the host Docker daemon"
  (https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/;
  hypervisor **UNVERIFIED**), and the MCP Gateway keeps credentials on the host so "the sandbox
  never sees them"
  (https://github.com/docker/docs/blob/main/content/manuals/ai/sandboxes/mcp-gateway.md).
  The credential-never-crosses-the-boundary rule is I6 restated by someone else, and it is worth
  citing when the c2w guest eventually wants a key.

### 2.5 Container sandboxes as a class — e2b, Modal, Daytona, Blaxel, Cloudflare

Grouped, because they teach one lesson between them and are otherwise unreachable.

- **e2b.** The sandbox is a *resumable process*: `Sandbox.create()`, then `pause()` and
  `connect()`, where pause preserves "both the sandbox's filesystem and memory state… all the
  running processes, loaded variables, data" (https://docs.e2b.dev/sandbox/persistence). Default
  timeout **5 minutes**; paused sandboxes kept indefinitely. (Firecracker + ~150 ms restore is
  repeated everywhere but is **UNVERIFIED** from e2b's own docs, which say only "Linux VM".)
- **Modal.** gVisor, plus network policy as declared sandbox arguments: `block_network=True`,
  `outbound_cidr_allowlist` (any protocol), `outbound_domain_allowlist` (TLS/443 only, Beta)
  (https://modal.com/docs/guide/sandbox-networking). `snapshot_filesystem()` stores only the diff
  from the base image; memory snapshots are experimental and *terminate the sandbox*
  (https://modal.com/docs/guide/sandbox-snapshots).
- **The lesson.** Modal's domain allowlist is TLS-only *because* they cannot see inside TLS — the
  same reason a browser can only gate `fetch()` by origin. Our I2/I6 network story is not a
  browser handicap; it is the industry-normal expressiveness. Write the allowlist as a declared
  field and we match Modal's semantics exactly.
- **The cost we do not pay.** These bill per vCPU-hour for the whole time the sandbox is alive
  (https://blog.logrocket.com/comparing-ai-agent-sandbox-platforms-e2b-modal-daytona-and-more/).
  Our guest costs the user's own CPU and nothing else. That is a real, defensible product claim.
- **Reachable?** No. And the pause/resume API in particular should **not** be designed yet: this
  repo already measured guest persistence at ~79 KB/s and refused it. Designing the API before
  fixing the throughput ships a signature over an implementation we rejected.

### 2.6 agent-zero — *the framework is the prompt folder*

- **Philosophy.** "Almost nothing is hidden. Prompts live in `prompts/`, tools live in `tools/` or
  plugins"; it is "built for extension, not just configuration"
  (https://github.com/agent0ai/agent-zero).
- **Feature.** An agent profile is a *folder* (`agents/researcher/` = `AGENTS.md` + `agent.yaml` +
  `prompts/`) whose prompts **override** the global `prompts/`.
- **Correction to the internet.** The `instruments/` directory is gone; what exists now is
  `skills/` with Anthropic-style `SKILL.md` files
  (https://raw.githubusercontent.com/agent0ai/agent-zero/main/docs/guides/skills.md). Every blog
  post describing "instruments" as a third tool type is describing a dead layout.
- **Cost, and this is the cautionary tale.** "Nothing is hard-coded" means nothing is typed,
  nothing is testable, and the repo's own `docs/developer/architecture.md` is now a stub that says
  it "intentionally stays short so the repository does not maintain a second, stale architecture
  manual" and points at a generated wiki. That is what happens to legibility at the far end of
  this road. We deleted 8 agents down to 3 for the same reason; agent-zero is what not deleting
  looks like.
- **Take exactly one thing:** profile-folder prompt overrides. Refuse the rest.

### 2.7 Open SWE (LangChain) — *the agent as an async teammate*

- **Launch architecture (2025).** Four roles: Manager (routing), Planner ("researches the codebase
  by viewing files and running searches, and creates a detailed, step-by-step execution plan"),
  Programmer, and a Reviewer that is a **sub-agent inside the Programmer** and "sends the task
  back to the Programmer with feedback for another iteration". Each session gets its own Daytona
  sandbox; plan approval "interrupts and gives you the chance to accept, edit, delete, or request
  changes to the plan"
  (https://www.langchain.com/blog/introducing-open-swe-an-open-source-asynchronous-coding-agent).
- **What actually happened.** The README no longer describes that graph. Open SWE now "composes on
  the Deep Agents framework" with subagents spawned via a `task` tool, config in `langgraph.json`,
  repo conventions injected from `AGENTS.md`, and a pluggable sandbox (Modal, Daytona, Runloop,
  E2B, LangSmith) (https://github.com/langchain-ai/open-swe).
- **The finding.** A named four-role decomposition collapsed into one deep agent plus ad-hoc
  subagents inside a year. That is direct evidence against role-per-agent decomposition as an
  *architecture*, and it matches what this repo already did when it deleted its summarizer and
  critic agents and made critique a stage. **This is the strongest counter-argument to the phase
  mandate's deep path, and it must be answered rather than ignored** — the answer is in §4.
- **The cheapest steal in the whole sweep:** the plan-approval interrupt. Everywhere else it needs
  a persistence platform; in a tab the plan is already on screen. We produce a plan
  (`crates/agent/src/stages.rs`, `PLAN`) and never stop on it.

### 2.8 LangGraph / Temporal / DBOS / Restate — durable execution

- **LangGraph.** Checkpointers (`InMemorySaver`, `SqliteSaver`, `PostgresSaver`), a cross-thread
  `Store`, and three durability modes on any call — `durability="exit"` (cannot recover from a
  mid-run crash), `"async"`, `"sync"`
  (https://docs.langchain.com/oss/python/langgraph/durable-execution). `interrupt()` surfaces any
  JSON value and resumes with `Command(resume=...)`, and **requires** a checkpointer
  (https://docs.langchain.com/oss/python/langgraph/interrupts).
- **The tax, stated in their own docs.** Code before `interrupt()` re-runs on resume; the runtime
  restarts the node from the beginning. Durability there is **node-granular replay**, so every
  pre-interrupt side effect must be idempotent.
- **The commercial seam.** Assistants — the versioned `graph_id` + config object — "are a
  LangSmith Deployment concept… not available in the open source LangGraph library"
  (https://docs.langchain.com/langgraph-platform/assistants), and cron is a server-side
  `CronsClient` (https://docs.langchain.com/langsmith/cron-jobs). **The half they charge for is
  the half a file gives us free.**
- **Temporal.** Recovery is replay: "A Workflow is deterministic if every execution of its
  Workflow Definition produces the same Commands in the same sequence given the same input"; a
  mismatch means replay "will be unable to continue"
  (https://docs.temporal.io/encyclopedia/event-history/event-history-python). For agents, LLM
  calls and tool use are non-deterministic and therefore belong in Activities
  (https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal). Requires a
  cluster.
- **DBOS — the one that matters.** `@DBOS.workflow` / `@DBOS.step` checkpointed to Postgres;
  recovery "checks before each step if that step's output is checkpointed… If there is a
  checkpoint, the step returns the checkpointed output instead of executing", and there is a
  **library-only mode**: "There's no separate orchestration server and no infrastructure required
  besides Postgres" (https://docs.dbos.dev/architecture).
- **Restate.** `ctx.run()` journals non-deterministic results; Awakeables are "a one-shot signal…
  with a generated unique ID that an external system can resolve or reject"
  (https://docs.restate.dev/concepts/durable_building_blocks). Whether an embedded no-server mode
  exists is **UNVERIFIED**.
- **Reachable? Yes — and it is the biggest unclaimed win here.** Swap Postgres for IndexedDB and
  DBOS's pattern ports whole: key each step by `(run_id, stage, round, index)`, write the result
  before advancing, and on reload skip any step with a recorded output. We already have the
  ordered event log I8 demands and `docs/research/indexeddb.md`. And note the structural point:
  Temporal's determinism rules exist to stop you writing a loop the runtime cannot reproduce. **A
  declared stage list cannot be written that way.** Our loop being a declaration is what makes
  replay free.
- **The honest caveat.** Replay only helps if effects are replayable. A browser `fetch` is not
  idempotent. Journal the *response*, not the request.

### 2.9 Letta / MemGPT — *the agent is a database row*

- **Philosophy.** Agents are persistent stateful services behind a REST API.
- **Feature.** Memory blocks: `label`, `value`, `limit` (a character cap), `description`,
  `read_only`, attachable by ID to several agents at once so all of them carry the same block
  (https://docs.letta.com/guides/agents/memory-blocks). Sleep-time agents rewrite blocks every N
  steps (`sleeptime_agent_frequency`, default 5).
- **The `.af` agent file** carries model config, the **full message history with an `in_context`
  flag per message**, system prompt, blocks, tool rules, env vars, and complete tool definitions
  including source code; secrets are nulled on export
  (https://docs.letta.com/guides/agents/agent-file).
- **Verdict: steal half, refuse half.** Steal `limit` / `read_only` / `description` **on the
  block** — our compaction budgets sit on the agent, and Letta proves the budget belongs on the
  thing being budgeted. That maps directly onto `Component`. Refuse `.af`: bundling history and
  tool source into the declaration makes it a database dump wearing a file extension. You cannot
  hand-write one and you cannot diff one.

### 2.10 Goose (Block) — *a unit of work is a shareable YAML file*

- **Feature.** Recipes: required `title` + `description` + one of `instructions`/`prompt`;
  optional `parameters`, `extensions`, `settings`, `sub_recipes`, and — the two interesting ones —
  **`response`** (a structured output schema) and **`retry`** (automated retry with success
  validation) (https://goose-docs.ai/docs/guides/recipes/recipe-reference/). Sub-recipes cannot
  nest and "run in isolation — they don't share conversation history, memory, or state"
  (https://block.github.io/goose/docs/guides/recipes/sub-recipes/).
- **Cron.** `goose schedule add --schedule-id daily-report --cron "0 0 9 * * *" --recipe-source
  ./recipes/daily-report.yaml`, plus `schedule list|sessions|run-now|remove`
  (https://goose-docs.ai/docs/guides/goose-cli-commands/) — delegating to the host OS scheduler.
- **What it does not declare.** How the loop turns. No stages, no round ceiling, no pass budget.
  `retry` is a blunt outer wrapper.
- **Steal:** `response:` and `retry:`. Both are declarations of *termination*, which is what T2
  is about, and they belong next to our pass budget.

### 2.11 OpenAI Agents SDK (and Swarm's descendants) — *everything is an Agent*

- **Feature.** `Agent(name, instructions, model, model_settings, tools, handoffs, output_type,
  input_guardrails, output_guardrails, hooks, context)`
  (https://openai.github.io/openai-agents-python/agents/). `agent.as_tool()` turns an agent into a
  callable tool "without full handoffs"; function tools auto-derive their JSON schema from Python
  type annotations via `inspect` + Pydantic, and descriptions from docstrings via `griffe`
  (https://openai.github.io/openai-agents-python/tools/).
- **The relevant one: guardrails.** They run **in parallel** with the agent, input guardrails only
  on the first agent and output guardrails only on the agent producing the final output, and a
  failure raises a *tripwire* exception. The docs' own example implements a guardrail by running a
  separate agent inside it (https://openai.github.io/openai-agents-python/guardrails/).
- **Why this matters here.** A guardrail is a cheap separate-context checker that can abort a run,
  attached to the *boundary* of the loop rather than to a stage inside it. That is a better
  structural template for our verifier than "a fifth stage".
- **The warning.** OpenAI's declarative Agent Builder is deprecated and shuts down 2026-11-30,
  with the advice to use the SDK "for workflows that should continue as code"
  (https://developers.openai.com/api/docs/guides/agent-builder). The distinction that survives:
  Agent Builder declared **topology**. We declare **policy**. Keep it that way.
- **Also relevant:** `agent.as_tool()` is the industry's version of the owner's definition — *a
  tool is anything invokable that accepts variable input and produces a result*. We already have
  `spawn_agent`; making an agent callable *as a named tool* with a declared input shape is a small
  step and it makes the definition literal.

### 2.12 Claude Code (Anthropic) — the nearest neighbour, and it declares more than we do

- **Philosophy.** A markdown file with YAML frontmatter *is* the agent; the harness supplies the
  loop. This is our design, shipped at scale.
- **Subagent frontmatter** (`.claude/agents/*.md`): `name`, `description`, `tools`,
  **`disallowedTools`**, `model`, `permissionMode`, **`maxTurns`**, **`skills`** (preloaded at
  startup), `mcpServers`, `hooks`, **`memory`** (`user|project|local`), `background`,
  **`effort`**, **`isolation`**, `color`, `initialPrompt`, with a five-level precedence order
  across managed settings, a CLI flag, project dir, user dir, and plugins
  (https://code.claude.com/docs/en/sub-agents). Context isolation is *specified*: a non-fork
  subagent gets its own prompt, the delegation message, preloaded skill bodies and a sibling
  roster, and explicitly does **not** get the parent's conversation history or tool results.
- **Skills** (`SKILL.md`): progressive disclosure made literal — "a skill's body loads only when
  it's used, so long reference material costs almost nothing until you need it" — with `paths:`
  globs that gate auto-activation on what is being touched, and a **1 536-character truncation of
  `description` + `when_to_use` in the listing** (https://code.claude.com/docs/en/skills). Only
  six fields are the portable agentskills.io standard; the rest are extensions.
- **Cron, and read this as our design spec.** Three tiers because none suffices: cloud Routines
  (min interval 1 hour, no local files), desktop scheduled tasks (1 min), and session-scoped
  `/loop` — 5-field cron, deterministic jitter from the task ID, **7-day auto-expiry**, max 50 per
  session, and **no catch-up for missed fires**
  (https://code.claude.com/docs/en/scheduled-tasks).
- **Cost.** ~17 subagent fields, ~18 skill fields, ~30 hook events. This is the far end of the
  declaration road and it is not obviously legible; I12 is our defence against arriving there.
- **The four gaps it exposes in our frontmatter,** in order of how much I think we need them:
  1. **`skills:` preload** — declaring what is resident at t=0 versus loaded on demand. This is a
     compaction budget applied to *prompt assembly*, and `Slot`/`Component` already has the
     machinery.
  2. **`paths:`-style conditional availability** — a faculty that is present only when the turn
     touches the thing it is for. We have no conditional grant at all.
  3. **`disallowedTools`** — subtractive policy is genuinely different from additive, especially
     once a faculty grants tools by name.
  4. **`effort`** as a knob separate from `model`.
  And one **trap**: hooks in frontmatter. That is a code path smuggled in through a declaration,
  and it is the thing that would make our agent files stop being readable.

### 2.13 smolagents + CodeAct — *the action should be code*

- **The agency ladder** is the cleanest published framing of the phase mandate: ☆☆☆ simple
  processor → ★☆☆ **Router** (`if llm_decision(): path_a() else: path_b()`) → ★★☆ tool call →
  ★★☆ multi-step agent → ★★★ multi-agent → ★★★ code agent
  (https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents). Our `strategy` vote
  is the Router rung and our `react` is the multi-step rung; the mandate is asking us to add the
  top rung without collapsing the bottom ones.
- **The claim.** Writing actions as code beats JSON tool calls on composability, object
  management, generality, and training-data match, citing *Executable Code Actions Elicit Better
  LLM Agents* (https://huggingface.co/papers/2402.01030).
- **Their own advice against themselves,** worth quoting when we are tempted to grow: "For some
  low-level agentic use cases, like chains or routers, you can write all the code yourself. You'll
  be much better that way… it's advised to regularize towards not using any agentic behaviour."
- **Reachable?** Yes, twice over: the guest already has a shell, and R5 already priced an embedded
  interpreter for the pure core.

### 2.14 SWE-agent's ACI paper — *the model is a new class of user*

- **Claim.** "LM agents represent a new category of end users with their own needs and abilities,
  and would benefit from specially-built interfaces to the software they use", and the custom ACI
  "significantly enhances an agent's ability to create and edit code files, navigate entire
  repositories, and execute tests" (https://arxiv.org/abs/2405.15793). Anthropic states the same
  principle: "plan to invest just as much effort in creating good agent-computer interfaces (ACI)"
  (https://www.anthropic.com/engineering/building-effective-agents).
- **Why it is a live critique of us.** Our guest hands the model *bash*, which is a human
  interface. The paper's whole result is that a narrowed, model-shaped file/search/edit surface
  beats raw shell. T9 (the incapable image) is currently framed as "the guest needs more
  packages"; the ACI reading says it may instead need **fewer, better tools**.
- **Reachable?** Entirely. It is a tool-surface decision, not infrastructure.

### 2.15 OpenHands — skipped except for one idea

Its architecture is ours with a network hop inserted: the backend talks to an action-execution
server inside the sandbox over REST
(https://docs.openhands.dev/openhands/usage/architecture/runtime). Reintroducing HTTP between core
and guest would breach I4 for no gain. **The one transferable idea** is image build tagging:
versioned tag, a lock tag that is the MD5 of the base image name plus dependency lockfiles, and a
source tag, so a build is skipped when the most specific tag already exists. We have the
`BUNDLES.json` sha256 precedent and T11 is about to rebuild the image.

### 2.16 Browser-native and Wasm-native runtimes

- **WebLLM.** OpenAI-compatible API over WebGPU with a `ServiceWorkerMLCEngine` front end and an
  `MLCEngine` in a worker; retains "up to ∼80% of the decoding throughput of MLC-LLM on the same
  device" (Llama-3.1-8B 41.1 vs 57.7 tok/s on an M3 Max) (https://arxiv.org/html/2412.15803v2).
  **The asymmetry this exposes is the most important number in this section:** in-browser
  *inference* costs ~20%, in-browser *emulated x86 compute* costs 13–15x (measured in this repo).
  That should decide where work is placed, permanently.
- **container2wasm.** Bochs for x86_64, TinyEMU for riscv64; `c2w-net-proxy` forwards HTTP/HTTPS
  through the browser's Fetch API; upstream says "Tested only on Chrome. The example might not
  work on other browsers" (https://github.com/container2wasm/container2wasm). Our browser-support
  story is Chrome's story. That belongs in an ADR, not in a memory note.
- **BrowserPod.** A commercial in-browser sandbox — "keep execution inside the browser, leveraging
  WebAssembly and the browser's security model, while still providing a Linux-compliant
  environment"; disk images "streamed on-demand to the user device", changes "stay local to the
  browser"; roadmap reaches CheerpX-based Linux workloads in November 2026
  (https://browserpod.io/blog/browserpod-10/). Confirmation the thesis is live commercially — and
  a reminder that the CheerpX deletion bought sovereignty at a real speed cost.
- **WebContainers / StackBlitz.** Node-only, closed-source, and "Licensing is required for
  production usage of the API in a commercial, for-profit setting"
  (https://webcontainers.io/enterprise). Refuse. It undoes the reason c2w was chosen.
- **Cloudflare Code Mode.** One `run_code` tool against typed APIs beats many sequential tool
  calls, executed in V8 isolates. The adversarial caveat is load-bearing: Check Point notes
  "security bugs in V8 are more common than those in typical hypervisors" and found five
  memory-corruption bugs in workerd's glue
  (https://research.checkpoint.com/2026/when-agentic-glue-melts/). Same direction as the ACI
  paper: fewer, better tools.
- **Server-side Wasm (Spin, wasmCloud, Wasmer).** Skipped. They are serverless-function platforms;
  in a tab the browser is already the capability-gated host and there is nothing to import.
- **The negative result, and it is the important one.** Every *production* agent in this sweep —
  Open SWE, OpenHands, agent-zero, docker-agent, bolt.new — puts the loop on a server and the
  sandbox in a cloud. I found **no primary source for a shipped, serverless, fully client-side
  agent loop with tool execution**. Marked **UNVERIFIED / likely does not exist**. Every component
  exists in isolation; the composition does not. Prior art will therefore never validate our whole
  design, only its parts — the risk is integration and budget, not feasibility.

### 2.17 Protocols — MCP, A2A, ACP

- **MCP, revision 2026-07-28**, and the changes matter to us:
  **MCP is now stateless** — the `initialize`/`notifications/initialized` handshake is removed,
  every request carries `protocolVersion` in `_meta`, and there is a new `server/discover` RPC.
  The `Mcp-Session-Id` header and the HTTP GET endpoint are removed; server-initiated requests are
  replaced by **MRTR**, where a server returns `resultType: "input_required"` and the client
  retries carrying `inputResponses`. Roots, Sampling and Logging are deprecated
  (https://modelcontextprotocol.io/specification/2026-07-28/changelog).
  This is a POST-only, sessionless shape — exactly what `fetch()` handles. The remaining blocker
  is **CORS**, which is the remote server's choice, and local servers are deliberately
  unreachable: the spec tells servers to validate `Origin` against DNS rebinding and bind to
  127.0.0.1 (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). Exact
  CORS header requirements: **UNVERIFIED** (secondary sources only).
  **The unlock:** the protocol is transport-agnostic over "any communication channel that supports
  bidirectional message exchange", so a `postMessage` / `MessageChannel` transport between the
  page and a Web Worker is conformant. **We can run MCP servers as Workers with zero network**,
  which closes PARITY gap 4 (no MCP, no way to add a tool without a rebuild) without a server.
  **MCP Apps** already does the mirror image: a tool carries `_meta.ui.resourceUri` pointing at a
  `ui://` HTML resource the host renders in a sandboxed iframe over JSON-RPC on `postMessage`
  (https://modelcontextprotocol.io/extensions/apps/overview).
- **A2A.** The Agent Card is "a JSON metadata document published by an A2A Server, describing its
  identity, capabilities, skills, service endpoint, and authentication requirements", with
  `AgentSkill` entries, capability flags (`streaming`, `pushNotifications`) and
  `securitySchemes`, over JSON-RPC / gRPC / HTTP+JSON
  (https://a2a-protocol.org/latest/specification/). Our `agent.md` frontmatter is an Agent Card
  that never learned to publish itself. Low priority, but it is the cheapest portability story we
  have.
- **ACP (Zed).** JSON-RPC 2.0 over stdin/stdout between an editor and a local agent subprocess
  (https://github.com/agentclientprotocol/agent-client-protocol). **Skipped:** stdio is not
  reachable from a page, and we are not an editor.

### 2.18 Skipped, and why

- **AutoGen / AG2, CrewAI Flows, n8n, Dify.** All teach the same lesson as Agent Builder — a
  declaration a human cannot hand-write becomes a build output, and then it is a code path again,
  just uglier. n8n's Schedule Trigger and Dify's DSL are confirmed
  (https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger); the Dify
  DSL field list is **UNVERIFIED**. CrewAI is recorded only for its warning: its YAML resolves
  `llm:` and `tools:` **by Python method name**, so the declaration cannot be read without the
  code beside it (https://docs.crewai.com/en/learn/using-annotations). Our `agent.md` must never
  acquire a symbol reference.
- **Cline / Roo / Devin.** No primary architecture document worth citing was reachable;
  everything found was secondary. **UNVERIFIED**, skipped rather than guessed.
- **The Ralph loop.** Not a project, a technique: re-run the same prompt with a *fresh* agent
  until a TODO list is empty, because "progress doesn't persist in the LLM's context window — it
  lives in your files and git history"
  (https://ralphloop.sh/blog/who-invented-the-ralph-technique/). Worth naming because DeepSeek
  shipped it as `tool-ralph`, i.e. a fresh-context outer loop is now a *tool*, not a script. That
  is the cheapest possible form of the skeleton mandate's "long-running agent", and it needs
  exactly one durable thing: the file the todo list lives in.

---

## 3. The translation table

Rows are candidate features for us. **20/80** is my score for value carried per unit of build
cost, 1 (skip) to 5 (do it now).

| # | Candidate feature | Who does it | Philosophy it comes from | What it costs us | What it breaks (invariant IDs) | 20/80 |
|---|---|---|---|---|---|---|
| A | **Verifier as a separate window, not a stage** — the verify call re-runs against the artifact and the criteria, with the work turn's reasoning withheld | CoVe *factored*; OpenAI guardrails; Anthropic evaluator-optimizer | Self-evaluation is biased by the draft; independence is the mechanism | One extra model call per `project` turn; a second `Document` assembled from a subset of components | Nothing. I13/I14 already say every model input is an assembled Document; this is a different component set, not a new path. I8 needs one new event kind | **5** |
| B | **Durable step memo in IndexedDB** — key `(run_id, stage, round, index)`, write result before advancing, skip on reload | DBOS library mode; LangGraph checkpointers | Durability needs a transactional KV store, not a cluster | A store, a key schema, and a replay path in `step()` | Strengthens I7/I8/I11. Risk: I7 says `step()` is pure — the memo must be an injected port, not a global | **5** |
| C | **Grounder as a separate post-pass** — a role that reads the answer plus the retrieved evidence and emits per-claim support, refusing unsupported sentences | Anthropic `CitationAgent`; Vertex check-grounding (0–1 support score, claim-level); RARR; Self-RAG `IsSup` | Attribution is a different judgement from correctness and must see the sources, not the reasoning | One model call on answers that used retrieval; a way to carry retrieved text as an addressable component | I13 is fine. **I2 is the constraint**: it can only ground against evidence we actually fetched, so it is honest only if retrieval is recorded | **4** |
| D | **Plan-approval interrupt** — the `plan` stage stops and the person may accept / edit / delete / revise | Open SWE | An agent that works for hours must be steerable before it starts | A pause state in the run, a UI fragment, a resume `Request` | I4 holds (it is a `Request`). I8 wants the interrupt and the resolution both logged | **4** |
| E | **`skills:` preload + a declared resident/on-demand split** | Claude Code; Hermes 3-level disclosure | Progressive disclosure is a *declared* property, not an implementation detail | Two frontmatter fields and a `Slot` rule | None. I13/I14 already own assembly order | **4** |
| F | **Skill files that carry their own `## Verification`** | Hermes SKILL.md | The test belongs with the instruction | A section in the skill format; `verify` reads it | Feeds T2 directly. No invariant risk | **4** |
| G | **Declared termination: `response:` schema + `retry:` with a success check** | Goose recipes | Termination is a declaration, not a vibe | Two frontmatter keys; wiring `retry` to an observed exit code | Closes T2. I7 fine (exit code is injected) | **4** |
| H | **MCP servers as Web Workers over `postMessage`** | MCP 2026-07-28 transport-agnosticism; MCP Apps | A tool is anything invokable; the transport is incidental | A JSON-RPC framing layer and a worker host | Closes PARITY gap 4 **without a server** (I1 safe). I6 needs a grant per server. I15 needs honest absence | **4** |
| I | **Budget on the block, not on the agent** — `limit` / `read_only` / `description` per component | Letta memory blocks | Budget belongs to the thing being budgeted | Three fields on `Component`; degrade reads them | I14 must stay byte-identical for declared-static sections; caps must be declared, not adaptive | **3** |
| J | **Model-written orchestration script in an embedded interpreter** (Koto ~1.12 MB, Rhai ~1.30 MB per R5) | DeepSeek `workflow`; smolagents CodeAct; Cloudflare Code Mode | Code is the natural notation for a plan | ~1.1 MB wasm and a capability-bound host API | I6 is the whole risk: the script must call only granted tools. I7 needs the interpreter deterministic. I12 will fight the host binding | **3** |
| K | **Faculty `priority` + `dependencies`** | Eliza plugin manifest | Order and prerequisites are declarations | Two fields and a topological check at spec load | Reinforces I14. Refuse if it becomes a graph | **3** |
| L | **`sub_agents:` auto-deriving the delegation tool** | docker-agent `transfer_task` | Delegation is derived from the roster, not remembered | One rule in spec resolution | I9 friendly. Small | **3** |
| M | **`disallowedTools` denylist beside the allowlist** | Claude Code | Subtractive policy is not expressible additively once faculties grant by name | One field, one refusal path | I6 is default-deny already, so this is ergonomics, not safety. Do it when faculties multiply | **3** |
| N | **Content-hash the guest image; skip the build** | OpenHands `runtime_build.py` tags | A build is a pure function of its inputs | A hash and a check in `image/build.sh` | Pairs with T11. No invariant risk | **3** |
| O | **Narrow the guest tool surface (ACI) instead of fattening the image** | SWE-agent ACI; Anthropic ACI advice; Code Mode | The model is a new class of user | Design work, then deletion | Directly reframes **T9**. I12 friendly; I15 must still degrade | **3** |
| P | **Declared cron with fire-on-next-open reconciliation and honest missed-fire reporting** | Goose schedules; Claude Code `/loop` (7-day expiry, no catch-up) | A schedule is intent, not a promise of punctuality | A declaration, a reconciler, a visible "3 fires missed" | **I1 forbids a server, so punctuality is impossible.** Periodic Background Sync is not Baseline and needs an installed PWA (https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API). I15 requires we say so on screen | **3** |
| Q | **Ralph-style fresh-context outer loop as a declared run class** | Ralph technique; DeepSeek `tool-ralph` | Progress lives in files, not in the window | A run class that re-enters with a fresh window against a persisted todo | Needs B first. I8 must show iteration count | **2** |
| R | **Publish/consume an A2A Agent Card** | A2A spec | An agent should be discoverable as data | A serializer over frontmatter | I2 — publishing is outbound. Only worth it once someone asks | **2** |
| S | **Agent-as-tool with a declared input shape** | OpenAI `agent.as_tool()` | *A tool is anything invokable that accepts variable input* | A wrapper over `spawn_agent` | Makes the owner's definition literal. Wait for T4 (spawn observability) to land first | **2** |
| T | **Memory/filesystem pause+resume of the guest** | e2b `pause()`/`connect()` | A sandbox is a resumable process | Large, and blocked | **Do not build.** Persistence already measured at ~79 KB/s and refused. Fix throughput or say no | **1** |
| U | **A registry of tool *types*** | docker-agent's 26 `toolsets` | Everything must be nameable | A taxonomy maintained forever | Violates "no speculative generality"; I9 says built-in and forged must be indistinguishable, and a type enum makes them distinguishable | **1** |
| V | **Role-per-agent decomposition of the whole loop** | Open SWE at launch; GADC-style planner/generator/evaluator | Specialisation | Many agents, many windows, 15× tokens | Open SWE **collapsed it within a year**; we already deleted ours. Refuse as an architecture; keep only rows A and C, which are single extra passes | **1** |

---

## 4. What nobody does

**1. Nobody runs the whole loop client-side.** Every production system found puts the agent loop
on a server and the sandbox in a cloud. The parts all exist in the browser — WebLLM for
inference, c2w/Pyodide/WebContainers for execution, MCP Apps for tool UI — but the composition
does not (**UNVERIFIED / likely does not exist**). **Edge.** The differentiator is not any
component; it is the absence of a server anywhere in the loop, and it is defensible because every
component is independently proven. The warning attached: prior art will never validate the whole
design, so our own measurements are the only evidence we will ever have. That makes T12 (no CI)
more expensive than it looks.

**2. Nobody declares the loop.** Goose declares the work, CrewAI declares the roster, Letta
declares the memory, Claude Code declares the policy envelope — the stage sequence is code
everywhere. `stages: [plan, work, verify, critique]` selected per message by a model vote appears
to be ours alone. **Edge, conditionally.** It is an edge *because* it is a fixed sequence and not
a graph — the moment it grows edges, conditions, or fan-out it becomes Agent Builder, which is
being shut down on 2026-11-30. The line to hold: declare policy and budget, never topology.

**3. Nobody ships a grounder as a role in open source.** It exists as a closed product component
(Anthropic's `CitationAgent`), as a paid API (Vertex check-grounding), and as papers (RARR,
Self-RAG). No open harness in this sweep has one. **Edge, and a cheap one** — it is one extra
model call over material we already have. The caveat: a grounder is only honest if retrieval is
recorded, so it depends on the evidence being an addressable component rather than prose that
already melted into the history.

**4. Nobody gets durable execution without a server.** Temporal wants a cluster, LangGraph wants
Postgres and sells the versioned-declaration half, Restate wants a server. DBOS proves the pattern
needs only a transactional KV store. **Edge, unclaimed.** And there is a structural bonus nobody
else can have: Temporal's determinism rules exist to police hand-written loops, and a *declared*
loop cannot be written non-deterministically. Our declaration buys replay for free.

**5. Nobody has an honest answer for background work in a browser.** Claude Code needed three
scheduling tiers and still says "no catch-up for missed fires". Periodic Background Sync is not
Baseline. **Warning, not an edge.** The skeleton mandate's "cron jobs" cannot mean punctuality
under I1. It must mean a declaration plus reconciliation on next open, and the page must say so —
which is the same posture `index.html` already takes about memory.

**6. Nobody agrees on whether to split roles at all.** Anthropic measured a multi-agent researcher
beating a single agent by 90.2% on their internal eval at ~15× the tokens, and said plainly it
suits breadth-first research and *not* "most coding tasks"
(https://www.anthropic.com/engineering/multi-agent-research-system). Cognition's position is the
opposite: "Share context, and share full agent traces, not just individual messages" and "Actions
carry implicit decisions, and conflicting decisions carry bad results", recommending a
single-threaded linear agent with a compression model
(https://cognition.com/blog/dont-build-multi-agents). LangChain split research from writing and
found reports "disjoint because the section-writing agents were not well coordinated", concluding:
"restrict multi-agent to research, and write the report in one-shot"
(https://www.langchain.com/blog/open-deep-research). **The reconciliation, and it is the design
ruling this document exists to produce:** split *reading and judging*, never *writing*. A
verifier and a grounder read an artifact and return a verdict; they never co-author. That is
compatible with all three sources, and it is the narrow form of the phase mandate's deep path.

---

## 5. The five things to do next, ranked

**1. Make `verify` a separate window before making it a separate agent.**
Keep the four-stage list. Change what `verify` is assembled from: the artifact, the criteria, and
the observed command output — **not** the work turn's reasoning. Concretely, a second component
set through the existing `assemble` path, and `crates/agent/src/stages.rs`'s "same window"
sentence stops being true only for this one stage. *Why it beats #2:* it is the only row that
converts a stage we already ship into the thing the mandate actually asked for, at the cost of one
call and zero new machinery — and it corrects a documented reasoning error
(`docs/GOAL-AND-LOOP.md:581` rejected this for being "two models grading one piece of work",
when the published mechanism is two *contexts*, not two graders). It also needs no image, no
network, and no owner gate, which #2 partially does.

**2. Ship the durable step memo over IndexedDB.**
`(run_id, stage, round, index) -> result`, written before the cursor advances, consulted on
reload; the port injected so I7 survives. *Why it beats #3:* it is the prerequisite for every
skeleton-mandate item — long-running agents, cron, Ralph loops and resumable projects are all the
same feature underneath, and DBOS proves the whole pattern needs only a KV store
(https://docs.dbos.dev/architecture). It also directly repairs the failure T9 keeps hitting
(nothing survives a reload) *for the agent's own progress*, without touching the guest, which is
blocked on an owner gate. Do not attempt guest memory snapshotting (row T) — that is measured and
refused.

**3. Add the grounder as a post-pass on retrieval-bearing answers, with evidence as a component.**
One call after `work`, over the answer plus the retrieved text, emitting per-claim support in the
shape Vertex uses (a 0–1 score plus the cited chunk) and refusing to let unsupported sentences
stand. *Why it beats #4:* it is the half of the phase mandate nobody in open source has, it is one
call, and it is the only row that makes `web_search` (PARITY gap 2, T3) *safe to grant* rather
than merely granted. *Why it does not beat #1 or #2:* it needs retrieved evidence to be an
addressable component first, which is real work in `crates/context`, and it is worthless on turns
that retrieved nothing.

**4. Stop the `plan` stage for approval, and make the plan an artifact.**
Accept / edit / delete / request-changes on the plan before `work` runs, as a `Request` through
the one seam. *Why it beats #5:* Open SWE needed a persistence platform for this and we need a
fragment, so it is the highest ratio of borrowed value to build cost in the sweep; and it makes
the deep path *steerable*, which is what makes a long run tolerable at all. *Why it does not beat
#3:* it improves runs a person is watching, and the mandate's deep path is mostly about runs they
are not.

**5. Rule on the guest's tool surface, in writing, before T9 spends anything on the image.**
Two claims point away from "add packages": SWE-agent's ACI result says a model-shaped surface
beats raw bash (https://arxiv.org/abs/2405.15793), and the measured 13–15x emulation penalty
against WebLLM's ~20% inference penalty says work should move *out* of the guest wherever it can.
The output is an ADR that either kills the narrower-surface idea on the record or acts on it —
including the honest options R5 already priced (an embedded interpreter at ~1.1 MB) and the one
the sweep surfaced (Pyodide, if the real need is "run a snippet" rather than "run Linux").
*Why it is last:* it is a decision, not a build, and it is gated on the owner (T9). *Why it is on
the list at all:* T9 is currently the thing blocking everything, and it is framed as a capacity
problem when the field's best evidence says it may be an interface problem. Answering it wrongly
is the most expensive mistake available right now.

**Explicitly not in the top five, and why:** MCP-over-Workers (row H) is the most *exciting*
finding — the 2026-07-28 spec went stateless and POST-only and explicitly permits custom
transports, so a page can host conformant MCP servers in Web Workers with zero network. It is not
top-five because it closes an *extension* gap while rows 1–3 close *correctness* gaps, and because
the SDKs are in beta against a breaking revision. Queue it immediately after.

---

## 6. Where we are already ahead — do not let this sweep talk us into a rewrite

`docs/PARITY.md` is right and this sweep confirms it from the other side: **we are the best in
this field at defining an agent, and we fail at getting the task done.** Nothing below should be
reopened.

- **The single-file agent, with refusal.** One `agent.md` whose frontmatter carries identity,
  model, engine, role, loop, tool allowlist, faculties, space, compaction budgets, round ceiling
  and pass budget — and which *refuses* rather than defaults on any value it cannot honour
  (`crates/agent/src/spec/mod.rs:167-197`). CrewAI's YAML resolves by Python method name and
  cannot be read alone. Letta's `.af` bundles message history and tool source. Eliza puts secrets
  in it. Claude Code is the only comparable design and it is at ~17 fields with ~30 hook events.
  **We are at the good point on this curve. Adding fields is the risk, not the opportunity** —
  which is why §2.12's four gaps are ranked and only the first two are recommended.
- **The loop is a declaration and the message picks it.** `strategy.rs:43-57` votes
  answer/react/project and `Route::stages()` returns the list. Nobody found in this sweep declares
  the stage sequence at all. Keep it fixed and small; the moment it takes edges it becomes the
  thing OpenAI is switching off.
- **The mechanical verify gate, on by default.** `verify.rs:94-100` refuses to let "done" stand
  over an unverified edit, and `docs/GOAL-AND-LOOP.md:587` refuses to ship a
  `verify_on_stop: false`. DeepSeek says outright it has no independent evaluator; Hermes ships
  the same idea opt-in. Recommendation #1 changes *what verify sees*, not whether it runs.
- **Typed, ordered, golden-tested prompt assembly.** `Slot`, `Component`, `assemble` (I13/I14) is
  strictly stronger than every assembly strategy R4 catalogued and than everything in this sweep.
  agent-zero's answer to prompt structure is a folder of text files and an architecture doc that
  is a stub.
- **The event log we already have.** Half of what LangGraph and Temporal sell is an ordered,
  replayable record of what happened. I8 gave us one for free, which is why row B is cheap for us
  and expensive for them.
- **The sandbox that costs nothing per hour.** e2b, Modal, Daytona and Blaxel bill per vCPU-hour
  for the life of the sandbox. Ours runs on the user's own CPU, needs no account, and outlives no
  vendor. The 13–15x compute penalty is the price of that and it is a *stated trade*, not a defect
  — but see recommendation #5 for the part of it that may be avoidable.
- **Refusing to say what the records do not support.** `vouch.rs`, `ending.rs`, the honest
  capability gate. Nothing in this sweep does this, and it is the property that makes every number
  in this document worth writing down.

---

## Method and limits

Sources were opened this session via search and fetch; raw GitHub and official docs were preferred
over blogs, and where only a blog existed the claim is marked **UNVERIFIED**. A caveat on our own citations: `crates/` was being edited by another agent while this was
written, so `path:line` references into `crates/agent/src/{strategy,stages,verify,spec}.rs` were
true at read time and may have drifted by a few lines; the named functions and doc-comments are
the durable anchors. Specifically
unverified: e2b's hypervisor and restore latency; Docker Sandboxes' hypervisor; the exact CORS
header set an MCP server must send; Dify's DSL field list; Eliza's task/world/room semantics;
Restate's embedded-mode availability; Cline/Roo/Devin architecture (no primary source found — not
guessed). Two named subjects were read but are covered elsewhere and not restated here: Hermes'
and Eliza's prompt sectioning (`docs/research/prior-art-prompts.md`) and whether Plan/Work/Verify
is the right cut (`docs/research/phase-cut.md`). No code was read or written outside `docs/`.
