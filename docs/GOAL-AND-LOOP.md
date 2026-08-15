# GOAL-AND-LOOP — the pre-pass, and the four-stage loop

Design for two things the owner asked for, in one document:

> "Jarvis is a system where, given a goal, it is able to formulate the plan. … Adding 1 LLM call
> before such that, the model converts that goal with technical information, filling in the gaps and
> paths to do and verify the work. This way, the cognitive load shifts from figuring out *how* to
> prompt to *what* to prompt."

> "The agents should be able to work on goals with not just the react loop only. But also a plan,
> work, verify and critique loop."

Every claim about current behaviour is cited `path:line` and was read on `main` (2026-08-14). This is
a design; nothing here is implemented. Sizes are estimates against the ≤200-line file rule (I12).

**Read `docs/ALIGNMENT.md` §1 and §3 first.** This document does not repeat its prior-art evidence;
it uses its conclusions and, in §11, says which of them it confirms and which it strains.

---

## 0. The two findings that shape everything below

**Finding 1 — the verify gate does not need the stage machine, and should ship without it.**
The gate is a fold over what a turn already records. It makes `main` more honest *today*, on the
react loop, with no new declaration format and no new agent folders. The stage machine is the larger,
more speculative half. Ship §7 first, alone. §6 and §9 are the second commit and may never be needed.

**Finding 2 — the core must parse none of the brief.**
This app runs against a local gemma (`public/agents/*/agent.md` all say `model: local`). Any design
where a small model's output has to satisfy a Rust parser fails on the day the model drops a colon.
So the brief is markdown that a *model* reads and a *person* reads, and the one machine consumer —
the verify gate — reads the **event log** instead. That is what makes the whole design survive a bad
generation: a malformed brief is a slightly worse first message, never a crash and never a wrong
badge.

---

# A. THE GOAL→PLAN PRE-PASS

## 1. What it is, and its output shape

One model call, before any work, that turns *"make the budget script work"* into a technical brief.
It runs with read-only file tools, so it can look before it writes anything down.

The output is **one markdown message** whose first five lines are labelled fields. Not JSON, not a
schema, not a new file format — labelled lines, because a small model writes those reliably and
because a person can read the result without a viewer.

```
outcome:  budget.csv holds one row per expense and `python3 total.py` prints their sum
paths:    total.py (new), budget.csv (exists), .harness/ (new)
verify:   python3 total.py
done_when: it prints a number, and that number equals the sum of column 2 of budget.csv
unknowns: whether python3 is in this workspace image; nothing I read says either way

<prose: what I read, what surprised me, the ordered steps>
```

Every field, and the stage that consumes it:

| field | consumed by | what would break without it |
|---|---|---|
| `outcome` | the work stage's opening message; the critique agent's yardstick | critique has nothing to judge against and degrades to style notes |
| `paths` | the work stage (what to read first); the user, at approval (this is where an invented path is caught) | the work stage rediscovers the ground with three tool rounds it did not need |
| `verify` | **the work stage runs it**; it is what turns the gate in §7 from red to green | the turn edits a file, never runs anything, and ends `answered, unchecked` every time |
| `done_when` | the critique agent; the person reading the answer | `verify` becomes "run something", and a command that exits 0 while printing the wrong number passes |
| `unknowns` | the user, at approval | the pre-pass invents an answer instead of naming a gap — the exact failure §5 exists to prevent |

**Fields deliberately cut**, each because nothing downstream reads them:

- `steps[]` as *structured* data. The prose already carries the steps, and a structured list would
  want `AgentState.plan: Vec<PlanStep>` (`crates/agent/src/state.rs:35`) and its `cursor`
  (`state.rs:38`) to be advanced by something. Nothing advances them today and
  `ResponseContract::PlanSteps` is `todo!()` (`crates/agent/src/reply.rs:33`). ALIGNMENT §1 says
  leave both alone. Confirmed: the steps stay prose.
- `constraints` / `boundaries` (Hermes' completion contract has both, `reference/agents/hermes.md:113`).
  Their consumer would be the work agent's system prompt — which is `agent.md`'s body already
  (`crates/agent/src/paper.rs:112-115`). A second place to write a rule is a second place for it to
  rot.
- `risk`, `effort`, `phases`. `public/agents/scout/agent.md` already forbids these in its own words —
  *"No effort estimates, no phases, no risk matrix"* — and it is right.

## 2. Where it lives

The owner's rule is that agents are declared in the agents folder and the core just runs them. Two
candidates:

**(a) A new `public/agents/brief/` folder.** Own prompt, own read-only allowlist, writes the brief to
`.harness/brief.md` so later stages `read_file` it.

**(b) The existing `public/agents/scout/` agent, invoked as the loop's first stage, with its answer
carried in-memory.** No file, no write tool, no new folder.

**Recommend (b), and argue against it first.** (b)'s weakness is durability: the brief lives only in
the work agent's history section, so a compaction can summarise it away (`crates/agent/src/window.rs`,
driven from `step.rs:64` and `step.rs:198`). That is real. It is outweighed by three things:

