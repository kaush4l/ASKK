# Open SWE (langchain-ai/open-swe)

Source read: shallow clone at `ab27a34` (2026-08-13), the pinned dependency `deepagents==0.7.1`
(wheel unpacked), and two historical commits pulled from the GitHub API for the deleted TypeScript
graphs. `agent/**` = current Python tree; `apps/open-swe/src/**` = legacy TS tree at `d8b2997`.

## 1. What it is

https://github.com/langchain-ai/open-swe — an asynchronous coding agent running as a LangGraph
deployment. Every thread gets its own remote Linux sandbox (LangSmith by default; Daytona / Modal /
Runloop / E2B / local also wired), triggered from Slack, Linear, GitHub webhooks, a cron scheduler,
or a React dashboard. Alive: 204 Python files, ~44k LOC in `agent/`, last commit the day this was
written. **It has been rewritten since the version most write-ups describe** — the Manager → Planner
→ Programmer → Reviewer multi-graph split is gone, the whole TypeScript tree replaced by a Python
package that delegates the loop to `deepagents.create_deep_agent` (ReAct + a middleware stack). Five
graphs remain; one is the coding agent (`langgraph.json`):

```json
"graphs": {
  "agent": "agent.graphs.agent:traced_agent",
  "reviewer": "agent.graphs.reviewer:traced_reviewer_agent",
  "analyzer": "agent.graphs.analyzer:traced_analyzer",
  "chat": "agent.graphs.chat:traced_chat_agent",
  "scheduler": "agent.graphs.scheduler:get_scheduler"
}
```

## 2. The agent loop

There is no hand-written graph for the coding agent. `agent/server.py:954 get_agent(config)` is a
*graph factory* called per run; it resolves model + sandbox + tools + middleware and returns
`create_deep_agent(...)` (`agent/server.py:1185`). The actual loop is `create_agent` at
`deepagents/graph.py:923` — model → tools → model until the model emits no tool call.

```
run(thread_id, messages):
  # factory, per run (server.py:954-1241)
  backend   = ensure_sandbox_for_thread(thread_id)     # get-or-create, NEVER replace (server.py:433)
  model     = per-thread override > user profile > team default   (server.py:992-1052)
  tools     = 27 static tools + deepagents builtins    (server.py:1122-1150)
  subagents = [general-purpose, browser?]              (server.py:1189-1192)
  agent     = create_deep_agent(model, tools, subagents, backend, middleware=[...])

  # deepagents stack, outermost first (graph.py:816-877): Skills -> Filesystem -> SubAgent
  #   -> summarization -> PatchToolCalls -> *user middleware* -> prompt caching.
  # open-swe's own 16 entries splice in at *user middleware* (server.py:1195-1240).

  loop:                                          # deepagents/graph.py:923 -> langchain create_agent
    before_agent (once):
      PrepareAgentRunMiddleware._prepare         # server.py:875 — sandbox ready, work_dir,
                                                 # system prompt rendered, git turn snapshot
      PlanMode.before_agent -> plan_mode = initial            # plan_mode.py:49
    repeat:
      before_model:
        check_message_queue_before_model         # :148 — messages that arrived mid-run become
        refresh_github_proxy_before_model        #        new user turns
      wrap_model_call (outer -> inner): PrepareRun prepends the rendered system prompt
        (prepare_run.py:84) -> DynamicTool appends explicitly-loaded schemas (dynamic_tools.py:105)
        -> ModelCallLimit(run_limit=5000, exit_behavior="end") -> TimeoutWrapup appends
        <time_limit_warning> after 45 min (timeout_wrapup.py:43) -> ModelFallback -> PlanMode strips
        11 mutating tools (plan_mode.py:68) -> 3 sanitizers -> ModelCallTimeout (15 min)
      -> assistant message; if no tool calls: END   # the ONLY "done" condition
      wrap_tool_call: SanitizeToolInputs ("1, 80" -> 1) -> ToolError (exception -> error message)
        -> SubdirAgentsRead appends ancestor AGENTS.md to read_file results (subdir_agents.py:186)
        -> ToolRetry(tools=["task"], max_retries=2) -> PullRequestCreationGuard
      -> tool messages, continue
    after_agent: notify_step_limit_reached       # tell the user it hit the cap
```

