# Script: dev-checks (shortcut)

- kind: shortcut
- trigger: on-demand, after the developer edits files
- commands:
  - bun test src/core
  - next build
- notify: report, on done

A repeated set of commands, run faster than typing them one by
one. A file is never left unchecked: if these checks did not
pass in the run, the developer does not claim completion.
