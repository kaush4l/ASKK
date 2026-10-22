# Phases — a configured multi-agent flow

A phases file is one markdown file that chains agent runs one after another. Each phase is one agent's whole tool
loop; what a phase finds passes on to the next ones through the flow's board; each phase ends with a structured report.
It compiles to the kernel workflow (`backend/kernel/builtin/workflow.js`, step kind `phase`) and is drawn by the
pipeline view. Owner decisions, 2026-10-22: extend the workflow (not a new engine); a phase is a full ReAct loop; data
passes on a shared board of free entries; the phase's context is its own section; phases sharing an `after` run in
parallel; a phase may grant tools; one file, `## <id>` per phase.

## Where

`<desk>/phases/<flow>.md` — a desk holds the flow as an artifact `{type: workflow, id: <flow>}` (in the holder's .md
`artifacts:`). That gives the holder `<flow>.run {request, from?, note?}` and `<flow>.read {stage}`, and gives the owner
the Run box (with the request) and Stop on the pipeline view. Run files: `memory/<desk>/<flow>/runs/<date>/…` (each
phase's prompt and report). Example: `desks/agent/phases/brief.md`.

## Format

```markdown
---
title: Research brief      # run-wide settings (workflow settings: deadline_minutes, retries …)
deadline_minutes: 30
retries: 1
---

## research
agent: agent               # required: which of the desk's agents runs it
tools: web.search, web.read  # GRANTED for this phase only (from the desk catalogue), taken back after
report: sources, findings  # the answer must end with these `field: value` lines
max_steps: 16

Find what is known about {{request}} …

## outline
agent: agent
report: outline, open_questions

From the research on the board, outline …
```

Phase keys: `agent`, `after` (default: the phase before; a list waits for all; phases that share an `after` run
together), `tools`, `artifacts` (kit artifact types granted for the phase), `report`, `max_steps`, `title`, `inputs`,
`kind` (default `phase`; `code` / `research` / `agent` steps mix in as in the workflow folder). Variables: `{{request}}`
(the run's request), `{{date}}`, `{{now}}`. The heading is the id (`[a-z][a-z0-9-]*`).

## What the agent sees

The phase is the run's request (`# REQUEST`), so the agent's prompt keeps its order and `# WORK DONE` starts fresh:

- `# PHASE n of N: <id>` — the flow (`research → [outline] → write`), the flow's request, the phase body, the owner's
  note.
- `# BOARD` — every earlier phase's report (`## <id> — <agent>`), a code step's data, a failed phase's error.
- `# PHASE REPORT` — the fields to end with, in order; `none` when not found.

An answer that is missing a field is asked again once (`retries`), with the missing fields listed; if it still fails,
the gap moves on to later phases as a gate problem.

## Limits

- A phase's agent cannot be the agent that called `<flow>.run` (it would wait on itself). The phase fails and says so.
  Start the flow with the owner's Run, or name another agent.
- Grants are added and removed on the live agent. Parallel phases on one agent share them while both run.
- The board holds the phases' reports in the run. A team's `<team>.board` artifact is not written to.

Tests: `backend/kernel/test/phases.test.js`.
