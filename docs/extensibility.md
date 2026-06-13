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

### Tool composition: one trait, one set, many paradigms

Every tool source — however it is implemented — is unified behind one
composition contract, [`core::Tool`](../src/core/tool.rs):

```rust
pub trait Tool {
    fn spec(&self) -> &ToolSpec;          // what the model is told it can call
    fn paradigm(&self) -> ToolParadigm;   // RustFn | Js | Mcp | Connector | Agent
    fn call<'a>(&'a self, snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a>;
}
```

A run's tools live in **one** `core::ToolSet` (an ordered set of `Rc<dyn Tool>`)
that the engine composes alongside its inference handle and response kind. The
set is read three ways: `specs()` to inject the manifest into the model,
`contains()` as the allowlist gate, `get(name).call(...)` to run a call. The loop
**never matches on a tool's kind** — dispatch is polymorphic.

The paradigm of each name is chosen exactly once, when the shell assembles the
set in [`session::build_tool_set`](../src/engine/session.rs):

| paradigm | concrete `impl Tool` | callability | environment / state |
|---|---|---|---|
| `RustFn` | `core::RustTool` (wraps a compiled handler) | runs the `fn` directly | none |
| `Mcp` | `mcp::registry::McpTool` | routes to the live server's client | server worker brought up at run start; carries its display name |
| `Js` | `McpTool` whose server is the tool host (`tool-host-builtin`) | runs a user JS function | dedicated Web Worker with a persistent per-tool `state` object |
| `Agent` | `tools::agent_tools::AgentTool` | delegates via `call_agent` | carries the target agent id |
| `Connector` | reserved — a hosted-connector MCP server kind | (future) | (future) |

Adding a paradigm is one `impl Tool`, never an edit to the loop or the dispatch
path (invariant 2). "Tools are the only thing that needs an environment": the
set owns that lifecycle — bringing MCP/tool-host servers up before the loop runs,
then handing the loop a flat collection of callables it treats identically.

Acceptance tests: `core::tool::tests::*` cover the set's insertion/allowlist/spec
semantics and a polymorphic `get(...).call(...)`.

### Workspace actions as MCP tools

The Workspace page's actions (list/read/create/edit files, run JS, run a bridge
command) are also exposed to the agent as **MCP tools** by the built-in
`workspace` server ([`src/mcp/workspace_server.rs`](../src/mcp/workspace_server.rs)),
an in-process `McpTransport` (no worker, no JS) whose `tools/call` delegates to the
same compiled handlers (`file_list`/`file_read`/`file_write`/`file_edit`/`run_js`/
`run_command`). It is seeded into every snapshot (`workspace-builtin`, kind
`workspace`), brought up at run start like any other MCP server, and can be
disabled on the MCP page. Adding a third transport kind required no engine change:
`McpServerKind` + one `connect_server` arm behind the boxed `McpTransport` seam.

### Compiled functions and the stateful tool host

Beyond MCP server configs, the agent's tools can come from two more sources, both
in parity with the compiled built-ins:

* **Compiled functions** ([`src/state/compiled_function.rs`](../src/state/compiled_function.rs)):
  a `CompiledFunction` is one named JS handler body + description + input schema,
  managed on the MCP page and persisted in the snapshot. At run start every enabled
  function is synthesized into ONE shellized server (`tool_host_server_config`,
  stable id `tool-host-builtin`) that the MCP runtime brings up in its own
  dedicated Web Worker — the **tool host**. The shell worker compiles each handler
  as `async (args, state) => { ... }` where `state` is a single object shared by
  all functions and persisted for the worker's lifetime (across calls AND across
  runs, until a function is edited or the page reloads — the runtime's fingerprint
  cache keeps the worker alive while the definition is unchanged). So the tool
  host both hosts all the user's functions and maintains their state in another
  Web Worker. Browser test:
  `mcp::worker_transport::browser_tests::shellized_state_persists_across_calls`.

* **Agent tools** ([`src/tools/agent_tools.rs`](../src/tools/agent_tools.rs)):
  when `call_agent` is in a run's allowlist, every enabled peer agent is also
  offered as its own named tool `agent_<slug>` (e.g. `agent_researcher`), whose
  call routes through the `call_agent` handler with `agent` pre-filled — the
  nesting cap and untrusted-observation framing are inherited, never duplicated.
  Agent-tool names are reserved in the MCP registry's display-name assignment, so
  the three sources can never collide on a name.

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

Acceptance test: `state::manifest::tests::parses_agent_tool_allowlist_from_markdown` proves a new agent manifest can grant a custom tool name.

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

Acceptance tests: `engine::validators::tests::*` and `engine::tests::final_answer_validation_*` prove tool and final-answer validation paths.

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

Test coverage: `state::manifest::tests::parses_agent_tool_allowlist_from_markdown` proves custom tool allowlists survive manifest parsing. Agent selection and worker execution are covered by `worker_client::tests::pick_agent_prefers_enabled_agent` and orchestrator tests.

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

## The unified extension skeleton

Every extensible subsystem follows: descriptor + trait + id-keyed registry +
one-line registration.

| subsystem | descriptor | trait | registry | registration |
|---|---|---|---|---|
| tools | `ToolSpec` | `core::Tool` (handler fn for built-ins) | `ToolRegistry` (compiled) → `core::ToolSet` (per-run, all paradigms) | one line in `register_builtin_tools` |
| inference | `ProviderConfig` / model id | `InferenceProvider` | inference registry | id-keyed `get_or_create` |
| responses | `ResponseField` table (`define_response!`) | `StructuredResponse` | `ResponseKind` dispatch | macro + enum variant + match arm |
| strategies | `Phase` list | `Strategy` | `StrategyRegistry` | one line in `register_builtin_strategies` |

Strategy selection resolves: `LoopParams.strategy` → agent `strategy_id` →
`react`. Strategy travels with the work: `call_agent({agent, query, strategy})`.
