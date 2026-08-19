# PARITY — do we match Hermes and DeepSeek at defining an agent and getting a task done?

Bar-raiser assessment, 2026-08-19, against `main` @ `9368d7e`. Every claim about this repo cites
`path:line` read this session. Every claim about a competitor cites a URL opened this session.
This supersedes `BARRAISER.md` (2026-08-12) on this axis only; that document compared *product
surfaces* (dashboards, history, artifacts) and is stale in places — it cites
`crates/adapters_web/src/cheerpx.rs`, deleted at `51199eb`, and says "Zero network tools" which
`crates/agent/src/tools.rs:191` has since disproved.

Workspace state at time of writing: `cargo test --workspace` → **496 passed, 0 failed, 4 ignored**.
`gh-pages` is at `81d2826` (deploy of `187dc39`), three commits behind `main` — the Faculty seam,
the CheerpX deletion and the tree repair are **not live**.

**One caveat on gap 2.** A concurrent, uncommitted change to the working tree is already adding a
`memory` faculty and granting `write_agent` and `spawn_agent` to `main`. That closes two thirds of
gap 2 while this was being written. `web_search` is still not granted, and no agent holds
`role: critic`. The assessment below is against the committed tree; adjust gap 2 for whatever lands.

---

## The verdict

**No — not yet, and the gap is not where the last five rounds of architecture work were spent.**
On *defining* an agent we are ahead of all three: a single `agent.md` with a flat, refusing
frontmatter (`crates/agent/src/spec/yaml.rs:72-97`) expresses identity, model, temperature, engine,
role, a declared loop, a tool allowlist, faculties, a shared space, compaction budgets, a round
ceiling and a pass budget — and every value that cannot be honoured is *refused rather than
defaulted* (`crates/agent/src/spec/mod.rs:167-197`). Hermes has no per-agent file at all; an agent
there is a whole home directory (https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/profiles.md).
DeepSeek's agent file is a dependency-injection wiring list you must understand realm isolation to
author (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/config/agent-presets/minimal/agent.cordis.yml).
Eliza's is a persona schema with a plugin array and no goal, loop or verification field at all
(https://docs.elizaos.ai/agents/character-interface). We also have something none of them has: a
loop the *message* selects (`crates/agent/src/strategy.rs:43-57`) and a mechanical verify gate that
refuses to let "done" stand over an unverified edit (`crates/agent/src/verify.rs:94-100`) — Hermes
ships the same idea *opt-in* (docs say `verify_on_stop: false`,
https://hermes-agent.nousresearch.com/docs/user-guide/configuration; the shipped example says
`auto`, https://raw.githubusercontent.com/NousResearch/hermes-agent/main/cli-config.yaml.example —
the two disagree), and DeepSeek states the absence outright: *"there is no independent evaluator or
verifier deciding whether the objective is actually complete; evaluator policy and evaluator-driven
continuation are deferred"*
(https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-ralph/README.md).
It is also worth the owner knowing what the DeepSeek half of the bar currently *is*: the repo is six
days old, at `0.1.0-rc.7`, and its own README promises compatibility-breaking changes
(https://api.github.com/repos/deepseek-ai/deepseek-harness,
https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.md).
**Where we lose is not the definition. It is the second half of the sentence — *and get the task
done*.** The agent that ships can call no network tool, cannot start another agent, cannot author
one, and its shell is a stock busybox Alpine with no Python, no node, no git, no compiler and no
network, in which nothing survives a reload (`public/agents/main/agent.md:31-46`,
`image/Dockerfile:5-9,25-42`, `crates/adapters_web/src/c2w.rs:23-28`). Hermes and DeepSeek run
against your real machine with real toolchains and real internet. A harness that defines agents
beautifully and hands them a machine that cannot install anything, reach anything, or keep
anything does not match them on getting a task done. That is one number of gaps away from being
true, and none of them is an architecture problem.

---

## The comparison table — agent definition and task completion only

| Capability | This project | Hermes Agent | DeepSeek Harness | ElizaOS |
|---|---|---|---|---|
| **Agent definition artifact** | One `agent.md`: YAML frontmatter + markdown body = system prompt (`crates/agent/src/spec/mod.rs:98-112`); folder name is the fallback identity (`:124-147`) | **No per-agent file.** An agent is a profile *directory* — its own `config.yaml`, `.env`, `SOUL.md`, memory, sessions, skills, state DB ([profiles.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/profiles.md)) | A preset *directory* holding `agent.cordis.yml`, a top-level YAML **list of DI plugin rows** ([minimal/agent.cordis.yml](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/config/agent-presets/minimal/agent.cordis.yml)); `preset.yml` is display metadata only ([preset.yml](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/config/agent-presets/minimal/preset.yml)) | A `Character` object — TS or JSON: `name`, `bio`, `system`, `style`, `topics`, `adjectives`, `messageExamples`, `plugins`, `settings`, `secrets` ([character-interface](https://docs.elizaos.ai/agents/character-interface)) |
| **Malformed value behaviour** | **Refused, never defaulted** — `engine: reakt`, `compact_at: lots`, an unparsable `tools:` line are typed errors (`crates/agent/src/spec/yaml.rs:99-157`); one bad file costs that agent, not the boot (`spec/loader.rs:22-32`) | Unverified | A broken preset is *listed with a `broken:` reason*, not skipped (repo `packages/preset/agent-presets/README.md`, unverified by direct fetch) | Unverified |
| **Declared loop / stages** | `stages: [...]` in the file, from a closed set of six (`crates/agent/src/stages.rs:47`); a list with no acting stage is refused (`spec/mod.rs:183-189`) | **No mode enum.** Plan mode is a `SKILL.md`; run modes are transport-level (`/goal`, `/loop`, cron, kanban) ([goals.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/goals.md), [loops.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/loops.md)) | No `engine:` field. A preset chooses *which policy plugins mount* (`plan-mode`, `tool-goal`, `tool-ralph`) — composition, not loop selection ([agent.cordis.yml](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/config/agent-presets/minimal/agent.cordis.yml)) | One hardcoded react-to-message cycle in `plugin-bootstrap` ([message-flow](https://docs.elizaos.ai/plugin-registry/bootstrap/message-flow.md)); ordering is a numeric `position` on providers |
| **The loop adapts to the message** | **Yes, and uniquely.** `strategy` is one cheap call that votes `answer` / `react` / `project` and *rewrites the stage list for the turn* (`crates/agent/src/strategy.rs:71-83`, `stages.rs:134-139`); unreadable votes fail to the middle (`strategy.rs:20-25`) | No — the operator picks `/goal`, `/loop`, plan skill | No | No |
| **Stage prompts live in the agent file** | **No — in Rust** (`crates/agent/src/brief.rs:22-52`). The stated goal is "agent details fully present in the agents folder"; the plan/verify/critique briefs are code | Plan brief is a `SKILL.md` — data | Plan-mode prompt is a `config.section` string in the preset YAML — data | `system` + `templates` are Character fields — data |
| **Tool grant model** | Non-empty `tools:` **is the whole allowlist**; empty means every built-in plus faculty tools; checked at dispatch, not by prose (`crates/agent/src/subagent.rs:55-93`, `toolbox.rs` `check`) | `approvals.mode: manual\|smart\|off` + toolsets; enforcement is a gate chain (repo `tools/approval.py`, unverified line) | `ctx.tools.restrict(filter)` — explicitly *visibility composition, not an authority boundary* (repo note, unverified by direct fetch) | Capability = the `plugins` array; no allowlist concept ([character-interface](https://docs.elizaos.ai/agents/character-interface)) |
| **Shell / filesystem** | `exec`, `read_file`, `write_file`, `list_files`, `find_files`, `observe`, four process tools (`crates/agent/src/workspace.rs:22-96`) — but see *the machine*, below | `terminal` + file tools on the host cwd, unsandboxed by default; 7 pluggable backends | `bash`, `bash`(persistent PTY), `pwsh`, `read`/`write`/`edit`/`glob`/`grep`/`str_replace_editor`, 6 `terminal_*`, `job_*`, `lsp` ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)) | Not in core. `@elizaos/plugin-shell` 1.2.0, `@elizaos/plugin-code` 2.0.0-**alpha**.1 (npm registry) |
| **The machine the shell runs on** | **Stock `alpine:3.24.1` minirootfs, busybox only. No `apk add` — there is no network in the guest. No python, node, git, curl, make or compiler** (`image/Dockerfile:5-9,25-42`). **Nothing written survives a reload** (`crates/adapters_web/src/c2w.rs:23-28`) | Your actual machine (or docker/daytona/modal/ssh backends) | Your actual machine; OS-native sandboxing (bwrap/landlock/seatbelt), file-effects only | Your actual machine, Node 23.3+/Bun + a Postgres-family DB ([installation](https://docs.elizaos.ai/installation.md)) |
| **Web access for the agent** | `web_search` exists (`crates/agent/src/tools.rs:191-199`) — **but the shipped `main` does not name it** (`public/agents/main/agent.md:31-46`). No fetch, no page open | `web_search`, `web_extract`, browser, computer-use (docs `features/web-search.md`, `browser.md` listed at repo `website/docs/user-guide/features/`) | `web_search` + `web_fetch` ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)) | `@elizaos/plugin-browser`, WEB_SEARCH service type — plugins, not core |
| **MCP** | **None.** The string appears twice in the tree, both in comments (`crates/agent/src/calls.rs:145`, `docs/ALIGNMENT.md:74`) | `mcp_servers:` in the same `config.yaml` — stdio or HTTP, per-server `tools.include/exclude`, OAuth; each becomes an `mcp-<server>` toolset. `hermes mcp serve` runs Hermes *as* an MCP server ([mcp](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)) | `@deepseek-ai/dsh-mcp-client` as a plugin row (stdio or HTTP) ([mcp-client README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/mcp/mcp-client/README.md)); plus an ACP server/client and hook bridges for the Claude Code and Codex dialects ([hooks README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/README.md)) | `@elizaos/plugin-mcp` 1.8.2 (npm registry) |
| **Skills (instruction on demand)** | `list_skills` / `read_skill`, `skill.md` + frontmatter, two-stage disclosure, pure functions of compiled-in text (`crates/agent/src/skills.rs:33-75,135-177`). **Two skills ship** (`public/skills/index.json`) | `SKILL.md` per skill, three-level progressive disclosure, every skill also a slash command (repo `website/docs/user-guide/features/skills.md`) | `skill` tool + `<available_skills>` catalog of name+description only; skills travel inside the preset dir ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md), `@deepseek-ai/dsh-tool-skill`) | `knowledge` field + `@elizaos/plugin-knowledge` (RAG), not on-demand instruction |
| **Sub-agents / delegation** | A peer agent named in `tools:` becomes a tool; `spawn_agent(agent, goal)` starts an installed one (`crates/agent/src/tools.rs:167-177`, `subagent.rs:180-197`). Each gets its own Worker. **`main` names neither** (`public/agents/main/agent.md:31-46`) | `delegate_task(goal, context, max_iterations, tasks[], role, background)`; children inherit the parent model and **inherit toolsets but cannot widen them**; leaf children lose `delegate_task`/`clarify`/`memory`; `max_spawn_depth` 1 (range 1–3) ([delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)) | `SubagentStartRequest` carries **`outputSchema` (object-rooted JSON Schema for structured results)**, **`toolFilter`**, **per-child `persona`**, `maxDepth`; one-shot or continuable; providers include **`subagent-claude-code` and `subagent-codex`** — it delegates to other vendors' harnesses ([subagent.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/subagent.md)) | Co-presence in a room, not delegation ([add-multiple-agents](https://docs.elizaos.ai/guides/add-multiple-agents.md)) |
| **Standing goal across turns** | **None.** `passes:` laps the stage list within *one* turn, budget default 1 (`crates/agent/src/passes.rs:41-62`, `spec/defaults.rs:30`) | `/goal` — standing objective, judge model each turn, **completion contract** with a `verification` field, **quality gates** (shell commands that must pass before judging), `wait` verdicts on background PIDs, 20-turn budget ([goals.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/goals.md)) | `create_goal`/`get_goal`/`update_goal` with durable phases and `maxGoalRounds`; `ralph` runs fresh children per round with a validated `{status, summary, evidence[], nextSteps[], blocker}` handoff ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)) | No. "Task" = a background cron job returning `Promise<void>` ([background-tasks](https://docs.elizaos.ai/guides/background-tasks.md)) |
| **Verification that a task is done** | **A real mechanical gate.** A turn that wrote a file and ran nothing since cannot answer; the model is nudged twice, then the answer lands with an ending that says what is unknown (`crates/agent/src/verify.rs:41-108`, `ending.rs:56-60`). Log order *is* the freshness rule (`verify.rs:63-80`) | Same idea, richer, **and ahead of us**: a policy-only nudge over an evidence ledger ([verification_stop.py](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/agent/verification_stop.py) — *"intentionally policy-only … never runs checks itself"*), plus `/goal` **quality gates: shell commands that must exit 0, run before the judge each turn, 3 retries, auto-pause on exhaustion** ([goals.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/goals.md)). Opt-in: docs say `verify_on_stop: false` ([configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration)), example says `auto` | **Explicitly none.** *"there is no independent evaluator or verifier deciding whether the objective is actually complete … deferred"* ([tool-ralph README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-ralph/README.md)); completion is worker self-declaration | Runtime: none. Dev-time `elizaos scenario` YAML with `string_contains` / `regex_match` / `llm_evaluation` ([scenario](https://docs.elizaos.ai/cli-reference/scenario.md)) |
| **Independent critic** | `role: critic` is a real seam — a separate agent, own Worker, no sight of the conversation; only bare `PASS` clears (`crates/agent/src/critic.rs:28-40`), and a caller cannot report ANSWERED over a non-pass (`ending.rs:47-55`). **No critic agent ships** — the only one is a test fixture (`crates/agent/tests/agents/critic.md:16`), so in the product the fold is always `None` | Background review fork writes skills/memory; not a gate on the answer (unverified) | **Absent, deliberately** — four "no independent evaluator … deferred" notes across `packages/goal/*` and `tool-ralph` (repo READMEs, unverified by direct fetch) | None |
| **Round / budget ceiling** | `max_rounds` default **64**, per turn, hard and deterministic (`crates/agent/src/spec/defaults.rs:12`, `step.rs:186`); `passes` spans laps without multiplying it (`passes.rs:20-24`) | `agent.max_turns: 500` ([configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration)); `/goal` default 20 continuation turns ([goals.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/goals.md)) | **No round counter in the loop.** A turn closes on no-tool-calls + no queued steering + no `concludesTurn`; caps live in the goal domain and `ralph` (`maxRounds`, cap 256) ([core.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/core.md), [tool-ralph README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-ralph/README.md)) | No documented step cap on action plans ([action-planning](https://docs.elizaos.ai/guides/action-planning.md)) |
| **Typed ending** | Yes: `answered`, `no answer`, `round ceiling`, `pass ceiling`, `critic faulted`, plus the unverified-change ending, all as one `core.ended` fact (`crates/agent/src/ending.rs:26-60`) | 14+ named `_turn_exit_reason` values (unverified line) | Five loop exits (unverified line) | `RUN_ENDED` with completed/error ([runtime-and-lifecycle](https://docs.elizaos.ai/agents/runtime-and-lifecycle)) |
| **Mid-run steering / stop** | Both, as facts in the log (`crates/agent/src/steer.rs:24-30`, `stop.rs:19-24`) | `/queue`, `/steer`, `/redirect`, `/stop`, `/busy` (repo `website/docs/reference/slash-commands.md`, unverified line) | `send_message`, `interrupt_agent` ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)) | Not documented |
| **Human approval on a dangerous action** | **None.** The allowlist is the whole gate; nothing prompts before `exec` (`crates/core/src/workspace/gate.rs:21-28`). Blast radius is a network-less throwaway VM | `approvals.mode: smart|manual|off` plus a hardline blocklist that survives `--yolo`, deny globs and protected paths. **Caveat: the dangerous-command check is skipped entirely on the docker/singularity/modal/daytona/vercel-sandbox backends** ([security](https://hermes-agent.nousresearch.com/docs/user-guide/security)) | `sandbox/mode` x `approval/policy` as named presets; approval is **fail-closed** — callers fail unless the outcome is `allowed-once`; OS-level enforcement via bwrap/Landlock, Seatbelt, Windows ACL ([approval.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/approval.md), [sandbox.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/sandbox.md)) | Not documented |
| **Wire protocol for tool calls** | **Text.** The request body carries `messages`, `model`, `temperature` and nothing else — no `tools` array (`crates/context/src/openai.rs:51-56`); calls are parsed out of prose, layout carrying the batch schedule (`crates/agent/src/calls.rs:20-28`). Native `tool_calls` are read defensively and rendered back into the text syntax (`openai.rs:118-140`) | Native OpenAI function calling; the XML `<tool_call>` convention is a *training* format only (repo `agent/agent_runtime_helpers.py`, unverified line) | Native tool schemas; `output` schema is mandatory per tool and validated ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)) | XML block parsed from the reply, 3 retries ([message-flow](https://docs.elizaos.ai/plugin-registry/bootstrap/message-flow.md)) |
| **Authoring an agent from inside the product** | Yes — `write_agent` tool (`crates/agent/src/tools.rs:155-166`) and `POST /agents` from the UI (`crates/core/src/agents/authoring.rs:44`); a new agent is data, indistinguishable from built-ins (I9) | `hermes profile create <name>` — a shell command, not an agent capability ([profiles.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/profiles.md)) | **Copy-only.** `copy(from, id)` duplicates a directory; no caller supplies composition text (repo README, unverified by direct fetch) | Edit a Character file and restart |
| **Roster that actually ships** | **One agent** (`public/agents/index.json`) and two skills | Bundled skills seeded per profile; 59 toolsets | Four presets: `standard`, `code`, `cordis`, `minimal` ([contents API](https://api.github.com/repos/deepseek-ai/deepseek-harness/contents/apps/cli/config/agent-presets)) | 90+ plugins claimed; registry JSON 404s today |
| **Maturity** | 496 tests, one live-model test behind `--ignored` (`crates/agent/tests/live.rs:13-16`); site 3 commits stale | 232,773 stars, MIT, created 2025-07-22, v0.20.4 on 2026-08-18, releases every 1-3 days ([GitHub API](https://api.github.com/repos/NousResearch/hermes-agent), [releases](https://api.github.com/repos/NousResearch/hermes-agent/releases?per_page=10)) | 164,382 stars, MIT, TypeScript — but **created 2026-08-13, six days old, `0.1.0-rc.7`, breaking changes promised** ([GitHub API](https://api.github.com/repos/deepseek-ai/deepseek-harness), [README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.md)) | 19,095 stars, MIT, pushed 2026-08-19; `@elizaos/core` stable is **1.7.2 from January**, 2.0 still alpha/beta ([npm](https://registry.npmjs.org/@elizaos/core)) |

---

## The gaps, ordered by what they cost the owner's stated goal

### 1. The machine cannot do the work — busybox, no network, no persistence
`image/Dockerfile:5-9` states it: *"THERE IS NO NETWORK IN THIS GUEST … so `apk add` at runtime
cannot work. Whatever is not here at build time does not exist."* Lines 25-42 enumerate the entire
binary inventory: busybox applets named by our own callers. `crates/adapters_web/src/c2w.rs:23-28`
adds that the root is tmpfs — nothing survives a reload. So the shipped agent cannot run a test
suite, install a dependency, clone a repo, compile anything, or keep a file it wrote. Hermes and
DeepSeek both run `bash` on the user's real machine with real toolchains
([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)).
This is the single largest distance between "an agent is defined" and "the task got done".
**To close:** decide what class of task the browser guest is *for*, then bake exactly those
runtimes into the image (`docs/IMAGE-RECIPE.md` §2b), and give durability a real answer — either
an OPFS-backed overlay or an explicit, visible "this is a scratchpad" contract. Both are owner
gates: image size and storage. Until then every plan/verify/critique stage is checking work in a
room with no tools in it.

### 2. The shipped agent is granted almost nothing
`public/agents/main/agent.md:31-46` grants 18 tools and **omits `web_search`, `spawn_agent` and
`write_agent`** — three capabilities that exist, are tested, and are unreachable in the product.
The one agent that ships therefore cannot look anything up, cannot delegate, and cannot author a
collaborator. Meanwhile `public/agents/index.json` ships exactly one agent, and no agent holds
`role: critic`, so the critic seam built in increment 25 is dead code in production
(`crates/agent/tests/agents/critic.md:16` is the only holder in the tree).
**To close:** three lines in one file plus one new `public/agents/critic/agent.md` and a manifest
entry. This is the cheapest high-value change in this document.

### 3. No standing goal — the agent stops when the turn stops
`crates/agent/src/passes.rs:41-62` laps the stage list, mechanically, up to `passes:` (default 1,
`spec/defaults.rs:30`), and `main` does not set it. There is no objective that survives a turn, no
judge, no gate. Hermes' `/goal` has a completion contract with an explicit `verification` field,
shell **quality gates that run before the judge**, `wait` verdicts that park on a background PID,
and a turn budget
([goals.md](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/goals.md)).
DeepSeek has durable goal state plus a fresh-child Ralph loop with a cross-validated handoff schema
([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)).
**To close:** a `Goal` fact on the log, a `goal:` block in `agent.md` carrying `outcome` /
`verification` / `done_when`, and a continue-condition that is `verification exit code == 0`, not a
model's opinion. Our `verify.rs` fold and our `space` (`remember` survives compaction,
`crates/agent/src/brief.rs:59-65`) are already the two hard parts.

### 4. No MCP, and no way to add a tool without a rebuild
`crates/agent/src/faculty/mod.rs:45-53` is honest about it: *"a faculty is Rust compiled into this
binary, and a name with no arm here does not exist."* Every competitor extends by data or process:
Hermes loads MCP over stdio/HTTP/SSE, DeepSeek registers MCP tools dynamically as
`mcp__<server>__<tool>` ([tool-catalog.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/tool-catalog.md)),
Eliza has `@elizaos/plugin-mcp` 1.8.2 (npm). We have a `module` crate whose tier-1 dispatch is
unfinished. **To close:** an MCP-over-HTTP client behind a `faculty: mcp` name, with the server URL
a Settings value under the same network-allowlist gate `web_search` already uses. A browser cannot
speak stdio, so this is HTTP/SSE only — that is a real constraint, not an excuse.

### 5. Stage prompts are in Rust, not in the agents folder
`crates/agent/src/brief.rs:22-52` holds `PLAN_BRIEF`, `VERIFY_BRIEF`, `CRITIQUE_BRIEF` as string
constants. The stated architecture goal is *"the agents details fully present in the agents folder
with data and metadata."* DeepSeek puts the whole six-paragraph plan-mode policy in the preset YAML
([agent.cordis.yml](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/config/agent-presets/minimal/agent.cordis.yml)
shows `config.text` doing exactly this for persona); Hermes puts plan mode in a `SKILL.md`. Both
beat us here on our own criterion. **To close:** `briefs:` in the frontmatter with the Rust
constants as defaults — the parser already has the shapes it needs (`spec/yaml.rs:129-157`).

### 6. Delegation carries a goal string and nothing back but prose
`crates/agent/src/subagent.rs:102-133` reads one `query` string and refuses an empty one — correct
and well-argued. But there is no output schema, so a caller cannot mechanically consume a child's
answer, and no per-child persona or tool narrowing. DeepSeek's `SubagentStartRequest` carries
`outputSchema` (object-rooted JSON Schema), `toolFilter` and a per-child `persona`
([subagent.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/subagent.md));
Hermes' children inherit toolsets and provably cannot widen them
([delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)).
**To close:** an optional `returns:` on the
sub-agent call and a typed parse of the reply — `components::ResponseObject`
(`crates/agent/src/components/mod.rs:32`) is already the machinery for demanding a shape.

### 7. No approval gate on a destructive action
`crates/core/src/workspace/gate.rs:21-28` is the whole gate, and it is a capability grant, not a
confirmation. Today the blast radius is a network-less disposable VM, which is a genuine mitigation.
The moment gap 1 is closed — a guest with network or durable storage — this becomes a real hole,
and DeepSeek's rule is the one to copy: `ctx.approval` **fails closed to deny when absent**.

### 8. Text tool-calls instead of native function calling
`crates/context/src/openai.rs:51-56` sends no `tools` array. It works — `openai.rs:118-140` already
absorbs providers that answer natively anyway — and against a small local model the text convention
is defensible. But it forgoes provider-side argument validation, parallel-call semantics and
streaming tool deltas that both competitors get for free. Log this as a known cost, not a bug.

---

## The deliberate divergences, and whether the trade still holds

**Browser-only, static, no server (I1).** Nothing else in the field does this. Hermes needs a Python
daemon and a profile directory; DeepSeek is Node-hard (`node:sqlite`, `node-pty`, worker threads)
and its own web app refuses to run standalone; Eliza needs Node 23.3+, Bun and a Postgres-family DB
([installation](https://docs.elizaos.ai/installation.md)). **The trade still holds** — it is the
project's entire reason to exist, and it is what makes the agent shareable as a URL. But it is the
direct cause of gaps 1 and 4, and it should be named as such rather than absorbed silently.

**Pure core, host-tested (I3).** 496 tests, no browser, no network, and `crates/agent/tests/live.rs`
drives the real `step` against a real local model without adding an HTTP dependency. Nothing in
Hermes or DeepSeek is testable this cheaply; `conversation_loop.py` is thousands of lines of
inlined provider recovery. **Holds, unambiguously.**

**One seam, `handle(Request) -> Response` (I4).** DeepSeek reaches the same replaceability through a
vendored DI framework and ~7,400 files. We reach it with a function signature. **Holds.**

**Refuse rather than default.** `crates/agent/src/spec/yaml.rs:99-117` and `mod.rs:167-197` are a
genuinely better idea than anything the competitors do with configuration, and the reasoning
(*"a setting that parses clean and selects nothing is worse than no setting"*) is the right one.
**Holds.**

**One agent in the roster.** `public/agents/index.json` calls this "the design rather than a
starting point" — the jobs that were agents became stages. That argument is sound for the
summarizer. It is **not** sound for the critic: `crates/agent/src/critic.rs:1-21` argues at length
that a same-model `critique` stage marking its own homework is exactly what the separate agent
exists to fix, and then the separate agent does not ship. Two files in the tree disagree with each
other (`brief.rs:44-48` says the critic agent "went" into the stage; `critic.rs` says it is the
thing the stage cannot be). **This one does not hold. Pick one and delete the other.**

**No approval prompt.** Defensible *only* while the guest has no network and no durable storage.
It is a consequence of gap 1, not an independent decision, and it flips the moment gap 1 closes.

---

## What we do better — honestly, and it is not nothing

1. **The agent definition itself.** One file, flat keys, a markdown body, and every unhonourable
   value refused with a sentence telling the author what to write instead
   (`crates/agent/src/spec/yaml.rs:129-157`). Hermes has no such file; DeepSeek's requires knowing
   that a service-publishing row needs an `isolate:` realm or it collides process-wide; Eliza's
   cannot express a loop, a budget or a verification at all. On the owner's literal words — *"the
   ability to define an agent"* — we are the best of the four.
2. **A loop the message picks.** `crates/agent/src/strategy.rs` is, as far as this assessment could
   verify, unique: three routes, one cheap call, enforced by taking the tools away rather than
   asking nicely (`brief.rs:99-110`, `ask.rs:33-56`), failing to the middle route on an unreadable
   vote. Everyone else makes the *operator* choose the mode.
3. **Verification on by default.** Hermes built the better machinery and ships it opt-in
   ([configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration));
   DeepSeek documents the absence as a deliberate deferral
   ([tool-ralph README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-ralph/README.md)).
   Our fold is simpler and it is *on*, and log order being the freshness rule (`verify.rs:63-80`) is
   a genuinely elegant reduction of what Hermes needed a second SQLite database for. Neither
   competitor ships a real verifier gate; Hermes' exit-0 `/goal` gates are the closest thing in the
   field, and they are the thing to copy.
4. **The continue condition is mechanical, never the model's opinion.** `passes.rs:6-14` names the
   AutoGPT failure and refuses it. DeepSeek's goal loop asks the model whether it is done.
5. **Endings are typed facts, not the absence of a task.** `ending.rs:26-60` — six named endings,
   each a fold of one `core.ended` record, so no surface can report "finished" over an abandoned run.
6. **Capability is default-deny and the allowlist *is* the mode.** `subagent.rs:68-93` refuses to
   append anything after the filter, so a read-only agent with a workspace is representable.
   DeepSeek's equivalent is explicitly *not* an authority boundary.
7. **Zero install.** A URL versus a Mac Mini, a Python daemon, or Node 23.3 plus Postgres.

---

## The three things to build next

**1. Make the guest capable of the work, and say what it keeps.**
Decide the task class, bake those runtimes into `image/Dockerfile`, resolve the pinned digest, and
give the workspace a durable answer or a loud contract that it has none. Nothing else on this list
pays off while `exec` runs in a busybox with no network and a tmpfs root. This is the whole of gap 1
and it is an owner gate on size and storage — bring it a measured proposal, not a question.

**2. Grant the shipped agent what it already has, and ship the critic.**
Add `web_search`, `spawn_agent` and `write_agent` to `public/agents/main/agent.md`; write
`public/agents/critic/agent.md` with `role: critic` and add it to the manifest; then resolve the
`brief.rs` / `critic.rs` contradiction in favour of whichever one ships. Hours, not days, and it
converts three tested-but-dead capabilities into product.

**3. A standing goal with a data-declared check.**
`goal:` in the frontmatter carrying `outcome`, `verification` (a command), and `done_when`; a
`Goal` fact on the log; and a continue condition that is the verification command's **exit code**,
not a judge's verdict. This is the feature that turns the strategy loop from a good turn-shaper into
a workflow agent, it is the one thing both Hermes and DeepSeek have that we do not, and our
`verify.rs` fold plus compaction-surviving `space` facts are already most of it.

---

## Method and limits

Repo claims: read this session from the working tree at `9368d7e`; test counts from
`cargo test --workspace`. Competitor claims: fetched this session from the URLs inline above —
GitHub REST for repo state, `raw.githubusercontent.com` for source and docs,
`hermes-agent.nousresearch.com/docs`, `deepseek.com/harness`, `docs.elizaos.ai` and
`registry.npmjs.org`. Neither Hermes nor the DeepSeek harness publishes a benchmark for the
*harness* — Hermes has an open issue asking for one
(https://api.github.com/repos/NousResearch/hermes-agent/issues/23137), and DeepSeek's model-level
SWE-bench claims were vendor-produced and not tied to this repository, so "match them on task
completion" cannot be settled by a published number in either direction. Rows marked *unverified*
come from this repo's own prior-art studies
(`reference/agents/hermes.md`, `reference/agents/deepseek-harness.md`) whose `path:line` citations
were **not** re-opened here; they are directionally supported by what was fetched but should not be
quoted as fact. `docs/AGENT-BOUNDARY.md` is stale on two points corrected here: `temperature` is now
wired to the request body (`crates/agent/src/ask.rs:83` → `crates/core/src/effects.rs:44`) and
`engine` is now enforced rather than inert (`spec/yaml.rs:81`).
