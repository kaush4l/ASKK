# Browser-Native Harness Extensibility Contracts

This project is a client-only browser/WASM harness. New capabilities must be pre-compiled and registered; the agent loop, orchestrator, prompt assembly, and state store must not be edited for each extension.

## Tool contract

A tool is a descriptor-backed module:

```rust
use crate::state::{AppResult, AppSnapshot, ToolSpec};
use crate::tools::{ToolDescriptor, ToolFuture};
use serde_json::{Value, json};

pub fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: ToolSpec {
            name: "my_tool".to_string(),
            description: "Short capability description.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": { "input": { "type": "string" } },
                "required": ["input"]
            }),
        },
        handler,
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let input = args.get("input").and_then(Value::as_str).unwrap_or("");
        Ok(format!("handled {input}"))
    })
}
```

Registration is centralized in `ToolRegistry::new()` via `register_builtin_tools`. The core loop only asks the registry for specs and execution by name; it does not contain a tool-specific match.

Acceptance test: `tools::tests::registry_accepts_new_tool_descriptor_without_execute_match_edits` proves a brand-new descriptor can be registered and executed without changing the executor match logic.

## Agent contract

An agent is a Markdown manifest in `agents/*.md`:

```md
---
id: specialist
name: Specialist
enabled: true
tools: web_search, file_read
response_format: toon
---

Role, responsibilities, constraints, and operating instructions.
```

The parser preserves explicit `tools:` allowlists, so a newly registered tool can be granted to an agent by name without editing the agent loop.

Acceptance test: `state::tests::parses_agent_tool_allowlist_from_markdown` proves a new agent manifest can grant a custom tool name.

## Skill contract

A skill is a Markdown bundle in `skills/<id>/SKILL.md`:

```md
---
id: research
name: Research
enabled: true
---

Instructions contributed to prompt assembly.
```

Enabled skills are composed into the prompt by the provider-normalization path. They are state data, not hidden model memory.

## Validator contract

Validators gate tool results and final answers. `ValidatorRegistry` returns a structured `ValidationOutcome { ok, feedback }`. Failures are recorded in `run.scratchpad.verification`, added as visible loop feedback, and bounded by the run verification retry budget.

Acceptance tests: `validators::tests::*` and `engine::tests::final_answer_validation_*` prove tool and final-answer validation paths.

## LLM provider contract

Providers implement the `InferenceProvider` trait. The loop depends on the trait and `ProviderConfig`, not vendor-specific code. The current concrete provider is OpenAI-compatible.

## Worked extensibility demo

### Add a new compiled tool

1. Add one descriptor module, for example `src/tools/demo_tool.rs`, exporting `descriptor() -> ToolDescriptor`.
2. Add one registration line in `register_builtin_tools`:

```rust
registry.register(demo_tool::descriptor());
```

No changes are allowed in the engine loop, orchestrator, prompt assembly, state store, or executor dispatch. The executor already calls descriptors by name.

Test coverage: `tools::tests::registry_accepts_new_tool_descriptor_without_execute_match_edits` constructs a brand-new descriptor and executes it through `ToolRegistry::execute` without adding a tool-specific match arm.

### Add a new agent

1. Add one manifest file under `agents/<id>.md`:

```md
---
id: research_specialist
name: Research Specialist
enabled: true
tools: web_search, file_read
response_format: toon
workflow: parallel_batch
---

You are responsible for browser-grounded research tasks. Use only your allowed tools.
```

2. Register/load the manifest through the existing workspace file bridge or bundled defaults path.

No changes are allowed in the engine loop, orchestrator, prompt assembly, state store, or worker runtime. The agent manifest provides role text, tool allowlist, optional workflow, and model profile references as data.

Test coverage: `state::tests::parses_agent_tool_allowlist_from_markdown` proves custom tool allowlists survive manifest parsing. Agent selection and worker execution are covered by `worker_client::tests::select_worker_agent_prefers_enabled_agent` and orchestrator tests.

## Workflow contract

A workflow is declarative state, not imperative code:

```rust
WorkflowDefinition {
    id: "parallel_batch".to_string(),
    name: "Parallel batch orchestration".to_string(),
    initial_step: "planned".to_string(),
    transitions: vec![
        WorkflowTransition::new("planned", "workers_running", "dispatch child workers"),
        WorkflowTransition::new("workers_running", "workers_joined", "join child worker"),
        WorkflowTransition::new("workers_joined", "aggregated", "aggregate child results"),
        WorkflowTransition::new("workers_running", "failed", "child worker failed"),
    ],
}
```

The orchestrator attaches a `WorkflowGate` before a declared workflow run and must call `transition_to(next_step)` before moving between lifecycle stages. Undeclared transitions are blocked and recorded in `WorkflowRuntimeState.blocked_transition`.

Acceptance tests: `workflow::tests::allows_declared_transition` and `workflow::tests::blocks_undeclared_transition_and_records_feedback`.

## Definition-of-Done traceability

See `docs/definition-of-done.md` for the invariant-to-component map and the repeatable browser smoke demos.
