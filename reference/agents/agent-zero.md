# Agent Zero (frdel/agent-zero)

All paths below are relative to the repo root of a `--depth 1` clone of
`https://github.com/frdel/agent-zero` at commit `baadd0d` (2026-08-12, "Remove Migrate Agents
sidebar shortcut"). Line numbers are from that commit.

## 1. What it is

Agent Zero is a Python framework for a general-purpose personal agent that lives inside a Kali
Linux Docker container and treats the whole computer as its tool surface. Repo:
https://github.com/frdel/agent-zero. Last commit 2026-08-12 — alive, and moving fast; the layout
has changed materially from the widely-blogged version (there is no `python/tools/` any more; tools
live at `tools/`, prompts at `prompts/`, and most capability now ships as **plugins** under
`plugins/_*`). The design thesis: nothing is hardcoded. Every prompt is a file, every tool is a
`.py` next to a `.md`, every lifecycle point is an overridable folder, agents spawn subordinate
agents recursively, and the primary tool is a shell.

## 2. The agent loop ("the monologue")

`Agent.monologue()` — `agent.py:387-551`. Traced:

```
monologue():                                             # agent.py:387
  loop forever:                                          # outer: survives exceptions
    loop_data = LoopData(user_message=last_user_message) # 391
    call_extensions("monologue_start")                   # 393
    loop forever:                                        # inner: the message loop, 400
      context.streaming_agent = self                     # 402
      loop_data.iteration += 1                           # 403
      call_extensions("message_loop_start")              # 408
      handle_intervention()                              # 411  <- interrupt point
      prompt = prepare_prompt(loop_data)                 # 415  (see §4)
      call_extensions("before_main_llm_call"); handle_intervention()   # 418-421
      llm_result = call_chat_model_turn(prompt,          # 474
                      response_callback=stream_callback, #   streams; every chunk calls
                      reasoning_callback=reasoning_cb)   #   handle_intervention() (425,444)
      handle_intervention(agent_response)                # 480, 486, 492
      if agent_response == loop_data.last_response:      # 494  identical reply twice
          hist_add_ai_response(...)                      # 499
          hist_add_warning(read_prompt("fw.msg_repeat.md"))  # 506
          continue                                       #      no tool executed
      else:
          hist_add_ai_response(agent_response)           # 519
          tools_result = process_llm_result_tools(llm_result)  # 523
          if tools_result: return tools_result           # 526-527  <-- THE ONLY EXIT
      except Exception as e: handle_exception("message_loop", e)   # 530
      finally: call_extensions("message_loop_end")       # 536  (history compression lives here)
    except Exception as e: handle_exception("monologue", e)        # 543
    finally: streaming_agent = None; call_extensions("monologue_end")  # 546-551
```

**Termination.** The loop has exactly one exit: a tool returns `Response(break_loop=True)`, whose
`message` bubbles up through `_execute_tool_request` (`agent.py:1222-1224`) → `tools_result` →
`return`. There is **no iteration cap and no round budget**. An agent that never calls a
loop-breaking tool runs until the user intervenes or the process dies.

**The `response` tool** (`tools/response.py`) is the canonical loop-breaker — 14 lines:

```python
class ResponseTool(Tool):
    async def execute(self, **kwargs):
        for key in ("text", "message"):
            message = self.args.get(key)
            if isinstance(message, str) and message.strip():
                return Response(message=message, break_loop=True)
        raise RepairableException("response tool requires a non-empty top-level text or message ...")
```

Its `after_execution` deliberately writes nothing to history (`tools/response.py:21-25`) — the
answer is the return value, not a history entry. Every other tool's `after_execution`
(`helpers/tool.py:54-59`) appends `hist_add_tool_result(name, text)` and returns to the loop.

**Interventions.** `AgentContext.communicate()` (`agent.py:260-277`): if a task is already running,
the incoming `UserMessage` is *not* queued — it is assigned to `agent.intervention` and walked up
the superior chain for `broadcast_level` hops (default 1). Otherwise it starts the task.
`handle_intervention()` (`agent.py:1071-1089`) is called at ~10 points per iteration including
inside every stream chunk callback; when it sees a pending intervention it flushes the running
tool's partial progress into history, appends the intervention as a user message rendered through
`fw.intervention.md`, and raises `InterventionException`. Extension
`extensions/python/_functions/agent/Agent/handle_exception/end/_40_handle_intervention_exception.py`
swallows that exception (`data["exception"] = None`), so the message loop simply restarts with the
new instruction already in history. This is a real mid-stream interrupt, not a between-turns queue.

## 3. Modes

There is no thinking/acting split and **no plan/ask/agent mode** (grep for "plan mode"/"ask mode"
finds nothing). Reasoning is one JSON field, `thoughts`, in the same object as the tool call
(`prompts/agent.system.main.communication.md:8-14`), so thinking and acting are the same LLM turn.
Provider-native reasoning tokens are streamed separately (`reasoning_callback`, `agent.py:424-440`)
but are not a distinct phase.

The closest thing to a mode is the `_goal` plugin: while a goal is active, an extras block is
injected saying "A `response` call is only an intermediate update and will not end the run"
(`plugins/_goal/prompts/agent.extras.goal.md`), converting the loop from turn-based to autonomous
until `goal(action=update, status=complete)`.

**Delegate-vs-act** is decided purely by prompt text, not by code. `prompts/agent.system.main.solving.md:12-21`:

```
3 solve or delegate
tools solve subtasks
you can use subordinates for specific subtasks
call_subordinate tool
use prompt profiles to specialize subordinates
never delegate full to subordinate of same profile as you
always describe role for new subordinate
```

and `agent.system.main.tips.md`: "always use specialized subordinate agents for specialized tasks
matching their prompt profile". The subordinate's own profile prompt counter-instructs it not to
delegate back up — `agents/developer/prompts/agent.system.main.specifics.md`: "As a subordinate
agent, directly execute code actions and development tasks - never delegate upward".

## 4. Context window

`prepare_prompt()` (`agent.py:554-613`) assembles, in order:

1. **System message** — `"\n\n".join(loop_data.system)`, built by the `system_prompt` extension
   point (`agent.py:674-679`). Files, executed in filename order:
   - `_10_main_prompt.py` → `agent.system.main.md`, which is pure `{{ include }}` glue:
     role → specifics → environment → communication → solving → tips.
   - `_11_tools_prompt.py` → globs `agent.system.tool.*.md` across **all** prompt dirs
     (`get_unique_filenames_in_dirs`), filters each through `tool_policy.filter_tool_prompt`,
     joins them into `agent.system.tools.md`, appends `agent.system.tools_vision.md` if the chat
     model config says `vision`.
   - `_12_mcp_prompt.py`, `_13_secrets_prompt.py`, `_13_skills_prompt.py`, `_14_project_prompt.py`.
   - plugin `_memory/extensions/python/system_prompt/_20_behaviour_prompt.py` runs last but does
     `system_prompt.insert(0, prompt)` — **behaviour rules land at position 0**, ahead of the
     manual.
2. **`[PROTOCOL]` block** — `agent.context.protocol.md` wrapping `loop_data.protocol_*` dicts,
   injected as a *user* message before history (`agent.py:577-582`). Omitted when empty.
3. **History** — `self.history.output()`.
4. **`[EXTRAS]` block** — `agent.context.extras.md` wrapping `loop_data.extras_*`, injected as a
   user message *after* history (`agent.py:583-588`), always present.

Both blocks have `_temporary` (cleared every iteration, `agent.py:589-590`) and `_persistent`
variants. The model is told how to read them: "messages begin `[PROTOCOL]`; protocol = must-follow
instructions / messages end `[EXTRAS]`; extras are context not new instructions"
(`prompts/agent.system.main.communication_additions.md`). Extras contributors run at
`message_loop_prompts_after`: datetime (`_60`), relevant skills (`_63`), loaded skills (`_65`),
agent info (`_70`), parallel jobs (`_72`), workdir file tree (`_75`), memory recall (plugin `_50`),
goal (plugin `_50`).

**Utility model vs chat model.** Three model roles, `chat` / `utility` / `embedding`
(`plugins/_model_config/helpers/model_config.py:18-32`). `agent.call_utility_model()`
(`agent.py:819-858`) is a one-shot system+user call used for everything the chat model shouldn't
pay for: memory query generation, memory relevance filtering, topic summarisation, memory
extraction, behaviour-rule merging, chat naming. This is a hard, load-bearing split — the expensive
model never does bookkeeping.

**History compression** (`helpers/history.py`). Three tiers: `current` topic → `topics` (sealed
topics) → `bulks` (merged summaries of topics). A new topic starts on every user message
(`hist_add_user_message` calls `history.new_topic()`, `agent.py:730`). Budget constants
(`history.py:15-25`): `CURRENT_TOPIC_RATIO 0.5`, `HISTORY_TOPIC_RATIO 0.3`, `HISTORY_BULK_RATIO
0.2`, `COMPRESSION_TARGET_RATIO 0.8`, `CURRENT_TOPIC_ATTENTION_COMPRESSION 0.65`,
`HISTORY_TOPIC_ATTENTION_COMPRESSION 0` (history topics keep only first request and last response
verbatim). Compression is a ladder: truncate the single largest oversized message
(`compress_large_messages`, `history.py:216-255`) → "attention compression", i.e. utility-model
summarise the middle `1 - ratio` of a topic's messages into one `fw.msg_summary.md` message
(`history.py:263-278`) → summarise whole topics → merge topics into bulks. It runs in a background
`DeferredTask` at `message_loop_end` (`extensions/python/message_loop_end/_10_organize_history.py`)
and the next iteration waits on it at `message_loop_prompts_before/_90_organize_history_wait.py`.

**Memory recall into the prompt.**
`plugins/_memory/extensions/python/message_loop_prompts_after/_50_recall_memories.py`: every
`memory_recall_interval` iterations (default 3), asynchronously: utility model turns
(user_message + tail of history) into a search query → FAISS similarity search over area
`main|fragments` (limit 12, threshold 0.7) and separately over `solutions` (limit 8) → optional
second utility-model pass that returns the indices worth keeping (`memories_filter`) → truncate to
5 and 3 → render `agent.system.memories.md` / `agent.system.solutions.md` into
`loop_data.extras_persistent["memories"]`. A sibling `_91_recall_wait.py` blocks the next prompt
build on the search task. Recall is periodic and *replaces* the previous block rather than
accumulating.

## 5. Tools

**Catalogue.** Root `tools/`: `call_subordinate`, `response`, `parallel`, `search_engine`,
`document_query`, `vision_load`, `notify_user`, `scheduler`, `skills_tool`, `a2a_chat`, `wait`,
`unknown` (the fallback). Plugins add the rest: `code_execution_tool` + `input`
(`plugins/_code_execution`), `memory_load`/`memory_save`/`memory_delete`/`memory_forget`/
`behaviour_adjustment` (`plugins/_memory`), `goal`, browser, text editor, office, desktop,
document query, plus any MCP server's tools.

**Calling convention** — verbatim from `prompts/agent.system.main.communication.md`:

```
- Output must be valid JSON with double quotes for all keys and string values
- No JSON in markdown fences
- Do not invent unavailable tool names and args

### Response format (json fields names)
- thoughts: array thoughts before execution in natural language
- headline: short headline summary of the response
- tool_name: use tool name
- tool_args: key value pairs tool arguments
```

```json
{
    "thoughts": ["instructions?", "solution steps?", "processing?", "actions?"],
    "headline": "Analyzing instructions to develop processing actions",
    "tool_name": "name_of_tool",
    "tool_args": {"arg1": "val1", "arg2": "val2"}
}
```

One tool per turn. `helpers/extract_tools.py:79-119` normalises aliases (`tool`/`name`,
`args`/`parameters`, a single-element `actions` wrapper, `tool_name` of the form `name:method`) and
rejects multi-action batches. The whole reply must be one JSON root
(`extract_tool_request`, `extract_tools.py:23-33`); anything else routes to
`is_misformatted_tool_request` and the model gets `fw.msg_misformat.md` back
(`agent.py:1510-1518`). A neat streaming trick: `stream_callback` (`agent.py:442-458`) tries to
parse a complete tool request out of the partial stream and returns early the moment one is valid —
cutting generation at the closing brace. The model is told to cooperate: "treat the closing `}` of
a tool call as an end-of-turn signal. terminate generation immediately".

If the provider supports OpenAI Responses-style function calling, native `function_calls` are
handled first (`agent.py:1097-1114`) and a bare text reply in that mode is auto-wrapped as a
`response` tool call (`agent.py:1124-1135`). The JSON protocol is the fallback and the default.

**Registering a Python tool.** Drop `tools/<name>.py` exporting a `Tool` subclass. `get_tool()`
(`agent.py:1554-1587`) resolves `subagents.get_paths(self, "tools", name + ".py")`, loads the first
match, falls back to `tools/unknown.py`. No registry, no import list. The interface is
`helpers/tool.py`: `execute(**args) -> Response(message, break_loop, additional)`, with optional
`before_execution` / `after_execution` / `get_log_object` / `set_progress` overrides.

**Registering a prompt-only tool.** Drop `prompts/agent.system.tool.<x>.md`. The glob in
`_11_tools_prompt.py` puts it in the system prompt automatically — the `_example` profile says so
in the file itself: "this tool is automatically included to system prompt because the file name is
`agent.system.tool.*.md`". A `.md` may have a sibling `.py` implementing
`files.VariablesPlugin.get_variables()` to compute template variables at render time; e.g.
`prompts/agent.system.tool.call_sub.py` enumerates the installed agent profiles and returns
`{"agent_profiles": {...}}`, which `agent.system.tool.call_sub.md` renders inside `{{if
agent_profiles}}`. So the prompt half and the code half are independently overridable.

**Permission model.** `helpers/tool_policy.py` + the `_tool_access` plugin. A policy is
`{mode: inherit|custom, default: allow|block, mcp_default: allow|block, allowed: [...], blocked:
[...]}` resolved per project + per agent profile; `response` and `vision_load` are
`NON_CONFIGURABLE_TOOLS` (always available). Enforcement is by *withholding the prompt*:
`filter_tool_prompt` drops the tool's `.md` from the system prompt. There is no execution-time
capability check, no user approval prompt for local tools, and no sandbox — the container is the
boundary. The only interactive gates are for provider-hosted Responses features: `computer_call`
safety checks are refused (`agent.py:1243-1261`) and hosted MCP approval requests are auto-denied
(`agent.py:1299-1321`).

## 6. Loop strategies

**Subordinates** (`tools/call_subordinate.py`). One tool call:

```python
config = initialize_agent(override_settings={"agent_profile": requested_profile})  # :66
sub = Agent(self.agent.number + 1, config, self.agent.context)                      # :69
sub.set_data(Agent.DATA_NAME_SUPERIOR, self.agent)                                  # :71
self.agent.set_data(Agent.DATA_NAME_SUBORDINATE, sub)                               # :72
subordinate.hist_add_user_message(UserMessage(message=message, attachments=[]))     # :76
result = await subordinate.monologue()                                              # :79
subordinate.history.new_topic()                                                     # :82
return Response(message=result, break_loop=False)                                   # :92
```

Key properties: the subordinate **shares the parent's `AgentContext`** (same log, same chat, same
UI stream) but has its own `History`, own profile, own resolved prompt/tool/extension paths. It is
`await`ed synchronously — the parent blocks. Its return value is whatever its `response` tool
produced, and it arrives at the parent as an ordinary tool result. Each agent holds at most **one**
subordinate slot, reused across calls unless `reset: true`; switching profile without `reset` is a
`RepairableException` (`call_subordinate.py:46-55`). Depth is `number+1` with no limit. Real
parallelism only via the `parallel` tool, which can wrap `call_subordinate` calls into background
jobs ("starts an isolated child chat under the parent chat").