**What decides "done":** an assistant message with zero tool calls. Nothing else. There is no
verifier node, no "task complete" state machine, no plan-item checklist. The system prompt fights
this: *"You must ALWAYS call a tool in EVERY SINGLE TURN. If you don't call a tool, the session will
end"* (`agent/prompt.py:93`). Belt and braces exists in `agent/middleware/ensure_no_empty_msg.py`
(re-inject a synthetic `no_op` tool call so the run continues) — but it is **not wired** into
`get_agent`; only its tests reference it. Hard stops: `MODEL_CALL_RECURSION_LIMIT = 5_000`,
`DEFAULT_RECURSION_LIMIT = 9_999` (`agent/runtime/constants.py:5-6`).

## 3. Modes

**Current: three graphs, not three phases, plus one mode flag.**

- `agent` — does everything: research, plan, implement, test, commit, PR.
- `reviewer` (`agent/reviewer.py:1327`) — separate graph, separate thread (one per PR), read-only
  toolset (`add_finding`, `update_finding`, `list_findings`, `publish_review`, `fetch_review_diff`),
  no commit/push/PR tools. The main agent reaches it only by calling `request_pr_review`, which
  dispatches a run on the other graph. Findings are capped at 6 (`review/findings.py:57`).
- `analyzer` — nightly graph that rewrites the reviewer's per-repo prompt from its own outcomes.
- `chat` — sandbox-less read-only Q&A over a PR; context seeded as virtual files under `/pr/`.

**Plan mode** is the plan/ask/agent equivalent and is *not* a graph phase — it is a boolean plus a
tool filter:

1. The model decides, calling `enter_plan_mode` (`agent/tools/enter_plan_mode.py:26`), which returns
   `Command(update={"plan_mode": True, ...})`. It can also start on for a thread via
   `configurable.plan_mode`.
2. `PlanModeMiddleware` recomputes the tool list on *every* model call and strips
   `PLAN_MODE_EXCLUDED_TOOLS` = `{task, http_request, open_pull_request, recreate_sandbox,
   request_pr_review, save_user_skill, delete_user_skill, slack_start_new_thread, linear_create_issue,
   linear_update_issue, linear_delete_issue}` (`agent/server.py:582-596`). Note `task` is excluded
   because "subagents wouldn't inherit these restrictions" (`prompt.py:129`). `write_file`/`execute`
   are *not* excluded — read-only-ness of the repo is enforced by prompt text, not by the filter.
3. The agent writes `/workspace/plans/YYYY-MM-DD-slug.md` and calls `save_plan(plan_file_path)`
   (`agent/tools/save_plan.py:31`), which reads it out of the sandbox and publishes it to a dashboard
   plan-review page with status `ready`.
4. The human reviews there (or replies in Slack), comments, approves.
5. `approve_plan` (`agent/tools/approve_plan.py:34`) checks ownership (`only the plan owner can
   approve`), pulls the published markdown **and the review comments**, sets status `approved`, and
   returns a ToolMessage that inlines the plan as source of truth plus "Also take this reviewer
   feedback into account" (ibid.:132-145).

**There is no `interrupt()` anywhere in the current codebase.** HITL is entirely out-of-band: a
human message becomes a new run on the same thread with `multitask_strategy="interrupt"`, which
halts the in-flight run (checkpointed with `durability="sync"`) and resumes with full history plus
the new message (`agent/dispatch.py:6-19`). Messages that arrive while busy are also queued in the
LangGraph store and injected before the next model call (`check_message_queue.py:148`).