1. **(a) needs a write tool to exist, and `plan` is read-only on purpose.** Its file names seven
   reading tools and no writer, so a write is refused at dispatch by `Toolbox::check`
   (`crates/agent/src/toolbox.rs:69`) rather than by prose. Giving the brief-writer `write_file` —
   even scoped to `.harness/` — hands the planning stage a mutation, and §7's gate is built entirely
   on "a mutation happened".
2. **(b) costs zero new plumbing.** A stage that is a peer agent is `Effect::Delegate { agent, goal,
   batch }` (`crates/agent/src/effect.rs:54`), and its answer already comes back as a `Result:` line
   appended to history and to `observations` (`step.rs:168-169`).
3. Under container2wasm the workspace root is tmpfs in guest RAM (`crates/kernel/src/workspace.rs:104-114`).
   A brief in a file is no more durable than one in the log — the log is the only durable thing here (I11).

So: **the pre-pass is the `plan` agent, run as a declared stage.** Its prompt gains the five labelled
fields; nothing else about it changes. If the compaction concern turns out to bite, the smallest fix
is a `brief` section in the paper pinned at `Fidelity::Full` — but that touches `assemble`'s golden
tests (I14, `crates/context/src/assemble.rs:151`), so do not pay for it before it is observed.

`public/agents/ask/agent.md` stays exactly as it is. It is the *other* read-only mode — a question,
not a goal — and merging the two would give one agent two jobs.

## 3. The prompt

Appended to `public/agents/scout/agent.md`, after its existing `## The plan` section, replacing its
current final paragraph. House voice: second person, plain, says what not to do.

```markdown
## The brief

Somebody gives you a goal in their own words. It is usually short and usually missing the
things a machine needs: which files, which command proves it worked. Your job is to put those
back — by reading, not by guessing — and hand back something the next agent can start on.

Open your answer with exactly these five lines, in this order, one line each:

    outcome:   one sentence. What is true when this is done that is not true now.
    paths:     the files and folders this touches. Mark each (exists) or (new).
    verify:    the one command that decides whether it worked.
    done_when: what that command must print or exit with for this to be finished.
    unknowns:  what you could not settle by reading, or "none".

Then the prose: what you read, what surprised you, and the numbered steps.

Rules for those five lines, and they matter more than the prose:

- Mark a path `(exists)` only if you opened it or listed the folder it is in this turn. If you
  believe a file is there and did not look, mark it `(new)` and put the doubt in `unknowns`.
  A path you invented sends the next agent to read a file that is not there.
- `verify` is a command, not an intention. `python3 total.py`, `cargo test -p agent`, `wc -l
  out.csv`. Not "check the output looks right" — nothing can run that.
- If there is genuinely no command that could decide it — the work is prose, or a design — write
  `verify: none` and say in `done_when` what a person would have to look at. Do not invent a
  command so the line is filled.
- If the goal already names the files and the check, say so in one line and repeat them. Adding
  detail to a goal that had enough is not helpful; it is noise the next agent has to read past.
- `unknowns` is not a disclaimer. It is the list of things you would have asked about if there
  were somebody to ask. Empty is a fine answer when you actually settled everything.

Then stop. You are not doing the work, and you have nothing to do it with.
```

## 4. What happens to the output

**Recommend: the user approves, by default — and approval is an ordinary message.**

Open SWE's `approve_plan` pulls the published markdown **and the human's review comments** and returns
them as a tool result that inlines the plan as source of truth plus *"Also take this reviewer feedback
into account"* (`reference/agents/open-swe.md`, §3 item 5). That property — approval carrying the
edits, not just a yes — is the one worth copying, and this app gets it for free:

- The plan stage ends the turn with the brief as its answer. `ending::ANSWERED`
  (`crates/agent/src/ending.rs:30`) is what a prose reply already produces, and it is the only
  ending after which the page offers `Read the reply` (`crates/core/src/ending.rs:48`).
- The person types anything back. `step` appends it to history and starts the next turn
  (`step.rs:55-67`).
- The next turn is the work stage, and its opening history holds the brief *and* the reply — which is
  Open SWE's re-injection, without a `save_plan` tool, a dashboard page or an ownership check.

**What the UI shows.** Nothing new. The brief renders as the plan agent's reply in the conversation
(`crates/core/src/transcript.rs:79-82`), the five labelled lines survive markdown-lite as-is, and the
board row reads `answered` because it did. One addition, and only one: the composer's placeholder
while a brief is on screen should say what pressing enter *does* — "reply to change it, or say go".
A string in `crates/ui/src/composer.rs`, not a feature.

**The unattended case.** `crates/ui/src/launch.rs:1-7` exists to "hand an agent a task and walk away".
An approval gate stalls that forever. So one frontmatter key, with exactly one consumer:

```yaml
plan_approval: ask     # or: auto — go straight from the brief into work
```

