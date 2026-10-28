---
deadline_minutes: 45
retries: 1
board: false
vars:
  goal: (no standing goal)
  measure: (none)
  target: none set
  constraints: none set
  ledger: empty
  milestones: no plan yet
  last: no progress yet
  next: find where the measure stands now
  feedback: none
  mode: continue
---
# Goal cycle

One resume of the desk's standing goal (2026-10-24 owner: "I want the desk to be a goal oriented runner … I want to
create configurable workflows"). The goal artifact holds what must outlive every run and every compaction — the
charter, the ledger of facts, decisions and dead ends, the milestones and who claimed them — and fills this flow's
variables from it each time the desk resumes. Three steps, the planner / worker / judge split that ran large agent teams
for days (Cursor's long-running coding agents): plan picks the milestone that moves the measure most and writes the
plan into the goal; work does that one item and nothing else; judge reads what came of it against the measure and
records the run's progress. Each step is its own agent and sees the live goal block in its prompt. Edit a step's
wording here to change how the desk works toward its goal; add a second work step (after: plan) to work two items in
parallel — claims keep them apart.

## plan — Pick the next milestone
kind: agent
artifacts: goal
max_steps: 8

The standing goal: {{goal}}
Measure: {{measure}} · target: {{target}} · never break: {{constraints}}
Mode: {{mode}}

What the work knows (the ledger):
{{ledger}}

The plan so far:
{{milestones}}

The last run: {{last}}
It said next: {{next}}
The owner's feedback: {{feedback}}

Decide the ONE milestone the next work should do: the open item that moves the measure most now, or a new one. When
there is no plan, or the mode says replan, write one first with goal.plan (3–7 items, each "id: what is true when it is
done | how it is checked", no item another already rules out as a dead end). Never pick an item the ledger records as
a dead end unless you say what is different now. goal.note each decision you take, with why. Do not call
goal.progress: the judge records the run's progress.

### Output
item: the milestone's id
why: why this item moves the measure most now, one line
brief: what the worker does, the files or sources it starts from, and how it shows the item done

## work — Do the item
kind: agent
tools: web.search, web.read
artifacts: goal, files
max_steps: 24
min_calls: 2

Do this one milestone toward the goal "{{goal}}", and nothing beyond it:
item {{plan.item}} — {{plan.brief}}

First goal.claim it (if another agent holds it, stop and say so). Work it to its check. When it passes, goal.done it
with the evidence; when it fails, goal.note a dead_end saying what you tried and why it did not work. goal.note each
fact you checked that a later run should not have to find again (with its evidence). Never break: {{constraints}}.
Do not call goal.progress or goal.plan: the judge records the run's progress, the planner owns the plan.

### Output
outcome: done | failed | partial — and what shows it
evidence: the check you ran and what it showed (files, numbers, URLs)
learnt: what a later run should know, one line each

## judge — Judge the run against the measure
kind: agent
artifacts: goal, files
max_steps: 6

Judge this run of the standing goal "{{goal}}" against its measure ({{measure}}, target {{target}}).

The planner chose {{plan.item}}: {{plan.why}}
The worker's outcome: {{work.outcome}}
Its evidence: {{work.evidence}}
What it learnt: {{work.learnt}}
The run before: {{last}}

Read the measure where it shows now (not the worker's word for it, when you can check). Say whether the goal is closer,
the same or further than the run before — "closer" only when the measure moved or a milestone passed its check.
Record it with goal.progress {did, result, value, toward, next}; goal.met only when the target is reached, with the
evidence.

### Output
toward: closer | same | further | unrelated
value: the measure now (a number when it is one)
did: what this run did toward the goal, one line
result: what came of it, one line
next: what the next run should do
