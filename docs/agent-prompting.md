# Agent prompting & initialization

How ASKK turns its in-code objects into the prompt the model sees, and where each
part lives. (Patterns here were informed by the LocalAgents reference design.)

## soul.md + agent.md split — soul is always first

System instruction is split across two markdown sources:

- **`soul.md`** — the agent "soul" (behavioral charter), embedded at compile time
  (`state::manifest::default_soul_prompt`) and stored mutably on `AppSnapshot.soul`.
  It is rendered **first** in every prompt and carries only behavioral content (no
  meta-header): the four laws (think before acting, stay grounded, work surgically,
  drive to a verified result) plus the exploratory streak, the untrusted-data
  boundary, and the research/build playbooks. It does **not** list the tools — those
  come from the tool manifest.
- **`agents/*.md`** — per-agent files (`planner.md`, `coder.md`, `researcher.md`,
  `synthesizer.md`) parsed by `agent_from_markdown` into `Agent { name, role, … }`.
  The markdown body becomes the agent's `role`. The right agent is chosen per run
  (`engine::pick_agent`, or the orchestrator's selection), so the task-specific
  `agent.md` loads after the soul.

## Code objects → LLM information

Initialization reduces in-code objects to LLM-facing text, all in
[`src/agent_prompt.rs`](../src/agent_prompt.rs):

- `describe_tools` — each `ToolSpec` as a **minimal** markdown entry (name +
  description + a generic `tool_name({"key": "value"})` usage hint) under
  `## AVAILABLE TOOLS`. The raw `input_schema` is **not** dumped into the prompt — the
  exact parameters live in the description, and the model writes calls in the same
  `tool_name({...})` shape the response format requires.
- `render_context` — a `## CONTEXT` block carrying the current date (UTC, via
  `state::now_iso`, passed in on `InferenceRequest.now`) so the agent can reason about
  "now" (e.g. how recent a news search should be), plus the one-line sandbox note.
- `describe_skills` — enabled `Skill`s as `### ` subsections under `## SKILLS`; the
  section is omitted entirely when none are enabled.
- `describe_sub_agents` — the sub-agent roster under `## SUB-AGENTS` (see below);
  omitted when empty.
- `Agent::short_description` — a one-line summary of an agent derived from its role,
  used in the roster.

## The whole prompt is formatted within the agent

`src/agent_prompt.rs` is the single place the system prompt is assembled —
`render_system_prompt` (and `render_critic_system_prompt` for the verifier). A
provider (`src/inference/openai.rs`) wires that rendered system prompt to the
transcript, then appends the response-format instructions as the **final message** so
the model reads them right before generating. The full order the model sees:

```
soul → "You are {name}" → role → ## SUB-AGENTS → ## AVAILABLE TOOLS → ## SKILLS → ## CONTEXT   (system message)
→ conversation messages (goal / prior turns / tool observations)
→ ## RESPONSE FORMAT                                                                            (final message)
```

i.e. **soul → agent → tools → context → messages → response format**. The soul is the
agent's persona/identity (Hermes-style: injected first). The prompt carries only what
the agent's objects contain: no boilerplate headers, no JSON-Schema tool dump, and the
optional `## SUB-AGENTS` / `## SKILLS` sections are omitted when empty. The
`CompiledPromptPanel` renders this whole order, with a placeholder for the run-time
conversation.

## Init-time vs runtime prompt split (TARGET)

> **Status: TARGET, not yet shipped.** Today `render_system_prompt` rebuilds the
> *entire* system prompt from the `InferenceRequest` on **every** turn (see
> [`src/agent_prompt.rs`](../src/agent_prompt.rs)). The split below is the design this
> batch is porting in from the `LocalAgents` reference; it is a performance/structure
> refinement of the same ordering shown above, not a change to what the model sees.

The prompt divides into two halves by how often each part changes:

- **Static, compiled ONCE at init time.** The pieces that do not vary turn-to-turn for
  a given agent: the **soul**, the **concise tool manifest** (`describe_tools` — the
  minimal name + description + usage hint, *not* a JSON-Schema dump), the enabled
  **skills**, and the **sub-agent roster**. These are assembled once when the run
  starts and reused unchanged across every turn of that run.
- **Dynamic, rebuilt PER TURN.** The pieces that change as the run progresses: the
  **context** (current date + sandbox note), the **conversation history**, the
  **goal**, and accumulated tool **observations** — plus the **response-format
  instructions, always appended last** so the model reads the output contract
  immediately before generating.

The serialization itself is "concise object → string": each in-code object renders to
the smallest faithful text (a tool is three lines, not a schema), and the split is the
init-time/runtime boundary — compile the static prefix once, concatenate the
freshly-built dynamic suffix each turn. The on-the-wire order the model sees is
unchanged (**soul → agent → tools → context → messages → response format**); only the
*when* of assembly moves.

## Response format: TOON default, JSON fallback after 3 consecutive failures

The response contract is a `ResponseFormat` object
([`src/responses/mod.rs`](../src/responses/mod.rs)) with two wire formats: **TOON**
(the default — terse, one field per block) and **JSON**. Each `StructuredResponse`
declares its fields once and inherits both the prompt `instructions(format)` and the
`from_raw` cascade parser.

- **Today**, parsing is a per-response cascade: `from_raw` tries a JSON object first,
  then TOON, then a raw-text fallback — on *every* response, independent of history.
  The format the model is *instructed* to use is fixed per agent (TOON by default).
- **TARGET**: the format becomes adaptive. The loop stays on **TOON by default**, and
  only **after 3 consecutive parse failures** does it **fall back to instructing the
  model in JSON** for subsequent turns. The counter is consecutive — a single clean
  parse resets it — so a transient malformed turn does not permanently switch formats.
  This keeps the terse TOON path as the common case while giving the more rigid JSON
  contract as a recovery mode when a particular model keeps producing unparseable
  TOON.

## Engine owns its messages

`src/engine/mod.rs` owns the conversation messages distinct from the system prompt: the
user goal, prior-run conversation seed, the assistant's raw responses, tool
observations (`tool_name -> result`), and validator feedback. Tool output is always
untrusted **data**, never instructions.

## Orchestrator: see + invoke sub-agents

- **See** — at run start the engine builds the roster of peer agents the run can
  reach (`engine::sub_agent_roster`: every enabled agent except the one running) and
  passes it on `InferenceRequest.sub_agents`; `agent_prompt` renders it into the
  prompt's "Sub-agents you can delegate to" section.
- **Invoke** — `src/orchestrator.rs` dispatches a sub-agent on a focused sub-goal via
  `run_goal_for_agent_in_worker_or_inline` (a child ReAct run in a Web Worker, or
  inline on host), then folds the child's result back into the parent.
