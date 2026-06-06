# Browser-Native Harness Definition of Done Traceability

This note maps the project goal invariants to concrete ASKK components and the tests or runnable demos that exercise them.

## Verification command

Run this from the repository root:

```sh
cargo fmt --check
cargo test
cargo check
dx build --platform web
```

The browser artifact is written to:

```text
target/dx/askk/debug/web/public
```

## Reproducible browser smoke demos

Use the deterministic mock provider when a real browser-reachable LLM is not available:

```sh
python3 scripts/mock-openai-provider.py
python3 -m http.server 8765 --directory target/dx/askk/debug/web/public
```

Open `http://127.0.0.1:8765/` and configure:

```text
Base URL: http://127.0.0.1:9989/v1
Auth: No auth
Model: mock-worker-model
```

### Parallel worker demo

Submit a decomposable batch goal, for example:

```text
Compare these:
- Rust browser worker orchestration
- Dioxus 0.7 UI responsiveness
```

Expected result:

- ASKK shows one aggregated assistant answer.
- Run details show child worker events.
- `curl http://127.0.0.1:9989/stats` reports `max_active_requests >= 2`, proving parallel child agent execution through browser Web Workers.

### Reload/resume demo

Start a run, reload while a run is in progress, and confirm:

- ASKK reports `Recovered a paused run from IndexedDB.`
- The Chat page shows `Resume`.
- Clicking `Resume` completes the task and saves the completed run back to IndexedDB.

## Invariant traceability

| Invariant | Enforcing component | Mechanism | Test or runnable demo |
|---|---|---|---|
| Prompt = instruction | Prompt assembly in `src/inference.rs` | The provider call receives soul, agent role, skills, live state, tool schemas, and validator feedback as explicit prompt/history text. | `inference::tests::agent_calls_include_soul_prompt_before_role`, `inference::tests::tool_history_is_sent_as_user_context` |
| State = truth | `AppSnapshot`, `AgentRun`, `RunScratchpad`, `IndexedDbStorage` in `src/state.rs` and `src/storage.rs` | Messages, tool calls, tool results, artifacts, jobs, workers, workflow state, budgets, and events are serializable state; load normalization recovers interrupted runs as paused jobs. | `state::tests::checkpoint_current_run_persists_resumable_job_record`, `state::tests::normalize_pauses_running_run_after_reload_and_keeps_resume_checkpoint`, reload/resume browser demo |
| Tools = evidence | `ToolRegistry` and `BrowserExecutionProvider` in `src/tools.rs` and `src/execution.rs` | The loop executes only registered pre-compiled descriptors that are also in the selected agent's allowlist. Valid tool results are recorded before they can support final answers. Unknown or disallowed tools return structured failed `ToolResult`s. | `tools::tests::registry_accepts_new_tool_descriptor_without_execute_match_edits`, `engine::tests::rejects_tool_not_in_agent_allowlist_before_execution`, `execution::tests::browser_executor_rejects_shell_and_test_commands`, validator tests |
| Validator = reinforcement | `ValidatorRegistry` in `src/validators.rs`; validation gates in `src/engine.rs` | Tool and final-answer validation produce structured feedback events and observations; rejected outputs re-enter the bounded loop and are not returned as final. | `validators::tests::*`, `engine::tests::final_answer_validation_reenters_loop_on_failure`, `engine::tests::final_answer_validation_accepts_grounded_answer` |
| Workflow = discipline | `WorkflowDefinition`, `WorkflowRuntimeState`, and `WorkflowGate` in `src/state.rs` and `src/workflow.rs` | Declarative transitions constrain the `parallel_batch` orchestration lifecycle; undeclared transitions are blocked and recorded as workflow feedback. | `workflow::tests::allows_declared_transition`, `workflow::tests::blocks_undeclared_transition_and_records_feedback`, orchestrator workflow events in browser run details |
| Orchestrator = control | `src/orchestrator.rs`, `src/worker_client.rs`, `src/worker_transport.rs`, `src/worker_runtime.rs` | The orchestrator alone decomposes batch tasks, selects child agents, schedules worker-pool waves, updates worker state, cancels/joins, and aggregates results. Browser child agents run through the typed Web Worker transport. | `orchestrator::tests::*`, `worker_transport::tests::*`, `worker_runtime::tests::cancel_command_returns_structured_cancel_event`, parallel worker browser demo |
| Model = bounded reasoning engine | `RunBudgets`, tool allowlists, agent manifests, and engine/orchestrator guards | Each run has max steps, verification retry limits, no-progress limits, selected agent tools, and per-agent/provider parameters. The model can request tools and emit text only through the loop; hidden tool calls outside the selected allowlist are rejected before execution. | `engine::tests::*` budget/classification tests, `engine::tests::rejects_tool_not_in_agent_allowlist_before_execution`, `state::tests::parses_agent_tool_allowlist_from_markdown`, step-limit behavior in normal runs |

## Global Definition of Done status

| Requirement | Status | Evidence |
|---|---|---|
| Browser-only harness with no app backend other than browser-reachable LLM APIs | Satisfied | Dioxus/WASM build via `dx build --platform web`; storage is IndexedDB; model calls use browser fetch. The optional local bridge is a development adapter for CORS/files/search, not a required application backend. |
| Provider-agnostic LLM client | Satisfied | Callers depend on `InferenceProvider`; concrete OpenAI-compatible implementation selected from `ProviderConfig`. Tests cover base URL/auth normalization. |
| Single agent completes tool-using task and budget exhaustion path | Satisfied | Engine tests cover final answer validation and step-limit termination; browser runs exercise the loop. |
| Pre-compiled tools invoked through registry and recorded as evidence | Satisfied | `ToolRegistry` descriptor API, `BrowserExecutionProvider`, `ToolResult` state, and registry extensibility test. |
| Validators reject tool/final outputs and feed bounded correction | Satisfied | Validator tests and engine validation feedback tests. |
| Orchestrator spawns at least two child agents in parallel inside Web Workers | Satisfied | Worker transport/runtime tests plus browser demo with mock provider concurrency stats. |
| Declarative workflow constrains multi-step process | Satisfied | `parallel_batch` workflow and blocked-transition tests. |
| State is serializable, persisted, inspectable, and resumable after reload | Satisfied | IndexedDB storage, checkpoint jobs, reload normalization tests, reload/resume browser demo. |
| Extensibility acceptance test for new tool and new agent | Satisfied | `docs/extensibility.md`; `tools::tests::registry_accepts_new_tool_descriptor_without_execute_match_edits`; `state::tests::parses_agent_tool_allowlist_from_markdown`. |
| Every invariant maps to a component and enforced mechanism | Satisfied | This document. |
| Each shipped capability has a test or runnable demo | Satisfied | Rust unit tests plus the browser smoke demos above. |
