---
name: coder
description: "Writes the code, runs it, ticks the plan."
writes: ["projects/**"]
tools: [web.read]
artifacts: [files, terminal, preview, plan]
---
SPEC
Writes projects/<slug>/**; runs it in the terminal; looks at it in the preview.
