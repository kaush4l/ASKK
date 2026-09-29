# Configured strategies and worker ownership

The agent loop remains framework independent. A strategy coordinates agent invocations; it does not construct model responses, execute tools, or ask the model to update the UI.

## Published configuration

`public/workbench.json` selects a published `strategies/*.json` definition. Agent mode names an agent and a delegation ceiling. Graph mode names roles, explicit dependencies, literal query templates, allowed input slots, the final output role, and concurrency/time limits. Prompt text lives in `public/prompts/strategies/*.md`; role instructions and context providers live in agent Markdown.

The loader resolves only published files, validates the complete definition, computes a SHA-256 identity of the resolved definition, and stores that definition before admitting graph work. Changing configuration requires a new run. There are no model-authored expressions, hidden conditional edges, or automatic retries.

`Compare perspectives` is the initial general-purpose graph: approach and independent critique run concurrently; synthesis waits for both. These roles have no external tools and receive only the configured goal, declared predecessor outputs, static instructions, response contract, and their own budget context. This workflow produces reasoned proposals, not proof that external actions occurred.

## Runtime contract

`src/core/strategy.js` supplies validation and deterministic scheduling. The Hub adapter allocates a coordinator record without an LLM worker. Every admitted role gets a fresh worker, even when its agent definition normally remembers conversations. The role cannot read or overwrite that agent's resident conversation. Owner restrictions and a pinned workspace binding are inherited; nested model delegation is disabled for these graph roles.

The scheduler enforces configured parallelism and checks wall-clock expiry again at receipt/admission boundaries. Only a genuine `done` child receipt contributes an output. Oversized declared inputs fail instead of silently truncating. Failure skips queued work, requests cancellation of active siblings, and waits for their actual outcomes. A stop acknowledgment is not an exit receipt. Late/stale role events cannot unlock another invocation.

Workspace graphs additionally require the controller's independent completion check against the delivered source revision. Role completion enters `verifying`; a failed check ends `incomplete`. Cancellation during verification discards any later check result. The shipped general-purpose graph does not start Browser Linux or native execution.

## Observable records

The coordinator stores the immutable definition and its hash, sequenced role states, actual child IDs, dependency structure, and references to child results. Each child retains its own exact prompt snapshots, provider requests, tool receipts, and completion/usage data. The trace aggregates observed usage rather than estimating unreported usage as zero.

The dashboard projects these records into role cards and linked inspection views. Approval waits come from host approval records. Tool receipts remain unchanged by presentation labels. No model needs to send a frontend event or describe a UI operation.

Reload marks active work interrupted and does not replay roles or old tools. History retention groups completed traces so a still-running graph does not lose a finished sibling's evidence. Export refuses a graph with a missing recorded child.

## Deliberate limits

Graph version 1 is a bounded acyclic role graph with one declared output. It does not promise arbitrary feedback cycles, dynamic branches, live graph steering, unrestricted thread counts, or automatic execution recovery. Browser and model resources still bound practical concurrency. Single-agent loops retain their existing steering and conversation behavior. General-purpose external browser control remains an explicit companion capability; running an agent in a Web Worker does not grant DOM automation.

Browser Linux's full Next build and current Safari acceptance are still separate, incomplete gates. Native build evidence cannot satisfy either gate.
