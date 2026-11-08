# Non-blocking calls: the cases (phases, workflows, owner, lifecycle)

The model: a step starts calls and ends. Each call finishes on its own and calls `wake(owner)`.
`wake` checks the owner's wait condition and, when it is met, starts the owner's next step
(a model step for a loop, the next step for a workflow). One step per owner at a time; a wake
during a step sets `wake_pending`. Below: every case where that meets phases, workflows, the
owner or the lifecycle, the rule we pick, and why. **Owner** = you; **owner of a call** = the
loop or workflow that started it.

Status: rules marked **(proposed)** need your OK; the rest follow from decisions already made.

## 1. Events that can wake an owner

| Event | Wakes? | Note |
| --- | --- | --- |
| call finished (ok / failed / timed_out) | when the wait condition is met | the normal callback |
| call cancelled | same as finished | a cancelled call counts as done |
| owner input (a new message to the loop) | **yes, at once** (proposed) | running calls keep running; the step sees them under RUNNING |
| phase changed (by you, a tool, or an exit) | yes, if the loop is waiting | the next step renders the new phase |
| a help.ask reply arrives | yes | help.ask is a call that completes on an outside event |
| boot after a crash | once, if calls were running | they become `interrupted` |
| timer (workflow `wait`, alert) | yes | later, with the scheduler |

## 2. Phases

| # | Case | Rule | Why |
| --- | --- | --- | --- |
| P1 | Phase changes while calls run; a running tool is not offered in the new phase | the call **finishes**; its result is delivered, marked `phase: <old>` | aborting a half-done write is worse than finishing it; the next step cannot start new calls of that tool |
| P2 | A phase exit (gate) is due while calls run | the exit **waits for running calls** (or the model cancels them) | an exit is a commit point: "checks passed" must not race a write |
| P3 | A call result triggers a phase exit (e.g. checks pass) | the exit happens in the callback, then `wake` starts the step in the new phase | one path for every phase change |
| P4 | You switch the phase by hand while the loop waits | allowed; P1 applies to the running calls; the loop wakes | you are always allowed to steer |
| P5 | New phase offers no tools | the next step's format has no calls; results still arrive and are shown | consistent with "an engine with no tools shows exactly that" |
| P6 | A call's `effects` exceed the new phase (e.g. `write` in a read-only phase) | **(proposed)** cancel `long` calls, let `quick` ones finish | long writes are the risky ones; quick ones are near done |

## 3. Workflows

A workflow step = a set of calls + a wait condition, advanced by the same `wake`.

| # | Case | Rule | Why |
| --- | --- | --- | --- |
| W1 | Parallel branches, then a join | the step's calls start together; `await: all` or `await: <ids>` is the join | same grammar as the loop |
| W2 | A call fails inside a workflow step | the step's `on_fail`: `stop` (default) / `continue` / `retry n` (proposed) | translation §B: a failure skips later groups |
| W3 | A workflow step calls another engine (sub-engine run as a tool) | a `long` call that completes when that engine answers; its answer is the result | callbacks chain up: child answer → parent wake |
| W4 | Workflow started in phase A, phase changes to B | **(proposed)** pinned to the phase it started in; P2 applies: the exit waits for it, or you cancel it | half a workflow under a new phase's rules is incoherent |
| W5 | Loop and a workflow of the same engine both wake | each has its own step; they share the engine's single writer, so writes never interleave | one writer per object |
| W6 | Refocus (context at 90%) | a workflow of the loop that runs **between** steps, never during one; running call ids live in `state.calls`, outside history, so folding cannot lose them | refocus must not drop in-flight work |
| W7 | Waiting on a timer or an outside event | the event is a call that completes later (like help.ask) | one mechanism for "finishes later" |

## 4. You (the owner) and the lifecycle

| # | Case | Rule |
| --- | --- | --- |
| O1 | Stop while waiting | running calls are cancelled (recorded `cancelled`); the loop goes idle |
| O2 | New input while an answer is pending (held for running calls) | the pending answer is marked superseded; the input wakes a step |
| O3 | Restart / crash with calls running | on boot they become `interrupted`; one wake so the model sees it |
| O4 | `max_steps` reached while calls run | no more model steps; running calls cancelled; `stop_reason` says so |
| O5 | Shutdown | calls cancelled and recorded `interrupted`; nothing lost from state |

## 5. Ordering and races

| # | Case | Rule |
| --- | --- | --- |
| R1 | Two calls finish at the same moment | exactly one step starts |
| R2 | A result arrives while a model step is in flight | recorded at once; `wake_pending`; next step after this one |
| R3 | A result arrives after the run ended | recorded as `late`, shown in history, no wake |
| R4 | Result order | by completion time; each result carries its call id |
| R5 | Same id reused in a later step | refused (`format` note); ids are unique per run |

## 6. Open questions for you

1. **Owner input wakes at once** while calls run, or waits for the wait condition?
2. **P6**: cancel long calls whose effects the new phase forbids, let quick ones finish?
3. **W2**: default `on_fail: stop` for workflow steps?
4. **W4**: workflows pinned to their starting phase, and a phase exit waits for them?
