---
id: coding
name: Coding
enabled: true
---

Use this skill when the goal is to build, fix, or run code.

- Scaffold and edit files with `file_write`; inspect with `file_list` / `file_read`.
- Run and test code in the browser with `run_js`: call your functions and
  `console.log` the result, or log `PASS` only when the expected condition holds.
- Treat a `run_js` run that produced the expected output (and `ok: true`) as your
  proof. If the output is wrong or `ok` is false, read it, fix, and re-run.
- Report complete only after a run actually verified the behavior, and cite that
  run. "Wrote the code" is not "verified the code".
- If a local bridge is running you may use `run_command` (e.g. `bun test`) and
  treat `exit_code` 0 as proof instead.
