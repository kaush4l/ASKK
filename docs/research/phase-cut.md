# R6 — The phase-cut argument

> G0 research unit R6, 2026-07-29. Question (PROMPT §18, last bullet): is
> Plan/Work/Verify the right cut for this workload, or does it collapse to two
> phases or need a fourth? Argued from three evidence sources, not symmetry.
> Feeds ADR-010 (kept Proposed).

## 1. Evidence: this repo already built a phase machine and partially retracted it

The strongest evidence available: a full phase machine shipped in this
repository's prior life (tag `pre-rewrite-rust`) and its failure and partial
recovery are both recorded in commits and ADRs. Verified directly against
`git show pre-rewrite-rust:...` — citations below are to real objects, not
memory.

### 1.1 What was built

- **ADR-008** — gate semantics: "Only the gate (verifier) phase's pass
  terminates a run as success; every other stop is `Unverified`,
  `BudgetExhausted`, `Interrupted`, or `Error`. Back-edges bounded." Marked
  "behavioral gold, kept verbatim" through every later rewrite.
- **ADR-025 / ADR-032 / ADR-034** — per-phase contracts, per-phase tool and
  skill filters (`phase.N.tools` / `phase.N.skills`), declared fan-out,
  bounded back-edges (`MAX_BACK_EDGES = 2` in
  `pre-rewrite-rust:crates/core/src/phase.rs`). ADR-034 states the exact §9
  thesis: "A phase is a complete context recipe — {contract, tools, skills,
  header}."
- The default chat agent (`orchestrator.md`) ran a **plan → dispatch → verify
  strategy**: phase 1 used a `plan` contract with a REQUIRED `steps` field;
  the verify phase used a `critique` contract with a verdict enum.

### 1.2 What failed — precisely