**Superior messaging.** Two directions. Downward: `fw.msg_from_subordinate.md` = `Message from
subordinate {{name}}: {{message}}`. Upward on chat reload: `AgentContext._process_chain`
(`agent.py:292-311`) recursively feeds a finished agent's response to its superior as a
`call_subordinate` tool result, so a chat restored from disk with a lost Python callstack still
resumes the hierarchy. Interventions broadcast up the `_superior` chain (`agent.py:268-273`).

Long subordinate outputs are not copied: `fw.hint.call_sub.md` = "do not rewrite long responses, use
`§§include(<file>)` instead!" — `§§include(abs_path)` is expanded out of tool args by
`extensions/python/response_stream/_15_replace_include_alias.py` / `helpers/strings.py:162`, so an
agent passes a file reference where a naive design pastes 50 KB.

**Behaviour adjustment** (`plugins/_memory/tools/behaviour_adjustment.py`). The agent can rewrite
its own top-of-prompt rules: the tool sends the current ruleset plus the requested adjustment to the
*utility* model with `behaviour.merge.sys.md`, normalises the result, and writes it to
`<memory_subdir>/behaviour.md`. `_20_behaviour_prompt.py` reads that file back into
`system_prompt[0]` on every subsequent prompt build. Self-modifying system prompt, persisted, per
memory subdir.

