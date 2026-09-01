# Reference prompts — what four other agents put in the context window

Four projects have already answered questions we are about to answer badly. This
reads their **prompt and context engineering** and nothing else: not their
architecture, which is theirs, and not their code, which is theirs. What
transfers across a licence and across a realm boundary is an *idea about what a
model should be shown*.

**Read on 2026-09-01, from each project's `main`.** All four move; a line number
is a pointer to the version read, not a promise about the version you fetch.
Where a line number would rot fastest, the quoted text is given too, so the
claim survives the pointer.

## How the token numbers were made

There is no tokenizer in this tree, on purpose (ARCHITECTURE.md, "Counting
tokens"). Every number below is `estimateTokens` from `src/core/prompt/tokens.js`
run over text assembled from the projects' own sources — the same estimator the
prompt panel uses, measured on this tree at **within 1.6% of the provider's
count before calibration**. They are estimates from *our* estimator, not
invoices from anyone's provider, and they are comparable to each other and to
our own numbers because they were all produced the same way.

What was assembled, per project, is stated in that project's section. Our own
figures come from `ReActEngine.plan()` with the real `agents/main/agent.md`, the
real `ShellTool`, one user turn and one completed tool step:

| block | tokens | volatility | in prefix |
|---|---|---|---|
| `instructions` | 195 | static | yes |
| `tools` | 161 | static | yes |
| `contract` | 463 | static | yes |
| `conversation` | 19 | append | no |
| `scratchpad` | 46 | append | no |
| `context` | 22 | volatile | no |
| `reminder` | 23 | static | no (`tail`) |
| `cue` | 6 | static | no (`tail`) |
| **total** | **935** | | **819 cacheable (88%)** |

---

## The comparison

| | **agent-zero** | **bolt.diy** | **Open SWE** | **elizaOS** |
|---|---|---|---|---|
| **1. Mid-run context, in order** | system manual (role → specifics → environment → communication → solving → tips → tools → mcp → secrets → skills), **~4,220 tok**; then `[PROTOCOL]`, then the whole message history, then `[EXTRAS]` (datetime, agent info, workdir tree — ~145 tok of template, a floor) | one system message: constraints → database → artifact DSL → examples, **~6,980 tok**; then `CONTEXT BUFFER` (whole selected files) and `CHAT SUMMARY` appended *to the system message*; then the user/assistant turns | one system message of eighteen sections — eight literal constants, ten slots — **~5,550 tok**; then the message list, each human event wrapped in `<input-message sender= surface= kind=>`; entity introductions as content-hashed `<dynamic-context>` | two stages. Stage 1: `messageHandlerTemplate`, **~4,210 tok**, plus provider text joined in `position` order. Stage 2: `plannerTemplate`, **~2,730 tok**, plus `contextObject` + `trajectory` |
| **2. How a tool result re-enters** | as a **user turn**. `hist_add_tool_result` → `hist_add_message(ai=False, …)`, rendered through `fw.tool_result.md` as `{"tool_name": …, "tool_result": …}` | it does not, automatically. The human clicks "Fix this error" and the terminal output is `append`ed as a **user message**; edited files re-enter as a `<boltArtifact>` prepended to the next **user message** | as a real `ToolMessage` on the provider's tool channel, paired to its call by `tool_call_id`; errors are normalised into `ToolMessage(status="error")` rather than thrown | as **provider text**, not as a turn: the `ACTION_STATE` provider renders the plan, `state.data.actionResults` and working memory; `RECENT_MESSAGES` carries `action_result` memories |
| **3. What ends the loop** | the model calling the `response` tool. Plus a hard stop after *N* consecutive **unusable** responses (misformatted / repeated / empty), settings key `max_consecutive_unusable_responses` | nothing loops. One assistant turn per user turn; the only continuation is `CONTINUE_PROMPT` when output tokens run out, capped at `MAX_RESPONSE_SEGMENTS = 2` | **a turn with no tool call**, stated as a rule in the prompt. Backstopped by `ModelCallLimitMiddleware(run_limit=5000)` and a `TimeoutWrapupMiddleware` | a terminal `REPLY` / `IGNORE` / `STOP` tool call, or `completed=true`. Backstopped by a trajectory `maxToolCalls` (16 chat, 32 coding) and a required-tool miss budget |
| **4. How tools are described** | **prose markdown, one file per tool**, each ending in a full JSON usage example. `agent.system.tools.md` interpolates them all | **a DSL**: `<boltArtifact>` containing `<boltAction type="shell\|file\|start">`, taught by 14 numbered rules and two worked `<examples>` | **native function calling** (JSON schema), plus long prose in the system prompt about *when* each one is right and when it is not | **native function calling**: every Action becomes a tool named by the action, `parameters` from its JSON Schema; plus `REPLY`/`IGNORE`/`STOP` sentinels |
| **5. In, that we leave out** | a workdir file tree; agent number, profile and model id; skills catalogue; behavioural rules the user edited at runtime; a rolling LLM-written summary of old topics | the entire selected file set, verbatim, every turn; an LLM-written chat summary; a list of locked file paths; the shell's command inventory | the dashboard's URL map; the triggering user's identity, timezone and git identity; the allowed-org boundary; per-repo `AGENTS.md`; a trust marker on every untrusted field | a provider catalogue of 22, of which 5 compose by default (actions, character, capabilities, the provider list, long-term memory) and 17 are `dynamic` and opt-in per call — roles, world, entities, relationships, facts, follow-ups, attachments, settings, time |
| **5. Out, that we keep** | *(they keep more of everything)* | no clock at all — a bolt.diy prompt does not say what time it is | no response-format contract: native tool calling replaces it, so nothing renders field rules | no plain-text fallback contract in stage 2 beyond one line; the format is the provider's tool schema |

---

## agent-zero — the maximal reading of "the agent has its own environment"

The brief named `frdel/agent-zero`. That path 301-redirects
(`api.github.com/repos/frdel/agent-zero` → `agent0ai/agent-zero`), and every
agent-zero link below points at the target, which is the same project.

Assembled for measurement: `agent.system.main.md` with its six `{{ include }}`
lines expanded *recursively* — `agent.system.main.communication.md` carries a
nested include of `agent.system.main.communication_additions.md`, worth 674 of
the characters — then `agent.system.tools.md` with the nine root-level
`agent.system.tool.*.md` files interpolated into `{{tools}}`, then
`agent.system.mcp_tools.md`, `agent.system.secrets.md` and
`agent.system.skills.md` as written, joined with blank lines: what
`extensions/python/system_prompt/_10…_14` append. **4,217 tokens / 16,597
characters**, of which **2,447 is the nine tool files alone** (58%).

Nine is a floor, not a fixture. `_11_tools_prompt.py` globs
`agent.system.tool.*.md` across every directory `subagents.get_paths(agent,
"prompts")` returns, so a bundled plugin's tool file joins the listing without
anything appearing under `prompts/`. Nine is what the repository root holds.

**1. What is in the window.** `prepare_prompt` builds
`[SystemMessage(system_text), *history_langchain]` where the history list is
`protocol + loop_data.history_output + extras`
([`agent.py:603-610`](https://github.com/agent0ai/agent-zero/blob/main/agent.py)).
`loop_data.system` is a *list* of strings appended by numbered extensions and
joined with `\n\n`: main manual, tools, mcp, secrets, skills, project
(`extensions/python/system_prompt/_10_main_prompt.py` …
`_14_project_prompt.py`). The manual itself is
`agent.system.main.md`, which is nothing but six `{{ include }}` lines — role,
specifics, environment, communication, solving, tips, in that order.
`agent.system.main.specifics.md` is a zero-byte extension point on `main` today,
so the manual is six includes and five sections of text.
`extras` is rebuilt every iteration and appended **after** the whole history —
current datetime (`message_loop_prompts_after/_60_include_current_datetime.py`),
agent number/profile/model (`_70_include_agent_info.py`), and a filtered
workdir file tree (`_75_include_workdir_extras.py`).

The `~145 tok` in the table is those three templates exactly as written —
`agent.system.datetime.md`, `agent.extras.agent_info.md` and
`agent.extras.workdir_structure.md` substituted into `agent.context.extras.md`,
448 characters with every `{{placeholder}}` left standing. It is a floor and not
a measurement of a live run: `{{file_structure}}` is a whole depth-limited file
tree, and `_63_recall_relevant_skills.py`, `_65_include_loaded_skills.py` and
`_72_include_parallel_jobs.py` append to the same block.

Note the shape: agent-zero puts its volatile facts *after* the transcript, for
the same reason we do. It is the one place the two designs agree exactly.

**2. How a tool result re-enters — as a user turn.**

```python
def hist_add_tool_result(self, tool_name: str, tool_result: str, **kwargs):
    ...
    return self.hist_add_message(False, content=data, id=msg_id, metadata=metadata)
```

`agent.py:785-808`. The first positional argument is `ai`, so `False` is the
human slot. The rendering is `prompts/fw.tool_result.md`:

````
```json
{
    "tool_name": {{tool_name}},
    "tool_result": {{tool_result}}
}
```
````

Every framework message rides the same channel — `fw.msg_repeat.md` ("You have
sent the same message again. You have to do something else!"),
`fw.msg_misformat.md`, `fw.msg_nudge.md` — all `hist_add_warning` →
`hist_add_message(False, …)` (`agent.py:780-782`). The model is told the user
said all of it. This is precisely the arrangement `ReActEngine` rejects, in a
comment written before this study existed: *"a model that reads its own tool
output as something the user typed will answer the wrong participant"*
(`src/core/engine/ReActEngine.js:37-42`).

**3. What ends the loop.** The inner `while True` returns only when
`process_llm_result_tools` yields a result — i.e. the model called the
`response` tool, whose own prompt says "ends task processing use only when done"
(`prompts/agent.system.tool.response.md`). `agent.py:535-536`:

```python
if tools_result:  # final response of message loop available
    return tools_result  # break the execution if the task is done
```

The safety net is not a step counter. It counts **consecutive unusable
responses** — only replies equal to the misformat, repeat, or empty-response
framework messages, and only when they land on consecutive iterations
(`extensions/python/_functions/agent/Agent/hist_add_warning/end/_90_stop_unusable_response_loop.py`).
At the limit it raises `HandledException` carrying
`fw.msg_unusable_response_limit.md`: *"Agent stopped after {{limit}} consecutive
unusable model responses to prevent further API charges."* That is a bound on
**wasted** turns, not on work, and it is the only bound of its kind in the four.

Separately, context pressure is handled by compaction, not truncation:
`message_loop_end/_10_organize_history.py` starts `history.compress()` on a
background thread, targeting `COMPRESSION_TARGET_RATIO = 0.8` of the window and
splitting the budget `CURRENT_TOPIC_RATIO = 0.5 / HISTORY_TOPIC_RATIO = 0.3 /
HISTORY_BULK_RATIO = 0.2` (`helpers/history.py:15-25`). Old topics get
`HISTORY_TOPIC_ATTENTION_COMPRESSION = 0` — "only request and response remain
intact".

**4. How tools are described.** Prose, one file per tool, concatenated by
`extensions/python/system_prompt/_11_tools_prompt.py` into `{{tools}}` in
`agent.system.tools.md`. Every file ends in a complete JSON example. There is no
schema anywhere; the contract is the response format in
`agent.system.main.communication.md` — `thoughts`, `headline`, `tool_name`,
`tool_args` — with a worked example and this line, which is a defect report
turned into a rule: *"`tool_name` must be one listed tool name, never an action
name such as `read`, `write`, `terminal`, or `multi`"*. Ours has the identical
scar tissue in `ReActResponse.FIELDS.act`: *"Never write a tool name here —
'act: echo' is always wrong."*

**5. In, that we leave out.** The workdir file tree (`{{file_structure}}`,
depth-limited and gitignore-filtered); agent number, profile and model id;
the skills catalogue; behavioural rules the user edited at runtime
(`agent.system.behaviour.md` is `!!! {{rules}}`); and a running LLM summary of
compacted topics. **Out, that we keep:** nothing meaningful — agent-zero keeps
strictly more. Its style is the opposite of ours: telegraphic, unpunctuated,
lowercase (`"reason step-by-step execute tasks / avoid repetition ensure
progress / never assume success"`), which is a token-cost decision applied to
prose rather than to the list of things said.

---

## bolt.diy — client-only execution, scoped to code

Assembled for measurement: the `getSystemPrompt` template literal in
`app/lib/common/prompts/prompts.ts`, unescaped. **6,981 tokens** — the largest
static prompt of the four, and the whole of it before a single file is shown.

**1. What is in the window.** One system message, then the turns. The system
message is `getSystemPrompt()` — `<system_constraints>` (what WebContainer is
and cannot do), `<database_instructions>`, `<code_formatting_info>`,
`<chain_of_thought_instructions>`, `<artifact_info>` with fourteen numbered rules,
mobile-app guidance, and `<examples>` containing two complete worked artifacts.
Then, appended **to the system message** at request time
(`app/lib/.server/llm/stream-text.ts:164-215`):

```ts
const codeContext = createFilesContext(contextFiles, true);
systemPrompt = `${systemPrompt}
    ...CONTEXT BUFFER:
    ---
    ${codeContext}
    ---`;
```

`createFilesContext` emits each selected file whole, wrapped in the same
`<boltAction type="file" filePath="…">` tag the model writes
(`app/lib/.server/llm/utils.ts:57-86`). Then optionally `CHAT SUMMARY`, and then
— crucially — the message list is **sliced**, keeping only the last message or
from `messageSliceId`. Then a list of locked file paths.

**This is the clearest counter-example to our own ordering in the four.**
Everything volatile is appended to the end of the *system* message, ahead of the
turns, so the first byte that changes each request is a few hundred tokens in
and nothing after it can be reused. ARCHITECTURE.md's finding (1) — caching is
prefix matching — says this costs the whole prompt on every turn. bolt.diy pays
it, and buys back what it can by throwing the transcript away instead.

**2. How a tool result re-enters — by hand, as a user message.** There is no
observe step. A failing command raises an alert component, and a human presses a
button:

```tsx
postMessage(
  `*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`,
)
```

`app/components/chat/ChatAlert.tsx:73-75`. Files the human edited by hand
re-enter the same way — `filesToArtifacts(modifiedFiles)` prepended to the next
user message (`app/components/chat/Chat.client.tsx:515-530`). The execution
substrate is right there in the page and its output still reaches the model only
because a person decided it should.

**3. What ends the loop.** There is no loop. One assistant turn answers one user
turn. The only continuation is a length continuation: when the stream stops on
the token limit, the server pushes the partial assistant message and a synthetic
user message carrying `CONTINUE_PROMPT` — *"Continue your prior response.
IMPORTANT: Immediately begin from where you left off … Do not repeat any
content, including artifact and action tags"* (`prompts.ts:711-714`) — and it is
allowed to happen `MAX_RESPONSE_SEGMENTS = 2` times before
`throw Error('Cannot continue message: Maximum segments reached')`
(`app/routes/api.chat.ts:252-267`; `app/lib/.server/llm/constants.ts:47`).

**4. How tools are described.** A DSL, not a schema and not a signature. Actions
are XML-ish elements the model writes inside its prose, taught by fourteen
numbered rules (`prompts.ts:312-438`) and demonstrated twice at full length. The rules carry the
severity in the text — `CRITICAL: You MUST always follow the <boltArtifact>
format.`, `ULTRA IMPORTANT: Do NOT run a dev command with shell action use start
action to run dev commands` — which is what a system does when it has no
validator: it shouts.

**5. In, that we leave out.** Every selected file, verbatim, on every turn; an
LLM-written chat summary; the locked-file list; and a full inventory of the
shell's commands. **Out, that we keep: the clock.** A bolt.diy prompt contains
no statement of the current time anywhere. For a code sandbox that is defensible
— nothing it does is decided by the date — and it is a useful check on our own
`# CONTEXT` block: one fact is the floor, and zero is a real option for an agent
whose answers never depend on the moment.

---

## Open SWE — a planning/execution agent over a real repository

Assembled for measurement: `construct_system_prompt(working_dir=…)` with every
other argument left at its default (`agent/prompt.py:550-607`), which renders
`SYSTEM_PROMPT_TEMPLATE`'s eight literal section constants and ten `{…}` slots
(`agent/prompt.py:528-547`) with plan mode, the corridor and admin environments
off, and `agent/resources/default_prompt.md` loaded into the custom-instructions
slot. **5,549 tokens / 24,431 characters**, of which `OPEN_SWE_SHARED_BASE`
alone is 10,949 characters.

**1. What is in the window.** `construct_system_prompt` formats one template of
eighteen sections, several of which render empty when their flag is off
(`agent/prompt.py:528-607`): working environment → dashboard context → source
guidance → plan-mode guidance → plan mode → self-awareness → default prompt →
repository scope → repo setup → task execution → corridor → dependencies →
untrusted comments → commit & PR → repo instructions → environment → admin →
shared base. Then the message
list. Human events are not bare strings: `_serialize_message` wraps each one as

```python
return f"<input-message {' '.join(attributes)}>\n{body}\n</input-message>"
```

with `sender`, `surface`, `kind` and optional `channel` attributes
(`agent/input_messages.py:259-272`). People, channels and systems get their own
one-time `<dynamic-context kind= id= hash=>` introductions, hashed with SHA-256
of the canonical form so the same entity is never introduced twice
(`agent/input_messages.py:216-231`). Mid-run, new user messages that arrived
while the agent was busy are injected as fresh human messages before the next
model call (`agent/middleware/check_message_queue.py`).

**2. How a tool result re-enters.** On the provider's own tool channel, paired
to its call by id — and, importantly, *sorted back into call order* before every
model request:

> "Tool results from a parallel batch land in state in completion order, which
> is not the order a later run reads them back in. The provider prompt cache is
> a byte prefix match, so a single swapped pair invalidates every token after
> the earliest parallel batch in the thread — tens of thousands of tokens
> re-prefilled on the first model call of every new run."

`agent/middleware/stable_tool_order.py:1-8`; installed at
`agent/server.py:1829`. Nothing in Open SWE sets an explicit `cache_control`
breakpoint — `grep` for it finds nothing in `prompt.py`, `server.py` or
`chat.py` — so the whole caching strategy is *defend the byte prefix*, and this
middleware is what that costs.

Failures become results rather than exceptions: `ToolErrorMiddleware` catches
everything a tool throws and returns `ToolMessage(status="error")` carrying a
JSON payload, *"so the LLM can see the failure and self-correct, rather than
crashing the entire agent run"* — with exactly one exception, a sandbox that has
stopped answering, because *"every later sandbox call would hit the same dead
backend and notify again"* (`agent/middleware/tool_error_handler.py`). That is
our `Outcome` rule — repair, do not refuse; degrade, do not stop — arrived at
independently, including the carve-out for the failure that cannot be survived.

**3. What ends the loop.** A rule in the prompt, in the second person:

> "A turn with no tool call is how you stop. Stop once you have reported the
> outcome — a failure or a blocking question is an outcome. Never fill turns
> with repeated status messages or re-checks"

`agent/prompt.py:113`. It is paired with an explicit anti-stopping rule two
paragraphs up — *"Persistence: Keep working until the task is completely
resolved … never stop partway to describe what you would do"* — so both
directions are stated, which is what makes either legible. The backstop is
`ModelCallLimitMiddleware(run_limit=MODEL_CALL_RECURSION_LIMIT,
exit_behavior="end")` with the limit at **5,000** (`agent/server.py:1800`,
`agent/runtime/constants.py`), and when it fires an `after_agent` middleware
detects the marker text and tells the user in their own channel: *"Open SWE
reached its maximum step limit and had to stop"*
(`agent/middleware/notify_step_limit.py`). A limit that fires silently is
indistinguishable from an agent that finished; this one says so.

**4. How tools are described.** Native function calling, so the argument
contract is a JSON schema the provider enforces. The prompt then spends its
tokens on the part a schema cannot carry — *when* a tool is the wrong choice.
`execute` gets its 300s default and `timeout=` argument; `background_execute`
gets "only for long-running, non-interactive verification … do not poll or
hand-roll `nohup`/PID loops"; `recreate_sandbox` gets "Never call … proactively
or as automatic recovery". This is the division we already draw between
`Tool.parameters` and `Tool.description`, taken much further.

**5. In, that we leave out.** The dashboard's URL map; the triggering user's
identity, git identity and timezone; the allowed-org boundary as a hard
constraint; per-repo `AGENTS.md` promoted to prompt authority; and a
`trust="untrusted"` marker on every user-controlled field, with a matching
section telling the model what that marker means (`agent/prompt.py:67-72`,
`334-339`). **Out, that we keep:** a response-format contract. Native tool
calling means there is no `instructions()` equivalent anywhere — no field table,
no format rules, no reminder line. Our 463-token `contract` block is the price
of supporting models with no function-calling API, and Open SWE shows exactly
what that price buys.

---

## elizaOS — memory as a schema, providers/evaluators/actions composition

Assembled for measurement: `messageHandlerTemplate` (**4,209 tokens**),
`plannerTemplate` (**2,726 tokens**), and the provider spec catalogue
(**1,343 tokens**).

**1. What is in the window.** Two model calls per inbound message. Stage 1 asks
one question — respond, ignore, or stop, and if respond, which contexts —
using `messageHandlerTemplate` (`packages/prompts/src/index.ts:681-782`). Stage
2 plans tool calls with `plannerTemplate` plus `{{contextObject}}` and
`{{trajectory}}` (`packages/core/src/prompts/planner.ts:16`).

The context itself is composed, not written. `composeState`
(`packages/core/src/runtime.ts:5011`) selects providers, runs them, and joins
their text in a deterministic order:

```ts
providersToGet.sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name));
...
const rawProvidersText = orderedTexts.join("\n");
```

`runtime.ts:5158-5160, 5460`. The order is declared per provider as a `position`
integer in `packages/prompts/specs/providers/core.json`: `ACTIONS` at `-1`,
`CONTEXT_BENCH` at `5`, `LONG_TERM_MEMORY` at `50`, `RECENT_MESSAGES` at `100`,
the rest unset. Unset is not `0`: the comparator reads the provider object, not
the spec, and a provider may default its own — `actionStateProvider` is
`position: spec.position ?? 150` (`actionState.ts:41`), so `ACTION_STATE`
renders *after* `RECENT_MESSAGES` while carrying no position in the catalogue at
all. This is our `PromptTemplate` order list under a
different name, with one thing ours does not have — a **catalogue file** that a
non-programmer can read to see what the prompt is made of.

Providers also declare their own reuse policy, which is our `Volatility` by
another name: `actionStateProvider` carries `cacheStable: false, cacheScope:
"turn"` with the reason in the file — *"Previous action results are
context-agnostic. Every planner turn that follows a tool execution needs to see
what just ran, regardless of which context is engaged"*
(`packages/core/src/features/basic-capabilities/providers/actionState.ts:42-46`).

**2. How a tool result re-enters — as provider text, not as a turn.** The
`ACTION_STATE` provider renders four sections into the next planner prompt: the
active plan with per-step status, `state.data.actionResults` for the current
chain, working memory, and action history reconstructed from `action_result`
memories in the `messages` table (`actionState.ts:1-11`). Nothing is
impersonating a speaker; the results are a labelled block of context that the
next call reads. That is the same instinct as our `# WORK SO FAR` scratchpad
block, reached from the other direction — they made the observation a
*provider*, we made it a *block*.

**3. What ends the loop.** A terminal tool call. `REPLY` / `IGNORE` / `STOP` are
always-available sentinels emitted alongside the real tools
(`packages/core/src/actions/to-tool.ts:1-11`), and the planner sets
`completed=true` when the goal is met this turn. The backstops are numeric and
plural. A trajectory `maxToolCalls` — *"the chat default (maxToolCalls=16) caps
that mid-build"* (`packages/core/src/runtime/planner-loop.ts:340`), raised to 32
for coding builds by `resolveCodingMaxToolCalls` (`planner-loop.ts:247-257`).
And a **required-tool miss budget** — how many times the planner may answer with
a terminal reply instead of acting before the loop gives up: 8 for coding
(`planner-loop.ts:259-268`), 3 for chat (`planner-loop.ts:348`). That second one
is a bound on a specific failure mode rather than on work, and it is the same
family as agent-zero's unusable-response stop.

**4. How tools are described.** Native function calling, generated from the
action catalogue: *"Each Action is exposed to the LLM as its own native tool
whose name is the action name and whose `parameters` is the action's parameter
JSONSchema"* (`to-tool.ts:33-37`). Names must match
`/^[A-Z_][A-Z0-9_]*$/` or conversion throws.

**5. In, that we leave out.** Everything, and then some of it conditionally.
Twenty-two providers are declared in the core catalogue
(`packages/prompts/specs/providers/core.json`), but only five compose by
default: `composeState` takes
`this.providers.filter((p) => !p.private && !p.dynamic)` (`runtime.ts:5077`),
and seventeen of the twenty-two carry `dynamic: true`. The default five are the
actions list, character bio and style, capabilities, the provider list itself,
and long-term memory. Roles, world, entities, relationships, facts, follow-ups,
documents, attachments, settings and time are all `dynamic` — declared, and
entering the prompt only when a caller names them, which is a lever we do not
have. Three affective providers ship outside the catalogue entirely, in the
basic-capabilities bundle
(`packages/core/src/features/basic-capabilities/providers/anxiety.ts`,
`userEmotionSignal.ts`, `botAwareness.ts`). And the stage-1 template
is 4,209 tokens of behavioural rules, most of them defect reports promoted to
prose: a paragraph banning claims of investigation that did not happen
("past-perfect … bare past-tense … present-continuous with subject … gerund
headers"), a paragraph banning invented moderation systems, a paragraph banning
"as of my last update". **Out, that we keep:** a plain-text contract. Stage 2's
fallback is one line — *"plain-JSON fallback only (when native tool calls are
unavailable)"* — where ours is a rendered field table with an example, because
ours is the only path.

**A correction to our own CAPABILITIES.md §4.** It says eliza's memory is
"pgvector with the embedding dimension frozen at init". On `main` today it is
not frozen — the `embeddings` table has **seven** fixed-width vector columns
(384/512/768/1024/1536/2048/3072), one populated per row, *"Supporting multiple
fixed-width columns instead of a single variable-length vector lets PostgreSQL
index each dimension separately"*
(`plugins/plugin-sql/src/schema/embedding.ts:1-33`). The lesson we recorded —
that memory is a schema and not a bucket — survives; the specific claim about
freezing does not, and should be edited when someone touches that line.

---

## What is worth stealing

Six, ranked. Nothing here needs a server, a container, or cross-origin
isolation — see "What was refused" below for what that rules out.

**1. A stop that counts wasted turns, not steps.** agent-zero ends a run after
*N* consecutive replies that were misformatted, empty, or byte-identical to the
last, and says so in a message
(`extensions/python/_functions/agent/Agent/hist_add_warning/end/_90_stop_unusable_response_loop.py`;
`prompts/fw.msg_unusable_response_limit.md`).
*Changes:* `src/core/engine/ReActEngine.js` — the detector is already there and
has no ceiling: `seen` (`:44`) counts byte-identical calls, and `observe()`
(`:82-100`) answers a repeat with a nudge instead of re-running it because it
"works by informing rather than by stopping". The change is a bound on that
counter, not a second one beside it, plus one new code in `src/core/Outcome.js`.
*Costs:* one counter, one failure path, and the risk of ending a run that would
have recovered — bounded by counting only turns that carried no information at
all, which is a different measurement from the step ceiling ARCHITECTURE.md
retired, and it closes the row CAPABILITIES.md calls out as "unbounded **and**
uncancellable, which is worse than either alone".

**2. Mark tool output as data, not as instruction.** Open SWE wraps every
user-controlled field in `trust="untrusted"` and spends a prompt section saying
what the marker means (`agent/prompt.py:67-72`, `334-339`).
*Changes:* `src/core/tools/Toolbox.js` (`runOne`, which today returns
`` `${name} -> ${result.value}` ``) and the `scratchpad` block in
`src/core/engine/Engine.js`.
*Costs:* about five tokens per observation and a wrapper the model may echo
back — against the fact that today a `shell` call that `cat`s a file containing
"ignore your previous instructions" is rendered into the prompt in the same
voice as our own framing, with nothing to tell them apart.

**3. Name the call each observation answers.** Open SWE pairs every result to
its call by `tool_call_id` and re-sorts parallel batches back into call order
before each request (`agent/middleware/stable_tool_order.py`).
*Changes:* `src/core/tools/Toolbox.js` — `runOne` already returns `raw` on the
error paths and drops it on success, so two `shell` calls on one line produce
two lines both beginning `shell -> ` with nothing to distinguish them.
*Costs:* the call text is repeated in the prompt, tens of tokens per parallel
call; the ordering half of the idea we already get for free, because
`Promise.all` resolves in input order.

**4. State the stopping rule as a behaviour, in the instructions.** Open SWE
writes it as a sentence to the agent — *"A turn with no tool call is how you
stop. Stop once you have reported the outcome — a failure or a blocking question
is an outcome"* — paired with an explicit persistence rule pulling the other way
(`agent/prompt.py:113`, `78`).
*Changes:* `agents/main/agent.md`, one paragraph; optionally the `act`
description in `src/core/response/ReActResponse.js`, which today explains the
mechanism (`'tool'` or `'answer'`) but never says when a run is finished.
*Costs:* roughly forty tokens, in the static prefix, where they are paid once
and reused on every later call.

**5. A second, short description per tool, for when the listing is long.**
eliza's provider catalogue carries both `description` and
`descriptionCompressed` for every entry
(`packages/prompts/specs/providers/core.json`).
*Changes:* `src/core/tools/Tool.js` (`render`) and `src/core/mcp/discover.js`.
*Costs:* two descriptions to keep in sync, and a short description that is wrong
costs more than a long one that is right — so the long one stays the default and
the short one is opt-in, which is the same bargain `include_tools` already makes
against ARCHITECTURE.md's measured 3,717 → 1,332 tokens.

**6. One headline per step.** agent-zero requires a `headline` field on every
reply — "short headline summary of the response" — beside `thoughts` and the
tool call (`prompts/agent.system.main.communication.md`).
*Changes:* one field in `src/core/response/ReActResponse.js`, rendered in
`src/app/page.jsx` and in Slice 0A's transcript.
*Costs:* about ten output tokens per step and one more field a small model can
get wrong — bought against the fact that a run of six steps is currently read by
reading six full replies, and the rubric below asks a critic to do exactly that
twice, side by side.

### What was refused

Named so the exclusions read as decisions rather than oversights.

- **bolt.diy's whole environment paragraph** — an accurate description of
  WebContainer is an inaccurate description of ours, and the substrate it
  describes needs `SharedArrayBuffer`, hence cross-origin isolation, hence
  headers a static host cannot set (CAPABILITIES.md §1, C1).
- **Open SWE's `background_execute` and `schedule_thread_wakeup`** — both
  describe work happening while the requester is elsewhere. C3: the tab is the
  process.
- **Open SWE's `<dynamic-context>` entity introductions and agent-zero's agent
  info block** — identity of a sender presupposes senders, plural. C4.
- **eliza's recall providers (`FACTS`, `LONG_TERM_MEMORY`, `RELATIONSHIPS`)** —
  not barred by any root constraint, but CAPABILITIES.md scores semantic and
  cross-session recall `absent` with no store behind them, and a retrieval block
  with nothing to retrieve is ceremony by definition.

One idea is blocked rather than refused, and the difference is worth keeping
straight: **agent-zero's `§§include(abs_path)`**, reusing a long earlier output
by reference instead of retyping it
(`prompts/agent.system.main.communication_additions.md`). It needs a file that
survives between calls, and `CAPABILITIES.md:123` scores that row `unverified`
under `C1?` — not `barred` — with the reason spelled out two lines below it:
"nobody has established that it cannot be done". `docs/LEDGER.md` queues 2A as
the spike that settles it, so this is an idea to re-read the day 2A lands, not
one to strike.

---

## The blind comparison rubric

For a critic given two agent transcripts of the same task, unlabelled, scoring
each 1–5 per criterion and picking a winner.

**What counts as a transcript.** The user's message, and then per step: the
assembled prompt with its block accounting, the model's reply, and the
observation. This tree already emits all of it —
`Engine.step → onPrompt(assembled)` carries the text *and* the per-block token
and cache breakdown, `onStep` carries the parsed reply, and `ReActEngine` builds
the scratchpad from the observations (ARCHITECTURE.md, "The prompt is visible").
Where only the visible dialogue is available, criterion 1 cannot be scored at
all — which is itself the strongest argument for putting the prompt in the
transcript.

| # | Criterion | 1 | 5 |
|---|---|---|---|
| 1 | **Working context vs ceremony** | Whole blocks go unreferenced by any turn: rules for situations the run never enters, a persona restated three times, a paragraph introducing a heading. Deleting a third of the prompt would change no reply in the transcript. | Every block earns a turn you can point at. What is present and unused — a tool listing, a format contract — is there because keeping it is cheaper than deciding per turn, and the transcript shows that trade being made rather than forgotten. |
| 2 | **Tool contract unambiguity** | The contract is stated in one place and contradicted in another; argument names and types are implied by an example only; the transcript shows a malformed call being silently repaired, or lost. | Name, argument names, types and *when not to use it* are all present. Every call in the transcript is well-formed first time, and the one that is not gets an observation naming the exact defect and the exact fix. |
| 3 | **Termination legibility** | The run just ends. Nothing distinguishes finished from gave-up from hit-a-limit. Or a limit fired and the transcript contains no trace that a limit exists. | The last turn names the reason in the agent's own output — answered, blocked, refused — and any limit that fired appears as a message carrying its number, so re-running the same input would stop the same way for the same stated reason. |
| 4 | **Speaker attribution** | Tool output is presented as something the user said. Framework nudges wear the user's voice. The agent's own working is indistinguishable from dialogue. | Dialogue, the agent's own working, and machine output are three distinct kinds, each labelled with who produced it — and content the agent *fetched* is marked as data rather than as instruction. |
| 5 | **In-transcript failure recovery** | A failure ends the run, or repeats verbatim. The observation is a status code or a stack trace with no hint of a next move. The agent retries the identical call. | The failure returns as a readable observation naming what could be done differently, and the next turn does something different. A failure that genuinely cannot be recovered says so and stops, instead of being retried until a budget runs out. |
| 6 | **Token cost per useful action** | Thousands of prompt tokens per step, most of them re-sent unchanged and outside any reusable prefix, and half the steps produce no new fact. | Per-step cost is dominated by material that either changed or is provably reused, and every step either obtains a fact the run did not have or ends the run. *(Dialogue-only fallback: count steps that produced nothing.)* |
| 7 | **Prefix stability** | Something volatile sits near the top — a clock, a step counter, a re-ordered tool listing, a summary rebuilt each turn — so the shared leading run is a few hundred tokens and every step re-prefills almost everything. | The parts that grow only grow at their end, volatile facts sit after them, and the transcript reports the boundary and the reusable share per step. *(Dialogue-only fallback: does anything that changes per step appear before anything that does not?)* |
| 8 | **Grounding** | The agent reports an action it never took — "I searched and found…" with no call above it — or summarises a tool result instead of showing it, or invents a failure or a policy to explain a refusal. | Every factual claim points at a specific observation above it; where nothing was run, the agent says so plainly and answers from what it has; a refusal is owned in the first person rather than blamed on a system. |

**Scoring.**

- Criteria **4** and **8** are disqualifying at 1. Both are the transcript lying
  about what happened — one about who said a thing, one about whether a thing
  was done — and a transcript that lies loses to one that is merely expensive,
  regardless of totals.
- Sum the remaining six. Ties break on **6**, then on **3**: given equal cost,
  prefer the run whose ending you can explain.
- Score each criterion against the *other* transcript, not against an ideal. The
  question is which of these two is better, and a rubric that scores both a 2
  has told the critic nothing.
- A criterion the transcript cannot answer is scored 1, not skipped. An
  unanswerable question about a run is a fact about the run.

Criteria 4, 5 and 8 are the three this tree currently fails or cannot
demonstrate: observations carry no speaker marker beyond `observation:`, and
there is no durable run log to read any of it out of (CAPABILITIES.md, "Traces /
a run log: `absent`"). Criterion 3 has moved — the loop has a legible bound now
(CAPABILITIES.md, "Bound it: `have`"; `core/engine/Budget.js` renders `# BUDGET`
on the turn that has no room left and the hard stop names the budget that went) —
and criterion 3 is nonetheless where the first blind panel scored against us, for
a reason the rubric anticipates and this tree had not: a run that ends because a
truncated reply took the `act` field's default *looks* answered and is not.
That is the point of writing the rubric before the work rather than after it.

**And the first panel did not use this rubric.** `docs/LEDGER.md`'s bar says a
blind critic judges "on the rubric in `docs/REFERENCE-PROMPTS.md`". The panel run
in the benchmark wave was briefed as five single-question lenses — token
efficiency, cost against what it bought, reply shape — and three reported. None
of the three scored a criterion, so nothing below was exercised, criteria 4 and 8
were never applied as disqualifiers, and the results are not comparable to a
later run that does use it. Either the bar names the lenses or the panel scores
the rubric; today they are two different tests wearing one sentence.
