# Agent skeleton and configured behavior

The model chooses task actions. Code owns valid state transitions, permissions, cancellation, revisions and evidence. Removing those conditions would let a malformed response or a model's success claim bypass the contract.

## Where a change belongs

| Responsibility | Source |
| --- | --- |
| Loop, retries, dispatch, cancellation and budget | `src/core/engine.js` |
| Deterministic configured model input | `src/core/agent-prompt.js` |
| Response contract and parsing | `src/core/responses.js` |
| Tool input validation and examples | `src/core/tool-input.js` |
| Trusted result-to-activity projection | `src/core/tool-activity.js` |
| Workspace adapters and their receipt validators | `src/builtin/workspace.js` |
| Per-agent worker and current capability filtering | `src/runtime/agent.worker.js` |
| Desk model transport, credentials and run records | `src/runtime/hub.js` |
| Committed workspace state and completion evidence | `src/workspace/controller.js` |
| Agent policy, soul, prompts, strategies and workflows | `public/packages/starter/` |

Each worker owns an engine. A tool result becomes an observation; a trusted adapter can attach a small file, command or artifact reference. The controller and UI consume that reference. The model never sends editor navigation commands. Projection failures do not change the execution result; ambiguous call identities do not update an arbitrary tool card.

Prompt construction renders the configured static soul/job and selected context/history, then the current available tool contract and response contract. Required tool/response slots occur once. Final-only turns advertise no callable tools. Schemas supply argument descriptions and examples as well as pre-dispatch validation. Optional schemas preserve legacy tool compatibility; this is a deliberately limited schema subset, not a complete JSON Schema implementation.

## Configured workflows

`builder/agent.md` selects the generic workbench template for scripts and project scaffolding. Its package permissions exclude application build/check tools. `strategies/project.json` and `workflows.json` bind it to **Scripts and projects**, selected workspace execution, and a current-source command receipt. There is no branch on the builder's name in the engine.

The application agents share `prompts/application.md`, which carries the Next static-export profile once. Application completion still requires its artifact checks. The reviewer reads the same task-bound workspace, with write/run/build/check denied. A command exiting zero is evidence of execution, not universal functional correctness. Source must remain unchanged throughout the command and still match when completion is checked; source-changing commands need a subsequent verification command.

The desk provides capabilities; a folder requests them. Connecting model relay does not grant commands, host files or browser control. Browser execution and Local Bun remain explicit separate targets. This refactor does not add Apple model access or establish the Browser Linux build gate.

## Reproduce real-model evaluation

The opt-in runner uses the production folder, worker and model broker, with a scoped Local Bun companion and independent checks on withheld inputs. Commands execute natively; the project directory is not an operating-system sandbox. Use a trusted model endpoint and a new directory for every attempt:

```sh
bun scripts/evals/project-loop.js --run --model MODEL_ID --base-url http://127.0.0.1:8873/v1 --directory .cache/project-loop/my-script-attempt --case script
```

Cases are `script`, `project` and `repair`. Evidence retains exact prompts, transmitted requests, command receipts, checks and timings. [Recorded results](evidence/project-loop-local.json) include the initial evaluator permission-setup failure; corrected script, project and repair attempts passed on the local Qwen 27B profile. These are individual smoke checks, not proof that any small model succeeds. The first repair attempt did not first execute a failing test. Subsequent repair-02 and repair-03 passed a stricter trace check: failed command, acknowledged edit, then a newly started successful command, followed by independent withheld inputs.

Fresh planner and UX contexts split prompt compilation from activity projection; an independent reviewer identified the concurrent-edit verification flaw and added its regression.

## Context and verification follow-up

Supported tool schemas now advertise nested shapes, enum choices, descriptions and bounds that the validator enforces. Workspace observations decode their own JSON receipts into structured model context; successful writes omit duplicated source content while preserving the complete raw receipt. Conflicts and failed commands retain their diagnostics. Replaying the same six repair-02 receipts reduced their serialized result payload from 2,487 to 1,935 characters; this is not a latency or token benchmark.

MCP schemas are retained separately as `providerInputSchema`: full JSON Schema is shown to the model; validation remains the provider’s responsibility rather than being passed through the limited local validator. Provider-only tool catalogues omit fabricated argument examples. MCP `isError` results now become failed tool observations rather than successful text. Completion configuration and each verification attempt are visible in the run inspector; no configuration or receipt is labeled explicitly, rather than being inferred from the agent's answer or Completed status.