Commit `e853fc7` ("fix(orchestrator): lean single-phase react agent — kills
the plan-contract retry loop", 2026-07-14) is the retraction, and its message
is a controlled experiment report:

- Reproduced live against local gemma-4-12B: **one trivial prompt fired 5
  completion calls**, looping `TOOL: Missing or invalid required field(s):
  steps — Reply again`.
- Root cause chain: (a) the orchestrator became the **sole chat entry**, so
  every message — "even 'hi'" — entered the phase machine; (b) the Plan
  contract **required** `steps`, which gemma answers with bare prose; (c) the
  parser re-asked via `observe(repair_prompt)` up to `MAX_REPAIRS`, burning
  calls and dumping the rejection transcript on screen; (d) ADR-008 meant
  only a gate pass could end the run, so there was no legal cheap exit.
- Fix: single-phase ReAct orchestrator with delegation tools; simple ask →
  `action: reply` terminates in **one** completion call. ADR-042 (Decision B)
  then codified it: "Deliberately NOT a plan→execute→verify phase machine:
  the lean-react finding showed that machine looped weak/local models on
  `MAX_REPAIRS`."

### 1.3 What was NOT retracted

Phases came back within days as **deterministic workflow-path steps**
(ADR-042 Decision A; `pre-rewrite-rust:crates/core/src/phase.rs`
`PhaseStep::{Llm, Tool{tool,args}}`, executed by
`crates/engine/src/run/scripted.rs`): a scripted phase runs one fixed
read-only tool with no LLM call and advances. And the gate rule (ADR-008),
per-phase context recipes (ADR-034), and bounded back-edges all survived
every rewrite as keepers.

### 1.4 What the history actually says

**Failure attribution matters.** The machine did not fail because "phases are
wrong." It failed at the conjunction of four specific choices:

1. **No triage** — trivial inputs were forced through the full machine.
2. **A weak local model** vs. a strict structured contract (required `steps`,
   verdict enum). ADR-042 says this explicitly: "a weak/local active provider
   may still loop" was a *known limitation of the model class*, not of phases.
3. **Repair-by-re-asking** — contract violation → re-prompt up to
   `MAX_REPAIRS`, with the failure transcript accumulating. The loop was a
   *contract-repair* loop, not phase routing gone wrong; back-edges were
   bounded and never the problem.
4. **No cheap exit** — the gate-only success rule turned "hi" into a
   three-contract obstacle course.

What was retracted was **Plan as the mandatory front door**. What survived
was per-phase context/tool/contract configuration, the verify gate, and
deterministic phases. HARNESS §9 already differs from the failed design on
two of the four points (it targets capable providers, and its phase machine
is a pure `step()` state machine testable without a model); the cut decision
must fix the other two (triage/entry, and contract-failure handling).

## 2. Evidence: published findings

- **ReAct vs Plan-and-Execute** — the measured trade-off: Plan-and-Execute is
  cheaper (roughly one strong-model plan + N cheap executor calls; ReAct's
  input tokens run ~35% higher because every turn re-carries the whole
  interleave), but ReAct's closed think-act-observe loop yields higher task
  success because static pre-plans are brittle against dynamic feedback
  ([LangChain planning agents](https://www.langchain.com/blog/planning-agents),
  [practical comparison](https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9)).
  So Plan buys token efficiency and loses adaptivity — it pays off when steps
  are predictable and N is large, not on short reactive tasks.
- **ReWOO** ([arXiv:2305.18323](https://arxiv.org/abs/2305.18323)) — planning
  decoupled from observations: **5× token efficiency and +4% accuracy on
  HotpotQA**. Directly supports §9's rule that Plan excludes volatile
  observations ("planning against half-finished noise produces plans about
  the noise") — that exclusion is where the token win comes from.
- **Reflexion** ([arXiv:2303.11366](https://arxiv.org/abs/2303.11366)) — a
  verify/reflect loop lifts HumanEval pass@1 by ~11 points (80→91 with GPT-4)
  and AlfWorld by +22% absolute — **but only when feedback is concrete and
  checkable** (unit tests, environment success signals). Verification earns
  its call when there is a real criterion to check against.
- **Self-correction literature** —
  [Huang et al., "LLMs Cannot Self-Correct Reasoning Yet"](https://arxiv.org/abs/2310.01798):
  intrinsic self-correction without external feedback fails and can degrade
  answers. Kamoi et al.'s survey finds no prior work showing successful
  self-correction from the model's own feedback alone. The
  [Self-Correction Illusion](https://arxiv.org/pdf/2606.05976) result: models
  correct errors presented as *external input* but not errors in their own
  output. This is the published case for §9's "Verification must not be able
  to act" — and, more strongly, for Verify running in a **separate context**
  that treats Work's output as external material, judged against explicit
  criteria rather than the model's own sense of correctness.

Net: the literature splits the value cleanly. **Verify is the phase with
unambiguous support** — provided it checks against concrete criteria and is
separated from the acting context. **Plan is conditional** — a token/cost
optimization for predictable multi-step work, a robustness liability for
short reactive work.

## 3. Evidence: the workload

HARNESS tasks (PROMPT §2, §6) are dashboard/module/tool operations: render a
panel, forge a module, run a tool, wire a route. Two properties dominate:

- **Success criteria are mechanically checkable.** A forged module compiles
  or not; a route serves a fragment or 404s; golden tests pass or fail; §14's
  gates are literal commands. This is exactly the regime where Reflexion-style
  verification pays (concrete feedback) — and where much of Verify can be a
  **deterministic check, not an LLM call at all** (the ADR-042 scripted-step
  precedent: run the test, read the exit code). The LLM Verify call is only
  needed where the criterion is judgment-shaped ("does this fragment satisfy
  the ask").
- **Task length is bimodal.** Interactive dashboard operations are 1–3 steps
  — an upfront Plan call on those is pure overhead and (per §1.2) the exact
  failure mode this codebase already paid for. But the forge pipeline (§7)
  and the overnight run (§17) are long-horizon, multi-step, and unattended —
  precisely where Plan-and-Execute's `1×strong + N×cheap` economics and
  ReWOO's observation-free planning win, and where a recorded plan doubles as
  the audit trail §17's morning report needs.

So: **Verify is paid for by the workload's checkability; Plan is paid for
only by the long tail.** A mandatory Plan phase taxes the majority (short
ops) to subsidize the minority (long runs).

## 4. Findings

- **true** — This repo's phase machine failed as a *mandatory front door for a
  weak model with repair-by-re-asking*, not as a phase machine: the retraction
  commit (`e853fc7`) and ADR-042 both attribute the loop to the required
  `steps` contract + `MAX_REPAIRS` re-prompting + no cheap exit. Deterministic
  phases, per-phase context recipes, and the verify gate survived every
  rewrite.
- **true** — Published evidence supports separating Verify from Work:
  intrinsic self-correction fails without external feedback, models judge
  external output better than their own, and verify loops add ~11–22 points
  when criteria are concrete. Verify-may-not-act is evidence-backed, not
  aesthetic.
- **true** — Planning decoupled from observations is a measured token win
  (ReWOO 5×) — §9's volatile-exclusion rule is the load-bearing part of Plan.
- **uncertain** — Where the short/long task boundary sits for HARNESS (the
  "enter Plan" trigger below is a provisional heuristic; instrument it in G4
  and let the boop/run logs set the threshold).
- **uncertain** — Whether capable hosted models still profit from a Verify
  *LLM call* when mechanical checks already pass; the delta may be small
  enough that LLM-Verify triggers only on judgment-shaped criteria.
- **constrains** — Contract failure must degrade, never re-ask unboundedly:
  one repair attempt, then accept-as-prose or route to Answer with the
  failure noted. A required field + `MAX_REPAIRS` re-prompting is the proven
  loop generator (§1.2), independent of the phase cut chosen.
- **constrains** — Every phase graph needs a cheap legal exit to Answer from
  its entry phase; ADR-008's "only a gate ends a run as success" must not
  apply to conversational/trivial inputs (triage before machine).
- **constrains** — Verify runs tool-less and context-separated (treats Work's
  output as external material against explicit criteria), and mechanical
  checks run *before* any LLM Verify call.

## 5. Verdict

**Recommended cut: Work/Verify as the default machine, Plan on demand,
Answer as a real (fourth, cheap) phase.** All four phase configurations are
defined; the *cut* is which of them the router enters by default:

- **Entry = Work.** A short op does Work → Verify → Answer. Work's first
  response may be `escalate: plan` — that is the Plan-on-demand trigger
  (multi-step goal detected, or a Verify `replan` verdict). This inverts the
  failed design's mistake: Plan is opt-in by the model's own judgment, not a
  mandatory toll booth.
- **Verify = mechanical first, LLM second.** Run the step's checkable
  criteria as deterministic checks (scripted, no model — the ADR-042
  `PhaseStep::Tool` precedent); invoke the tool-less LLM Verify call only for
  judgment-shaped criteria or on mechanical failure needing a
  retry/replan/fail verdict.
- **Answer is a phase, not an afterthought.** §9's diagram already routes all
  exits to Answer; §18 asks whether a fourth phase is needed — it is, and it
  already half-exists. Giving it a real config (sections: task + outcome
  summary; no tools; tight budget) is what lets trivial inputs terminate in
  one cheap call, the exact fix commit `e853fc7` shipped as `action: reply`.
- **Exit conditions on the cut itself** (when to change it): promote Plan to
  default entry for a *run class* (overnight §17, forge pipeline) rather than
  globally — those runs are long-horizon and unattended, where P&E economics
  and the plan-as-audit-trail win. Demote LLM-Verify to mechanical-only if
  instrumentation shows the LLM verdict agrees with the mechanical check
  ≳95% of the time.

**Strongest argument against:** with a capable hosted model, the failed-gemma
evidence is out of distribution — a strict Plan front door might work fine,
and Work-entry gives up ReWOO-scale token savings on any task that turns out
to be multi-step (ReAct-style interleave runs ~35% more input tokens). The
answer is that the cost asymmetry still favors Work-entry: a missed Plan
costs one escalation round-trip on long tasks (rare), while a mandatory Plan
costs a full strong-model call on every short op (common) and re-introduces
the known brittleness of static pre-plans against dynamic feedback.

**Cheap mid-flight reversal:** the ADR-042 `#[serde(default)]` lesson. Phases
are document configurations (data) and the cycle is a pure state machine over
`step()` (§9/§11), so the cut lives in a routing table, not in code shape.
Keep all four phase configs defined from day one; the default entry phase and
the Plan-trigger predicate are each a one-line config change, golden-testable
with no model in the loop. Reversing to Plan-first (or collapsing to
Work-only for a module) is a config edit with zero schema migration —
which is exactly the property that lets ADR-010 stay Proposed.

## 6. Summary for RESEARCH.md

- R6 phase-cut: this repo's own history (tag `pre-rewrite-rust`, commit `e853fc7`, ADR-042) shows the plan-contract front door looping a weak model on `MAX_REPAIRS` — the retraction hit mandatory-Plan + repair-by-re-asking, NOT phases: gates, per-phase recipes, and deterministic steps all survived.
- Published: Verify is the evidence-backed phase (Reflexion +11–22pts with concrete criteria; intrinsic self-correction fails — separate, tool-less Verify); Plan is a conditional token optimization (ReWOO 5×) that costs robustness on short reactive tasks.
- Workload: HARNESS criteria are mechanically checkable (Verify pays, and is deterministic-first); tasks are bimodal (short dashboard ops vs long forge/overnight runs), so mandatory Plan taxes the majority.
- Verdict: Work/Verify default with Plan-on-demand (Work may escalate; overnight/forge run-classes may enter at Plan) + Answer as a real cheap fourth phase (§9 already routes exits there).
- Reversal is config, not code: all four phase configs exist; the cut = default-entry routing, one line, golden-tested with no model — ADR-010 stays Proposed safely.
