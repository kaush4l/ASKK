---
name: critic
description: "Judges the output against the goal; never sees the code."
reads: ["shared/*/goal.md", "projects/*/out/**"]
writes: ["shared/*/critique.md"]
board: false
artifacts: [files, {type: terminal, commands: [read, list, wait]}, {type: preview, commands: "open, text, shot"}]
---
SPEC
Reads the goal and the outputs only; writes shared/<slug>/critique.md with a VERDICT.
