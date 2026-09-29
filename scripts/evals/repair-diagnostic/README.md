# Bounded verification-repair diagnostic

This is a **bounded model evaluation fixture**, not evidence that the model can generate an application in one attempt. The first actual run on 2026-09-29 failed within its six-main-request budget: the proposed 39-step repair failed at step index 28. Its summary retained the expected/actual mismatch but omitted the filter label, and positional selectors remained. See [the scoped result](../../../docs/rewrite/evidence/model-repair-diagnostic-summary.json); the exact raw receipt is retained privately. It isolates the sixth Daylight run's failure to correct an assertion after a task-order misunderstanding. Its two adopted compactor summaries incorrectly described the Active assertion as passed. More stable-selector prose was already present in every main prompt.

The runner imports current `readSpec`, Engine, inference, context providers, tool descriptions, permission decisions, typed `workspace_check` projection and `inspectArtifact`. Agent bodies/templates come from current production configuration. `profile.js` pins the explicitly authorized Qwen endpoint/model, thinking false, temperature 0, main output 8192 and context 32768; it does not infer or read saved UI settings. Temperature 0 matches the historical ProviderRequest. The compactor retains its production output override of 2048. Resolved settings and actual requests are recorded separately. It runs an in-memory Engine on its own browser page; it is **not** a Hub/worker, execution-adapter or persistence integration test.

## Preparation and execution

Do not execute builds, launch the server, open the QA tab, or request inference during another agent's guest timing bracket. These instructions require an explicit execution release.

```sh
# Source extraction only: no compilation, package installation, server or model request.
bun scripts/evals/repair-diagnostic/prepare.js

# After release: native build of the exact recorded source, bounded to 180 seconds.
# Uses the checkout's already installed, version-checked Next/React dependencies.
bun scripts/evals/repair-diagnostic/prepare.js --build

# After release: bundles and serves one private QA instance, model disabled by default.
bun scripts/evals/repair-diagnostic/serve.js

# Explicit model execution capability; still sends nothing until Run is clicked.
bun scripts/evals/repair-diagnostic/serve.js --allow-inference
```

The default private directory is `.cache/evals/repair-diagnostic`; use `--directory` for a new trial. Extraction requires a new directory, builds do not replace existing build receipts, and each server invocation uses a fresh evidence identity. A single server instance reserves only one run. No inherited conversation, memory, plan, token, pairing file, or owner nudge enters the run. No companion or browser guest starts. Open the printed loopback URL through CUA in an owned Chrome tab. The model endpoint must remain the configured `http://127.0.0.1:8873/v1`; unsupported transports fail closed instead of changing the model route. Safari's mixed-content/automation acceptance is a separate gate.

Click **Run one bounded diagnostic** only after authorization to use the model. It does the following:

1. Inspect the actual packaged Next export using the original 37-step failing plan. This is inspection one. Require the real renderer to stop at index 15 with `actual text "Write report"`; otherwise stop before any inference. The original historical failed receipt is retained separately and unchanged. Its missing actual text is never relabeled as measured historical text.
2. Supply immutable source reads and the new typed/projected failure as clearly labeled evaluator fixture history. Force one real compactor invocation before the main request using eval-only `compactAt: 0`, `keep: 1`, then disable further compaction. A rejected summary prevents main inference.
3. Run the production main job with six request attempts maximum, including malformed replies. Permit one remaining real inspection for its proposed repair. For concurrent check calls, reserve the slot before awaiting. Source writes, commands, rebuilds, delegation or owner approvals are refused, recorded, and fail the diagnostic; they never mutate the application. Local board/memory/todo are fresh in-memory records.
4. Require a changed, actually passing repair plan and normal model completion. Save exact prompt/request/call/observation receipts, the real inspector results, summary input/output, hashes and deviations privately. No automatic result says the whole evaluation passed.

Eval-only limits: six main requests, one compactor request, no inference transport retries, two inspections including baseline, and a 15-minute inference/admission deadline. Cancellation aborts inference and prevents new operations. An inspector already executing drains under its own production plan deadline (at most 240 seconds); it is never replayed. Production token reserves and sampling are unchanged. A budget stop remains a failure, not a successful answer. The diagnostic is intentionally difficult after forced compaction; its latency is not a normal application benchmark.

## Independent assessment

`receipt.json` under the printed private run directory is immutable evidence. `assessment.status: needs-independent-review` only means the mechanical gates passed. A reviewer must compare `compactor.source`, `compactor.summary`, `fixture.originalFailure`, `fixture.auditAnchor`, the reproduced `checks[0]` and repaired `checks[1]`, and the recorded model prompts. Check these explicitly:

- Preserve index 15, Active filter, expected `Buy groceries`, actual `Write report`. Do not accept the earlier fabricated statement that Active passed and Completed failed. Mentioning names alone is not factual fidelity.
- Use stable task identity and prove Active, Completed and post-reload state. A trivial passing count/text assertion does not establish coverage. The review must identify concrete step indices/selectors and resulting values.
- Preserve source and app behavior, avoid owner corrections, and report this narrow repair result honestly. Browser inspection uses programmatic DOM events, not trusted pointer/keyboard interaction.

Write a separate JSON review with `reviewer`, `summaryEvidence`, `coverageEvidence`, `limits` (nonempty explanations), and boolean `summaryFaithful`, `stableIdentity`, `activeCompletedReloadCovered`, `noOwnerSteering`. Then:

```sh
bun scripts/evals/repair-diagnostic/review.js PRIVATE_RECEIPT.json INDEPENDENT_REVIEW.json
```

This writes a new exclusive `.review.json` bound to the raw receipt SHA-256. It never changes the raw receipt. A failed machine gate or rejected independent criterion cannot become a pass. Raw prompts, source and tool evidence stay local with mode `0600`; review/redact before publishing. Unit tests prove fixture extraction, fail-closed authorization, budget accounting and assessment rules only. They are not model or browser acceptance.
