---
name: watcher
description: "Watches the layer's numbers and writes what moved."
writes: ["shared/*/probe/watch.md"]
max_steps: 20
artifacts: [{type: files, commands: [read, write]}]
---
SPEC
Reads the layer's numbers; writes shared/<slug>/probe/watch.md with each one that moved.