`ask` is the default because silence must never fail towards more capability (`spec.rs:126`, the same
argument that refuses a malformed `tools:` line). A walk-away launcher run sets `auto` in the agent's
file, deliberately, once.

## 5. The failure cases

**The pre-pass invents a path that does not exist.** Three layers, none of which is a Rust check:

1. The prompt makes `(exists)` a claim about *this turn's reading*, and `unknowns` the place for a
   belief. That is the honest version of what a model can actually do.
2. The person sees `paths:` before work starts. A wrong path is the single most obvious thing in the
   brief and takes two seconds to spot. This is most of why §4 recommends approval.
3. If it survives both, the work agent's first `read_file` on it is refused with the workspace's own
   teaching refusal (`crates/agent/src/workspace.rs:134-152` for paths, `toolbox.rs:69-95` for the
   shape), and the model corrects. That is a round spent, not a lie told.

There is deliberately **no core-side path check**. `step` is pure and cannot stat a file (I7), the
brief never becomes typed data (§0 finding 2), and a checker would need somewhere that can do I/O — a
fourth place that knows about briefs.

**The goal was already precise and the pre-pass adds noise.** Named in the prompt ("say so in one
line and repeat them"). The cost is bounded — one call at `temperature: 0.3` against a local
endpoint, and `compact_at: 8` keeps the plan agent's window tiny — but it is not free, so the real
mitigation is the escape hatch in the design: an agent whose file omits the `plan` stage never pays
for it. `stages: [- work: main]` is today's react loop exactly (§9).

**The model is small.** This is the constraint the whole shape is chosen for:

- No JSON. Five `key: value` lines are the same dialect `spec.rs` already reads from humans and
  models alike, and gemma writes them.
- **No core parser.** If the model emits four fields, or prose before them, or renames `verify` to
  `verification`, nothing in Rust fails. The next stage's model reads a slightly worse brief. The
  verify gate does not read the brief at all (§7).
- The fields are short. Long structured output is where small models drift; `outcome` is one
  sentence and `verify` is one command.
- Residual risk, stated rather than solved: a small model may write a `verify:` command that does not
  exist in the image (`pytest` in an Alpine with no pytest). The work stage runs it, it fails, the
  failure is a tool result, and the model reads it — which is the normal repair path and not a new
  failure mode.

---

# B. THE PLAN / WORK / VERIFY / CRITIQUE LOOP

## 6. The stage machine

A stage is **a peer agent plus a fixed place in one topology**. It is not a new phase, not a graph
node, and not a mode. The sequencing agent makes no model calls of its own — it emits
`Effect::Delegate` and reads the `Result:` back — so the machine itself costs zero tokens.

| stage | purpose | prompt | tools | what ends it | next |
|---|---|---|---|---|---|
| **plan** | goal → brief (§1) | `public/agents/scout/agent.md` | its own allowlist: seven readers, no writer | its prose answer (`ending::ANSWERED`) | `work` — via the person, if `plan_approval: ask` |
| **work** | do it | `public/agents/main/agent.md` (or whichever agent the file names) | its own allowlist: the full workspace set | its prose answer, **after the §7 gate lets it** | `verify` |
| **verify** | judge what happened against `done_when` | `public/agents/verify/agent.md` | `read_file`, `list_files`, `find_files`, `exec` | its answer, whose first word is `pass` or `fail` | `pass` → `critique`; `fail` → `work`, up to `max_repairs` |
| **critique** | read the result cold and list what is wrong | `public/agents/critique/agent.md` | `read_file`, `list_files`, `find_files` — no `exec`, no writer | its answer: at most five findings, or `none` | findings → `work`; `none` → done |

Transitions, as the code would read:

```rust
// stages.rs — the whole topology. There is exactly one, and it is not configurable.
fn next(stage: Stage, said: &str, state: &mut StageState) -> Step {
    match stage {
        Stage::Plan  => Step::To(Stage::Work),           // approval is a user message, not a stage
        Stage::Work  => Step::To(Stage::Verify),
        Stage::Verify if passed(said) => Step::To(Stage::Critique),
        Stage::Verify => match state.repairs_left() {    // fail
            true  => { state.repairs += 1; Step::To(Stage::Work) }
            false => Step::Done(Ending::RepairCeiling),
        },
        Stage::Critique if findings(said).is_empty() => Step::Done(Ending::Answered),
        Stage::Critique => match state.replans_left() {
            true  => { state.replans += 1; Step::To(Stage::Work) }
            false => Step::Done(Ending::CritiqueUnaddressed),
        },
    }
}
```

Three deliberate absences:

- **No `Replan` edge back to `plan`.** `phase.rs:143` reserves one (`VerdictReplan → PhaseId::Plan`)
  and it is unreachable. A second brief costs a model call and, on a local model, mostly produces the
  first brief again. If a run needs replanning, the person is holding the answer and can say so —
  which starts a new turn with the failure already in history. Add the edge when a run is observed
  needing it, and not before.
- **No stage may skip forward.** A model that writes "PASS" in the work stage does not reach
  critique; only the verify agent's answer is read for a verdict, and it has no writer, so it cannot
  have caused what it is judging. That separation is the one thing `docs/PROMPT.md` §9 insists on —
  *"Verification must not be able to act"* — and it is preserved by an allowlist rather than by a
  `ToolScope::None` on a phase.
- **No new response contract.** `passed(said)` is `said.trim_start().to_lowercase().starts_with("pass")`,
  the same shape as `malformed_call` (`reply.rs:54`): one fact the parser can be sure of, and anything
  else reads as `fail`. `ResponseContract::Verdict` stays `todo!()`. Silence fails towards *more*
  work, never towards done.

## 7. Verify — the gate, and why it is a fold

This is the point of the document. It ships alone, first, and it applies to every agent including
`main` on today's react loop.

**What the evidence is.** Not a ledger, not a new event kind, not a database. Every tool result is
already a fact in the append-only log: `EventKind::ToolInvoked { tool, args, ok, output }`
(`crates/agent/src/subagent.rs:130-135`; consumed at `step.rs:95-103`). Two questions over this
turn's slice of it:

- **Did a mutation succeed?** `ok: true` on a tool in one closed list: `write_file`, `write_agent`.
  Deliberately *not* `exec` — an agent that runs `ls` has not changed anything, and counting it would
  nudge every read-only turn. Deliberately not a shell-command classifier: guessing whether
  `sed -i` mutates is exactly the cleverness that produces a wrong badge.
- **Did a command run after it and say something?** `ok: true` on `exec`, **later in the log**, whose
  output is not silent. "Silent" is `core::calls::says_nothing` (`crates/core/src/calls.rs:52`) —
  empty, `(no output)`, `(nothing yet)` — the same predicate `vouch::doubt` already uses to refuse to
  vouch for a command that printed nothing (`crates/core/src/vouch.rs:45`). One predicate, two
  readers, so the gate and the trace can never disagree.

**The freshness rule.** Hermes keys staleness on wall-clock: `last_edit_at > evidence.created_at ⇒
stale` (`reference/agents/hermes.md:109`). This app does not need a clock: **the log is ordered**, so
"fresh" is "after the last successful mutation, in log order". A later edit invalidates earlier
evidence because the fold is a left-to-right scan and a mutation resets the flag. That is the whole
freshness mechanism, and it is three lines.

```rust
// verify.rs — pure, host-tested, no I/O. ~60 lines with its tests.
pub fn is_mutating(tool: &str) -> bool { matches!(tool, "write_file" | "write_agent") }

/// One tool result folded into the turn's evidence. Ordering IS the freshness
/// rule: a mutation clears the green flag, so evidence always postdates the
/// edit it is offered for.
pub fn observe(ev: &mut Evidence, tool: &str, ok: bool, output: &str) {
    if ok && is_mutating(tool) { *ev = Evidence { mutated: true, green: false }; }
    if ok && tool == "exec" && !says_nothing(output) { ev.green = true; }
}
```

`Evidence` is two bools on `AgentState`, `#[serde(default)]` like every other addition there, cleared
where `pending_tools` and `tool_rounds` are cleared (`step.rs:60`) and where a turn ends
(`ending.rs:44`).

**What the gate refuses, exactly.** In the answer path (`step.rs:111-138`), *before*
`ending::end(&mut state, ANSWERED)`: if the turn mutated, has no green evidence, and has spent fewer
than two nudges, the turn does not end. Instead one sentence is appended to history and the model is
asked again — the same shape as the steer path directly above it (`step.rs:123-127`), which already
turns "one more call, carrying something" into two lines.

It refuses **one thing and no more**: it refuses to let a *prose answer* end a turn that changed a
file and never ran anything afterwards. It does not refuse the answer permanently, does not judge
whether the answer is right, does not run anything itself, and does not touch a turn that mutated
nothing. Hermes' gate is policy-only and "never runs anything" (`hermes.md:109`); so is this one.

The nudge, written for the model:

```
[This turn changed a file and nothing has run since. Run the command that would show it
worked — the brief's `verify:` line if there is one — and read what it prints. If nothing
can be run here, say what is unchecked and why, in one sentence. Do not claim it works.]
```

**What the user sees when it refuses.** Two things, and the second is not optional:

1. The nudge is a *fact*, not a silent injection. `core.verify_nudged`, emitted the way
   `core.steered` is (`crates/agent/src/steer.rs:25-36`) and for the identical reason recorded there:
   a state field is not reachable by a projection, and I8 says every view is a fold of the log. The
   conversation renders it as one `Note` line — *"asked it to check its own work before answering"* —
   through the existing `ending::is_note` list (`crates/core/src/ending.rs:136`). Without this, a turn
   silently grows a round and the transcript shows a model talking to itself.
2. After two nudges the answer **lands**, and the ending says so. A new reason beside the three in
   `crates/agent/src/ending.rs:30-37`:

```rust
/// The model answered after changing a file, with nothing having run since. The
/// answer is real and is shown; what is NOT known is whether it worked.
pub const UNCHECKED: &str = "unchecked";
```

folded by `core::ending::named` (`crates/core/src/ending.rs:125`) into a fifth `Ending` variant whose
`word()` is `answered, unchecked` and whose `line()` is *"it changed a file and nothing ran
afterwards, so this page cannot say whether it worked — the Tool trace has what it did"*. That reuses
R17's entire three-surface fold: row, card and conversation get it for free.

**Two files must split first, and neither split is invented for this work.** `core/ending.rs` is
already **exactly 200 lines**, so `Ending`'s wordings move out (~70). `step.rs` is at 200 too, so the
answer path (`step.rs:111-138`) becomes `answer.rs` (~50), leaving `step.rs` ~170. That is the I12
rule arriving, not a cost of the gate. Sizes in §10.

**The interaction with `max_rounds`.** A nudge costs a round. The ceiling defaults to 64
(`state.rs:121`) against a nudge cap of 2, so the nudge can never exhaust it — but a turn already at
63 hits the ceiling instead of being nudged, and the ceiling ending is the honest one there. No
special case.

**Open question.** A run whose work is prose — an answer, a design, a summary — mutates nothing and
never meets the gate. That is correct and intended. But a run that writes a *document* with
`write_file` mutates, and no command can check prose. The design's answer is `verify: none` in the
brief plus the model saying so in one sentence, after which it still ends `unchecked` — which is
true, if slightly unkind to a turn that did everything right. Whether `unchecked` should distinguish
"nothing ran" from "nothing could run" is a real question and I do not have a way to tell them apart
that does not trust the model's word for it. Left open; the conservative reading (both are
`unchecked`) never over-claims, which is the direction to be wrong in.

