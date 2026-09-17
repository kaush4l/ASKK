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

Three things the goal asks for are built, and knowing that shortens the list.

| Asked for | Where it already is |
|---|---|
| web search utilities | `search` and `fetch`, two of the five in `BUILTIN_TOOLS` (`src/core/tools/index.js`) |
| a research agent | `agents/researcher/agent.md` — stateless, reads at most three pages, lists the URLs it actually opened |
| prompt built from named elements, in order | every agent file's `prompt:` list — `[soul, instructions, tools, contract, context, conversation, scratchpad, budget, reminder, cue]` |
| work handed to another agent, on another thread | `researcher({..., "wait": false})` → `AgentWorkerPool.start`, read back with `check_task` |
| ending that work | `AgentWorkerPool.stop(id)`, from the line that announces it |
| a real machine to work in | the wasm guest — `uname -a` answers in about 1.1 s cold |

So the gap to Hermes is not tools, not threads, and not prompt structure. **It
is that nothing in this tree holds a goal.** A conversation holds turns; a pool
holds tasks; no layer holds "what we are trying to achieve", which is the thing
a goal-taking agent decomposes and returns to.

## The sequence

### 1. A goal that outlives the turn

The smallest thing that makes everything below it possible. A goal is a record —
text, made at a time, still open or closed — kept where conversations and
settings are kept (`IndexedDbRepository`), and rendered into the prompt as one
block of the `prompt:` list, beside `context` and `scratchpad`.

Why first: every later item is a thing done *toward* something, and there is
currently no something. Recitation is also the cheapest known defence against a
long run drifting — the goal re-entering the prompt every turn is what keeps
turn forty pointed at what turn one was asked.

Touches: a `Goal` record and repository, one new prompt element, one drawer
section. Measured by: a goal set in one turn is in the prompt of the next, and
survives a reload.

### 2. Tasks composed from the goal

The decomposition. The agent reads the goal and writes a list of tasks; each
task is a record with a state, and the list is in the prompt. This is Manus's
recitation and Open SWE's plan step, and it is the half of "compose it into
tasks" that the pool already has a vocabulary for — `TaskState` gained a fourth
member this wave and the records are already rendered by `describeTask`.

Touches: a `plan` tool the agent calls to write and revise the list; the task
records it makes are the same ones `check_task` reads.

Measured by: a goal of three obvious parts produces three tasks without being
told how many, and finishing one changes the block the next turn reads.

### 3. A long-running agent that outlives the tab

Today the pool lives in the tab's own backend worker, so a reload is a new pool
with nothing in it — stated plainly in `AgentWorkerPool._worker`. A "long-running
agent" that dies on refresh is a long-running *turn*.

This is where the owner's "installation will be required" lands: surviving a
closed tab means either a service worker, or persisting the task and resuming it
on next open. The honest cheap version is the second — a task record in
IndexedDB with enough to restart it — and the honest expensive version is the
first.

Measured by: hand over work, reload, and be told it is still going; and the same
across a close and re-open.

### 4. Approve an action mid-loop

`CAPABILITIES.md` carries this as `absent` with the evidence "nothing". It is
listed here rather than lower because it is the precondition for an agent
running unattended: a loop that may run for an hour on a machine with a shell
needs a way to ask before it does something the user would not have chosen.

Measured by: a `shell` call matching a declared pattern pauses, surfaces, and
runs or does not on the answer.

### 5. An interactive session in the guest

`absent`, and the measurement for it is already in the tree:
`scripts/probe/results/2026-09-01-pty.md` — one guest booted with blocking stdin
reached its prompt in 3,826 ms and then answered ten commands at 106–120 ms
each, about **7.5x cheaper per command** than re-paying the 887 ms one-shot, and
the saving does not decay. `C2wSandbox.js` builds one instance per command by
construction.

This is what makes a real development loop affordable: `npm test` after every
edit is currently a fresh boot every time.

### 6. Files that persist inside the guest between commands

`absent`. The agent's own files already survive (`ShellTool` carries named files
in and out), but the guest's filesystem dies with each command, so anything a
build wrote — `node_modules`, a compiled binary — is gone. Item 5 makes this
nearly free: one session is one filesystem.

### 7. The cluster — planner, programmer, reviewer

Only now, and deliberately last of the agent work. Open SWE's shape is Manager →
Planner → Programmer with a Reviewer inside it, and every mechanism it needs
exists here already: agents are folders with `tools:` lists, delegation is a
call, and threads are real. What is missing is items 1–3: a cluster without a
goal and a plan is three agents interrupting each other.

The bolt.diy reading is the dissent worth keeping in view: one agent, no
sub-agents, the reply itself carrying the actions. If items 1–2 land and a single
agent with a plan does the work, that is the cheaper answer and this item should
be dropped rather than built.

### 8. A research agent that writes an architecture sheet

The owner's own description: look for papers on a task, theorise what has
happened, and produce an architecture sheet of everything so far. The current
researcher answers in a paragraph to a caller; this variant **writes a file**,
which is a different contract and probably a different agent file beside it
rather than a change to that one.

Cheap once items 1–2 exist, because "everything that has happened so far" is
exactly the goal and its task list.

### 9. A formatter and a linter in the guest

Both `absent`, and both one run of `scripts/wasm/build.sh` away. Listed low
because they improve work the agent is already doing rather than enabling work
it cannot do.

### 10. Network from inside the guest

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
| **Hermes** | `delegate_task(goal, context, toolsets, role)`, a global `SOUL.md` and a project `AGENTS.md` | the soul/agent split is the same shape and arrived at independently. What is missing is the first argument: `delegate_task` takes a **goal**, and nothing here holds one — items 1–2 |
| **agent-zero** | the benchmark's other arm, seventeen prompt files vendored at `6a6cecf` | measured head to head already. The asymmetries are recorded in `bench/README.md` rather than smoothed over, including one that runs against our own arm |
| **Open SWE** | Manager / Planner / Programmer, Reviewer nested, human review of the plan | item 7, and it needs items 1–3 first. Human review of a plan is item 4 wearing a different hat |
| **bolt.diy** | one agent, no sub-agents, actions parsed out of the reply; ships as a static page | the deployment model is already the same, and stricter — bolt.diy fetches WebContainer from its vendor, this repo carries a 52 MB guest in the tree |
| **Devin** | stateless brain plus a devbox; Fusion pairs a lead with a cheap executor on separate persistent contexts | the devbox is here and the pairing is possible today — what is missing is the persistent part, item 3 |

## What would tell us this is done

Not a feature list. One run: a goal given once, decomposed without being told
how, worked on across more than one turn and at least one reload, with a thread
that can be stopped and a plan that visibly changes as parts of it are finished
— and an architecture sheet written at the end by an agent that read the papers.

Every item above exists to make that single run possible, and any item that
turns out not to be needed for it should be deleted from this page rather than
built.
