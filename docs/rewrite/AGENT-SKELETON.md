# Agent skeleton and configured behavior

The model chooses task actions. Code owns valid state transitions, permissions, cancellation, revisions and evidence. Removing those conditions would let a malformed response or a model's success claim bypass the contract.

## Where a change belongs

| Responsibility | Source |
| --- | --- |
| Loop, retries, dispatch, cancellation and budget | `src/core/engine.js` |
| Deterministic configured model input | `src/core/agent-prompt.js` |
| Response contract and parsing | `src/core/responses.js` |
| Native proposal normalization and paired history | `src/core/native-protocol.js` |
| Native streaming descriptors and fragments | `src/core/native-tools.js`, `src/core/inference.js` |
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
# Optional provider response schema

An owner model profile may set `structured_output: "json_schema"` for an explicitly compatible OpenAI-style endpoint. Omit it to preserve ordinary generation. This requests the current agent's JSON v2/v3 envelope and available tool names through `response_format`; it does not enable native provider tool calls. The response model generates both instructions and schema, and final-only decisions remove action alternatives. The schema and wrapper contribute to the estimated context budget, and each prompt snapshot and transmitted provider request records the actual schema.

Each tool name is paired with a copy of its local `inputSchema`, when supplied by its trusted adapter. Required and optional fields remain as declared, nested object defaults are explicit, and duplicate names retain the first tool. Legacy tools and provider-only schemas retain an open argument object; arbitrary provider schemas are not relocated because their references may depend on the root. Unknown local-schema keywords fail explicitly in this optional mode. Local validation, permissions, source revisions and completion evidence still govern execution; provider constraints are not a complete semantic equivalent of the JavaScript validator. `strict: false` avoids claiming support for every provider's strict-schema subset. Endpoint support must be tested; unsupported contracts, providers, and conflicting `request_params.response_format` fail rather than silently downgrade. Model connection probes remain transport-only and do not test schema support. [llama.cpp documents schema-constrained responses](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1chatcompletions-openai-compatible-chat-completions-api); compatibility with other endpoints is not implied.

[Three real Qwen3 1.7B trials](evidence/qwen3-schema-loop.json) produced valid envelopes without parse repairs but failed script, scaffold, and repair checks. Repeated unproductive actions and invalid arguments remain unresolved. This is a configurable protocol capability, not demonstrated task reliability, and is not enabled in shipped profiles. The evaluator accepts `--structured-output` separately from `--json-output`; combining them is rejected.
# Configured history assembly

Agent folders may opt into `history_format: messages`; omitted or `transcript` preserves the existing literal transcript. Message mode requires exactly one standalone `{{conversation}}` line in the user side of the prompt template. Package import/restore and legacy folder loading validate this boundary. The slot expands into actual accepted user and assistant messages. Observations and summaries become labeled user-level task data, never system messages or invented native provider tool calls. Text containing role labels or template placeholders stays literal, and rejected model candidates remain repair data rather than accepted assistant history.

Template text before and after the slot stays in separate user messages. Wrapping the slot in tags cannot quote history across message boundaries; keep quoted summarization templates in transcript mode. Consecutive user messages are retained deliberately. Chat endpoints must support these messages; CLI transport still serializes them to role-labeled text. Exact assembled messages and `historyFormat` appear in each prompt snapshot, and budgets use the final messages. Layer `chars` describe authored slot representations, not serialized provider bytes; use the actual snapshot or request for wire inspection. Existing templates and shipped agent defaults are unchanged.

The evaluator accepts `--history-format messages` to change only the copied agent folder. [Four Qwen3 comparisons](evidence/qwen3-history-loop.json) remain failed trials, not proof that role preservation improves task completion. The unconstrained message-history scaffold created files but failed functional and test checks; the other trials did not deliver working source.

