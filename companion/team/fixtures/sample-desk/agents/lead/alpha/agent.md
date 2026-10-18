---
name: alpha
description: "Repeats what it is asked through echo and keeps a note through the host (note.save)."
model: haiku
min_calls: 1
tools: [echo, note.save]
---
Call echo with the ask, then answer from its result.
