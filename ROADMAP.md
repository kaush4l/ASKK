# Roadmap — from here to an agent that takes a goal

The target, in the owner's words: **take in a goal, compose it into tasks and
long-running agents.** The comparison named for it is Hermes; the shape named
for the cluster is "the Open SWE or bolt.diy of the browser".

This page is the sequential list of what is missing to get there. It is ordered
so that each item is buildable on the one above it, and every row says what it
touches and how it would be measured, because a roadmap whose items cannot be
checked off is a wish list. `CAPABILITIES.md` is the measured present; this is
the argued future, and where the two disagree `CAPABILITIES.md` wins.

## What is already here, which is more than the target assumes

Nine things the goal asks for are built, and knowing that shortens the list.
The last three landed in the waves just gone and are why the sequence below
starts where it does.

| Asked for | Where it already is |
|---|---|
| web search utilities | `search` and `fetch`, two of the seven in `BUILTIN_TOOLS` (`src/core/tools/index.js`) |
| a research agent | `agents/researcher/agent.md` — stateless, reads at most three pages, lists the URLs it actually opened |
| prompt built from named elements, in order | every agent file's `prompt:` list — `[soul, instructions, tools, contract, conversation, scratchpad, context, goal, plan, budget, reminder, cue]` |
| work handed to another agent, on another thread | `researcher({..., "wait": false})` → `AgentWorkerPool.start`, read back with `check_task` |
| ending that work | `AgentWorkerPool.stop(id)`, from the line that announces it |
| a real machine to work in | the wasm guest — `uname -a` answers in about 1.1 s cold |
| a goal that outlives the turn | `Conversation.goal`, set in the drawer, rendered as the `goal` block of every prompt — item 1, landed |
| that goal composed into tasks | `Plan` and the `plan` tool — the agent writes the list, ticks it off, and reads it back in the `plan` block next turn; item 2, landed |
| work that outlives the tab, not merely the turn | the task record is stored and `AgentWorkerPool.resume` puts the question back on a thread when the page reopens; item 3, landed |

So the gap to Hermes is not tools, not threads, not prompt structure, not the
goal, not its decomposition, and no longer the tab either: a question handed
over survives a reload and is put back on a thread. What is left divides in two.
One half is **a run that can be trusted unattended** — it must be able to ask
before it acts. The other is **a machine worth working in** — a guest with a
session and a filesystem that lives between commands, which is what makes a
build-and-test loop affordable.

## The sequence

### 1. Approve an action mid-loop

`CAPABILITIES.md` carries this as `absent` with the evidence "nothing". It is
listed here rather than lower because it is the precondition for an agent
running unattended: a loop that may run for an hour on a machine with a shell
needs a way to ask before it does something the user would not have chosen.

Measured by: a `shell` call matching a declared pattern pauses, surfaces, and
runs or does not on the answer.

### 2. An interactive session in the guest

`absent`, and the measurement for it is already in the tree:
`scripts/probe/results/2026-09-01-pty.md` — one guest booted with blocking stdin
reached its prompt in 3,826 ms and then answered ten commands at 106–120 ms
each, about **7.5x cheaper per command** than re-paying the 887 ms one-shot, and
the saving does not decay. `C2wSandbox.js` builds one instance per command by
construction.

This is what makes a real development loop affordable: `npm test` after every
edit is currently a fresh boot every time.

### 3. Files that persist inside the guest between commands

`absent`. The agent's own files already survive (`ShellTool` carries named files
in and out), but the guest's filesystem dies with each command, so anything a
build wrote — `node_modules`, a compiled binary — is gone. Item 2 makes this
nearly free: one session is one filesystem.

### 4. The cluster — planner, programmer, reviewer

Only now, and deliberately last of the agent work. Open SWE's shape is Manager →
Planner → Programmer with a Reviewer inside it, and every mechanism it needs
exists here already: agents are folders with `tools:` lists, delegation is a
call, and threads are real. A goal and a plan are no longer what is missing:
what is, is a reason to prefer three agents to one — see the dissent below,
which is now testable rather than hypothetical.

The bolt.diy reading is the dissent worth keeping in view: one agent, no
sub-agents, the reply itself carrying the actions. A single agent with a plan is
now a thing this tree can actually run, so the cheap answer is testable rather
than hypothetical — and if it does the work, this item should be dropped rather
than built.

### 5. A research agent that writes an architecture sheet

The owner's own description: look for papers on a task, theorise what has
happened, and produce an architecture sheet of everything so far. The current
researcher answers in a paragraph to a caller; this variant **writes a file**,
which is a different contract and probably a different agent file beside it
rather than a change to that one.

Cheap now that a goal and a plan exist, because "everything that has happened so
far" is exactly the goal and its task list.

### 6. A formatter and a linter in the guest

Both `absent`, and both one run of `scripts/wasm/build.sh` away. Listed low
because they improve work the agent is already doing rather than enabling work
it cannot do.

### 7. Network from inside the guest

`barred` under C2: every WASI socket is stubbed `ENOTSUP` (`vm-worker.js:121-132`)
and a page has no raw socket, so any guest network must be a `fetch` bridge and
inherits the page's CORS limits. Worth doing only when something concrete needs
it — a package install is the obvious candidate, and the tty route to that is
already measured as working.

## Against the reference systems

Honest scope note: **"OpenClone 2.0" is not a system I can identify**, and I have
not guessed at what it is. The comparison below is against the four I can
describe accurately, plus agent-zero, which this repository already benchmarks
against with vendored prompt bytes (`bench/README.md`).

| | them | here |
|---|---|---|
| **Hermes** | `delegate_task(goal, context, toolsets, role)`, a global `SOUL.md` and a project `AGENTS.md` | the soul/agent split is the same shape and arrived at independently. The first argument is here now: a conversation holds a **goal**, and the `plan` tool is what decomposes it into the tasks the threads take |
| **agent-zero** | the benchmark's other arm, seventeen prompt files vendored at `6a6cecf` | measured head to head already. The asymmetries are recorded in `bench/README.md` rather than smoothed over, including one that runs against our own arm |
| **Open SWE** | Manager / Planner / Programmer, Reviewer nested, human review of the plan | item 4. Human review of a plan is item 1 wearing a different hat |
| **bolt.diy** | one agent, no sub-agents, actions parsed out of the reply; ships as a static page | the deployment model is already the same, and stricter — bolt.diy fetches WebContainer from its vendor, this repo carries a 52 MB guest in the tree |
| **Devin** | stateless brain plus a devbox; Fusion pairs a lead with a cheap executor on separate persistent contexts | the devbox is here, the pairing is possible today, and a handed-over question now survives the tab it was asked in. What is still missing is a persistent CONTEXT: a resumed task is re-run from its instruction, not continued from where it got to |

## What would tell us this is done

Not a feature list. One run: a goal given once, decomposed without being told
how, worked on across more than one turn and at least one reload, with a thread
that can be stopped and a plan that visibly changes as parts of it are finished
— and an architecture sheet written at the end by an agent that read the papers.

Every item above exists to make that single run possible, and any item that
turns out not to be needed for it should be deleted from this page rather than
built.
