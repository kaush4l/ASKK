# ADR-010 — Phase machine

**Status:** Proposed (PROVISIONAL)

## Context

One monolithic ReAct call is asked to plan, act, judge, and narrate at once (PROMPT §9). The
design splits this into phases, where **a phase is a named configuration of the Context
Document** (ADR-009) — sections at declared fidelity, a response contract, exposed tools, a
budget, and legal exits. Orchestration must live in the pure `step()` function (§11, I7), not in
the model. This ADR fixes the phase representation, the v1 phase set, and the transition rules.

## Options

**Option A — monolithic ReAct.** One loop, tools always exposed, one contract. Cheapest to
build, matches most prior art (ASKK's hermes loop, LocalAgents' orchestrator). Rejected:
judgment and execution share one call, so a model that misjudges also acts on the misjudgment;
there is no point where "no tools" is enforceable; and the whole document churns every turn,
forfeiting the cache.

**Option B — phases as code.** `enum Phase` with hand-written per-phase assembly and transition
functions. Typed and direct, but every phase change is a core change, and §18's open question —
is Plan/Work/Verify even the right cut? — would be answered by recompiling. It also invites
per-phase special cases that erode the "a phase is *only* a document configuration" claim.

**Option C — phases as data.** A `PhaseConfig` record; the machine interprets it:

```rust
struct PhaseConfig {
  phase: PhaseId,                       // Plan | Work | Verify | (others as earned)
  sections: Vec<(SectionId, Fidelity)>, // what the paper contains, at what fidelity
  contract: ResponseContract,           // exact expected reply shape; parsed, not trusted
  tools: ToolScope,                     // None | Only([ToolId]) — affordances narrowed to match
  budget: Budget,
  exits: Vec<(ExitCondition, PhaseId)>, // the only legal next phases
}
```

## Trade-offs

C costs a thin interpreter and validation (a config can be wrong at runtime where B's would be
wrong at compile time — mitigated by validating configs in `cargo test`, since they are static
data in v1). In exchange: the phase-cut question stays open as a *data* question, phase configs
are golden-testable as documents, and §8.4's endgame — the agent proposing a phase adjustment
through the forge, gated — is representable without a rebuild. B closes all three.

## Decision

**Option C.** The v1 set is Plan / Work / Verify per §9:

| | Plan | Work | Verify |
|---|---|---|---|
| sections | soul, identity, operating_rules, affordances(Full), task, history(Summarized) | soul, identity, operating_rules, affordances(narrowed), task(current step), observations | soul, identity, operating_rules, step criteria, observations |
| tools | **none** | only the step's declared tools | **none** |
| contract | ordered steps + success criteria | exactly one tool envelope | pass / fail / retry / replan + reason |
| excluded | observations (volatile noise) | full history | everything not needed to judge |
| exits | → Work | → Verify | → Work (next/retry), → Plan (replan), → Answer (done) |

Notes on the matrix:

- Plan and Verify expose no tools **structurally**: `render` receives `ToolScope::None`, so no
  tool schema exists in the call at all — not a refused permission, an absent affordance.
- Work does **one step per call**; the loop, not the model, advances the plan cursor.
- Verify judges against the *plan's own success criteria* carried as a section — the judge reads
  the spec, not the vibes.

### The pure state machine

`step(state, event) -> (state, effects)` owns all transitions. A model response is parsed
against the phase's contract; the parsed variant is matched against `exits`; anything else —
malformed reply, illegal transition, budget exhausted — is handled by the machine (retry with a
repair notice, or fail the task), never by prose. Guards live here too: max consecutive retries
and max replans are counters in `AgentState`, so a looping model terminates deterministically.
All of this tests on the host with a scripted model port, no browser, no network (I3, I7) —
transition coverage is a table-driven unit test.

### The static-prefix rule

`soul`, `identity`, `operating_rules` appear in **every** phase at Full fidelity, first, and the
ADR-009 ordering makes them byte-identical across Plan/Work/Verify — so the provider cache
holds across an entire task, not just within a phase. Enforced by a golden test that renders all
three phase documents from one state and asserts a common byte prefix. Corollary from §9: a
phase needing a different `soul` is a different agent, not a fourth phase.

Deeper thinking is a budget, not a phase: raise `budget` inside Plan rather than adding a
"Think" phase (§9).

## Consequences

- Phase behavior is legible in one table and diffable when it changes; changing the cut
  (merge, add a phase) is a config + exits edit, no machine changes.
- The interpreter must stay thin — if a phase ever needs bespoke code beyond its config, that is
  a design smell to surface, not to special-case.
- Cost profile: three short calls replace one long one; Work calls are cheap and retryable,
  which is where "small loops" pays (§9).

## Reversal cost

Low by construction — the phase set is data. Collapsing to two phases or adding a fourth is an
edit to configs and exit tables plus new goldens. Abandoning phases-as-data for hand-written
code is also cheap early (three configs to transcribe); the reverse migration is the expensive
one.

## Pending evidence

- **docs/research/phase-cut.md:** whether Plan/Work/Verify is the right cut for this workload
  or collapses to two phases / needs a fourth (PROMPT §18). Option C makes any answer a config
  change; the *exits* semantics and pure-machine claim survive regardless.
- **docs/research/prompt-caching.md:** if provider caching demands a longer shared prefix,
  `affordances` narrowing in Work may move from content-narrowing to tail-placement.
- **spikes/paper (Spike C):** confirms per-phase documents keep the shared byte prefix in
  practice.