## 8. Critique

An agent, not engine code. `public/agents/critique/agent.md`, read-only by allowlist for the same
structural reason `plan` is: `read_file`, `list_files`, `find_files`, `now` — and no `exec`, so it
cannot cause the state it is judging, and no writer, so it cannot fix what it finds. Open SWE's
surviving split is exactly this shape, and it is the only split its authors kept
(`reference/agents/open-swe.md`, §3: a separate graph, separate thread, read-only toolset).

It runs in its own Worker, which is what `Effect::Delegate` already means (ADR-008, one Worker per
agent), so "on its own thread" is not something to build.

**How its findings get back.** As the delegation's `Result:` line — appended to history and to
`observations` by `step.rs:168-169`. No findings artifact, no `add_finding`/`publish_review` tool
quartet, no store. The cap Open SWE enforces in code (`review/findings.py:57`, six findings) is a
prompt rule here, enforced by nothing: a model that writes nine findings gets nine through. Stated
weakness, accepted — the alternative is a tool, an executor, a projection and a UI, to bound a list
read by one model and one person.

**Validation against a diff: not possible, and the design says so rather than pretending.** Open SWE
validates findings against the PR diff at creation. This app has no diff — the space folder is a live
filesystem with no snapshot (`kernel/src/workspace.rs:104-114`; snapshotting is a gated ADR,
ALIGNMENT §5.14). So critique reads the *current* files the brief's `paths:` named, and a finding
about a line nobody changed is indistinguishable from one about a line that was. Mitigation is scope:
judge against `outcome` and `done_when`, ignore everything else. Revisit if the snapshot lands.

