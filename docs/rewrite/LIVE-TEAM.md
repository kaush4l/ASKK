# Live team and recorded runs

The dashboard separates **Your live team**, which shows actual run instances,
from **Agent library**, which lists configured definitions. An available
configured agent is not evidence that it has started, received a message, or
completed work. Two runs of the same definition remain two cards, including when
agents from different imported packages share a display name.

This describes the UI and evidence contract. Release-specific browser results
belong in [implementation status](IMPLEMENTATION-STATUS.md). See also the
[portable-agent guide](PORTABLE-AGENTS.md) and
[configured role strategies](CONFIGURED-STRATEGIES.md).

## Read the team

Each card carries a run identity, a readable status, and an activity or task
excerpt. Status is expressed in text as well as a dot. Queued work counts as a
live instance; a stopped, failed, incomplete or interrupted run does not become
successful merely because its worker is no longer active. A pending owner
decision is associated by exact run identity, never by a shared name or tool.
Stopping remains a distinct state while the outcome is pending.

Cards expose three separate actions:

- Open the card to inspect that exact recorded run.
- Open **Instructions** to inspect its agent definition. The run inspector's
  historical prompts remain the evidence of what an earlier request contained.
- Use **Stop run** on a live instance to request cancellation. The button does not
  itself establish that work has stopped.

The live list begins with eight cards and recent history with six. **Show more**
reveals additional records explicitly. Card activity excerpts contain at most
280 UTF-16 code units plus an ellipsis, without splitting a surrogate pair; the
full recorded task is available through inspection. The excerpt is bounded in
the DOM, not merely hidden by a visual line clamp.

Live cards retain creation order as tool activity and status text change. An
actual terminal state can move a card into recent history. There is no streaming
layout animation. Keyboard buttons, readable state labels, a single-column
narrow layout and reduced-motion styles support direct navigation.

## Relationships are evidence, not a chat animation

**Delegated by** comes from a recorded parent run. Configured strategy roles use
**Parent run** because a scheduler relationship does not establish that one role
sent another a message. Coordinator records can supply an inspectable parent
without appearing as agent cards themselves. If the parent record is absent
from the supplied view, the card reports that limitation rather than inventing
an agent or a connection.

A **Selected task** badge requires a matching run, task, trace or recorded parent
ancestry. Names, instructions and apparent role similarity do not establish
membership. Configured graph dependencies remain in the strategy view: they
specify which role outputs are prerequisites. They are distinct from a child
run's parent receipt.

None of these links is a message delivery or read acknowledgement. Communication
acknowledgements are still a missing contract. The view does not infer exchanges,
private reasoning or progress from model prose.

## Inspect a snapshot

The run inspector opens a snapshot of retained records. **Refresh snapshot** is
an explicit read of newer evidence; the dialog is not a continuously streaming
inspector. It shows the assigned task, status, recorded result or error, parent
identity and any pinned package identity.

The evidence sections distinguish:

- **Recorded guidance:** notes actually retained in this run's history. A note's
  presence does not prove every subsequent model response followed it.
- **Historical prompts:** the model input recorded for that particular step and
  attempt, not a forecast of the next prompt or hidden chain of thought.
- **Provider requests and completions:** transport attempts remain separate;
  transport secrets are redacted. These records are different from the agent's
  final answer.
- **Tool activity:** an outcome pairs with a unique recorded call ID and
  compatible tool name, with run/agent identity checked when supplied. Duplicate,
  orphaned, conflicting or otherwise ambiguous events remain inspectable as
  unpaired records. Position and matching prose never substitute for identity.

Tool success comes from the recorded typed outcome. False, zero, null and an
empty string remain distinct recorded results; a missing outcome is not filled
in as success. Exact raw tool records remain available alongside their readable
presentation.

Record lists initially show twelve entries. Large prompt, request, completion,
guidance and raw-record payloads mount when their disclosure is expanded. This
reduces rendered content; it does not make the underlying snapshot a paginated
storage API or impose a total evidence-memory limit. The assigned task, result
and currently rendered tool cards can still contain substantial text.

## Reload and export

Reload restores retained run summaries and history for inspection. It does not
resume a recorded run, replay a command, reapprove an action or recreate authority over
an old execution environment. An interrupted record is history to review, not an
automatically resumed task. Browser storage and retention limits still apply;
visible conversation text is not a substitute for a missing stored trace.

**Export this trace** resolves the selected run's recorded trace. It can read
retained evidence after reload without starting execution. The export uses the
run's original recorded workspace binding when one exists; it does not attach
the environment that happens to be selected now. A general agent task can have
no workspace binding.

Command rows are included only when their recorded run IDs belong to the exported
trace. Artifact records require a recorded build-command link to one of those
commands. A matching project, revision or currently visible preview is not enough
to establish provenance. Artifact HTML, transient URLs and frame authority
material are excluded from this export. Records outside the retained command or
artifact view are not reconstructed or invented. Missing trace evidence and
export failures remain explicit errors.

## Remaining limits

This is a view of actual state and retained evidence, not a delivery/read-ack
system or a model reliability claim. Inspector refresh is manual, browser history
can be evicted, and bounded card/list rendering does not bound all retained data.
General Browser Linux application-build acceptance remains pending; displaying a
completed agent or a recorded command does not establish a verified browser-built
application. Current Safari guest/artifact and VoiceOver acceptance are separate
gates recorded in implementation status.
