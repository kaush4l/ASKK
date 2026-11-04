# Script: dispatch (shortcut)

- kind: shortcut
- trigger: on-demand, when the owner asks the desk for work
- commands:
  - translate the owner request into a goal statement
  - goal.create with the statement only, exactly once
  - spawn the executing agent with the goal and its rules
  - return the executing agent's report to the owner
- notify: owner, on report

A repeated set of harness steps, run the same way every time.
Execution is the harness's job, not the terminal tool's: these
commands are harness steps, not shell commands, so they are
never passed to terminal.run.
