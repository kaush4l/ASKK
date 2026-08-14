# VS Code / GitHub Copilot Chat — modes, agents, tools

Research target: the Ask / Edit / Agent mode split, custom chat modes, instructions files,
prompt files, and the tool/MCP model. Read on 2026-08-13.

## 1. What it is

`microsoft/vscode-copilot-chat` is MIT-licensed and was public — **it is now archived**
(README: "This project has been moved into the main VS Code repository and this repository is
now archived."). Last commit `5863f5a` 2026-05-20, version `0.44.0`. I shallow-cloned it and
read the real prompt strings, the tool-calling loop, and the built-in agent definitions; every
source citation below is from that snapshot. The Copilot backend, the Agent Host runtime and
the CLI harness are closed. The docs were restructured in 2026:
`/docs/copilot/chat/chat-modes` now **redirects** to
`/docs/agent-customization/custom-agents`, and the standalone Ask/Edit/Agent-mode pages are
gone. **The Ask/Edit/Agent "mode" vocabulary is dead. It is now "agents", and every built-in
mode is literally an `.agent.md` file.** That is the most important fact in this report.

## 2. The modes, precisely

In v0.44 the built-in modes are `ChatCustomAgentProvider` implementations that *generate an
`.agent.md` file at runtime* into extension global storage and hand back its URI
(`src/extension/agents/vscode-node/{ask,editMode,plan,explore}AgentProvider.ts`). The
generator is `buildAgentMarkdown()` in `agentTypes.ts:56-120` — the same function a
user-authored agent file is parsed by. There is no privileged mode machinery.

| | Ask | Edit | Agent (default) | Plan | Explore |
|---|---|---|---|---|---|
| Source | `askAgentProvider.ts:20-32,95-127` | `editModeAgentProvider.ts:14-47` | `agentIntent.ts` + `defaultAgentInstructions.tsx` | `planAgentProvider.ts:19-32,106-196` | `exploreAgentProvider.ts:14-42` |
| User-invocable | yes | yes | yes | yes | **no** (`userInvocable: false`) — subagent only |
| Tools | `DEFAULT_READ_TOOLS` + `renderMermaidDiagram` + `vscode/askQuestions` | **exactly `['read','edit']`** | everything enabled in the picker | `DEFAULT_READ_TOOLS` + `agent` + `askQuestions` | `DEFAULT_READ_TOOLS` |
| May change | nothing | active file + explicitly attached files only | any file, terminal, tasks, tests | only `/memories/session/plan.md` via the memory tool | nothing |
| Terminal | no | **forbidden in prose**: "Never propose or use terminal commands." | yes, per-command approval | no | no |
| Subagents | `agents: []` | `agents: []` | yes | `agents: ['Explore']` | `agents: []` |
| Model | `chat.askAgent.model` override | inherits picker | picker | `chat.planAgent.defaultModel` | fallback list: Claude Haiku 4.5 → Gemini 3 Flash → Auto |
| Handoff out | none | "Continue with Agent Mode" (`send: true`) | none | "Start Implementation" → `agent` (`send: true`), "Open in Editor" | n/a |

`DEFAULT_READ_TOOLS` verbatim (`agentTypes.ts:40-50`):
`['search','read','web','vscode/memory','github/issue_read',
'github.vscode-pull-request-github/issue_fetch',
'github.vscode-pull-request-github/activePullRequest',
'execute/getTerminalOutput','execute/testFailure']`

**What changes between modes is three things and only three things: the tool allowlist, the
markdown body prepended as system prompt, and the handoff buttons.** Not the loop, not the
context assembly, not the confirmation machinery.

The system-prompt deltas are blunt prose, not policy engines. Ask
(`askAgentProvider.ts:96-126`): "You are an ASK AGENT … You are strictly read-only: NEVER
modify files or run commands that change state." Edit (`editModeAgentProvider.ts:31-46`):
"You are a focused allowlist editing agent. … Allowed files are strictly: (1) the currently
active file and (2) files explicitly attached in the request context. … If a request requires
touching files outside the allowlist, stop and explain that Edit Mode is restricted to the
active file plus attached files." Plan (`planAgentProvider.ts:113-125`): "Your SOLE
responsibility is planning. NEVER start implementation. … STOP if you consider running file
editing tools — plans are for others to execute. The only write tool you have is
`#tool:vscode/memory` for persisting plans."

Edit mode's file restriction is enforced by prose alone — two tools, no path filter. Plan's is
enforced structurally, by giving it no write tool but memory. **The allowlist is the real
enforcement; the prose is a hint.** Copy the allowlist.

Agent mode's base prompt is `AgentPrompt` (`agentPrompt.tsx:113-141`): "You are an expert AI
programming assistant, working with a user in the VS Code editor." + identity rules + safety
rules + the per-model body from `defaultAgentInstructions.tsx:110-209`. That body is
**assembled conditionally on which tools are present** — e.g. `{!tools.hasSomeEditTool &&
<>You don't currently have any tools available for editing files. If the user asks you to edit
a file, you can ask the user to enable editing tools or print a codeblock with the suggested
changes.</>}` (`:149`). The prompt describes the tool set it was given. Seven per-family
overrides exist, selected through `promptRegistry.ts`.

**Autopilot** (2026) is a fourth thing, "an agent mode rather than a permission level":
continuous iteration, auto-approve all tools, auto-retry on errors, auto-respond to blocking
questions so the agent never stalls.

## 3. The agent-mode loop

`src/extension/intents/node/toolCallingLoop.ts:858-...`, `_runLoop`. Faithful pseudocode:

```
i = 0; lastResult = none; taskCompleted = false
loop forever:
    if lastResult and i++ >= toolCallLimit:
        if permissionLevel == 'autopilot' and toolCallLimit < 200:
            toolCallLimit = min(round(toolCallLimit * 3/2), 200)   # silent extension
        else:
            emit confirmation("Continue to iterate?",
                "Copilot has been working on this problem for a while. It can continue to
                 iterate, or you can send a new message to refine your prompt.",
                payload { copilotRequestedRoundLimit: round(limit * 3/2) },
                buttons ["Continue", "Cancel"])
            mark result.metadata.maxToolCallsExceeded = true
            break                                    # loop yields to the user
    if lastResult and yieldRequested():              # user sent a steering message
        if permissionLevel != 'autopilot' or taskCompleted: break
    result = runOne(i)                               # one model call + its tool calls
    toolCallRounds.push(result.round)
    if result.inlineSummarizationRequested and no tool calls:
        store summary on the round; continue         # context compaction, not a turn
    if response failed and permissionLevel in {autoApprove, autopilot}:
        if autopilotRetryCount < 3 and not rate-limited/quota/cancelled:
            autopilotRetryCount++; continue          # auto-retry
    if no tool calls:
        if autopilot: msg = shouldAutopilotContinue(result); if msg: inject(msg); continue
        break                                        # normal termination
```

Round cap: `chat.agent.maxRequests`, default **200** in the v0.44 fallback
(`src/extension/intents/common/agentConfig.ts:10-14`); the 2025 docs list the user-facing
default as "5 for Copilot Free users, 15 for other users". The default handler options
constant is `{ maxToolCallIterations: 15 }`
(`src/extension/prompt/node/defaultIntentRequestHandler.ts:92`). Hitting the cap is **not an
error** — it is a confirmation card offering a 1.5× extension. Autopilot self-extends to a
hard ceiling of 200.

Termination in Autopilot is an explicit tool: `task_complete`, enabled only when
`request.permissionLevel === 'autopilot'` (`agentIntent.ts:125-127`). If the model stops
without calling it, `shouldAutopilotContinue` (`toolCallingLoop.ts:367-401`) injects a nudge,
up to `MAX_AUTOPILOT_ITERATIONS = 5`: "You have not yet marked the task as complete … Do NOT
repeat or restate your previous response. Pick up where you left off. If you were planning,
stop planning and start implementing. … Do NOT call task_complete if: - You have open
questions or ambiguities — make good decisions and keep working - You encountered an error —
try to resolve it or find an alternative approach - There are remaining steps". Paired
system-prompt clause (`agentPrompt.tsx:134-135`): "Before calling task_complete, you MUST
provide a brief text summary of what was accomplished … The task is not complete until both
the summary and the task_complete call are present."

Command gate: the terminal is one tool but is **approved per command, not per tool** — "The
agent uses a single terminal tool to run terminal commands, but that tool can run any command.
Approving the terminal tool once would be too broad." Sub-commands are extracted with
PowerShell/bash tree-sitter grammars; *every* sub-command must match a `true` rule and none a
`false` rule. The docs admit the hole: "find -exec is normally blocked, but find -e\"x\"ec is
not, despite doing the same thing."

A single tool result is truncated to `MAX_TOOL_RESPONSE_PCT = 0.5` of the model's max prompt
tokens (`agentPrompt.tsx:87`).

## 4. Context window

Layers, in the order they land in the prompt:

1. **Implicit editor context** — "VS Code automatically includes the active file, your current
   selection, and the file name as context."
2. **Workspace indexing** — "By default, VS Code uses workspace indexing to automatically
   include relevant files as context based on the conversation."
3. **`#`-mentions** — `#file`, folders, symbols, `#codebase` (whole-workspace semantic
   search), `#terminalSelection`, tools like `#fetch`, tool sets by name. `@`-mentions
   (`@vscode`, `@terminal`) select a chat participant, not context.
4. **Always-on instructions** — `.github/copilot-instructions.md`, any `AGENTS.md` (root and,
   experimentally, subfolders), `CLAUDE.md` (workspace root, `.claude/`, or `$HOME`), and
   GitHub-org-level instructions.
5. **File-based instructions** — `*.instructions.md` with an `applyTo` glob, applied when the
   agent touches a matching file *or* when the `description` semantically matches the task.
6. **Prompt file** — a `.prompt.md` invoked as a slash command, which can itself name an
   `agent`, `model`, and `tools`.
7. **Agent body** — "the guidelines in the custom agent file body are prepended to the user
   chat prompt."

Ordering caveat, quoted: "If you have multiple instruction files in your project, VS Code
combines and adds them to the chat context, **no specific order is guaranteed**." There is no
precedence resolution between instruction files. There *is* precedence for tools (§5).

Compaction: the loop supports inline summarization — the model emits a summary with no tool
calls, the loop stores it on the round and continues without counting it as a turn
(`toolCallingLoop.ts` inline-summarization branch; `summarizedConversationHistory.tsx`).

## 5. Tools

Built-in families in v0.44 (`ToolName` enum): `read_file`, `create_file`, `edit_file` /
`replace_string_in_file` / `multi_replace_string_in_file` / `apply_patch`, `file_search`,
`grep_search`, `semantic_search` (`codebase`), `list_dir`, `get_errors`, `run_in_terminal`,
`get_terminal_output`, `run_task`, `run_tests`, `test_failure`, `fetch_webpage`,
`manage_todo_list`, `vscode/memory`, `vscode/askQuestions`, `agent` (subagent spawn), plus
`search_subagent` and `execution_subagent` (gated on GPT/Anthropic families,
`agentIntent.ts:113-118`).

Delegation is pushed in the base prompt when those subagents exist: "For any context
searching, use `search_subagent` to search and gather data instead of directly calling
`grep_search`, `semantic_search` or `file_search`." (`defaultAgentInstructions.tsx:118`), and
the same for `execution_subagent` vs `run_in_terminal`, reserving the raw terminal for "when
you want the entire output of a single command without truncation" (`:119`).

**Tool sets** — `.toolsets.jsonc`, created with **Chat: Configure Tool Sets**:

```jsonc
{
  "reader": {
    "tools": ["search/changes", "search/codebase", "read/problems", "search/usages"],
    "description": "Tools for reading and gathering context",
    "icon": "book"
  }
}
```

Referenced as `#reader` in a prompt, or by name in an agent's `tools:` array. Predefined sets
exist (`#edit`, `#search`). Tool names are namespaced `group/tool`; `<server name>/*` includes
every tool of an MCP server.

**Tool list priority** (docs, prompt-files page): tools in the prompt file → tools from the
custom agent the prompt file references → default tools for the selected agent.

**Approval** is two-sided per tool: *pre-approval* ("without approval", skip the dialog before
the call) and *post-approval* ("without reviewing result", skip reviewing the output before it
enters context — "relevant for tools that return external data, where the content might
contain prompt injection attempts"). Dialog scope: single use, session, workspace, or all
future invocations. `chat.tools.eligibleForAutoApproval` marks a tool never-auto-approvable.
URLs get the same two steps, and post-approval deliberately ignores Trusted Domains.

Permission levels (session-scoped, `chat.permissions.default`): **Default Approvals**,
**Assisted permissions** (an LLM judge scores each call), **Bypass Approvals**. Org-managed
rules override the session level and can still block under Bypass/Autopilot.

Hard limit: **128 tools per request.** Above `github.copilot.chat.virtualTools.threshold`,
tools collapse into virtual grouped tools.

## 6. Custom agents (was: custom chat modes)

`.chatmode.md` is dead: `copilotCli.ts:292-294` — "Skip legacy `.chatmode.md` files — they are
a deprecated format". The replacement is `.agent.md`
(`AGENT_FILE_EXTENSION = '.agent.md'`, `src/platform/customInstructions/common/promptTypes.ts`).

The historical `.chatmode.md` had exactly three frontmatter fields — `description`, `tools`,
`model` — and one real example, quoted verbatim from the 2025-08-12 docs
(`vscode-docs@2fb34d6 docs/copilot/customization/custom-chat-modes.md`):

```markdown
---
description: Generate an implementation plan for new features or refactoring existing code.
tools: ['codebase', 'fetch', 'findTestFiles', 'githubRepo', 'search', 'usages']
model: Claude Sonnet 4
---
# Planning mode instructions
You are in planning mode. Your task is to generate an implementation plan for a new feature or for refactoring existing code.
Don't make any code edits, just generate a plan.
```

The current `.agent.md`, quoted verbatim from the live docs, is the same file with more
fields:

```markdown
---
description: Generate an implementation plan for new features or refactoring existing code.
name: Planner
tools: ['web/fetch', 'search/codebase', 'search/usages']
model: ['Claude Opus 4.5', 'GPT-5.2']  # Tries models in order
handoffs:
  - label: Implement Plan
    agent: agent
    prompt: Implement the plan outlined above.
    send: false
---
# Planning instructions
You are in planning mode. …
```

Every `.agent.md` frontmatter field: `description`, `name`, `argument-hint`, `tools`,
`agents` (subagent allowlist; `*` = all, `[]` = none), `model` (string or ordered fallback
array), `user-invocable`, `disable-model-invocation`, `infer` (deprecated), `target`
(`vscode` | `github-copilot`), `mcp-servers`, `handoffs` (`.label`, `.agent`, `.prompt`,
`.send`, `.model`), `hooks` (preview; `PostToolUse` etc., agent-scoped).

Locations: workspace `.github/agents/`, workspace Claude format `.claude/agents/`, user
`~/.copilot/agents`. "VS Code detects **any** `.md` files in the `.github/agents` folder of
your workspace as custom agents." The Claude format is accepted natively (`name`,
`description`, `tools` as a comma-separated string, `disallowedTools`) and "VS Code maps
Claude-specific tool names to the corresponding VS Code tools."

Resolution vs instructions files: they do not compete. The agent body is prepended to the user
prompt for the selected agent only; instructions files are additive context applying to every
request regardless of agent. `applyTo: '**'` makes one always-on; no `applyTo` means never
auto-applied but attachable by hand. Searched recursively under `.github/instructions/`,
`.claude/rules/`, `~/.copilot/instructions`, `~/.claude/rules`, each toggleable via
`chat.instructionsFilesLocations`.

## 7. Head-to-head with HARNESS `public/agents/<name>/agent.md`

| Concern | VS Code | HARNESS | Verdict |
|---|---|---|---|
| identity | `name`, `description`, `argument-hint` | `name`, `description` | add `argument_hint`; it is one string and it is what the composer placeholder shows |
| system prompt | markdown body | markdown body | same |
| model | string **or ordered fallback array** | `model` string | HARNESS missing fallback list — cheap, high value with flaky BYO endpoints |
| sampling | none (server-side) | `temperature` | HARNESS ahead |
| tools | `tools: [...]` incl. tool sets and `server/*` globs | `tools: [...]` flat names | HARNESS missing grouping/globbing |
| subagents | `agents: [...]`, `*`, `[]` | subagents are just tool names | HARNESS conflates the two axes; separating them is what makes Plan's `agents: ['Explore']` legible |
| visibility | `user-invocable`, `disable-model-invocation` | none | HARNESS missing: an Explore-style agent must be hidden from the picker but callable by a parent |
| handoff | `handoffs[]` with label/agent/prompt/send/model | none | **the biggest gap** |
| round cap | `chat.agent.maxRequests`, extensible mid-run | `max_rounds` fixed per agent | HARNESS cannot extend on user consent |
| compaction | inline summarization in-loop | `compact_at`, `keep_recent` | HARNESS ahead — declarative and legible |
| workspace | implicit, one folder | `space` (shared fs + memory) | HARNESS ahead |
| hooks | `hooks: PostToolUse` per agent | none | skip; see §10 |
| always-on rules | `copilot-instructions.md` / `AGENTS.md` / `CLAUDE.md` | none | HARNESS missing |
| glob-scoped rules | `*.instructions.md` + `applyTo` | none | HARNESS missing |
| invocable prompts | `.prompt.md` slash commands | none | HARNESS missing |

VS Code over-specifies: four accepted always-on instruction filenames (`copilot-instructions.md`,
`AGENTS.md`, `CLAUDE.md`, org-level) with *no guaranteed ordering* between them; two parallel
agent formats (`.agent.md` and Claude `.claude/agents`); `infer` deprecated but still parsed;
`target: vscode | github-copilot` leaking deployment into the persona file.

## 8. Confirmation and undo — the UX contract

Two generations; the newer one is the one to copy.

*Old (extension host, still live for legacy sessions):* edits land as **pending** — squared-dot
indicator in Explorer and tabs, state survives a restart, overlay controls give per-hunk
Up/Down navigation with **Keep** / **Undo** per file or for all, plus **Undo/Redo Last Edit**
in the title bar and **Undo Edits** on hover over any past request.

*New (Agent Host):* "The agent applies and saves edits directly in the session's folder or
isolated Git worktree. These edits **don't have a pending approval state**, so you don't need
to keep or undo each edit before you continue." Review moves to git-shaped surfaces: diff view,
Changes panel, Source Control, PR. Feedback is range-based — select a range, **Add Feedback**,
**Submit Feedback**; "The agent reads your comments, makes the requested edits, and resolves
each comment."

The safety net is **checkpoints**, and this is the precise contract:

- A snapshot of affected files is taken **before processing each request** (`chat.checkpoints.enabled`).
- **Restore Checkpoint** on a past request rolls the workspace back to that point *and removes
  every subsequent request from the conversation history*. Conversation and filesystem move
  together — that is the whole idea.
- **Redo** after restoring recovers what was undone.
- **Editing a past request** reverts that request's changes and all later ones, then resends
  the edited prompt (`chat.editRequests`).
- **Fork Conversation** on a request makes an independent session containing history up to
  that checkpoint.
- `chat.checkpoints.showFileChanges` shows per-request changed files and ±line counts so you
  can judge a checkpoint before restoring it.
- Explicit disclaimer: "Checkpoints are temporary and don't replace Git version control."

Mid-run control is a first-class three-way, not a stop button. While a request runs the Send
button becomes a dropdown: **Add to Queue** (waits, current response finishes uninterrupted),
**Steer with Message** (signals the current request to yield *after finishing the current tool
execution*, then processes the new message), **Stop and Send** (cancel outright). Default is
`steer`, via `chat.requestQueuing.defaultAction`. Pending messages are drag-reorderable. In
the loop this is the `yieldRequested()` check at the top of each round.

## 9. What it gets RIGHT that HARNESS lacks

Ranked. Each names where it lands.

1. **Modes are agents. Delete the mode concept.** Ask/Edit/Plan are `.agent.md` files built by
   the same `buildAgentMarkdown()` a user's file is parsed by. HARNESS should ship
   `public/agents/{ask,plan,agent}/agent.md` and have the mode switcher be an agent picker.
   Lands in `public/agents/` + the picker in `crates/ui`. **Small.** Highest ratio in this
   document.
2. **The tool allowlist *is* the mode.** Plan cannot edit because it has no edit tool, not
   because it was told not to. Enforce at `crates/agent/toolbox.rs` when resolving an agent's
   `tools:`, and make a read-only tool set the default for a plan-shaped agent. **Small.**
3. **Handoffs.** `handoffs: [{label, agent, prompt, send, model}]` renders buttons after a
   response; `send: true` auto-submits into the target agent. This is goal→plan→implement
   without an orchestrator. Frontmatter in `crates/agent/phase.rs`/`state.rs`, buttons in
   `crates/ui`, and the click is one `Request` through the existing seam. **Medium.**
4. **`max_rounds` as a negotiable budget, not a wall.** On exhaustion emit a confirmation
   ("Continue to iterate?") carrying `round(limit * 3/2)` and resume on accept. Today HARNESS
   just stops. `crates/agent/step.rs` + one `Response` variant. **Small.**
5. **Checkpoints tied to requests.** Snapshot the workspace before each request; restoring
   truncates the event-log projection *and* the filesystem together. HARNESS already has the
   append-only `EventLog` and a `WorkspacePort` — this is a projection plus a `durable`
   snapshot, and the biggest confidence win for an agent that can `rm`. `crates/core`
   (projection), `crates/kernel` (snapshot/restore), `crates/adapters_web`. **Large.**
6. **Steer with a defined yield point.** "yield after finishing the current tool execution" —
   not mid-tool, not next-token. Give the existing steering the explicit three-way
   (queue/steer/stop) at the round boundary in `crates/agent/step.rs`. **Small.**
7. **Instructions files with `applyTo` globs.** Always-on project rules plus glob-scoped rules
   layered under every agent. HARNESS has nothing between the agent body and the user message.
   `crates/context/assemble.rs` + `public/instructions/`. **Medium.**
8. **A hidden read-only research subagent on a cheap model.** Explore: `userInvocable: false`,
   read tools only, fallback Haiku → Flash → Auto, "Safe to call in parallel. Specify
   thoroughness: quick, medium, or thorough." `crates/agent/subagent.rs` + frontmatter.
   **Small.**
9. **Per-command terminal approval, not per-tool.** One `exec` tool, per-command allow/deny
   rules, sub-commands parsed out, all must pass. Approving `git status` forever while `rm -rf`
   always prompts. `crates/agent/tools.rs` + a confirmation `Response`. **Medium.**
10. **Two-sided tool approval** — may it run, and may its output enter context. The second
    exists because tool output is an injection vector; directly relevant to HARNESS's
    `web_search`/fetch. `crates/agent/toolbox.rs`. **Medium.**
11. **Prompt-file slash commands** with their own `agent`/`tools`/`model` and a stated priority
    order (prompt file > referenced agent > agent default). `crates/context` +
    `public/prompts/`. **Medium.**

## 10. What would be a MISTAKE to copy

- **Edit mode.** A whole mode whose value is "only touch the active file", enforced by prose
  the model can ignore. VS Code demotes it itself: its only handoff is "Continue with Agent
  Mode".
- **Four filenames for always-on instructions with no guaranteed merge order.** Pick one and
  define the order.
- **`.chatmode.md` as a name or shape.** Deprecated in the source. Do not build toward it.
- **128 tools per request.** A number that exists because someone shipped a marketplace. If
  HARNESS needs virtual tool grouping, the agent roster is wrong.
- **Per-agent `hooks:` shelling out.** No shell to hook in a browser tab, and it puts arbitrary
  command execution in a config file.
- **`target: vscode | github-copilot`.** Deployment target in the persona file.
- **Assisted permissions (an LLM judging tool-call risk).** Their own docs walk it back: "A
  model-based risk assessment can make mistakes." Two model calls, one confirmation you trust
  less.
- **The autopilot nudge loop as written.** "Do NOT call task_complete if: - You have open
  questions or ambiguities — make good decisions and keep working" instructs the model to guess
  rather than ask. Keep `task_complete`; drop the five-times re-prod that punishes stopping.
- **Model-family-specific prompt files.** Seven of them in v0.44. A vendor's tax, not a design.

## 11. Citations

Source: `microsoft/vscode-copilot-chat` @ `5863f5a` (v0.44.0, archived 2026-05-20). Paths
relative to repo root; `A/` = `src/extension/agents/vscode-node/`.

- `README.md:1-7` archive notice
- `A/agentTypes.ts:9-34` AgentConfig/AgentHandoff · `:40-50` DEFAULT_READ_TOOLS · `:56-120`
  buildAgentMarkdown
- `A/askAgentProvider.ts:20-32,95-127` · `A/editModeAgentProvider.ts:14-47` ·
  `A/planAgentProvider.ts:19-32,106-241` · `A/exploreAgentProvider.ts:14-42`
- `src/extension/intents/node/toolCallingLoop.ts:66,168` · `:350-351`
  (MAX_AUTOPILOT_RETRIES=3, MAX_AUTOPILOT_ITERATIONS=5) · `:367-401` shouldAutopilotContinue ·
  `:858-905` _runLoop · `:1244-1274` hitToolCallLimit
- `src/extension/intents/common/agentConfig.ts:10-14` (`chat.agent.maxRequests`, fallback 200)
- `src/extension/intents/node/agentIntent.ts:110-135` tool gating + `task_complete`
- `src/extension/prompts/node/agent/agentPrompt.tsx:87,113-141`
- `src/extension/prompts/node/agent/defaultAgentInstructions.tsx:110-209,215-300`
- `src/extension/chatSessions/copilotcli/node/copilotCli.ts:292-294` ".chatmode.md … a
  deprecated format"
- `src/platform/customInstructions/common/promptTypes.ts` file extensions + PromptsType

Docs, read 2026-08-13, all under `https://code.visualstudio.com`:
`/docs/agent-customization/custom-agents` (frontmatter, locations, handoffs, Claude format),
`/custom-instructions` (types, `applyTo`, "no specific order is guaranteed"),
`/prompt-files` (frontmatter, tool list priority), `/tool-sets`, `/tools`;
`/docs/agents/run/approvals` (permission levels, Autopilot, pre/post approval, terminal
auto-approve, sandboxing), `/review-code-edits` (checkpoints, fork, feedback);
`/docs/chat/chat-overview` (queue/steer/stop, implicit context), `/copilot-chat-context`.

Historical, `microsoft/vscode-docs@2fb34d6` (2025-08-12):
`docs/copilot/customization/custom-chat-modes.md` (the three `.chatmode.md` fields, verbatim
Plan example), `docs/copilot/chat/chat-agent-mode.md:111,138,319` (maxRequests 5 free / 15
other, 128-tool limit), `docs/copilot/chat/copilot-edits.md:66-92` (Keep/Undo, pending-edit
persistence).

Unverified: the Agent Host runtime, Copilot CLI harness internals, and the Assisted
permissions judge prompt are closed and were not read.
