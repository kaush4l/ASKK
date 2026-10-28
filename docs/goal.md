# The goal-oriented runner

2026-10-24 owner: "I want the desk to be a goal oriented runner. Create a goal artifact. The goal artifact will contain
the elements for a long running process. Since the auto compaction happens to the conversation history, the goal can be
live artifact. Look for experiments on how large scale agent projects handled coordination between agents. I want to
create configurable workflows."

Code: `backend/kernel/builtin/goal.js` (the artifact), `companion/team/kernel-team.js` (the resume loop),
`desks/agent/phases/goal-cycle.md` (the default flow), `components/views/goal.jsx` + `backend/live/goal.js` (its twin).
Tests: `backend/kernel/test/builtin-goal.test.js`, `companion/team/kernel-goal.test.js`, `backend/live/goal.test.js`.

## Why an artifact, not the conversation

A run's steps are compacted at 90% of the prompt budget (`agent.js` `#compact`): old steps and `# EARLIER RUNS` are
folded into one summary. Artifacts are not part of that history — every step renders each held artifact's current
state fresh. So what a process running for days must not forget goes in the goal artifact; the conversation can be
folded, cleared or restarted and the next step still sees it. Every experiment below converged on the same move: keep
the state of the work outside the context window, in a structured file the next session reads first.

## What the experiments found

| Experiment | Coordination | What worked | What failed |
|---|---|---|---|
| [Cursor, scaling long-running coding agents](https://cursor.com/blog/scaling-agents) (Jan 2026: a browser, 1M+ lines in a week) | planners (recursive sub-planners) make tasks, workers do one task each and never coordinate, a judge ends each cycle and decides whether to go on | the hierarchy; workers that own one task end to end; the best model per role; prompts mattered more than the harness | equal agents with locks: locks held too long or held by crashed agents, 20 agents at the throughput of 2–3; optimistic concurrency: robust but agents grew risk-averse and churned; an integrator role became a bottleneck and was removed; drift — periodic fresh starts still needed |
| [Anthropic, a C compiler by 16 parallel Claudes](https://anthropic.com/engineering/building-c-compiler) (Feb 2026: 100k lines, builds Linux) | no orchestrator: each agent loops forever, claims a task by writing `current_tasks/<task>.txt` in the shared git repo (git rejects the second claim), merges, pushes, deletes the lock | tests as a near-perfect oracle; READMEs and progress files every fresh container reads; a running doc of failed approaches; specialist roles (dedupe, performance, docs, critic); terse test output, details in log files | all 16 hitting the same bug on one giant task (fixed by an oracle splitting the work); regressions until CI blocked them |
| [Anthropic, effective harnesses for long-running agents](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Nov 2025) | an initializer session writes the spec as a feature list (each item passing or not), a progress file and an init script; every later session reads them, does one feature, tests it end to end, commits | one item per session; "passing" only by an end-to-end check; the progress file as the memory between sessions | agents declaring done early without the check |
| [Magentic-One](https://arxiv.org/abs/2411.04468) (Microsoft, 2024) | an orchestrator keeps a task ledger (facts, guesses, plan) and a progress ledger each round (done? looping? progress? who next?) with a stall counter | when stalled past a limit it rewrites facts and plan and starts the team again | unbounded rounds and resets cost dollars a task |
| [Anthropic, multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) (Jun 2025) | a lead plans and spawns subagents that return condensed findings | the lead saves its plan to memory before its context fills | ~15× the tokens of a chat |

## The elements, and where each came from

| Element | In the artifact | From |
|---|---|---|
| Charter | `text`, `measure`, `target`, `constraints` (never break), `why` | the harness's spec; every fresh session reads it first |
| Ledger | `goal.note {kind: fact \| guess \| decision \| dead_end, text, evidence}` (a fact needs evidence), `goal.forget {id, why}`; ≤ 60, rendered decisions → facts → dead ends → guesses | Magentic-One's task ledger; the C compiler's running doc of failed approaches |
| Milestones | `goal.plan {items: "id: text \| check"}`, `goal.claim {id}`, `goal.done {id, evidence}` (needs its check's evidence) | the feature list (passing or not); `current_tasks/` lock files |
| Claims that cannot get stuck | a claim is released when its holder's run ends (done or not), never restored after a restart; the owner can release one | Cursor: locks held too long or by dead agents |
| Progress | `goal.progress {did, result, value, toward, next}` each run (a soft gate for the keeper); the trend of `value` | the progress file; Magentic-One's progress ledger |
| Stall → replan | 3 progress entries in a row not `closer` → the resume text and the vars say REPLAN FIRST; a new plan or a `closer` clears it | Magentic-One's stall counter; Cursor's fresh starts against drift |
| Resume loop | the host starts the keeper every `cadence_minutes` from `next` (once per due time, never while it works); 3 failed runs pause it | the C compiler's `while true` loop |
| Configurable workflow | `goal.set {workflow}` / owner `workflow`: each resume runs that flow with the goal's vars; the last step's report becomes the progress when no step recorded one | Cursor's planner / worker / judge |
| One writer per item | a claimed milestone is done only by its claimer; the judge, not the worker, records the run's progress | Cursor: workers never coordinate; the judge decides |

## The default flow: `goal-cycle`

`desks/agent/phases/goal-cycle.md` — three step agents, each holding the live goal:

1. **plan** — reads the ledger and the plan; writes or rewrites the plan (always when the mode says replan); picks the
   one milestone that moves the measure most; notes its decision.
2. **work** — claims that item, works it to its check, `goal.done` with evidence or `goal.note` a dead end.
3. **judge** — reads the measure where it shows (not the worker's word), records `goal.progress`; its report
   (`toward, value, did, result, next`) is the fallback progress.

Its variables (`vars:`) are filled by `Goal.vars()`: `goal, measure, target, constraints, ledger, milestones, last, next,
feedback, mode`. To change how the desk works toward its goal, edit the file (the workflow card's editor checks it
live): reword a step, add a second `work` step after `plan` to work two milestones in parallel (claims keep them apart),
put a check step in, or write a whole new flow and pick it in the goal view's "Each resume runs" menu.

## The owner

Team call target `artifact`, `[{id: "goal", …}]`: `set {text, measure, target?, constraints?, cadence_minutes?,
workflow?}`, `pause`, `resume`, `drop`, `now`, `cadence {minutes}`, `feedback {text}`, `workflow {workflow | none}`,
`note {kind, text, evidence?}` (an owner's fact: "the owner's word"), `forget {note, why}`, `release {milestone}`.
The goal view: the charter with its constraints, stalled, the workflow it resumes through (running or not), the
controls, the milestones with their claims (Release), the ledger by kind (Note, Retire), every run's progress.