`public/agents/critique/agent.md`, body:

```markdown
You read work somebody else has just done and say what is wrong with it. You cannot change
anything and you cannot run anything — your tools read. That is what makes you worth asking.

You are given the outcome that was wanted and what would show it was met. Judge against those
two things and nothing else. A thing you would have done differently is not a finding.

## How to answer

- Read the files named in the brief before you say anything about them. A finding about a file
  you did not open is a guess with a file name attached.
- At most five findings. If there are more than five, the five that matter are the answer.
- One line each: the file, what is wrong, and what would fix it. No severity labels, no
  categories, no summary paragraph.
- If the work meets the outcome, say `none` on the first line and stop. That is the most
  useful answer you have and it takes one word.

## What not to do

- Do not restate what the work did. Whoever reads you has it in front of them.
- Do not comment on style, naming or structure unless it stops the outcome being met.
- Do not ask questions. There is nobody there to answer.
```

## 9. How an agent DECLARES this loop

`engine:` is parsed (`spec.rs:110`), written back by the authoring path (`crates/agent/src/author.rs:42`)
and **rendered on the agent card** (`crates/core/src/agentcard.rs:34-40`, which describes `react` and
`base` in prose) — and **nothing branches on it**. All six shipped agents say `react` or `base` and
run the identical `step`. So `engine: staged` is a new *value* of an existing key, and the first one
that will be load-bearing.

Two new frontmatter keys and one existing one gain meaning:

