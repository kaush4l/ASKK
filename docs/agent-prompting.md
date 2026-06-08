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