## Inspector snapshot boundary

`getRunDetails` forwards completion configuration and receipts explicitly. After awaiting archived evidence, it rereads a live run and captures its pending approvals synchronously, without another await, then freezes the combined view. Persisted-only records receive no live approval authority. Tool cards match nonempty run and call IDs; rendered call text is never an identity fallback. A captured approval cannot replace a recorded outcome. Snapshot cards say what was pending when captured and require a refresh for newer state.

The earlier renderer change omitted completion fields at the controller boundary. Controller-level regressions now cover that omission, rather than relying solely on rendering synthetic props.

## First small-model results

The installed llama-server was used with verified official Qwen2.5-Coder 1.5B Q4_K_M weights in a separate loopback process. [All six attempts are recorded](evidence/small-model-first-pass.json); none passed. Syntax-only JSON output mode did not establish semantic tool use: writes repeated despite revision conflicts, and the scaffold attempt exhausted output before a valid complete action. A read-only replay with real assistant/user history roles chose the same conflicting action, so history restructuring was not applied.

The evaluator now accepts `--context-length 8192` and optional `--json-output` for providers that support JSON object output. It records raw response text per attempt, including rejected replies, and returns actionable command-verification feedback. Clearer workspace content/revision argument descriptions are committed for continued evaluation; they did not solve this model's failures and are not in deployment `fcc4c29`.

Next investigations must separate baseline code generation, response-envelope complexity, tool-selection quality and actual token accounting. Do not claim that a syntax-constrained response or a model's final-answer example proves task completion. The 27B passes remain separate from these small-model failures.

A [direct code-generation diagnostic](evidence/small-model-code-baseline.json) removed the tools and loop entirely while retaining the CLI requirements. Its single response still failed: it returned Markdown fences and used nonexistent `Bun.args`. Exact output and a separately labeled fence-stripped diagnostic both failed positive and empty inputs. This narrows the diagnosis beyond response-envelope complexity; one attempt does not establish a model capability ceiling. The temporary model server was stopped afterward; the user's existing model server was unchanged.

## Receipt-calibrated context budgets

`src/core/token-budget.js` interprets provider input usage. The engine retains the highest observed actual/base estimate ratio for each resolved model configuration; that ratio raises subsequent prompt and compaction estimates without reducing the fallback. The desk provides an opaque stable identity across short-lived model handles, with owner cleanup. Prompt snapshots retain the base estimate, factor and sample count. Missing or malformed usage cannot calibrate a request. Anthropic cache input is included according to its [usage contract](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

This remains a heuristic: it cannot protect the first request or guarantee later counts as content changes. A [real calibrated run](evidence/small-model-calibrated-budget.json) stopped before request 15 at the 8,192-token guard, after 14 provider requests. It still repeated conflicting writes and failed independent checks. Dashboard status now distinguishes recorded context limits, step limits and invalid model replies; it does not infer model capability from a failure.

## Response-contract experiments

[Read-only decision replays](evidence/small-model-contract-replays.json) compared the captured v2 request against removing its final-answer example and shortening its response instructions. At the first post-write decision, all three returned an unverified final answer. At an existing conflict, the concise variant proposed a command while the other two repeated the conflicting write. These isolated changes do not establish a reliable loop, so production prompt rendering was left unchanged.

A separate native-tools replay used the same configured workspace schemas with native assistant/tool messages and llama-server's `--jinja` mode, following [upstream function-calling documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md). The model returned fabricated tool-output text with no API tool call. Nothing was executed or accepted as a receipt. This experiment changed several representation variables together and is diagnostic, not a controlled claim that one API mode is better. The temporary server was stopped afterward.

## Agent write revisions

The `workspace_write` schema now requires `expect`, rather than merely asking for it in prose. The desk's agent-facing `workspace.write` operation separately rejects omitted, invalid or contradictory revision arguments before calling the file service. New files use `0`; existing files use the observed revision. A stale revision returns a conflict and preserves newer owner content. Direct editor saves retain their existing behavior. This guarantee applies to this write tool; executable shell commands can mutate files independently.