```yaml
engine: staged        # was: an unread label. Now selects the sequencer.
stages:               # a block list, the dialect spec.rs already reads
  - plan: plan        # <stage>: <peer agent that runs it>
  - work: main
  - verify: verify
  - critique: critique
plan_approval: ask    # ask | auto  (§4)
max_repairs: 2        # verify fail -> work, this many times
max_replans: 1        # critique findings -> work, this many times
```

The rules, which are the parser's discipline (`spec.rs:126` — *"silence must never fail towards more
capability"*):

- A stage name that is not one of the four **is refused**, not ignored. `- test: main` is a typo
  that would otherwise silently produce a three-stage loop.
- `engine: staged` with no `stages:` block **is refused**. An empty list here would mean "no stages",
  and the agent would do nothing while its card claimed a loop.
- A stage may be **omitted**, and then it does not run. `stages: [- work: main]` is today's react
  loop exactly, which is what makes `engine: react` expressible in the same vocabulary rather than
  being a special case.
- The named agent is resolved against peers the same way a sub-agent in `tools:` is
  (`subagent.rs:70-78`). A name that resolves to nothing is **reported, not refused** — the same
  ruling `unresolved_tools` makes and for the same reason (`subagent.rs:27-38`): a stage agent may be
  written after the agent that names it.
- Everything per-stage — prompt, tools, model, temperature, `max_rounds`, `compact_at` — lives in the
  named agent's own file. There is no second place to configure a stage, and no per-stage overrides.
  That is the whole argument for stages-as-agents: `agent.md` already has every field a stage needs.

A complete example, `public/agents/builder/agent.md`, verbatim:

```markdown
---
name: builder
description: Takes a goal, works out how to do it, does it, checks it, and has it reviewed.
model: local
temperature: 0.4
engine: staged
space: research
stages:
  - plan: plan
  - work: main
  - verify: verify
  - critique: critique
plan_approval: ask
max_repairs: 2
max_replans: 1
# The sequencer makes no model calls of its own, so it needs no tools. Every
# tool this loop uses belongs to the agent named in a stage above.
tools: [now]
compact_at: 8
keep_recent: 3
max_rounds: 8
---

You run a goal through four stages and hand back what happened. You do not do the work
yourself — each stage is another agent, with its own tools and its own file.

The person gives you a goal. `plan` turns it into a brief and shows it to them. When they say
go, `work` does it. `verify` decides whether it worked, by running something. `critique` reads
the result cold. If verify says no, work goes round again — twice at most, and then you stop
and say so rather than looping.

Report in three or four sentences: what was wanted, what changed, what the check printed, and
anything critique found that was not fixed. If a stage stopped short, say which one and why.
Never report a stage as finished when it was not.
```

The three sibling files this needs — `public/agents/verify/agent.md`, `public/agents/critique/agent.md`
(§8), and the three added paragraphs in `public/agents/scout/agent.md` (§3) — plus four lines in
`public/agents/index.json`, which is the directory listing a static host cannot generate
(`public/agents/index.json`, its own `comment` field says so). **Zero Rust for the prompts, the tool
sets and the per-stage budgets.** That is ALIGNMENT §1's convergent finding applied literally.

## 10. What the core has to gain

The verify gate first, alone. Then, only if the loop is wanted:

| file | change | size |
|---|---|---|
| `crates/agent/src/verify.rs` | **new.** `is_mutating`, `Evidence`, `observe`, the nudge const, the gate predicate, tests | ~60 |
| `crates/agent/src/answer.rs` | **new.** the answer path lifted out of `step.rs:111-138` so the gate fits under I12 | ~50 |
| `crates/agent/src/state.rs` | +3 `#[serde(default)]` fields: `mutated`, `green`, `nudges` | +6 |
| `crates/agent/src/step.rs` | 2 lines in `on_tool_result`, 1 at turn start, the answer arm moves out | net −20 |
| `crates/agent/src/ending.rs` | `UNCHECKED` const + doc | +6 |
| `crates/core/src/ending.rs` | 5th `Ending` variant, 2 match arms — **and a split first: the file is at 200** | +12, +split |
| **subtotal — the gate, shippable alone** | | **~135 new** |
| `crates/agent/src/spec.rs` | `stages:` block list, `plan_approval`, `max_repairs`, `max_replans`; refuse an unknown stage name | +22 (169 → 191) |
| `crates/agent/src/stages.rs` | **new.** `Stage`, the `next()` above, `passed()`, the delegation each stage emits | ~70 |
| `crates/agent/src/step.rs` | one arm: a `Delegate` result while `engine: staged` advances the stage instead of going round | +10 |
| **subtotal — the stage machine** | | **~100 new** |

**Most of it is already there, and this is the substantive finding.** Not needed, at all:

- Sub-agent dispatch, its Worker, its batching and its result path — `Effect::Delegate`
  (`effect.rs:54`), `invoke_or_refuse` (`subagent.rs:128`), `crates/core/src/batch.rs`.
- Per-stage tool enforcement — `toolbox_for` (`subagent.rs:23`) → `Toolbox::check` (`toolbox.rs:69`),
  at dispatch, not in prose.
