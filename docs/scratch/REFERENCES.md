# REFERENCES — mechanics taken from other harnesses

> Source-level study of Hermes (read locally at `~/PycharmProjects/hermes-agent`),
> agent-zero, Devika, bolt.diy, OpenHands, smolagents, `earendil-works/pi`, and
> Claude Code. Only concrete mechanics are recorded — this is not a survey.

## The ten worth stealing, ranked

**1. Compaction is an EVENT in the log, not a mutation of the array.**
*(OpenHands `CondensationAction`, carrying `forgotten_events_start_id/end_id`
and `summary_offset`.)* Makes compaction replayable, auditable, undoable, and
visible in the UI — and a bad summary stops being unrecoverable. Costs one new
session record type. **Highest leverage idea in the whole survey.**

**2. The four-phase compressor, including the free first pass.** *(Hermes
`context_compressor.py`.)*
- Phase 1, **zero LLM cost**: replace old tool results >200 chars with
  `[Old tool output cleared to save context space]`. Reclaims most of the tokens.
- Phase 2: protect the tail by **token budget walking backwards**, not by a
  message count; snap boundaries so a tool_call/tool_result pair never splits.
- Phase 3: summarise into a fixed skeleton —
  `## Goal / ## Constraints & Preferences / ## Progress {Done,In Progress,Blocked} / ## Key Decisions / ## Relevant Files / ## Next Steps / ## Critical Context`
- Phase 4: reassemble, then inject stub results for orphaned tool calls.
- **Update the previous summary rather than re-summarising from scratch.**

Hermes and pi converged on nearly the identical skeleton independently. That is
about as strong a signal as this field produces.

**3. The three compaction refusals.** *(pi + Claude Code.)* Reject any summary
whose `stopReason === "length"` — a truncated summary must never become a
checkpoint. Never cut at a tool result. Stop auto-compacting after ~3
consecutive attempts and error rather than thrash.

**4. Child authority is intersected, never expanded — and blocked tools are
deleted from the child's PROMPT.** *(Hermes
`child_toolsets = [t for t in requested if t in parent_toolsets]`; agent-zero's
`filter_tool_prompt()`.)* The child never learns a tool it cannot call. Plus a
fixed denylist — no recursive delegation, no user interaction, no writes to
shared memory — and a depth cap of 2.

**5. The budget warning goes in the LAST TOOL RESULT, not the system prompt.**
*(Hermes.)* `[BUDGET: Iteration X/Y. N iterations left. Start consolidating
your work.]` at 70%, `[BUDGET WARNING: … Provide your final response NOW.]` at
90%. Keeps the cached system prefix byte-stable — which matters more here than
almost anywhere, because golden fixtures hold the prompt to the byte. Share the
budget across parent and child so delegating cannot multiply the ceiling.

**6. Identity splits three ways: timeless policy / recomputed environment /
triggered knowledge.** *(OpenHands; agent-zero.)* Two of the three already
exist here as `Soul` and `SystemInstructions`. The missing moves: ship an
**empty override slot** a profile fills without copying anything else
(agent-zero's `specifics.md` is 0 bytes in core and 15KB in a profile), and
attach the hedge verbatim to any retrieved content — *"It may or may not be
relevant."*

**7. Recompute volatile context every turn and CLEAR it.** *(agent-zero's
`[PROTOCOL]`/`[EXTRAS]` sandwich, `extras_temporary` cleared each turn.)*
History is bracketed by a must-follow block and a context-only block, and the
prompt *teaches the model the difference*. This is what stops a long session
carrying twenty stale clock readings.

**8. Skill frontmatter conditionals — especially the inverted one.** *(Hermes
`requires_tools` / `fallback_for_tools`.)* `fallback_for_tools` shows a keyless
workaround skill **only when** the keyed tool is absent. In a harness where the
user may have configured nothing, that single field is worth a lot. Pair with
the standing instruction that the agent writes and patches its own skills:
*"Skills that aren't maintained become liabilities."*

**9. Show the model's ACTUAL RENDERED PROMPT in the UI.** *(agent-zero's
`DATA_NAME_CTX_WINDOW = {text, tokens}`; OpenHands's system-message modal.)*
Almost nothing in this space does it, and the assembler here already produces
exactly this string with a `key()` hash per component. Nearly free, and the
strongest debugging surface any of these projects has.

**10. Design the projection BACKWARDS from the widgets, and stream partial tool
output into them.** *(Devika's state object; bolt.diy's `onActionStream`.)*
Devika's every push carries `internal_monologue`, `browser_session{url,
screenshot}`, `terminal_session{command, output, title}` — the interface defines
the record, not the reverse. bolt.diy applies an action *while it streams*:
select the file, flip to the code view, push partial content on every sample.
Latency reads as progress. Corollary from pi: the arrival record carries a
`details` payload the view renders and **the model never sees**.

## Loop shapes, for the record

| Project | Shape | Calls/turn | Stop condition |
|---|---|---|---|
| Hermes | ReAct tool loop | 1 per iteration | no tool calls; 90-iteration budget shared with children |
| agent-zero | ReAct monologue | 1 per iteration | **tool-driven** — the model calls `response` to end its own turn; no step cap |
| bolt.diy | not a loop — one generative turn the client executes as it streams | 1–3 | `finishReason==='length'` continuation, capped at 2 segments |
| OpenHands | event-driven latch over an append-only stream | 1 per action-observation cycle | `AgentFinishAction`; 500 iterations or a dollar budget |
| smolagents | step loop | 1 per step + 1 salvage on exhaustion | `final_answer` tool; max_steps 20 |
| pi | structured tool calling | 1 per turn | **no turn ceiling at all**; five stop conditions incl. every result carrying `terminate: true` |
| Devika | hardcoded pipeline, not a loop | ~5 fixed | the pipeline ends |

Two independent designs put the stop decision **in a tool the model calls**
(agent-zero's `response`, OpenHands's `finish`, smolagents' `final_answer`)
rather than in a parser deciding whether text looks like an answer. Worth
weighing against the response-model approach carried from ASKK.

## Deliberately NOT stolen

- **Devika's architecture.** Abandoned. `src/sandbox/code_runner.py` and
  `firejail.py` are **literally zero bytes** — the isolation was planned and
  never written, while `runner.py` executed LLM-authored commands on the host
  via `subprocess.run(command.split(" "))`. Its RAG is a 2-line stub and the
  knowledge base's read and write are both commented out. Only its UI survives
  contact.
- **smolagents' `LocalPythonExecutor` as a security model.** A 1,600-line
  hand-written AST interpreter whose own docs say it is not a security
  boundary. A browser gives real origin isolation for free; do not reimplement
  a weaker guarantee.

## One free design review

pi's `packages/agent/src/harness/` is the same author's **second, unwired
rewrite** of this exact problem — fully typed, every method stubbed to
`HarnessNotImplemented`. Its hook list, if a hook surface is ever wanted here:
`before_run | transform_context | before_request | before_payload |
after_response | before_tool | after_tool | before_compaction |
before_navigation`.

## Naming note

"pi agent" is ambiguous. The studied project is **`earendil-works/pi`**
(formerly `badlogic/pi-mono`), MIT, an actively developed agent toolkit — not
Inflection's closed consumer Pi. Popularity claims about it are unverified;
the code is what was read.
