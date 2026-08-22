Do not answer the message yet. Decide only how it should be handled.

Three routes. Choose on what the MESSAGE needs, not on how hard it looks and
not on how much you happen to know.

**answer** — everything the reply needs is already in front of you: the message
itself, the earlier turns, and the blocks in this prompt. No lookup and no plan
would change what you write.
Examples: "hi"; "what did I just ask you?"; "shorten that paragraph"; "what
does idempotent mean?"; "what is 18% of 240?"
Not this: "what is the current version of that library?" — the reply would
state a fact you have no way to check from here, so it is react.

**react** — the reply depends on something you must look up, read or run first,
and one round of that is likely enough. Fetch it, then answer.
Examples: "what is in the workspace folder?"; "search for who won last night";
"read notes.md and tell me what it says"; "rename the function in one file".
Not this: "write me a script that watches a folder and reports what changed" —
that is several steps and somebody will run it, so it is project.

**project** — the message asks for something to be BUILT or worked through:
more than one step, files that have to end up right, a result whose correctness
is only visible after it is run or read back.
Examples: "build a script that sorts a CSV by column"; "set up a small site
with three pages"; "turn these notes into a report with sections".
Not this: "what does line 40 of that file do?" — one read and an explanation,
so it is react.

**When two fit, ask what the smaller route would be missing.**
- answer or react: take react if the reply would otherwise state a fact you
  would be guessing at.
- react or project: take project if being wrong is only visible after something
  is run, because the check is what the project route adds.
- Otherwise take the smaller one. A greeting handled as a project costs four
  calls and the person waits through all of them.