- Per-stage prompts, models, budgets — `adopt_spec` (`paper.rs:92`).
- The ending vocabulary and its three surfaces — `agent/ending.rs`, `core/ending.rs`.
- Mid-run steering into any stage — `step.rs:47-51`, `steer.rs`.
- Stop, at the boundary of any stage — `stop.rs:51`.
- The evidence store. It is the event log.

**`phase.rs` is untouched.** `PhaseId::Verify` stays unreachable, `v1_phases()` keeps its two entries,
`ResponseContract::{PlanSteps, Verdict}` stay `todo!()`. A stage is a delegation to a peer agent, not
a phase of this one, so nothing here needs the phase table to grow. If that reads as a missed
opportunity: the phase table's own doc says a phase is "a named configuration of the paper"
(`phase.rs:1-4`), and a stage here is a different *agent* — different soul, different tools —
which `docs/PROMPT.md` §9 already rules is "a different *agent*, not a different phase".

## 11. What NOT to build

Confirming ALIGNMENT §1's rulings, with the one place this design strains them named honestly.

- **No mode enum.** *Strained, and the closest call in the document.* `engine: staged` makes an
  existing key load-bearing for the first time. The defence: the three converged codebases put the
  mode's *content* — prompt body, tool allowlist — in files, and so does this; what is in Rust is the
  four-node topology, which none of them made configurable either. If a reviewer disagrees the
  fallback is smaller, not larger: drop `stages:` and have the work agent name `plan`, `verify` and
  `critique` in `tools:` as ordinary sub-agents it is *asked* to call in order. Zero Rust, zero
  guarantees — the model may skip verify. The guarantee is the entire reason for the 100 lines.
- **No `ResponseContract::PlanSteps`.** Confirmed, and this design is why: the brief is markdown, the
  core parses none of it, `AgentState.plan` and `.cursor` stay unused. If they are still unused after
  this ships, delete them.
- **No `ResponseContract::Verdict`.** Confirmed. `passed()` reads one word the way `malformed_call`
  reads three tokens (`reply.rs:54`), and anything unclear reads as `fail` — towards more work.
- **No graph, no orchestrator, no middleware.** Confirmed. `next()` is one `match` in one file: no
  dynamic edges, no registry, no injection points.
- **No findings artifact, no `add_finding`/`publish_review` tools.** A finding is a sentence in a
  tool result.
- **No evidence ledger, no second database.** Hermes' ledger is its own SQLite DB (`hermes.md:109`)
  because Hermes has no ordered event log to fold. This app has one.
- **No LLM judge for the verdict.** Hermes' `/goal` judge is an extra model call per turn
  (`hermes.md:111`). The verify *stage* is already a model call; a judge on top is two models grading
  one piece of work.
- **No `Replan` edge, no fifth stage, no per-agent topology** (§6). **No path checker in the core**
  (§5). **No snapshot, no diff, no rollback** — real gaps, both gated ADRs; §8 states what critique
  loses rather than building half of one.
- **No `verify_on_stop: false`.** Hermes shipped its best feature disabled (`hermes.md:220`). The gate
  is on for every agent, always, with no key to turn it off. If an agent should be allowed to answer
  after a mutation without running anything, that is a bug report, not a setting.

---

# C. HONESTY

## 12. What each stage may and may not claim

The property eighteen UX rounds bought is that this page never claims something its own records
disprove — `vouch.rs` refuses to say `ok` about a call whose own record does not back it
(`crates/core/src/vouch.rs:38-60`), `ending.rs` refuses to call a stranded turn `finished`
(`crates/core/src/ending.rs:1-15`), `steer.rs` refuses to let a silent state field drive a projection
(`crates/agent/src/steer.rs:1-18`). A plan/verify loop is four new places to break that, and **a
"verified" badge over an unverified thing is worse than the bug that started round 13**, because the
*page* is asserting it rather than the model.

**plan may claim:** what it read, naming the file. That a path exists, *if* it opened it or listed
its folder. That a command is what it would run.
**plan may NOT claim:** that a path exists it did not open — the prompt routes that to `unknowns`
(§3). That the plan will work. Nothing in a brief is a prediction, and the word "will" should not
appear in `outcome`. **Structurally:** it has no writer and no shell, so it cannot have made anything
true before saying it is.

**work may claim:** exactly what it claims today. Nothing here changes it, and `vouch::doubt` keeps
refusing to vouch for a swallowed argument or a silent command (`vouch.rs:38`).
**work may NOT claim:** that the work is checked. Only the gate decides that, and the gate is
downstream of the answer.

**verify may claim:** that a command ran, and what it printed — quoted. That the printed output does
or does not match `done_when`.
**verify may NOT claim** — the load-bearing line in the document — **that the work is correct.** A
green command is evidence about a command, not proof about a change. The vocabulary follows: the
ending word is `answered, unchecked` or plain `answered`, and **the strings `verified`, `passed` and
`proven` do not appear in any surface this design adds**. `checked` is the strongest available word
and it means "something ran afterwards and printed something". If the verify agent's own prose says
"verified", that is the *model's* word inside a reply, rendered as speech — which is how the page
already separates what an agent said from what the page vouches for.