**Error handling.** Three exception classes (`helpers/errors.py`) with three handler extensions at
`_functions/agent/Agent/handle_exception/end/`:
- `InterventionException` → `_40` clears it, loop continues (see §2).
- `RepairableException` → `_50` formats the error, appends it to history as a warning
  (`fw.error.md` / `fw.warning.md`), clears it. **The model sees its own error and retries.** This
  is how bad tool args, unknown profiles, and empty `response` args are corrected.
- anything else → `_90` logs and rewraps as `HandledException`, which kills the loop. The
  `_error_retry` plugin adds `_80_retry_critical_exception.py` to retry N times before that.

Also: a repeated identical reply gets `fw.msg_repeat.md` instead of a tool execution
(`agent.py:494-511`), and an unknown tool name gets a warning in history rather than a crash
(`agent.py:1176-1187`).

## 7. Configuring a new agent — the prompt-folder override system

**This is the transferable idea.** Everything an agent is made of — prompts, tools, extensions —
resolves through one function, `subagents.get_paths()` (`helpers/subagents.py:335-428`), whose
docstring states the order:

```python
"""Returns list of file paths for the given agent and subpaths, searched in order of priority:
project/agents/, project/, usr/agents/, plugin agents/, agents/, usr/, plugins/, default."""
```

