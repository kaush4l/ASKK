---
name: probe
description: "Watches one layer closely (a team template the lead spawns): its numbers measured and written down, an alarm when they drift."
title: Probe desk
goal: "Every number of the layer measured and written to shared/<slug>/probe/."
writes: ["shared/*/probe/**"]
tools: [web.search]
artifacts: [files, {type: terminal, commands: [read, list, wait]}]
agents: [watcher, gauge]
---
SPEC
Leads the probe: quests the watcher and the gauge, writes shared/<slug>/probe/summary.md.
