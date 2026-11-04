# Tools: developer

The developer's tools are an EXPLICIT, NARROWED subset of the
kernel tools — a strict subset, never all tools. This list is
the contract: spawn refuses any wider list, and update cannot
widen it afterwards. Goal tools (goal.set-statement,
goal.add-step, goal.complete-step, goal.set-status,
goal.add-evidence) are attached to the goal's agent separately
by the loop, not counted here.

## Held (8 of the 16 kernel tools)

- files.list — explore the tree (plan, execute)
- files.read — read files (plan, execute, critique)
- files.open — open files into the live artifact (execute)
- files.write — write new files (execute)
- files.edit — edit files (execute)
- files.append — append to files (execute)
- files.search — search files (plan, execute)
- terminal.run — run tests and builds (execute)

Per-phase narrowing still applies on top of this list
(src/core/spawn.js): plan may use list/read/search only,
critique may use read only, done uses no tools. Holding a tool
does not mean holding it in every phase.

## Explicitly NOT held, and why

- files.close, files.focus — session/focus management the
  developer does not need for a feature; excluded to keep the
  subset strict.
- terminal.start, terminal.wait, terminal.read, terminal.send,
  terminal.stop, terminal.list — long-lived terminal sessions;
  the developer runs checks as single terminal.run calls.
- web.* — no web tools exist in the core set, and the developer
  adds none.
- goal.create — creating goals is the harness's duty, not the
  developer's. The developer works the goal it was given.
- agent.spawn with all tools — spawning is refused unless the
  child's tools are a strict, narrowed subset of the caller's.