Concretely, for `get_paths(agent, "prompts")` with profile `P` and project `J`:

1. `usr/projects/J/.a0proj/agents/P/prompts`
2. `usr/projects/J/.a0proj/prompts`
3. `usr/agents/P/prompts`            ← user's own copy of a profile
4. `plugins/<enabled>/agents/P/prompts`
5. `agents/P/prompts`                ← bundled profile
6. `usr/prompts`                     ← user-wide override of every profile
7. `plugins/<enabled>/prompts`       ← where most tools' prompts actually live
8. `prompts/`                        ← the shipped defaults

Resolution is **per file, first hit wins** — `files.find_file_in_dirs()` (`files.py:384-399`) walks
the list and returns the first existing path. So a profile overrides the two files it cares about
and inherits ~90 others. `agents/_example/prompts/agent.system.main.specifics.md` says exactly that:

```
> !!!
> This is an example prompt file redefinition.
> The original file is located at /prompts.
> Only copy and modify files you need to change, others will stay default.
> !!!

## Your role
You are Agent Zero, a sci-fi character from the movie "Agent Zero".
```

The same path list drives tools (`agent.py:1569`), Python extensions
(`helpers/extension.py:337`), and WebUI extensions. For extensions the override key is the
*filename*: `_get_extension_classes` (`extension.py:339-349`) collects classes from every path,
keeps the first occurrence of each basename, then sorts by basename — so `usr/extensions/python/
system_prompt/_10_main_prompt.py` replaces the shipped `_10_main_prompt.py` while `_11` etc. still
run, and numeric prefixes give a stable global ordering across independent sources.