The permissive response envelope now explicitly sets `args.additionalProperties: true`. [llama.cpp documents a nonstandard default of false](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md#a-word-about-additionalproperties). This preserves the intended open argument object; actual arguments still pass the tool's local validator. An isolated scaffold trial with this correction also failed, so it is not evidence that the converter default caused earlier failures.

## Argument constraints and retained validation diagnostics

[Three Qwen3 argument-schema trials](evidence/qwen3-argument-schema-loop.json) failed: scaffold repeated reads, the script response exhausted output before dispatch, and repair repeated an invalid Node command. More complete provider constraints did not establish task reliability. No missing-argument acceptance rule was relaxed. A regression verifies that a provider ignoring the schema cannot invoke an adapter with missing required input.

Repair and terminal rejection events now retain validator faults with their exact attempt IDs in stored run logs. These are validation diagnostics, not model reasoning. Tests cover persistence, final rejection without a repair, distinct failures across retries, and detachment from subsequently mutated event arrays.


## Pre-execution rejection and model sampling

Tool input validation now emits `failureKind: "invalid_input"` only when the local schema rejects the proposal before the adapter starts. The engine suppresses activity projection for that result. Both live and recorded tool cards show **Not run**, with **Input rejected before execution** and the retained validation diagnostic. Adapter exceptions remain **Failed**, including exceptions whose text imitates validation errors. Neither label independently proves that an operating-system process started; command receipts provide that evidence. Existing records without typed metadata retain their original status. Tests cover handler nonexecution, identical-looking adapter failures, live/recorded projections, persistence/export and accessible rendered labels; no new Safari or phone acceptance is implied.

The real-model evaluator accepts `--sampling path/to/profile.json`, with explicit `temperature`, `top_p`, `top_k`, `min_p` and `seed` fields. It validates and records the profile and tests its transmitted provider values. Omission preserves the historical temperature-zero configuration. Sampling belongs to model configuration; the engine has no model-name conditionals.

[Qwen's model guidance](https://huggingface.co/Qwen/Qwen3-1.7B#switching-between-thinking-and-non-thinking-mode) recommends temperature 0.6, top-p 0.95, top-k 20 and min-p 0 for thinking mode, and warns against greedy decoding. The historical temperature-zero trials therefore cannot establish the model's capability ceiling. [An explicit evaluation profile](evidence/qwen3-thinking-sampling.json) uses those values plus seed 42, which is an evaluation choice rather than a vendor recommendation. Changing decoding parameters does not relax parsing, revision checks, tool permissions or independent task checks.

[Six expanded-budget and sampling trials](evidence/qwen3-capacity-sampling-loop.json) retain all outcomes. With 32,768 context and 8,192 output, the greedy script passed independent checks, the greedy scaffold exhausted output before acting, and greedy repair produced correct code but skipped the required initial failing check. The three documented-sampling trials all failed: scaffold and repair stopped on malformed responses; the script exited successfully while producing no required output. The temporary server's actual slot context was confirmed and the server was stopped. Commands used installed host runtimes; browser execution and one-shot reliability remain unproven.

The native protocol below implements the next transport experiment. JSON-envelope modes remain separate; neither prose nor a model-authored tool-result claim becomes an execution receipt.


## Optional native provider tool calls

An agent folder may opt into:

```yaml
response_protocol: native
contract_version: 3
response_format: json
history_format: messages
```

`json` here describes the internal single-action domain contract. The model receives native function definitions and answers in ordinary text, without the custom `do`/`act` envelope. Omitted `response_protocol` remains `envelope`; shipped agent defaults are unchanged. Template messages still use exactly one standalone conversation slot. This initial native profile supports OpenAI-compatible providers with one function call per decision; it does not claim every provider or parallel native calls. [llama-server function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md) requires the appropriate server/template support (`--jinja` in these trials).

Schemas and tool descriptions come from the available adapter descriptors and are recorded in `PromptSnapshot.nativeTools` and the exact transmitted request. Legacy parameter descriptions remain visible without inventing local validation constraints. Request budgeting includes the native definitions. Credentials and endpoint configuration remain desk-owned. Native mode rejects conflicting structured output and manually supplied native or legacy function declarations.

The stream accumulator exposes partial fragments only as unexecuted data. It yields a proposal after a complete stream, a supported finish reason, a unique provider ID, a known function and object-shaped JSON arguments. Truncation, cancellation, multiple calls and malformed arguments cannot dispatch. Completed proposals normalize into the existing action contract, then use the existing permission, argument, revision and completion checks. No transparent retry occurs after a streamed fragment. Plain-text answers still need configured completion evidence.

Accepted history retains the provider's original argument string and pairs the assistant call with one actual result carrying its provider ID. It never parses arbitrary history text into calls. Compaction keeps call/result pairs together and carries used-ID metadata through restoration. Interrupted incomplete records are rejected rather than filled with fabricated results. Tool cards retain the independent engine call ID and show the provider call ID only in expanded details; receipt pairing remains keyed by engine identity. The model supplies no UI navigation actions.

The evaluator accepts `--response-protocol native --contract-version 3 --history-format messages`. A deterministic provider fixture exercises the production folder, worker, model broker, actual workspace writes, a real host command and independent script checks. This fixture establishes integration, not model competence or browser execution.

[Three native Qwen3 trials](evidence/qwen3-native-loop.json) produced one script pass and two failures. The script independently passed numeric, empty and invalid-input checks; the model itself ran empty-input checks after recovering from a command-not-found error. Scaffold and repair reached real tool dispatch without envelope repairs but produced or retained incorrect code, repeated unsuccessful commands, and exhausted the step budget. Their completion claims remained unverified/incomplete. These results establish one native script-loop smoke pass, not general task reliability, thorough model self-verification, or Browser Linux support. The temporary model server was stopped.

### Required command receipts

A workflow can opt into a stronger receipt contract without changing the agent kernel:

```json
{
  "completion": {
    "checks": [{
      "capability": "workspace.commands",
      "options": { "commands": ["bun run test", "bun run lint"] }
    }]
  }
}
```

These are exact command strings, not patterns or commands automatically executed by the completion adapter. The agent receives workflow requirements in workspace context and uses the ordinary permission-checked command tool. Importing this configuration grants no execution permission. Up to 16 unique commands are allowed; each is bounded to 8,192 characters. Fresh evidence is mandatory.

The desk selects the latest task-owned receipt for every configured command. All must exit zero without timeout or cancellation and retain the same saved-source fingerprint as the checked workspace. Pending saves/jobs, changed runtime bindings, source changes during commands or verification, and replaced receipts reject completion. A failed later rerun cannot borrow an earlier pass. The configuration and accepted evidence remain immutable run records. Missing/failed command diagnostics return through the existing completion-rejection loop; no task-specific branch is added to the engine.

A passed suite proves only the assertions its commands actually execute. It does not make model-authored tests independent or comprehensive. The existing `workspace.command` option still means one successful command, while `workspace.artifact` retains its artifact-specific checks. Dashboard cards separate **Agent finished** from the scope and outcome of the latest recorded completion evidence. Full configuration and receipts remain in the inspector.

Expected program rejection is a test result, not automatically a failed assertion. Put the expected exit/output in a trusted assertion command that exits zero only when the observed behavior matches. Require that exact command through `workspace.commands`; do not reinterpret an arbitrary nonzero receipt from the model as success. An unrelated successful command cannot replace a missing required check. Keep cancellation, signal termination and timeout distinct from expected rejection.

The real-model evaluator accepts `--completion path/to/contract.json`. Its script case now defaults to configured assertion commands for positive, negative, empty and invalid inputs; project and repair retain their prior completion configuration. Withheld behavior checks remain outside the model's repair feedback. The native production-worker fixture tests completion rejection for a missing required command, normal guarded execution, and accepted receipts after all commands run.

### Local evaluation boundaries

Project-loop trials execute in a fresh OS temporary directory outside the harness/evidence tree. This avoids package managers finding the harness's ancestor scripts when a model has not created its own manifest. It is a working-directory boundary, not an operating-system sandbox. Native commands still have the companion process's host authority.

`execution-environment.json` and the evaluation record retain the actual runtime identity/root. After shutdown, final files are copied to the requested evidence directory's `project` archive before the temporary root is removed. Archive failure retains the temporary source for recovery. Agent commands use a 30-second deadline; independent checks use 10 seconds, matching the execution API's seconds contract.

The evaluator stops admission and drains active commands and writes before independent checks. Regression coverage records cancellation exits and termination-handler writes before archival; missing exit receipts fail the lifecycle explicitly. This does not establish containment of arbitrary detached native descendants. Do not treat aborted or manually interrupted trials as quality comparisons.


## Bounded command observations

The workspace command tool owns its model-context projection in `src/builtin/workspace.js`; the engine does not branch on an agent name or task. In compact observation mode, valid exit receipts retain identity, revision, exit, cancellation and timeout fields. Long `output`, `stdout` and `stderr` fields share a budget of 6,000 retained UTF-16 units, preserving beginning and end with explicit omission markers and original/omitted counts. Short outputs remain exact. The limit is a character budget, not an exact token guarantee; markers and other receipt fields add overhead.

Raw observation events and command receipts remain unchanged for inspection and verification. Native tool history uses the projected observation paired with its actual provider call ID. Invalid receipts and unstructured transport errors are not reinterpreted or summarized by this projector. Legacy observation mode remains unchanged. A log excerpt cannot establish that omitted diagnostics are irrelevant or that a command passed.

### Selecting required checks by reference

`workspace_run` accepts exactly one input form: `{command: "…"}` or `{requiredCheck: 0}`. The zero-based index addresses the run's configured `workspace.commands.options.commands` array, advertised under workspace environment `referenceCompletion`. Inherited parent requirements appear separately as `overallTaskCompletion`; they do not grant child references. Equivalent root requirements are not duplicated in the prompt. The tool resolves that reference from the immutable completion snapshot before existing command guardrails, permissions and approval. It does not add permission or change execution location.

Trusted tools may provide a synchronous `resolveArguments` hook. The generic dispatcher validates the proposed input, resolves and snapshots actual arguments, then invokes the guarded tool. Invalid references are rejected before execution. The desk and evaluation adapters independently require the resolved command to equal the indexed command in their authoritative run contract. Raw commands remain available. Receipt matching, source freshness, runtime identity, cancellation and completion checks are unchanged.

Approval displays the actual command. Original model arguments remain in the call event; the observation carries separate resolved arguments. Live cards and recorded inspection show both. A resolved argument is not evidence that execution succeeded. The native worker fixture executes configured checks by index and passes independent CLI checks; permission fixtures cover allow, ask, refusal, deny, forbidden command text, invalid references and external configuration mutation. Browser/model reliability requires separate evidence.

### Adapter-owned command facts and command lifecycle

`src/execution/toolchain.js` owns runtime-specific command semantics. Execution adapters attach these facts to the current workspace environment; `src/core/context.js` renders that environment afresh for each model request. Agent definitions and the engine do not select task commands. Unknown runtimes receive no inferred Bun/npm guidance, and the facts explicitly say they are not execution verification.

For Bun, the facts distinguish the built-in runner (`bun test`) from a package-script invocation (`bun run <name>`). For the browser image's declared npm profile they distinguish package scripts from test runners. This follows the [Bun test documentation](https://bun.sh/docs/test) and [runtime documentation](https://bun.sh/docs/runtime); completion still requires actual bound command receipts and independent checks. The regression runs both a passing and deliberately failing temporary Bun test project, and checks context changes do not retain the previous runtime's guidance. This does not prove a small model will use the guidance correctly.

The optional native companion owns each command's original process-group lifecycle in `host/process-group.js`. Completion must wait for bounded group cleanup and child stream closure; uncertain cleanup is an explicit transport error, never a zero-exit success. Separate terminal sessions retain their own lifecycle. This is not OS isolation: descendants that leave the original group and host resource quotas remain outside the contract. UI timeout labels come from recorded `timedOut` evidence and retain the actual exit code, separately from workspace reconciliation or unknown outcomes.

### Completed native response repair

The inference adapter distinguishes a complete but unusable native proposal from an incomplete transport. Only a structurally valid single-call stream ending with `[DONE]` and `tool_calls` can attach a rejected candidate for an unknown function or invalid JSON-object arguments. Fragment errors, missing/invalid call identities, multiple calls, missing completion, truncation, cancellation and network failures remain terminal for this path.

`Engine.step` feeds that candidate into the configured repair budget. Each correction renders a fresh request, keeps separate attempt/request/completion records, and counts the quoted rejected proposal against the context budget. The proposal never enters accepted native history and never dispatches a tool. Ordinary completion metadata identity is preserved. A production-worker fixture verifies an invented function can be corrected before real file/command work and independent checks; this is integration evidence, not model competence.

`Hub.replyRejections` preserves exact rejected proposals independently of the bounded activity log and tool receipts. Inspection, restoration and export retain frozen records. The workbench shows collapsed rejection records separately from executed tool activity; older records explicitly disclose missing exact proposal text. Asking for correction does not prove a later reply succeeded.

The opt-in project evaluator accepts `--command-timeout` and `--check-timeout` in seconds, retaining defaults 30 and 10. Both must be above zero and at most 1800; chosen limits are recorded in `executionTimeouts`. Shorter limits bound duration, not process count or host authority, and trials with different limits are not like-for-like performance comparisons. Independent behavioral assertions remain unchanged.
