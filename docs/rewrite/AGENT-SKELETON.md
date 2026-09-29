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
