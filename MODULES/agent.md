# Module: agent

**One-sentence purpose:** The pure `step(state, event) -> (state, effects)` function and the
phases-as-data machine that walks Plan/Work/Verify, plus the forge pipeline as agent behavior.

**Invariants upheld:** I3 (host-testable with a scripted port), I7 (`step` is pure; effects
describe, never do), I8 (transitions arrive/leave as events), I13 (`Effect::CallModel` carries a
`Document`, making ad-hoc prompts unrepresentable at the call site).

**Routes served / fragments rendered / sections provided:** None directly; the forge (a built-in
module by manifest) serves its pipeline UI via the ordinary dispatch path.

**Capabilities required:** None — it emits Effects; the runtime exercises capabilities.

**Public surface:**
- `AgentState, PlanStep` — the whole agent as serializable data (snapshot/restore, pause across
  refresh — the properties async fns could not give, ARCHITECTURE §1c).
- `Effect` — the §11 closed set, coarse by rule; serializable so pending work survives refresh.
- `PhaseConfig, ToolScope, ResponseContract, Verdict, ExitCondition, PhaseExit` — ADR-010 Option C
  record; `ToolScope::None` is structural absence, not refusal.
- `v1_phases()` — Work/Verify default, Plan-on-demand, Answer exit (RESEARCH phase-cut) as data.
- `step(AgentState, Event) -> (AgentState, Vec<Effect>)` — the frozen §11 signature; owns ALL
  transitions and guard counters.
- `parse_reply(ResponseContract, &str) -> Result<ParsedReply, AgentError>` + `ParsedReply` —
  contract parsing, unit-testable against recorded model output.
- `ForgeStage, ForgeRun, Draft, forge_manifest(), forge_step(...)` — §7 pipeline as data + a
  step function; gates hold until their Event arrives.
- `AgentError` — the machine's typed failure vocabulary (malformed, illegal, exhausted).

**Depends on / Depended on by:** `kernel`, `context`, `module` (never `script` directly — only
via `module`, per §4) / `core` (the runtime is `step`'s only runtime caller).

**Owns:** transition rules, retry/replan guards, phase configs, the forge state machine.

**Explicitly does not own:** I/O of any kind, port implementations, effect execution, rendering
beyond its own fragments, section assembly (it selects, `context` assembles).

**Failure modes:** malformed reply → repair-retry with notice; illegal transition → machine
handles, never prose; guard exhaustion → deterministic task failure; all surfaced as Events.

**Test contract:** (1) table-driven transition coverage over `v1_phases` exits; (2) retry/replan
guards terminate a looping scripted model; (3) Plan/Verify emit no tool effects ever;
(4) `step` determinism: same state+event ⇒ same (state, effects); (5) forge gates do not advance
without their approval Event; (6) parse_reply per contract × malformed inputs.

**Rejected alternatives:** async fns with injected ports (loses snapshot/resume — §1c scoring);
phases as code (ADR-010 Option B — answers the phase-cut question by recompiling).

**Blast radius:** every turn of every agent; `Effect` variants are consumed by `core::runtime`
and persisted — a variant change is a data migration, not just a recompile.

**G4 status:** one Work-phase turn implemented (UserMessage → CallModel(Document) →
ModelReplied → quiescent) under the Answer contract; the agent seeds and mutates its
own §8.2 paper in `paper.rs` (section-providers-as-modules replace this at G5+).
`parse_reply` is total for Answer; structured contracts, guards-in-anger, and the
forge remain `todo!(G5)`. Tests: effect-sequence golden, determinism, quiescence.