The legacy version did use a real graph interrupt, and it is the better UX artifact of the two:
`interrupt({action_request: {action, args: {plan}}, config: {allow_accept, allow_edit, allow_respond,
allow_ignore}})` (`apps/open-swe/src/graphs/planner/nodes/proposed-plan.ts:271-289`), branching on
`response` (→ re-plan with feedback), `ignore` (→ END), `accept`, or `edit` (human edits the plan text
split on a delimiter, edited items become the task plan) — then it *starts the Programmer run* with
that plan (ibid.:295-379).

## 4. Context window

Order of the prompt, assembled in `agent/prompt.py:340-358 SYSTEM_PROMPT_TEMPLATE`:

1. Working environment (sandbox path) → dashboard base URL → plan-mode guidance → **plan-mode ACTIVE
   block** (only when in plan mode; ~40 lines of MUST NOT / MAY, `prompt.py:119-152`) → self-awareness
   → deployment default prompt (`agent/resources/default_prompt.md`, overridable by env) → repo setup
   → task execution → optional Corridor → dependencies → untrusted-comments rule → commit/PR rules →
   PR policy override → collaboration attribution → **repo custom instructions** → **user custom
   instructions** → `OPEN_SWE_SHARED_BASE` (the ~40-line standing behavior contract, `prompt.py:53-94`).
2. Precedence is stated in the prompt itself: `AGENTS.md` > repo instructions > user instructions >
   defaults; the triggering user outranks everything except untrusted content, force-push, secrets.
3. Injected later, not in the template: the skills index (name + description per skill,
   `SkillsMiddleware`), the `task` tool description listing available subagents
   (`deepagents/middleware/subagents.py:285`), and ancestor `AGENTS.md` bodies appended to
   `read_file` results as `<system-reminder>` blocks, once per path per run
   (`agent/middleware/subdir_agents.py:114-124`).

**Compaction** is `create_summarization_middleware` (`deepagents/middleware/summarization.py:1601`).
Defaults come from the model profile: trigger at **0.85 of the context window**, keep the last
**0.10**; without a profile, trigger at 170k tokens and keep 6 messages
(`compute_summarization_defaults`, ibid.:249-286). Three things are worth stealing:

- Evicted messages are **written to the backend** at `/conversation_history/{thread_id}.md`, and the
  summary embeds that path so the agent can `read_file` its own deleted history (ibid.:1618-1623,
  `_history_path_prefix` at :594). LangChain's version just drops them.
- Before full compaction it tries **tool-arg truncation**: clip huge `write_file`/`edit_file`
  arguments in old messages, which often reclaims enough to skip summarizing entirely.
- It is recorded in a private field via `wrap_model_call` instead of rewriting `state["messages"]`,
  so the raw log survives for replay and evals (ibid.:1631-1636).

**Persistent memory** between turns, and where it lives:

- Conversation → LangGraph checkpointer, TTL 43200 min (`langgraph.json`).
- Files and worktree → the sandbox, one per thread, `sandbox_id` in thread metadata. An unreachable
  one raises `SandboxUnreachableError` and **fails the run** rather than being replaced by an empty
  one that "would destroy uncommitted work while looking like a recovery" (`server.py:395-431`).
- Per-turn worktree snapshot → git ref `refs/open-swe/turns/<user-msg-id>` (`utils/turn_checkpoint.py`).
- Review findings → LangGraph **thread metadata** on the PR's reviewer thread (`review/findings.py:1-12`).
- Plans + comments → dashboard plan store; user skills → store namespace `("user_skills", login)`
  (`dashboard/skills.py:15`); user/repo standing instructions → dashboard stores (`prompt.py:305-334`).
- Mid-run inbox and CI events → store namespaces `("queue", tid)`, `("autofix", tid)`
  (`check_message_queue.py:116,185`).

## 5. Tools

**Builtins from deepagents** (`server.py:176-186` names them so they can be reserved):
`ls, read_file, write_file, edit_file, delete, glob, grep, execute, task`. `execute` is a shell with
a 300 s default timeout; `task` spawns a subagent.