**Creating a profile = a folder.** `agents/<name>/` with:

```yaml
# agents/developer/agent.yaml
title: Developer
description: Agent specialized in complex software development.
context: Use this agent for software development tasks, including writing code, debugging,
  refactoring, and architectural design.
```

plus `prompts/` (only the overridden files — `developer` overrides two:
`agent.system.main.specifics.md` and `agent.system.main.communication.md`), optionally `tools/` and
`extensions/` (see `agents/_example/`, which has `tools/example_tool.py`, an override of
`tools/response.py`, and `extensions/agent_init/_10_example_extension.py`). No `agent.yaml` = not
discoverable as a profile — that is how `_example` stays out of the picker
(`subagents.py:97-101`).

Three template features make partial overrides composable (`helpers/files.py`):
- `{{ include "file.md" }}` — resolved through the same priority list, so an included file can
  itself be overridden at a different layer (`files.py:355-367`).
- `{{ include original }}` — includes *this same filename from the next-lower-priority directory*
  (`files.py:339-353`, `_get_dirs_after`). Extend the default prompt instead of replacing it.
- `{{if expr}} ... {{endif}}` + `{{var}}` — evaluated with `simple_eval` over the kwargs and any
  `VariablesPlugin` output (`files.py:165-209`).

`description` and `context` from every enabled `agent.yaml` are injected into the delegating
agent's own prompt (`prompts/agent.system.tool.call_sub.py` → `{{agent_profiles}}` in
`agent.system.tool.call_sub.md`), and `call_subordinate` validates the requested profile against
that same list. Adding a folder is genuinely the whole install step.

## 8. Spaces and artifacts

