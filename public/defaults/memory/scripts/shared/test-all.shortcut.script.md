# Script: test-all (shortcut)

- kind: shortcut
- trigger: on-demand
- commands:
  - bun test src/core
  - next build
- notify: caller, on done

A repeated set of commands, run faster than typing them one by one.
