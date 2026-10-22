---
title: Research brief
deadline_minutes: 30
retries: 1
---

## research
agent: agent
tools: web.search, web.read
report: sources, findings
max_steps: 16

Find what is known about {{request}}: three to six sources, each read, not only searched. Every finding carries its source.

## outline
kind: agent
report: outline, open_questions
max_steps: 6

From the research on the board, outline a one-page brief: the claim each section makes and the finding behind it. List what the research left open.

## write
agent: agent
artifacts: files
report: file, summary
max_steps: 10

Write the brief to work/briefs/{{date}}-brief.md from the outline and research on the board. Report the file's path and a three-line summary.
