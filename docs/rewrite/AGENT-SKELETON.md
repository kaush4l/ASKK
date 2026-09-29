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

## Second small-model diagnostic

[Official Qwen3 1.7B Q8_0 results](evidence/qwen3-small-model-diagnostic.json) retain the failed production JSON loop alongside separate native-tool probes. The production loop proposed missing-revision writes, which the new schema rejected; no command executed. A native-tool proposal with thinking enabled produced a script that independently passed positive/negative, empty and invalid CLI inputs. That source check was performed by the evaluator, not by the model's own command loop. Native mode without thinking produced well-formed calls but unsuitable source.

Protocol and thinking mode changed together in the promising probe. Before adding another engine protocol, test thinking enabled in the existing production JSON loop. Neither the single candidate pass nor this second model supersedes the retained 1.5B failures or establishes small-model reliability. Both downloaded models remain in ignored local cache; neither is bundled into Pages.

## Thinking and repair-context follow-up

The evaluator now accepts `--thinking` and `--max-output-tokens N`, records both settings, and leaves existing defaults unchanged. These are provider request settings, not agent-name branches in the engine. Qwen3 1.7B completed one production script loop with thinking enabled and provider JSON output mode **omitted**; the strict v2 parser remained active. It repaired a missing revision argument, recovered from two command failures, and executed the script. The delivered [source](evidence/qwen3-script-loop.js) passed independent numeric, empty and invalid-input checks. The model itself only ran the positive example; its final text copied the response example. This is a functional smoke result, not proof of thorough self-verification or one-shot reliability.

With provider JSON mode enabled, the thinking-enabled trial emitted no recorded reasoning and failed during output exhaustion. With both thinking and provider JSON mode disabled, the script trial failed. These observations are specific to the pinned local server/model configuration, not a universal provider restriction.

Project scaffolding failed on malformed JSON. Strict JSON parsing now reports bounded syntax diagnostics, distinguishes non-object JSON, and validates an empty object against the response shape. Repair prompts also include the latest rejected content as a JSON-quoted, explicitly unexecuted candidate; they do not store it as accepted history or include reasoning-stream content. The normal prompt budget covers this additional context and rejects oversized repairs before another provider call. Neither diagnostic detail nor candidate context established a scaffold pass in the recorded trials. A read-only one-action instruction probe also failed, so it was not adopted.

[All seven follow-up runs](evidence/qwen3-thinking-loop.json) retain exact-result summaries, settings, usage and raw-evidence hashes, including the failed existing-project repair. Reproduce the passing configuration against the pinned model server with `--case script --context-length 8192 --thinking`, omitting `--json-output`; use a new evaluation directory. The default output allowance remains 2048. The temporary server was stopped after the trials. No browser, guest or broader reliability proof is inferred from this local smoke result.

## Shared loop budgets

`src/core/loop-budget.js` now owns authored/runtime bounds and omitted defaults: `max_steps` 1–1,000 (default 10), `repairs` 0–3 (default 2), and `keep` 1–10,000 (default 4). Package import/restore, legacy folders, worker initialization, engine and displayed composition use the same rules. Explicit null, numeric strings, fractions and out-of-range values fail with an actionable integer range; they are never clamped or coerced. Zero repairs remains supported. `keep: 0` is rejected because history compaction requires retained recent turns.

Compatibility: previously accepted packages above 1,000 steps or 3 repairs, or with zero retained turns, must update their authored settings before import/restore. Existing installed source bytes are not rewritten. This preserves the established execution ceilings while making them visible at configuration admission. These limits are per invocation, not cumulative team expenditure limits. This change does not establish improved small-model task success.

## Experimental single-action contract

