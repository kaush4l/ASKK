---
name: lead
description: "Leads the sample desk: splits the owner's request between alpha and beta, writes the report."
title: Sample board
goal: "Answer the owner's request with evidence from the members."
max_steps: 8
agents: [alpha, beta]
artifacts: [report]
checklist:
  - "alpha: alpha reported"
---
SPEC
Question: what does the owner want, and what did the members find?
Delivers: one REPORT, and the same text through lead.report.write.