**Curated open-swe tools**, 27, in one flat list (`server.py:1122-1150`): `http_request, fetch_url,
web_search, approve_plan, enter_plan_mode, save_plan, save_user_instructions, save/delete_user_skill,
linear_{comment, create_issue, delete_issue, get_issue, get_issue_comments, list_teams,
search_issues, update_issue}, notify_automation_channel, open_pull_request, request_pr_review,
recreate_sandbox, report_platform_issue, schedule_thread_wakeup, slack_{add_reaction,
read_thread_messages, start_new_thread, thread_reply}`. Reviewer-only: `add_finding, update_finding,
list_findings, fetch_review_diff, publish_review, reply_to_finding_thread, resolve_finding_thread`.
Analyzer-only: `read_finding_outcomes, save_review_style_prompt`.

**Calling convention:** a tool is a plain async Python function with a docstring (the docstring *is*
the model-facing description; see `agent/tools/web_search.py:13-39`). Tools that need to mutate agent
state return `langgraph.types.Command(update={...})` with an `InjectedToolCallId`; tools that need to
read state take `Annotated[State, InjectedState]`. Registration is three edits — new file in
`agent/tools/`, entry in the lazy `_TOOL_MODULES` map in `agent/tools/__init__.py:5`, and a line in
the `tools=[...]` list in `server.py` (documented as such in `AGENTS.md` "Conventions").

**Two ideas above plain registration.** *Tool-output offloading*: `web_search` writes the full result
into the sandbox as chunked JSONL (500 chars/record) and returns only `results_path` + `result_chars`
(`agent/tools/_sandbox_output.py:14-40`). *Deferred schemas*: integration tools (Notion, Datadog,
LangSmith, Corridor, Currents) are absent from the tool list; one meta-tool
`load_integration_tools(names)` carries the catalogue in its description, and only a loaded tool's
schema is appended to later model calls (`agent/middleware/dynamic_tools.py:30-129`).

**Permission model.** No per-tool allow/deny list, no interrupt-to-confirm. Five overlapping layers:
plan-mode tool hiding; `ExcludeToolsMiddleware` hard-stripping tools for the chat graph; semantic
guards that parse shell command strings (`gh pr create` blocked; pushes touching `.github/workflows/`
gated on an explicit human Slack approval, `middleware/workflow_push_guard.py:1`); identity gates in
Python (`approve_plan` requires thread ownership; observability tools require an authorized email or
org membership, `server.py:688-723`); and prose (untrusted GitHub comments wrapped in a tag the prompt
forbids obeying, `prompt.py:219-223`; secrets and force-push are the only things a direct user request
cannot unlock, `prompt.py:62`). The credential is never in the sandbox — `GH_TOKEN=dummy gh …` and a
proxy injects real auth.

## 6. Loop strategies

- **Planning:** model-initiated plan mode (§3). No tracked plan items — the legacy `taskPlan` with
  per-item `completed` flags and `mark_task_completed` was deleted, and deepagents' `TodoListMiddleware`
  is not enabled.
