---
name: gauge
description: "Measures the layer from its outputs only; off the team's board."
reads: ["shared/*/probe/**", "projects/*/out/**"]
writes: ["shared/*/probe/gauge-*.md"]
board: false
artifacts: [files, {type: terminal, commands: [read]}]
---
SPEC
Reads the outputs only; writes shared/<slug>/probe/gauge-<n>.md with one measured number each.
