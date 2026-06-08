# Agent prompting & initialization

How ASKK turns its in-code objects into the prompt the model sees, and where each
part lives. (Patterns here were informed by the LocalAgents reference design.)

## soul.md + agent.md split — soul is always first

System instruction is split across two markdown sources:

- **`soul.md`** — the shared agent "soul" (behavioral charter), embedded at compile
  time (`state::manifest::default_soul_prompt`) and stored mutably on
  `AppSnapshot.soul`. It is rendered **first** in every prompt.
- **`agents/*.md`** — per-agent files (`planner.md`, `coder.md`, `researcher.md`,
  `synthesizer.md`) parsed by `agent_from_markdown` into `Agent { name, role, … }`.
  The markdown body becomes the agent's `role`. The right agent is chosen per run
  (`engine::pick_agent`, or the orchestrator's selection), so the task-specific
  `agent.md` loads after the soul.

## Code objects → LLM information

Initialization reduces in-code objects to LLM-facing text, all in
[`src/agent_prompt.rs`](../src/agent_prompt.rs):

- `describe_tools` — `ToolSpec`s (already MCP-shaped `{name, description,
  input_schema}`) serialized as the tool catalogue.
- `describe_skills` — enabled `Skill`s as markdown sections.
- `describe_sub_agents` — the sub-agent roster (see below).
- `Agent::short_description` — a one-line summary of an agent derived from its role,
  used in the roster.

## The whole prompt is formatted within the agent

`src/agent_prompt.rs` is the single place the system prompt is assembled —
`render_system_prompt` (and `render_critic_system_prompt` for the verifier). A
provider (`src/inference/openai.rs`) **only** wires that rendered system prompt to
the transcript and ships it; it composes no prompt sections itself. Fixed order:

```
soul → "You are {name}" → role → ReAct guidance → sub-agents → tools → skills → response-format
```

## Engine owns its messages

`src/engine.rs` owns the conversation messages distinct from the system prompt: the
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
