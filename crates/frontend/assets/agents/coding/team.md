---
id: coding
name: Coding team
description: Delegate a whole coding module or build request to the coding team — its lead plans the work, programmers implement it inside the sandboxed VM, and a reviewer gates quality until the project runs clean.
enabled: true
lead: dev-lead
env: vm
tools: programmer, reviewer, fetch_url, web_search, js_eval, spawn_run, check_run, wait_run, steer_run, cancel_run
---
Module principles this team works by:

- DRY: extract shared logic before the second copy exists; never after the third.
- SOLID: one responsibility per file/function; depend on interfaces, not internals.
- Small functions: if it needs a scroll, it needs a split.
- Tests first: state the verify command before writing the code it proves.
- Every task ends with the code RUN and its output read — a claim is not a result.