**Filesystem.** One Kali Linux Docker container, root, persistent, described to the model in 15
lines (`prompts/agent.system.main.environment.md`): the framework at `/a0`, two Python venvs
(`/opt/venv-a0` for the framework, `/opt/venv` for task code), and instructions for calling the
WebUI's own JSON API from the shell with a CSRF token. The container is the sandbox boundary and
also the shared space — subordinates share it implicitly because they share the machine, not
because of any space abstraction. `code_execution_tool` keeps numbered persistent shell sessions
(`session: 0`, `reset: true` to kill) with `runtime=output` polling for long jobs.

**Knowledge** — `knowledge/<subdir>/{main,fragments,solutions}/`, plus `usr/knowledge`. Files are
embedded into the FAISS index at startup with an area tag; `main` is the default for anything in the
root (`plugins/_memory/helpers/memory.py:307-338`). Changed/removed files are re-indexed via
`knowledge_import.json`. Knowledge and memory share one vector store.

**Memory** — `Memory.Area = {MAIN, FRAGMENTS, SOLUTIONS}` (`memory.py:56-59`), FAISS per
memory-subdir, plus the plain-text `behaviour.md` in the same dir. Writes come from the
`memory_save` tool and from two background `monologue_end` extensions: `_50_memorize_fragments.py`
(utility model extracts durable facts from the finished conversation, quality-filtered) and
`_51_memorize_solutions.py` (extracts reusable how-to solutions). The system prompt tells the model
memories are "stable preferences facts constraints not task history".

**Outputs to the user.** Three channels: the `response` tool's text (rendered in the chat log);
`notify_user` for out-of-band notifications that do *not* end the task; and files written into the
work directory, surfaced by `helpers/media_artifacts.py` (base64 → saved artifact with size cap and
MIME sniffing) and the file browser / attachment manager. There is no first-class "artifact" object
— an artifact is a file plus a chat message pointing at it.

## 9. What it gets RIGHT that HARNESS lacks — ranked

1. **Per-file prompt override chain, not per-agent prompt blobs.** (`crates/context`, new
   `resolve.rs`; **medium**.) HARNESS puts the whole system prompt in one `agent.md` body, so a new
   agent copies everything to change one paragraph. Steal `subagents.get_paths` + `find_file_in_dirs`:
   an ordered list of prompt roots (`public/agents/<profile>/prompts/`, `public/prompts/`), resolve
   each *fragment file* independently, first hit wins. `assemble.rs` composes fragment names, not
   text. This is the single highest-leverage item in the report.
2. **`{{ include "x.md" }}` and `{{ include original }}`.** (`crates/context/render.rs`; **small**.)
   `include original` — pull in the same filename from the next-lower-priority root — is what makes
   overrides *additive* instead of forked. Twenty lines of Rust given item 1.
3. **A utility model separate from the chat model.** (`crates/kernel` `ModelPort` gains a role
   parameter; `crates/agent` callers; **small-medium**.) Summarisation, memory queries, relevance
   filtering, chat naming all go to a cheap model. HARNESS's `compact_at`/`keep_recent` presumably
   burns the main model on compaction. `agent.py:819-858` is the whole interface: `(system, message)
   -> String`.
4. **Tiered history compression with an explicit token budget split.** (`crates/agent/window.rs`;
   **medium**.) Current-topic 50% / sealed-topics 30% / bulks 20% of the history budget, compress
   toward 80%, and a *ladder* of cheapening actions (truncate biggest message → summarise the middle
   of a topic → summarise the topic → merge topics). HARNESS's `keep_recent` is a cliff; this
   degrades. `helpers/history.py:15-25, 525-585`.
5. **Mid-stream intervention.** (`crates/agent/step.rs` + `crates/kernel` `AgentPort`; **medium**.)
   An `intervention: Option<UserMessage>` checked at every await point including stream chunks,
   which flushes partial tool progress to history, appends the message, and restarts the iteration.
   HARNESS has "mid-run steering" already per memory; the transferable detail is the *flush partial
   tool output* step (`agent.py:1078-1084`) and the broadcast-up-the-superior-chain
   (`agent.py:268-273`).
6. **`RepairableException` as a first-class control-flow class.** (`crates/kernel` error enum +
   `crates/agent/step.rs`; **small**.) Typed errors already exist in HARNESS; what's missing is the
   loop policy: a repairable error is appended to history as a framework message and the model
   retries, everything else kills the run. Cheapest reliability win here.
7. **`{{if}}` + a code sidecar that computes prompt variables.** (`crates/context/render.rs`;
   **small-medium**.) `prompts/agent.system.tool.call_sub.py` computing `{{agent_profiles}}` from
   the installed profiles is why the delegation prompt is never stale. In Rust the sidecar is a
   registered function keyed by filename, not a loaded script.