A folder can explicitly select `contract_version: 3` with JSON responses. Its tool reply is `{"do":"tool","act":{"name":"tool_name","args":{}}}`; final replies retain `{"do":"done","act":"..."}`. The parser rejects arrays, extra fields and malformed/trailing JSON, then normalizes the one validated call into the existing dispatcher. Tool schemas, permissions, revision checks, cancellation, receipts, completion checks and UI projections remain unchanged. Accepted history and generated examples preserve this selected shape. Version 2 remains the default, and supports staged parallel calls.

The evaluator accepts `--contract-version 3`, modifying only its copied fixture folder. This is not native provider tool calling, and does not alter the shipped builder. The first Qwen3 1.7B project trial reached tool dispatch but failed by repeatedly selecting invalid Bun scaffolding commands. Simpler syntax is not evidence of competent task decisions. Retain full-loop evidence before adopting this format as a default.

[Single-action trial evidence](evidence/qwen3-single-action-loop.json) now includes all three tasks on the same Qwen3 1.7B profile, 8,192-token request window, 2,048-token output allowance, thinking enabled and provider JSON mode off. Project: 19/24 syntactically accepted responses, 15 calls, no files, failed. Repair: 4/9 accepted responses, three commands, no acknowledged edit, failed. Script: 9/12 accepted responses, six calls, invalid delivered script, failed. The latter two ended on output length. These are descriptive single trials, not statistical protocol comparisons. The temporary evaluation server was stopped; the owner's model server was not changed. No version-3 default migration is justified by these results.

## Tool-result navigation

`src/workbench/tool-navigation.js` resolves exact retained resources for the conversation, dashboard and run inspector through one shared renderer. Receipt inspection is separate from opening a file, command or preview. Explicit command/artifact selections cannot fall back to the newest resource after eviction; absent destinations remain unavailable. Duplicate IDs are not navigable. File links explicitly open the current workspace version, not historical source content. Snapshot approval state remains captured rather than replaced with live approval authority.

Intentional result navigation pauses Follow, switches the appropriate phone surface, closes the inspector and focuses a workspace control after mounting. Modal intents and newer result selections invalidate a pending file read, preventing late reads from closing a newer dialog or replacing a selected command. Automated resolver, rendering, and modal lifecycle checks cover these boundaries. A local Chrome export smoke check loaded 11 agent definitions, without starting a model or execution runtime; result-click focus, Safari and phone interaction acceptance remain unverified by that smoke check.

## Source-bound evaluation receipts

The version-2 evaluator records task/trace ownership, command text, pending/completed/failed stages, runtime identity, source snapshots before/after execution and completion receipts separately from provider completions. Completion rejects active operations, source changes, write-and-revert through its write adapter, and a newer same-task command that finishes during snapshot collection. The production controller also rejects that superseded-command race. Content snapshots cannot detect an external transient change that restores identical bytes between captures; this is not filesystem confinement or a continuous filesystem audit.

Project evaluation now requests the explicit `bun run test` invocation, requires its retained source-matching receipt, independently runs the declared script, and checks actual executed-test counts through [Bun's JUnit reporter](https://bun.sh/docs/test/reporters). Empty or skipped-only suites do not pass merely because Bun exits zero. The report is outside the source snapshot. Independent checks must retain the delivered source snapshot. Invalid-input exit checks also require the valid-input controls to have passed. Future evidence records hashes of both evaluator modules.

[Two source-bound script smoke runs](evidence/qwen3-fresh-script-loop.json) passed on Qwen3 1.7B, contract version 2, thinking enabled and provider JSON mode off. The second used the final evaluator: four prompts, no parser repairs, five tool proposals including three actual commands for positive, invalid and empty inputs; independent negative/fractional, empty and invalid cases passed. The agent ran host `node`, while independent checks used Bun, so these results do not prove bundled-runtime portability. The first run preceded the final concurrent-command/JUnit corrections. The [delivered source](evidence/qwen3-fresh-script.js) is retained with its hash. Both are smoke trials, not statistical reliability or scaffolding/repair acceptance; all earlier failures remain recorded. Temporary model servers were stopped.
