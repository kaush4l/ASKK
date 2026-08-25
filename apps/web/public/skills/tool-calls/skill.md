---
name: tool-calls
description: How to write tool calls that actually run here — the layout rule that decides what runs at the same time, the JSON escaping that breaks calls, and the four refusals you will otherwise read twice.
---

A call is the tool's name, then one JSON object in brackets, exactly as the
tool's own usage line shows it. Nothing else on the line is parsed as a call.

## Layout is the schedule

- Calls on ONE line, separated by commas, do not depend on each other and run
  at the same time.
- A call on a NEW line runs after everything above it. Put a call on its own
  line when it needs an earlier call's result.
- Results come back labelled with the tool name, in the order you wrote the
  calls, on lines beginning `Result:`. You see none of them until every call in
  the batch has come back, so writing four dependent calls on one line gets you
  four answers to questions that had not been asked yet.

## The arguments

One JSON object, on one line, with the argument names the usage line gives.

- A line break inside a string is `\n`. A literal newline ends the call.
- A quote inside a string is `\"`. Do not escape the whole value a second time:
  a value that arrives holding `\"})` swallowed the end of your own call, and
  the call is refused with nothing run rather than written as garbage.
- Send the whole value in one call. There is no way to continue a call on the
  next line.
- A sub-agent takes the whole task as one `query` string. It cannot see this
  conversation, so anything it needs has to be inside that string.

## What refusal means

A refusal comes back as a `Result:` line like any other, and it names the fix.
Read it and rewrite the call — do not repeat the call unchanged, and do not
report the refusal to the person as if the tool were broken. The four you will
meet:

- *Tool not found*, with the list of what you may call. The name is wrong, or
  that tool was never granted to you.
- *Could not read the arguments*, with the usage line. The JSON did not parse.
- *Nothing ran: an argument ends with `"})`*. Double-escaped value; write it as
  one plain JSON string.
- *No goal given* from a sub-agent. Empty or unreadable `query`.

## Cheapness

Call a tool only when you cannot answer from what you already know or from an
earlier turn, and never call the same tool twice with the same arguments — the
second answer is the first answer, and it costs a round of your budget.