8. **Prompt-only tool registration by filename glob.** (`crates/agent/toolbox.rs`; **small**.)
   Any `agent.system.tool.*.md` present in the resolved prompt dirs enters the system prompt with no
   registry edit. HARNESS lists `tools: [...]` in frontmatter — keep that as the *allow* list but
   let the description text come from an overridable file.
9. **`§§include(path)` in tool arguments.** (`crates/agent/tools.rs`; **small**.) Sub-agent returns
   a path, parent passes the path, expansion happens at execution. Directly relevant since HARNESS
   sub-agents are in separate workers and their output otherwise crosses as a string.
10. **Self-editing behaviour file.** (`crates/agent/state.rs` + `StorePort`; **medium**.) A
    `behaviour.md` merged by the utility model and prepended at `system[0]`. Persistent user-level
    correction without a settings UI.
11. **Periodic, replacing memory recall in extras.** (`crates/context/assemble.rs`; **medium**,
    assumes an embedding store exists — HARNESS has none, so this may be large in practice.) The
    shape worth copying regardless: recall every N iterations, run async, *replace* the previous
    block, and put it in a clearly-labelled `[EXTRAS]` region the model is told is context and not
    instruction.
12. **`[PROTOCOL]` before history / `[EXTRAS]` after history, with temporary vs persistent slots.**
    (`crates/context/assemble.rs`; **small**.) A disciplined answer to "where do I put dynamic
    context" that also tells the model how to weight each region.

## 10. What would be a MISTAKE to copy

- **No iteration cap.** The monologue's only exit is a `break_loop` tool. A model that never calls
  `response` runs forever; the mitigations are all prompt text. HARNESS's `max_rounds` is better —
  keep it.
- **Exceptions as the loop's control flow.** `InterventionException` raised from inside a stream
  callback, caught by a numbered file in
  `extensions/python/_functions/agent/Agent/handle_exception/end/`, which clears a dict field to
  mean "continue". Rust should express this as a state enum, not `Result` gymnastics.
- **The `_functions/<module>/<Class>/<method>/{start,end}` monkey-patch extension system**
  (`helpers/extension.py:57-206`). Every method decorated `@extensible` becomes a filesystem hook
  point with mutable input/result dicts. Untypeable, unsearchable, and the reason `agent.py`'s
  `handle_exception` is a two-line body with commented-out logic below it. HARNESS's one seam is
  worth more than this flexibility.
- **Enforcing permissions by hiding the prompt.** `tool_policy` blocks a tool by omitting its
  description. Nothing stops the model from emitting the name anyway; `get_tool` will happily load
  it. Enforce at dispatch.
- **One subordinate slot per agent, awaited synchronously.** `DATA_NAME_SUBORDINATE` is a single
  field; concurrency is bolted on via a separate `parallel` tool. HARNESS's worker-per-subagent is
  already better — don't regress to a slot.
- **Sharing `AgentContext` between superior and subordinate.** Same log, same task handle, same
  `data` bag; `context.streaming_agent` is a single mutable pointer to whoever is talking. This is
  why `_process_chain` needs a recursive reload hack. Keep sub-agent state isolated.
- **1592-line `agent.py` with Responses-API plumbing (`_responses_*`, `_computer_call_args`,
  `_handle_responses_mcp_approval_request`) inlined into the agent class.** Provider quirks belong
  in the adapter.
- **The 200-line `agents/developer/prompts/agent.system.main.specifics.md`.** "elite software
  architect", "Silicon Valley innovation capabilities", "Democratizing access to principal-level
  engineering expertise", plus ~150 lines of headings the agent will never act on. It is a
  demonstration of the folder mechanism, not evidence that this prompt works.
- **Prompt-only delegation policy.** "never delegate full to subordinate of same profile as you" is
  a rule the code does not check. HARNESS already has an authority-boundary concept; keep it in code.

## 11. Citations

- Monologue loop, extension points, exit: `agent.py:387-551`, exit at `526-527`.
- `prepare_prompt`, PROTOCOL/EXTRAS, ctx-window snapshot: `agent.py:554-613`.
- Intervention: `agent.py:260-277` (assign, broadcast up), `agent.py:1071-1089` (flush + raise);
  cleared by `extensions/python/_functions/agent/Agent/handle_exception/end/_40_handle_intervention_exception.py:43-44`.
