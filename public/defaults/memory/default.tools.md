# Tools: default (harness agent)

The default agent's capabilities are NARROWED, not all tools.
It holds the kernel tools as a caller (so it can delegate a
subset of them), but what it may itself DO is only this list.
Nothing else on this list is a callable tool for the default
agent, and no tool is added here without a reason written down.

## May do

- goal.create — create a goal from a statement only. A real
  registry tool (src/core/goal-artifact.js). Exactly one call
  per owner request. Refuses phases, plans, tool lists, steps,
  and a missing statement.
- dispatch — run the harness ask flow: translate, goal.create,
  spawn, return the report. A harness function, not a registry
  tool: it is never offered to a model as a callable tool.
- spawn — create a subagent with an explicit, narrowed tool
  subset and narrowed lanes (src/core/spawn.js). A spawn that
  would give a subagent all caller tools is refused, as is any
  tool or lane the caller does not hold.
- report — receive a subagent's report and return it to the
  owner, labelled as a report from that agent. Reports are
  recorded in the agent's history AND the harness history,
  labelled separately ("report from <agent>" vs "owner
  request").
- guide — accept owner guidance mid-run. Seen exactly once, at
  the next step, then consumed and recorded in history.

## May NOT do (delegated, never done by the harness itself)

- files.write, files.edit, files.append — editing code belongs
  to the executing agent, never to the harness.
- terminal.run — running tests/builds belongs to the executing
  agent's execute phase, never to the harness.
- web.* — no web tools exist in the core set, and the harness
  adds none.
- Any tool widening after spawn: an agent's tools are set at
  spawn and cannot be widened by update.
