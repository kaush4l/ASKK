---
deadline_minutes: 30
retries: 1
board: false
vars:
  audience: an engineer new to the topic
  length: one page
---
# Research brief

Three phases, each one agent's whole tool loop: research reads the web, outline plans the brief from what research
found, write puts it in a file. Each phase reads only the variables its text names — `{{phase.field}}` is a field of an
earlier phase's report — so what flows where is written here, and an edit to one phase's wording shows in its output.

## research — Find and read the sources
agent: agent
tools: web.search, web.read
max_steps: 16

Find what is known about {{request}} for {{audience}}: three to six sources, each read, not only searched. Every
finding carries its source.

### Output
sources: one line per source — S1, S2 … with its title and URL
findings: one line per finding, each ending with its source tag (S1 …)

## outline — Plan the brief
kind: agent
max_steps: 6

Outline a {{length}} brief on {{request}} for {{audience}}: the claim each section makes, the finding behind it, and how sure the sources are.

The findings:
{{research.findings}}

### Output
outline: the sections in order, each with its claim and the findings (S1 …) behind it
open_questions: what the research left open

## write — Write the brief
agent: agent
artifacts: files
max_steps: 10

Write the brief to work/briefs/{{date}}-brief.md for {{audience}}, following the outline section by section. Cite the
sources by tag and list them at the end; close with the open questions.

The outline:
{{outline.outline}}

The sources:
{{research.sources}}

The findings:
{{research.findings}}

The open questions:
{{outline.open_questions}}

### Output
file: the brief's path
summary: three lines — what the brief claims and how sure it is