**critique may claim:** what it read, naming the file. That a finding is about a file it opened.
**critique may NOT claim:** that it reviewed a change. It read a file's current state; it has no
diff (§8). Its prompt says "judge against the outcome", not "review the diff", and its findings are
about files, not about edits.

**The sequencing agent may claim:** which stages ran and how each one ended. It reads the same
`Result:` lines the log holds.
**It may NOT claim:** that the loop finished, when a stage hit `max_repairs` or `max_replans`. Those
are two new endings and they must be as distinguishable as `round ceiling` is today
(`crates/core/src/ending.rs:56-83`) — a row word and a line saying what to do, or they will be read
as success, which is precisely the R17 bug in a new place.

**Three structural rules the code must hold, not the prompts:**

1. **A synthetic message is a fact.** The verify nudge emits `core.verify_nudged` (§7). A round the
   machine added must be visible as the machine's, or the transcript shows a model talking to itself
   and the token meter (`crates/core/src/fold.rs:181`) charges a person for a turn they cannot see.
2. **The gate's word and the trace's word share one predicate.** `says_nothing`
   (`crates/core/src/calls.rs:52`) decides both whether a command is evidence and whether the trace
   will vouch for it. If they ever diverge, the page can say `checked` over a row that reads `ok, and
   it printed nothing` — two surfaces, one turn, two stories, which is the class of bug rounds 16 and
   17 were spent removing.
3. **`engine_line` becomes load-bearing.** `crates/core/src/agentcard.rs:34-40` prints prose about
   what an engine value means; today it is decoration because nothing branches on `engine:`. `staged`
   needs an arm there describing the loop that will actually run — the one the `stages:` list names,
   not a hardcoded sentence about four stages. (Pre-existing and worth a separate look: that function
   tells a person `base` "answers in one reply, without calling tools", while
   `public/agents/summarizer/agent.md` sets `tools: []`, which `subagent.rs:61` reads as *every*
   built-in. The card's sentence is already enforced by nothing.)

---

## Open questions

Written as questions rather than answered, per the brief this document was given.

1. **Should `unchecked` distinguish "nothing ran" from "nothing could run"?** §7. I have no way to
   tell them apart that does not take the model's word for it.
2. **Does the brief survive compaction?** §2. `compact_at: 8` on the work agent means a long run
   summarises early, and the summarizer is told to keep "what the user asked for" — which the brief
   is, but by inference. Measurable rather than arguable: run a 30-round task and read the compacted
   window.
3. **Where does the stage machine's state live across a page reload?** `AgentState` is serializable
   and that is what makes pause-and-resume work (`state.rs:20-23`), so the stage index belongs there
   — but a stage in flight is a delegation in someone else's Worker, and `fold::abandoned_run`
   (`crates/core/src/fold.rs:133`) currently detects an abandoned turn, not an abandoned *stage*. A
   reload mid-critique may show a loop that is not running. Unresolved.
4. **Is `plan_approval: auto` honest for a walk-away run?** It means a brief nobody read becomes the
   instruction. The gate in §7 still applies to the work stage, so the run cannot claim success it
   did not check — but it can work confidently from an invented path for two rounds. Possibly the
   answer is that `auto` runs must report the brief in the final summary, verbatim.

---

## SHIPPED — 2026-08-14 (increment 20)

The pre-pass is built, as `crate::stages` — but NOT the way §2 designed it.

**What was kept:** the five named lines (here `OUTCOME`, `PATHS`, `CHECK`,
`DONE WHEN`, `ASSUMED`), one model call ahead of the work, the brief living in
the window for every round after it, and §12's ban on the word "verified".

**What was dropped, and why:** the separate `plan` agent invocation. This
document proposed running the shipped read-only `plan` agent as the first
stage. That would have meant a delegation, a second Worker, and a handoff of
the brief across it — for one toolless model call. A stage is one instruction
pushed into the same paper and one more call against the same window, so there
is no second machine, no second agent, and nothing to hand over. The `plan`
agent still exists and is still callable; it is no longer load-bearing.

**What answered open question 3** ("where does the stage machine's state live
across a reload?"): in `AgentState`, as `stages` and `stage`, both
`serde(default)`. The concern about a stage in flight in another Worker does
not arise — a stage is never delegated.

**Open question 1** (`unchecked` vs "nothing could run") is unchanged.
**Open question 2** (does the brief survive compaction?) is unchanged and still
measurable. **Open question 4** (`plan_approval: auto`) is moot: there is no
approval step — the brief is written and the work proceeds, and the person sees
the brief in the conversation as it happens.

One thing the browser walk found that this document did not predict: the
mechanical verify gate (increment 19) and a declared `verify` stage answer the
same question, and a turn that fired both asked the model twice and printed two
notices saying it. The declaration wins — `stages::verify_ahead`.