- Repairable errors: `.../handle_exception/end/_50_handle_repairable_exception.py:17-23`; critical:
  `_90_handle_critical_exception.py:56-89`; retry: `plugins/_error_retry/.../_80_retry_critical_exception.py`.
- Repeat guard: `agent.py:494-511` + `prompts/fw.msg_repeat.md`. Misformat: `agent.py:1510-1518` +
  `prompts/fw.msg_misformat.md`.
- Tool dispatch and MCP-first lookup: `agent.py:1138-1227` (Responses path), `agent.py:1413-1518`
  (JSON path). Tool class resolution: `agent.py:1554-1587`.
- Tool base class / `Response(message, break_loop, additional)`: `helpers/tool.py:11-68`.
- `response` tool: `tools/response.py:5-25`. Prompt: `prompts/agent.system.tool.response.md`.
- JSON convention: `prompts/agent.system.main.communication.md:1-36`; parsing/normalising:
  `helpers/extract_tools.py:23-119`; early stream cutoff: `agent.py:442-458`.
- `call_subordinate`: `tools/call_subordinate.py:37-100`; prompt + profile list:
  `prompts/agent.system.tool.call_sub.md`, `prompts/agent.system.tool.call_sub.py:11-33`.
- Superior chain replay: `agent.py:292-311`; `prompts/fw.msg_from_subordinate.md`.
- Path resolution and its docstring: `helpers/subagents.py:335-428`; profile discovery/merge:
  `subagents.py:44-113, 116-149, 223-254`.
- Template engine: `helpers/files.py:88-209` (parse/read/conditions), `332-381` (includes,
  `include original`, `_get_dirs_after`), `384-423` (`find_file_in_dirs`,
  `get_unique_filenames_in_dirs`), `VariablesPlugin` at `files.py:25`.
- Extension override-by-filename: `helpers/extension.py:326-351`; `@extensible` hook points:
  `extension.py:57-206`.
- System prompt builders: `extensions/python/system_prompt/_10_main_prompt.py`,
  `_11_tools_prompt.py:28-59`; behaviour insert at 0:
  `plugins/_memory/extensions/python/system_prompt/_20_behaviour_prompt.py:244-245`.
- Extras builders: `extensions/python/message_loop_prompts_after/_60,_63,_65,_70,_72,_75`;
  goal: `plugins/_goal/extensions/python/message_loop_prompts_after/_50_include_goal.py`.
- Utility model: `agent.py:819-858`; model roles:
  `plugins/_model_config/helpers/model_config.py:18-32`.
- History tiers, constants, compression ladder: `helpers/history.py:15-25, 205-288, 307-354,
  356-405, 525-585`; scheduling: `extensions/python/message_loop_end/_10_organize_history.py`,
  `message_loop_prompts_before/_90_organize_history_wait.py`.
- Memory recall: `plugins/_memory/extensions/python/message_loop_prompts_after/_50_recall_memories.py:26-229`;
  defaults `plugins/_memory/default_config.yaml` (interval 3, threshold 0.7, 12/8 searched, 5/3 kept).
- Memory areas / knowledge import: `plugins/_memory/helpers/memory.py:54-59, 259-338, 672-678`.
- Behaviour self-edit: `plugins/_memory/tools/behaviour_adjustment.py:22-51`;
  `prompts/agent.system.behaviour.md`.
- Tool policy: `helpers/tool_policy.py:15-61, 64-90`.
- `§§include`: `prompts/agent.system.main.communication_additions.md:9-11`,
  `helpers/strings.py:162`, `extensions/python/response_stream/_15_replace_include_alias.py:20`.
- Environment/container: `prompts/agent.system.main.environment.md`; shell tool:
  `plugins/_code_execution/prompts/agent.system.tool.code_exe.md`.
- Profiles: `agents/default/agent.yaml`, `agents/developer/agent.yaml`,
  `agents/_example/prompts/agent.system.main.specifics.md`, `agents/_example/AGENTS.md`.
- Parallelism: `prompts/agent.system.tool.parallel.md`, `tools/parallel.py`.
- Skills (SKILL.md + YAML frontmatter): `helpers/skills.py:108-360`,
  `prompts/agent.system.skills.md`, `prompts/agent.system.tool.skills.md`.
- Artifacts: `helpers/media_artifacts.py`, `prompts/agent.system.tool.notify_user.md`.

Unverified: the WebUI's artifact rendering path (read only at the helper level, not the JS);
`tools/parallel.py` internals (read the prompt contract, not the implementation); whether any
bundled profile actually overrides `tools/` in production (only `_example` does).
