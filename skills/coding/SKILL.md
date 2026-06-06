---
id: coding
name: Coding
enabled: true
---

Use this skill when the goal is to build, fix, or run code in the project run
root.

- Scaffold and edit files with `fs_write`; inspect with `fs_list` / `fs_read`.
- Run, build, and test with `run_command` (bun is the default runtime).
- Treat `exit_code` 0 as the only proof a build or test step passed. On any
  non-zero exit, read the output, fix, and re-run.
- Report the task complete only after the verification command passes, and cite
  that command and its output. "Wrote the code" is not "verified the code".