- **Reflection:** none as a node; the prompt carries it ("your first attempt is rarely correct, so
  iterate. If something fails repeatedly, stop and analyze why", `prompt.py:59`).
- **Retry:** layered and typed. `ToolRetryMiddleware(max_retries=2, tools=["task"])` over an explicit
  transient-vs-permanent classifier (`middleware/task_retry.py:64-85`: retry 408/409/425/429/5xx and
  named timeout classes; hand `invalid_prompt`/`context_length_exceeded` back to the model as JSON;
  re-raise the rest). Model fallback on failure; a 15-min per-call timeout innermost so a wedged
  provider escalates outward to it; every tool exception becomes an error ToolMessage; orphaned tool
  calls from a cancelled run get synthetic results.
- **Verification:** by instruction, not machinery. "Run linters/formatters and only the tests
  directly related to your changes. **Never run the full test suite** … If a command fails and you
  change code to fix it, re-run it to confirm" (`prompt.py:77`). Nothing in the loop asserts tests
  ran. The real verification loop is external: CI fails → webhook → confidence-gated auto-fix run on
  the same thread (`agent/ci_autofix.py`).
- **Sub-agents:** `task` spawns an ephemeral subagent with its own context window and compiled graph.
  Two exist — `general-purpose` (inherits parent tools, `server.py:610-630`) and `browser` (Stagehand,
  `server.py:665-673`); the reviewer adds a third that reviews one disjoint file partition and returns
  candidates for the parent to validate (`reviewer.py:352-367`). Each carries its own middleware
  because "subagents compile into their own graphs, so parent middleware never wraps them"
  (`server.py:600-607`).
- **Parallelism:** only the model issuing several `task` calls in one message, which the tool
  description asks for ("Launch multiple agents concurrently when their tasks are independent",
  `subagents.py:291`). No fan-out node, no scheduler. **Self-scheduling:** `schedule_thread_wakeup`
  re-triggers the agent's own thread in 60 s – 24 h to poll for something.

## 7. Configuring a new agent

**You can't, declaratively.** No agent manifest: a new agent is a Python graph factory plus a line in
`langgraph.json` (§1); a new *subagent* is a `SubAgent` TypedDict literal. The whole surface, verbatim
from `agent/server.py:610-630`:

```python
def _general_purpose_subagent(
    model: BaseChatModel,
    skills: list[str] | None = None,
    dynamic_tools: DynamicToolMiddleware | None = None,
) -> SubAgent:
    subagent: SubAgent = {
        "name": GENERAL_PURPOSE_SUBAGENT["name"],
        "description": GENERAL_PURPOSE_SUBAGENT["description"],
        "system_prompt": OPEN_SWE_SHARED_BASE + "\n\n" + GENERAL_PURPOSE_SUBAGENT["system_prompt"],
        "model": model,
        "middleware": [
            *([dynamic_tools] if dynamic_tools else []),
            *_subagent_model_middleware(),
        ],
    }
    if skills:
        subagent["skills"] = skills
    return subagent
```

The spec accepts `name, description, system_prompt, model, tools, middleware, skills, permissions,
interrupt_on` (`deepagents/graph.py:662-740`); omitted `tools` means inherit the parent's.

What *is* declarative is **skills** — markdown + YAML frontmatter in a directory, exactly HARNESS's
`agent.md` shape. Verbatim head of `agent/skills/continual-learning/SKILL.md`:

```markdown
---
name: continual-learning
description: Nightly refinement of an existing per-repo review-style prompt using this reviewer's own finding outcomes. Read confirmed (resolved-by-commit / thumbs-up) and dismissed (thumbs-down) findings, promote the bug patterns the team actually fixes, demote the false-positive patterns, reconcile against the current prompt, and save the refined version. Use this once outcomes exist; use bootstrap-repo-analysis for a cold-start repo.
---

# Continual learning
...
```

Keys: `name` (≤64 chars, **must equal the directory name**), `description` (≤1024), optional
`license`, `compatibility`, `metadata`, `allowed-tools` (`deepagents/middleware/skills.py:44-52,
311-353`). Skills load from ordered *sources*, later overriding earlier by name ("base → user →
project → team", ibid.:8-12); only the name+description index enters the prompt, the body loads on
demand. User skills are created from the dashboard or by `save_user_skill`, stored in the LangGraph
store, and mounted as a read-only virtual `/skills/` route (`server.py:1167-1178`). Everything else
configurable — model, effort, default repo, draft PRs, always-create-PRs, auto-fix-CI, custom
instructions — is dashboard state resolved per run (`server.py:992-1052`).

## 8. Spaces and artifacts

**Space = one cloud sandbox per thread**, behind a `BackendProtocol` (`ls/read/write/edit/glob/grep`
+ `aexecute`). The clever part is `CompositeBackend`: path prefixes route to different backends, so
`/skills/` is a read-only store-backed virtual FS while everything else is the real sandbox
(`server.py:1168-1177`), and the chat graph serves PR context as virtual files under `/pr/` with *no
sandbox at all* (`agent/chat.py:1-14`). Same tools, different substrate.

Shared state between "nodes" is mostly *not* graph state: subagents get a fresh context and return
one final report string; sharing goes through the filesystem, thread metadata, or the store. Reviewer
and main agent are separate threads that communicate by dispatching runs at each other.

**Artifacts:**

- *Pull requests* — the primary one. Only `open_pull_request` may create one (attributed to the
  triggering human, open-swe as `Co-authored-by`); shell fallbacks are blocked by middleware.
- *Findings* — a durable, mutating, structured set: `add_finding` validates the anchor against the
  precomputed diff line set **at creation time** ("rather than failing at GitHub-publish time",
  `reviewer.py:8-11`); `update_finding` evolves or resolves; `publish_review` returns
  `review_id / skipped_empty_re_review / dry_run`, which the prompt forces the agent to read before
  claiming it published anything (`reviewer.py:317-333`). They live in thread metadata, so they
  survive sandbox loss.
- *Plans* — sandbox markdown → `save_plan` → dashboard page with comments and an approve button. The
  same tool doubles as "share a long response" outside plan mode (status `shared`, non-approvable) so
  Slack never gets a wall of text (`agent/tools/save_plan.py:88-95`).
- *Turn diffs* — at run start the worktree is snapshotted into `refs/open-swe/turns/<user-message-id>`
  via a scratch `GIT_INDEX_FILE` (no lock contention with the agent's own git; untracked files
  included). `GET /threads/{id}/turn-diff` reads it back, so the UI's changed-files view comes from
  git rather than from replaying edit calls — "the only way to catch edits made through `execute` and
  to drop files that were later reverted" (`AGENTS.md`; `utils/turn_checkpoint.py:1-42`).

## 9. What it gets RIGHT that HARNESS lacks

Ranked by value per unit of work.

1. **Turn checkpoints as the source of truth for "what changed" (medium)** — `crates/agent/step.rs`
   (snapshot the workspace tree at the start of every turn, keyed by the user message id),
   `crates/core` (a `TurnDiff` projection), `crates/ui` (changed-files pane). They use a git ref;
   HARNESS's VM has no persistence, so snapshot into `StorePort`. Kills "the UI missed an edit made
   through the shell", and it is the honest input to a verify step.
2. **Compaction that offloads instead of deleting (medium)** — `crates/agent/window.rs` +
   `crates/context/assemble.rs`. Write evicted turns to `/conversation_history/<run>.md` in the space
   and put that path *inside* the summary, so the agent can re-read its own dropped history. Add the
   cheaper pre-step: clip oversized tool *arguments* in old turns before summarizing at all
   (`summarization.py:1624-1627`).
3. **Tool results that return a path, not a payload (small)** — `crates/agent/tools.rs`. Output over
   N chars goes to chunked JSONL in the space; the tool returns `{path, chars}`. ~40 lines, buys back
   context on `web_search`, `execute`, and file reads immediately.
4. **Plan mode as a per-call tool filter, not a phase (small)** — `crates/agent/phase.rs` +
   `toolbox.rs`. One `plan_mode` flag in run state; `enter_plan_mode` sets it, `approve_plan` clears
   it *and re-injects the approved plan plus reviewer comments as the tool result*; the tool list is
   filtered on every model call. Reset the flag at run start so a stale `true` cannot gag a later run
   (`plan_mode.py:49-54`). Plan/ask/agent modes for ~120 lines and no new graph.
5. **Findings-style durable structured artifacts (medium)** — `crates/kernel` (a `Finding` leaf type
   + `StorePort`), `crates/agent/tools.rs` (`add/update/list/publish`). An append-and-amend set of
   typed records, capped (theirs: 6), **validated at creation time** against something checkable, and
   published by a tool whose return value the prompt forces the agent to inspect before claiming
   success. This is the missing substrate under HARNESS's "artifacts" goal.
6. **Ancestor `AGENTS.md` auto-injection on read (small)** — `crates/agent/tools.rs` read handler.
   Reading `/a/b/c.rs` appends every unread `AGENTS.md` from `/a/` and `/a/b/` as a
   `<system-reminder>`, once per path per run. Scoped rules without paying for them up front — this
   is how a "space" carries its own instructions.
7. **Skills with progressive disclosure and layered sources (medium)** — `crates/agent/space.rs` +
   `crates/context/assemble.rs`. Directory + `SKILL.md` + frontmatter, `name` must equal the directory
   name; only `name: description` enters the prompt, the body loads on demand; sources are an ordered
   list where last wins (builtin → user → project). HARNESS's `public/agents/<name>/agent.md` is
   already this shape minus the index-only injection and the layering.
8. **A route table on the workspace port (small)** — `crates/kernel` (`WorkspacePort`),
   `crates/agent/space.rs`. Prefix → backend, so `/skills/` is read-only virtual files while
   `/workspace/` is the Alpine VM, and a sub-agent can run against seeded virtual files with no VM at
   all. Worth more to a browser-only tab than it is to them.
9. **Deferred tool schemas behind a loader tool (small)** — `crates/agent/toolbox.rs`. One
   `load_tools(names)` whose description carries the catalogue; schemas append only after loading;
   calling an unloaded tool returns "load it first". Keeps a 40-tool agent at a 10-tool schema budget.
10. **Never replace a lost workspace (small)** — `crates/kernel` (typed `WorkspaceError::Unreachable`)
    + `crates/agent/supervisor.rs`. Fail the run and say so; do not hand the agent an empty VM that
    looks like a recovery. More important for HARNESS, not less, because the VM dies on reload.
11. **Four more, all small.** Deterministic prep in Rust before the first model call so no turn
    narrates setup (`reviewer.py:5-7`, `crates/agent/step.rs`); a 20-line typed transient/permanent
    retry classifier (`task_retry.py:64-85`, `crates/kernel` + `step.rs`); wall-clock wrap-up pressure
    and a visible message on round-cap exhaustion (`crates/agent/supervisor.rs`); and a test that
    parent interception does not wrap a child in its own Worker (`crates/agent/subagent.rs`).

## 10. What would be a MISTAKE to copy

**Roughly 90% of open-swe's mass is LangGraph/deepagents platform, and none of it should enter a
200-line-file Rust codebase as a concept.** `deepagents` alone is ~12.6k lines of middleware;
`create_deep_agent` is a 700-line function that is almost entirely middleware-list assembly,
exclusion-profile validation, and *verification that the exclusion config matched something* —
infrastructure defending infrastructure. Do not import Pregel/StateGraph, checkpointers,
`Command`/`Send`, `InjectedState`, reducer-annotated state channels, `multitask_strategy`, or the
middleware *framework*; steal the individual behaviors in §9 as plain functions in the loop.

- **The middleware stack as a growth strategy.** 16 entries in `get_agent`, five of them papering
  over provider bugs and malformed model output, with load-bearing ordering comments. An
  order-sensitive 16-layer chain is a debugging tax.
- **Plan mode's triplicated state and prose enforcement.** `plan_mode` is read from run state,
  `configurable`, and thread metadata with different precedence in different files
  (`approve_plan.py:95-102` vs `save_plan.py:98-101` vs `plan_mode.py:56-66`), and its rules live in
  three more (excluded-tool set, prompt block, tool docstring) — while `write_file`/`execute` stay
  callable and a 40-line "you MUST NOT" block is the only thing stopping them. One authority (the
  event log), and gate the mode in the toolbox.
- **"Always call a tool every turn."** Termination is "no tool call", so the prompt forbids the one
  thing that ends a run, and a middleware exists to undo it when it happens anyway. Pick a real done
  signal — an explicit `finish` tool or a verifier.
- **`recursion_limit = 9999`, 5000 model calls, 45-min wrap-up, 15-min per-call timeout.** Cloud
  budget numbers; a browser tab is not that. And durable domain objects in *thread metadata* —
  findings live there only because it survived sandbox eviction (`review/findings.py:5-11`); HARNESS
  has an event log and metadata-as-database would fight it.
- **The out-of-band HITL model.** Agent → dashboard page → human → newly dispatched run makes sense
  only because runs are server-side and the human is in Slack. In one tab, imitate the legacy
  `interrupt(accept|edit|respond|ignore)` *contract*, not LangGraph's resume protocol.
- **The 400-line system prompt.** Slack emoji policy, PR body templates, and dependency-vetting law
  in the same blob as the agent's identity; much of it compensates for what a tool signature could.
- **The four-graph Manager/Planner/Programmer/Reviewer split.** The thing everyone cites is the thing
  its authors deleted. They kept only the split that is a different *job with a different toolset*
  (read-only reviewer, own thread, findings artifact) and collapsed plan-vs-implement into one flag in
  one loop. Copy the conclusion, not the diagram.
- **Their doc drift** — as evidence for reading source over docs. `AGENTS.md` documents
  `ensure_no_empty_msg` and `SandboxCircuitBreakerMiddleware` as wired into the default stack; neither
  appears in `server.py`. `AGENTS.md` lists a `ci_monitor` graph; `langgraph.json` has `chat` and
  `scheduler`. `docs/CUSTOMIZATION.md` shows a `get_agent` body that no longer exists.

## 11. Citations

Current tree, `ab27a34`. `langgraph.json` (graphs, TTL, HTTP app); `agent/runtime/constants.py:1-6`
(limits); `agent/server.py:954-1241` (factory, sandbox, models, tools, middleware) with `:582-596`
plan-mode exclusions, `:176-186` deepagents builtin names, `:610-673` subagents, `:1167-1178`
composite skills backend, `:688-723` observability gating, `:395-431, 433` never-replace sandbox,
`:846-873` turn snapshot; `agent/prompt.py:53-94, 111-152, 219-223, 305-334, 340-358`;
`agent/middleware/{plan_mode.py:40-81, check_message_queue.py:116-245, timeout_wrapup.py:43-67,
notify_step_limit.py:37-88, task_retry.py:64-85, prepare_run.py:41-94, dynamic_tools.py:30-134,
subdir_agents.py:114-197, pr_creation_guard.py:1, workflow_push_guard.py:1,
sanitize_tool_inputs.py:1-8, tool_error_handler.py:1-6}`;
`agent/tools/{enter_plan_mode.py:26-53, save_plan.py:31-101, approve_plan.py:34-145,
__init__.py:5-42, _sandbox_output.py:14-40, web_search.py:13-39, schedule_thread_wakeup.py:1-29}`;
`agent/reviewer.py:1-16, 150-333, 352-367, 1405-1420`; `agent/review/findings.py:1-58`;
`agent/{analyzer.py:1-10, chat.py:1-14, scheduler.py:1-38, dispatch.py:1-20}`;
`agent/dashboard/skills.py:1-20`; `agent/skills/continual-learning/SKILL.md`; `AGENTS.md`
(their own architecture/middleware-order/conventions doc).

`deepagents==0.7.1` (`pyproject.toml:9`): `graph.py:268-400` (signature, stack ordering), `:600-944`
(assembly, subagent middleware, `create_agent`, `recursion_limit: 9_999`);
`middleware/summarization.py:1601-1660, 249-286, 594, 680`; `middleware/skills.py:1-80, 311-353`;
`middleware/subagents.py:285-306`.

Legacy TS, `d8b2997` (2025-12-08), via raw.githubusercontent.com:
`apps/open-swe/src/graphs/planner/index.ts:33-63`; `graphs/programmer/index.ts:109-241` (reviewer
subgraph, `maxReviewCount ?? 3`); `graphs/reviewer/index.ts:271-294`;
`graphs/planner/nodes/proposed-plan.ts:178-379` (the plan interrupt). Four-graph split confirmed
present at that commit and at `65b700e` (2025-07-31) via the GitHub trees API.

Unverified: whether the TS→Python rewrite landed in one commit or gradually (shallow clone, no
history); the `ci_monitor` graph referenced in `AGENTS.md` (no such module in the tree).
