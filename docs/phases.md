# Phases — a workflow in one markdown file

A workflow file is one markdown file that chains agent runs one after another. Each phase is one agent's whole tool
loop; what a phase finds passes on to later phases as **variables** (and, unless turned off, the shared board); each
phase ends with a structured report in the format the file gives it. The file compiles to the kernel workflow
(`backend/kernel/builtin/workflow.js`: `parseWorkflowMarkdown` → the workflow object, `workflowFromMarkdown` → a
`Workflow` artifact; step kind `phase`) and is drawn by the workflow viewer (`/workflow`). Owner decisions, 2026-10-22:
extend the workflow (not a new engine); a phase is a full ReAct loop; phases sharing an `after` run in parallel; a phase
may grant tools; one file, `## <id>` per phase; then "make the workflow configuration driven … a utility which read an
md file and creates the workflow object … editable can help me experiment different workflows and wording".

## Where

`<desk>/phases/<flow>.md` — a desk holds the flow as an artifact `{type: workflow, id: <flow>}` (in the holder's .md
`artifacts:`). That gives the holder `<flow>.run {request, from?, note?}` and `<flow>.read {stage}`, and gives the owner
the viewer: the Run box (the request and the file's run variables), Stop, Run from here, Edit workflow. Run files:
`memory/<desk>/<flow>/runs/<date>/…` (each phase's prompt, variables and report); every saved edit keeps the old text in
`memory/<desk>/<flow>/versions/`. Example: `desks/agent/phases/brief.md`. Outside a desk: `workflowFromMarkdown(text |
{read, write?}, options)`.

## Format

```markdown
---
deadline_minutes: 30        # run-wide settings (workflow settings: deadline_minutes, retries …)
retries: 1
board: false                # false: phases read only the variables they name (no shared board)
vars:                       # the run's own variables, with defaults — the Run box shows a field for each
  audience: engineers
---
# Research brief

What this workflow is for (the text before the first phase: the viewer's description).

## research — Find the sources
agent: agent               # required for a phase: which of the desk's agents runs it
tools: web.search, web.read  # GRANTED for this phase only (from the desk catalogue), taken back after
max_steps: 16

Find what is known about {{request}} for {{audience}} …

### Output
sources: one line per source, S1 … with its URL
findings: one line per finding, each with its source tag

## outline
kind: agent                # its own agent, spawned for the run
report: outline, open_questions

Outline the brief from these findings:
{{research.findings}}
```

Phase keys: `agent`, `after` (default: the phase before; a list waits for all; phases that share an `after` run
together), `tools`, `artifacts` (kit artifact types granted for the phase), `report` (the fields; else the `### Output`
lines name them), `max_steps`, `title` (else the heading's `— <title>`), `inputs`, `board` (this phase's own), `kind`
(default `phase`; `code` / `research` / `agent` steps mix in as in the workflow folder). The heading is the id
(`[a-z][a-z0-9-]*`).

`### Output` (last in a phase, optional): the format its report follows, given verbatim in its prompt; each line
`field: what it holds` names a field.

## Variables — the data a phase reads

| in a phase's text | is |
|---|---|
| `{{request}}` | what the run is for (the Run box, or the caller's `request`) |
| `{{date}}`, `{{now}}` | the run's day and time (ET) |
| `{{<name>}}` | a run variable from `vars:` (its default, or the value given at the Run) |
| `{{<phase>.<field>}}` | one field of an earlier phase's report — the data a phase hands on |
| `{{<phase>}}` | that phase's whole report (a code step: its data as JSON) |

Every variable is checked when the file loads: a name that is none of these, a phase that does not run before this one
(it must be in its `after`, directly or through others), a field the phase does not report — the file does not load,
and the error names the phase and the fields there are. A phase whose upstream phase failed reads
`(<phase> failed: …)`.

## What the agent sees

The phase is the run's request (`# REQUEST`), so the agent's prompt keeps its order and `# WORK DONE` starts fresh:

- `# PHASE n of N: <id>` — the flow (`research → [outline] → write`), the flow's request, the phase body with its
  variables filled, the owner's note.
- `# BOARD` — every earlier phase's report, a code step's data, a failed phase's error (not with `board: false`).
- `# PHASE REPORT` — the fields to end with, in order; `none` when not found; the `### Output` format.

An answer that is missing a field is asked again once (`retries`), with the missing fields listed; if it still fails,
the gap moves on to later phases as a gate problem. The report's fields are read back from the answer
(`reportFields`: each field's last `field: …` line, a value running to the next field) — that is what
`{{phase.field}}` fills with, and what the viewer shows as the phase's output.

## The viewer (the workflow's card on the dashboard)

A workflow lives on the dashboard (2026-10-22 owner: "I want the workflow UI in the dashboard page itself. There on
expanding the workflow card, show this view"): its tile under the agent that holds it shows its live status — the run's
state and time, a segment per phase, each running phase with its time, turns, calls and what its agent does now, what
the run is for, the decision, what waits for the owner. Opened big (a dialog; a sheet on a phone) it is the whole
viewer (`components/workflow/card.jsx` → `viewer.jsx`; `/?open=<flow>` opens it, and an old `/workflow?id=<flow>` link
lands there). The run (what it is for, its variables, a progress bar segment per phase, what runs right now — each running phase's
time, turns, calls and what its agent does), the flow (each phase as a card: how it runs, `in` the variables it reads,
`out` the fields it hands on; the variables carried on the arrows; phases that run together side by side) and the phase
shown as **Input → Work → Output**: the variables its prompt was filled with, by value and where each came from; its
agent's loop live, its web reads, the prompt as sent; its report fields, its check, the whole answer — and, after a
re-run, beside the run before's (Compare). It follows the phase that runs; a click stays on a phase until Follow.

**Edit workflow** opens the file beside the workflow it makes: every change is checked by the desk as you type (a draft
is parsed, never written — owner call `check`) — the phases with what each reads and hands on, the ones the draft
changes marked, or the reason it does not load with its line. Save writes it only when it loads (`edit`; refused when
the file changed since it was read); the old text is kept (Earlier versions brings one back). A phase whose wording
changed since its output is marked "edited since this output"; a run going keeps the steps it loaded. A phase's Edit
opens the file at its heading; Run from here re-runs it and every phase after it (the ones before keep today's output).
Under the phases, the run's **Outcome** when the desk's workflow has one: the report code filled, the checked result,
learnings waiting for the owner (Accept / Drop), theses, calibration, the memory note.

## From the command line

`bun scripts/workflow.js <file.md> [--json]` — the workflow object the file makes (each phase: how it runs, what it
reads and from where, what it hands on), or the reason it does not load (exit 1). The desk's own names (agents, tools,
code steps) are checked when the desk loads it.

## Limits

- A phase's agent cannot be the agent that called `<flow>.run` (it would wait on itself). The phase fails and says so.
  Start the flow with the owner's Run, or name another agent.
- Grants are added and removed on the live agent. Two phases on one agent may never run side by side (the file does not
  load and names the fix, `after: [<the other>]`): one agent runs one request at a time, and their grants and
  `max_steps` would cross.

## Serial and parallel (2026-10-23)

- A phase starts when everything it waits on has settled: its `after`, the earlier phases its `inputs` name (`all`:
  every earlier one), and every code step above it. Default `after` is the phase before, so a file is a chain; `after: []`
  or a shared `after` puts phases side by side, and the viewer draws them in one column.
- What a phase reads — its board, its `{{phase}}` variables, its `inputs: all` — is only what it waits on (directly or
  through others), never a sibling that happened to finish first: the same file gives the same prompts at any timing
  (`settledBefore`, kernel `builtin/workflow.js`).
- The board holds the phases' reports in the run. A team's `<team>.board` artifact is not written to.

Tests: `backend/kernel/test/phases.test.js`, `backend/kernel/test/workflow-md.test.js`, `backend/live/workflow-view.test.js`.
