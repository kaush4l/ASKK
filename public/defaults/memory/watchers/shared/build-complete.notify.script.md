# Script: build-complete (notify)

- kind: notify
- trigger: on-event
- watch: terminal session "build" exits
- notify: desk agent + owner feed, on exit, pass or fail
- halt: after 3 failures in a row

Notify when the build completes, or any alert of the same kind.
Background, stream expectation, never blocks the agent or the UI.
