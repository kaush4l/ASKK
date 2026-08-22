# DESIGN-PHASES.md — the deep path

> Closes the open half of **T7**. Binds **T13** (verify gets a window before an agent),
> **T14** (grounder as a post-pass), **T38** (the grounder is mechanical), **T30**
> (pin what must survive compaction), **T50** (one command, one exit code).
> Written by a planning agent that touched no code.

---

## 0. The answer in one paragraph

The deep path already exists and is called `Route::Project`. Its four stages —
`plan`, `work`, `verify`, `critique` — are already the owner's five roles minus
one, and the one that is missing is not a role at all. **The prompt-engineering
pre-pass and skill selection are the `plan` stage, already shipped and already
doing exactly that. The react worker is the `work` stage. The verifier is the
`verify` stage, and what it is missing is not an agent — it is a WINDOW that does
not contain the draft it is checking. The grounder is not a stage, not a window
and not an agent: it is a pure function, and refusing to make it a model is the
whole content of T38.**

So this design adds **zero stages, zero agents, and zero frontmatter keys.** It
adds one component, one pure function, one sheet, and one ending word. If that
reads as a small answer to a large mandate, that is the finding: the mandate was
mostly already built, and the parts that were not are the parts that should not
be built the way the mandate words them.

---

## 1. The role table

| Owner's words | What it is | Where it lives | Ships today? |
|---|---|---|---|
| "update the query to a prompt-engineered query" | **STAGE** — `plan` | `public/stages/plan.md` | Yes. Gap: its output is not pinned |
| "pick up the skills that we might need" | **STAGE** — `plan`, scoped to `list_skills`/`read_skill` | `ask::scoped_tools` + `brief::skill_only` | Yes. Gap: a loaded skill can be compacted away (T40b) |
| "one long running react agent" | **STAGE** — `work` | `stages::WORK`, `brief::acts` | Yes |
| "a separate verifier" | **WINDOW** — `verify` on its own sheet | new `verify/sheet.rs` | No — this design |
| "a separate grounder" | **MECHANISM** — a pure fold, no model at all | new `ground.rs` | No — this design |

There are four categories in that column, not three, and the fourth is the
important one. The brief asked me to answer STAGE / WINDOW / AGENT for each role.
For the grounder the honest answer is **none of the three**, and saying so is the
design decision rather than a dodge.

### 1.1 Why the pre-pass is a stage and not an agent

Ruling 3 says split reading and judging, never writing. A prompt-engineering
pre-pass **writes** — it authors the brief the rest of the turn works from. It is
therefore the one role the ruling forbids splitting off, and Open SWE is the
evidence: their Planner was a named role in 2025 and was a `task` call inside one
deep agent by 2026 (`PRIOR-ART.md` §2.7).

It is also already built. `public/stages/plan.md` says: turn the request into a
brief and write nothing else; call `list_skills`; `read_skill` what applies; then
write OUTCOME / PATHS / CHECK / DONE WHEN / ASSUMED. **That is a prompt-engineered
query.** The owner's sentence and the shipped file describe the same act.

The real gap is not a missing role, it is a missing *pin*. The brief is prose in
`History` at `Slot::HISTORY = 80`, and `window::compacted` can replace it with a
summary. An agent on pass four of a project route may be working from a
paraphrase of its own brief. That is the same class of bug as T30's un-pinned goal
and T40b's ghost skills, and it gets the same remedy: **pin it, or say it is
gone.** See §5, stage S1.

### 1.2 Why skill selection is not its own role

The owner names it as a step. It is one sentence of `plan.md` and two tool grants
in `ask::scoped_tools`. Making it a role would mean a call whose entire product is
a list of names — the most expensive way in the tree to produce two `read_skill`
invocations. Refused.

The genuine work here is T40b and T41, and neither is a new role: retract a
compacted skill loudly, and gate a skill on capability presence (I15). Both are
edits inside `skills.rs`.

### 1.3 Why the verifier is a WINDOW and not an AGENT

T13 already ruled this and named the mechanism correctly: **the value of a
separate verifier is separation of CONTEXT, not of role-name.** CoVe's factored
variant beats its joint variant because the verification is answered without the
draft in view; Panickssery (NeurIPS 2024) measures that judges prefer their own
generations. Neither result is about *who* answers. Both are about *what is in
the window when they do*.

`docs/GOAL-AND-LOOP.md` rejected a separate verifier under the heading **"No LLM
judge for the verdict"**, on the grounds that "the verify *stage* is already a
model call; a judge on top is two models grading one piece of work." That
sentence is right about the thing it refuses (a *second* model call layered on
the first) and wrong as a reason to refuse this — this is not a judge on top, it
is the same single call with the draft taken out of its window. **T13 requires
that correction in writing; §7 lists the file and the edit.**

And an AGENT is refused on three counts, all of them ours already:

1. We deleted the summarizer agent and it came back as a **sheet** (`window.rs`:
   *"THE SUMMARIZER IS NO LONGER AN AGENT — it is a sheet"*). The verifier is the
   identical shape: no tools, no conversation, one task, one reply.
2. An agent costs a Worker, a roster entry, a `public/agents/` folder, an
   `agent_problems` failure mode when it is missing (T23), and a second place a
   person can misconfigure the loop. A sheet costs a function.
3. We already ship the agent-shaped verifier and it is a *different job*:
   `role: critic` (`critic.rs`). Its verdict is read mechanically by `passed()`
   and gates the ending. Adding a second verdict-producing agent would give one
   turn two mechanical gates with no rule for which wins.

### 1.4 Why the grounder is a MECHANISM and not a model

T38 ruled it and the ruling stands unchallenged: quotes are checked as substrings
against text we actually fetched. Deterministic (I7), a fact rather than an
opinion (I8), ungameable by a model grading itself, and one model call cheaper.
A 0–1 support score is a judgement dressed as a measurement.

I add one thing T38 does not say, and it is uncomfortable: **we have almost
nothing to ground against.** `search.rs` returns five rows of title + URL + a
180-character snippet. There is no fetch-a-page tool in this build, and adding
one is T27 — gated on an ADR and an I2 amendment. So the honest corpus is *this
turn's tool results*: search snippets, `read_file` output, `exec` output,
`read_skill` bodies. That is a real corpus and grounding against it is real work
— "you quoted a line from the file you read" is a checkable claim — but it is not
"quotes are matched against actual page text" and **the UI must not say it is.**
Shipping a grounder whose name overpromises would be the sixth instance of the
habit the lead's 2026-08-20 ruling was written to stop.

---

## 2. How a person declares it

**They already have. This design adds no frontmatter key.**

`public/agents/main/agent.md` needs no edit at all. Its declaration is one line:

```yaml
stages: [strategy]
```

That is the whole deep-path declaration for the general assistant. `strategy`
votes, `Route::Project::stages()` returns `[plan, work, verify, critique]` in
Rust, and every role above is inside those four. Nobody writes a graph because
there is no graph to write.

A person who wants a *standing* deep worker — the "builder" case, an agent that
keeps going until a command says it is done — writes budget and policy, and still
no topology:

```yaml
---
name: builder
description: Works a project through to a check that passes.
model: local
engine: react
# THE LOOP THIS AGENT RUNS. A list of stage NAMES from a closed vocabulary
# (crates/agent/src/stages.rs). Not edges: `stages::next` walks it in order and
# `passes::again` returns to `work`. There is nowhere to write a condition.
stages: [plan, work, verify]
# BUDGET, not topology: how many times one turn may walk that list.
passes: 4
max_rounds: 12
space: build
# POLICY: what "done" means, and the one command that decides it.
# One command, one exit code (T50). Deliberately not a script, not a pattern,
# not a list — that would put a small language in the harness.
goal.outcome: index.html renders the three cards from data.json
goal.check: test -f DONE.md
goal.done_when: DONE.md exists and names the three card titles
tools:
  - list_skills
  - read_skill
  - exec
  - read_file
  - write_file
  - list_files
---
You build small web pages…
```

Every key there ships today. Read the list again against ruling 2: `stages:` is a
**sequence of names from a closed set**, `passes:`/`max_rounds:` are **integers**,
`goal.*` is **one sentence and one command**, `tools:` is an **allowlist**. There
is no field in which a person could express "if verify fails, go back to plan".
That is the property to defend, and `spec::refuse_contradictions` is what defends
it — an unknown stage name is refused, not defaulted.

### 2.1 The one field I considered and refuse

`grounding: off | mark | refuse`.

It is *policy*, not topology — it names a consequence, adds no node and no edge.
So it would be legal. I still refuse it, on this codebase's own precedent:

> **No `verify_on_stop: false`.** Hermes shipped its best feature disabled. The
> gate is on for every agent, always, with no key to turn it off. If an agent
> should be allowed to answer after a mutation without running anything, that is
> a bug report, not a setting. — `docs/GOAL-AND-LOOP.md`

Grounding costs no model call and cannot hold an answer (§4). A key whose only
use is to switch off a free, non-blocking honesty mechanism is a key whose only
use is to let an agent lie more cheaply. It ships always-on, with no key.

**Net new declaration vocabulary in this design: zero keys.**

---

## 3. What the model sees at each role

Slot order is `context::Slot`: SOUL 0, IDENTITY 10, OPERATING_RULES 20, GOAL 25,
AFFORDANCES 30, USER 40, MEMORY 50, SPACE 55, ENVIRONMENT 60, TASK 70, HISTORY 80,
OBSERVATIONS 90, DIRECTIVE 95, RESPONSE 99. `assemble` sorts by slot and nothing
else. **New: `Slot::PLAN = Slot(26)`**, immediately after GOAL, for the reason
GOAL sits at 25 and not beside TASK — a plan is what the agent is working to, not
what the person just said.

### strategy — unchanged

| Slot | Component | Content |
|---|---|---|
| 0/10/20 | `Soul`, `Identity`, `OperatingRules` | the agent's own file |
| 25 | `Goal` | `goal.outcome` / `done_when` if declared |
| 30 | `Affordances` | **empty** — `brief::acts("strategy")` is false, so `scoped_tools` returns `Toolbox::default()` |
| 50/55 | `Sensed` (memory), `SharedSpace` | declared faculties |
| 60/70/80 | `Environment`, `Task`, `History` | the message and the conversation |
| 95 | `Directive` | `public/stages/strategy.md` |
| 99 | `ResponseContract` | `Contract::shaped(strategy::OBJECT)` — ROUTE + WHY |

**Tools: none.** Known defect on this call, T25: `SharedSpace` at Slot 55 names
`observe`/`find_files`/`start_process` five lines under an `## affordances` block
saying no tools are installed. It is on the call that opens *every* turn. Not
this design's to fix, but this design must not pretend it is absent.

### plan — one addition

Identical to strategy except: Affordances = exactly `list_skills` and
`read_skill` (`brief::skill_only`), Directive = `plan.md` (+ `durable.md` appended
when the agent has a space), contract = prose.

**Addition:** when the plan stage's prose reply comes back, `stages::next` writes
it into a new `Plan` component at `Slot::PLAN = 26` before advancing the cursor.
From that moment every later call in the turn carries the brief above
AFFORDANCES, pinned, `Stability::Stable`, immune to compaction — because
compaction rewrites `History` at slot 80 and touches nothing else.

### work — unchanged

Full toolbox (`ToolScope::All` narrowed by the agent's own `tools:`), Directive
empty (`brief::keyed("work")` is false — the person's request is the instruction),
contract = `Contract::tool_envelope()`. Plus, new, the `Plan` block at 26.

### verify — a SHEET, and this is the change

Built the way `window::sheet` is built: `paper::seed()`, then components set
explicitly. It is a separate `State`; the agent's own `state.paper` is **not
mutated**, so nothing here can corrupt the conversation.

| Slot | Component | Content |
|---|---|---|
| 0 | `Soul` | the agent's own soul — same voice, same house rules |
| 10 | `Identity` | the agent's own name. **Not "verifier"** — inventing a persona is exactly the role-name theatre ruling 3 rejects |
| 20 | `OperatingRules` | unchanged |
| 25 | `Goal` | `goal.outcome` / `done_when` |
| 26 | `Plan` | the brief's OUTCOME / PATHS / CHECK / DONE WHEN lines |
| 30 | `Affordances` | **empty** |
| 60 | `Environment` | the clock |
| 70 | `Task` | the person's original request, verbatim |
| 80 | `History` | **EMPTY, and this is the entire point** |
| 90 | `Observations` | this turn's tool results, in log order, including the exit status line `gate::said` appends |
| 95 | `Directive` | `public/stages/verify.md`, rewritten (§7) |
| 99 | `ResponseContract` | `Contract::shaped` — one CHECKED line, one line of what it read |

**What is absent and why:** the draft answer, the model's own reasoning, and
every earlier assistant turn. That is the CoVe factored condition and the
Panickssery self-preference defence, and it is the only thing that makes this a
"separate verifier" in any sense that measures.

**Tools: none — and that is a change from `brief::acts`, which lists VERIFY as a
stage that may act.** The reason it may act today is to run the CHECK command.
It no longer needs to: T2 already made the harness run `goal.check` itself
through `goal::check` → `Effect::InvokeTool` → `goal::returned`, on the SPACE
grant, without the model. So the command runs mechanically and its output lands
in `Observations`; the verifier reads the output. **One command, one exit code
(T50), and now nothing in the loop asks a model to run it.**

That leaves an honest hole: an agent with a `plan`-written CHECK line but **no
declared `goal.check`** has a command nobody runs. Today the verify stage runs it
by hand. Under this design it does not, and the verify sheet must say so —
"nothing ran; the CHECK line is prose and no `goal.check` is declared" — rather
than silently checking nothing. §4 names what the person sees.

### critique — unchanged, and deliberately the opposite

`critique` keeps the **full** window *including* the draft. It is reflection: it
improves the answer and gates nothing (`critic.rs` documents both halves). A
critique that could not see the draft would have nothing to critique. Two stages,
two opposite window policies, one reason each — that is the design, not an
inconsistency.

### the grounder — sees nothing

It is a function:

```rust
pub fn ground(reply: &str, evidence: &str) -> Grounding
```

`reply` is the answer about to be given. `evidence` is this turn's tool-result
text, concatenated in log order — the same material `Observations` renders.
`Grounding` is `{ checked: usize, found: usize, missing: Vec<String> }`.

- A **quote** is a span in the reply inside straight or curly double quotes, or a
  span inside a fenced/inline code span, of at least 12 characters. Under 12 is
  noise ("ok", "index.html") and would produce marks nobody can act on.
- **Found** means: after collapsing all runs of whitespace to one space and
  lowercasing both sides, the quote is a substring of the evidence. Nothing else
  is normalised. Every additional normalisation step is a step toward a fuzzy
  matcher, and a fuzzy matcher is a judge with worse manners.
- No model. No score. No threshold. `checked == 0` is a legitimate result and is
  reported as itself, never as a pass.

---

## 4. Where it fails, and what the person sees

| Failure | What actually happens | What the person sees |
|---|---|---|
| Strategy votes `project` on a greeting | four calls billed for "hello" | `core.route_chosen` carries `{route, why, how}`; the WHY clause is on the trace row beside the token meter, and `how` says whether the route was VOTED for or fallen back to — `react` reached both ways used to emit an identical fact. Already shipped |
| Strategy votes `react` on a build request | no plan, no verify, no critique — one react loop | Nothing distinguishes it from a correct react turn. **Unfixed, and named in §8** |
| Plan writes no CHECK line | verify sheet has no command named | Verify's reply says what is unchecked and why; the turn ends `unchecked` (`ending::UNCHECKED`) |
| CHECK line exists, `goal.check` does not | the harness runs nothing | Verify's reply says the CHECK line is prose and no `goal.check` is declared. This is the one *new* confusing state and it earns its own sentence in `verify.md` |
| `goal.check` names a command busybox lacks | non-zero exit, `Observations` carries `(exit status 127)` | Turn ends `goal unmet`, not `answered`; T50's ceiling is what it is |
| Verify sheet's model rambles instead of answering | the shaped contract is not honoured | Read like every other unreadable reply in this tree: it fails toward MORE work — unreadable reads as "not checked", so the ending is `unchecked`, never `answered` |
| Compaction runs mid-project | `History` is replaced | `Plan` at slot 26 and `Goal` at 25 survive; the brief and the goal are still in view. This is the bug S1 exists to close |
| A skill is compacted away | model acts on instruction it can no longer see | **Unfixed until T40b.** Named here because a design that says "pick up the skills" and leaves this open is claiming a capability it does not have |
| Grounder finds a missing quote | one fold, no model call | Ending is `ungrounded`; the missing quotes are listed with the answer. The answer is **still shown** — see below |
| Model paraphrases instead of quoting | `checked == 0` | The trace says `0 quotes checked`, not "grounded". The grounder cannot see a claim that carries no quote, and pretending otherwise is the failure this whole file is trying not to commit |
| Evidence is huge (`cat` of a big file, T46) | grounding still works — it is a substring check over bytes, not a window | No effect on the model's window. This is a small argument *for* the mechanical form |

**Grounding never withholds an answer.** It marks. Refusing to show an answer
because a substring check missed would eat correct answers about material nobody
quoted, and the failure would be invisible — the exact shape of harm this tree
spent eighteen UX rounds avoiding. The mark lands where every other fold lands:
one more arm in `answer::why`, ahead of `UNCHECKED` and behind `CRITIC_FAULTED`.

---

## 5. Build order

Five stages. Each is independently shippable, each is gate-green on its own, each
is useful if the next four never land. Smallest first.

**S1 — Pin the plan.** New `components/plan.rs` (~70 lines), `Slot::PLAN = 26`,
one branch in `stages::next` that writes it when the cursor leaves `plan`.
Uses `AgentState.plan`, which has been declared and unused since G4.
*Gate:* a golden assemble test showing the brief above AFFORDANCES; a stages test
proving it survives a compaction. *Ships alone as:* a project route that stops
forgetting its own brief.

**S2 — Ground.** New pure `ground.rs` (~120 lines), one `EventKind::Custom`
(`core.claims_grounded`, payload `{checked, found}`), one arm in `answer::why`,
one ending constant `UNGROUNDED`. No new tool, no new capability, no port.
*Gate:* host tests only — it is a pure function over two strings (I3).
*Ships alone as:* an answer that quotes a file it never read is marked.

**S3 — The verify sheet.** `verify.rs` becomes `verify/mod.rs` + new
`verify/sheet.rs` (~110 lines); one branch in `ask::call_model`; `brief::acts`
drops `VERIFY`; `public/stages/verify.md` rewritten to match a toolless window.
*Gate:* a golden test asserting the draft is **absent** from the assembled
Document — the assertion is the artifact, not the sheet.
*Ships alone as:* the separate verifier the mandate asks for.

**S4 — Skill honesty (T40b/T41).** Retract a compacted skill loudly; gate a skill
on capability presence. Inside `skills.rs`. *Ships alone as:* "pick up the skills"
stops being a claim the window can quietly falsify.

**S5 — Show the bill (T42).** `assemble::cost()` per component, one view. The
deep path is the most expensive route this app can take and today nothing shows
where the window or the money went. *Ships alone as:* the owner's "trace" ask.

S3 depends on S1 only for quality (the sheet is better with a pinned Plan; it
works without one). S2, S4 and S5 depend on nothing. If the round is cut short,
cut from the bottom.

---

## 6. Everything this design refuses

- **A verifier agent, a grounder agent, a planner agent.** Ruling 3, Open SWE's
  collapse, and our own deleted summarizer and critic.
- **A second mechanical gate.** `critic::passed` is the one verdict a machine
  reads. The verify sheet's reply changes what the ending *says*; it does not get
  a veto, because two gates with no precedence rule is a coin flip in a suit.
- **A 0–1 support score.** T38.
- **A fetch-page tool to make the grounder look better.** That is guest egress,
  T27, gated on an ADR and an I2 amendment.
- **A richer `goal.check`.** T50 ruled it: a script, a pattern or a list puts a
  small language in the harness and starts the core parsing again.
- **A `Replan` edge, a fifth stage, a per-agent stage brief, per-agent topology.**
  Ruling 2. `PhaseConfig.exits` already exists in `phase.rs` and is already
  vestigial; this design adds nothing to it.
- **`grounding:` as a key.** §2.1.
- **A grounder that blocks the answer.** §4.
- **Parsing the plan's CHECK line.** It stays prose that a model reads. The one
  check a machine reads is `goal.check`, and there is exactly one of those, so
  there is no question of which wins.

---

## 7. Everything in the tree this design changes

| File | Change | Size |
|---|---|---|
| `crates/context/src/slot.rs` (90) | `pub const PLAN: Slot = Slot(26)` + its paragraph | +6 |
| `crates/agent/src/components/plan.rs` | **NEW** — the pinned brief | ~70 |
| `crates/agent/src/components/mod.rs` (127) | `mod plan;`, one `pub(crate) use`, one `seed()` line | +3 |
| `crates/agent/src/stages/mod.rs` (153) | one branch in `next()`: leaving `plan` sets the component | +8 |
| `crates/agent/src/state.rs` (170) | `plan: Vec<PlanStep>` finally has a writer; possibly retype to `String` | +0/−4 |
| `crates/agent/src/ground.rs` | **NEW** — quotes, normalisation, `Grounding` | ~120 |
| `crates/agent/src/lib.rs` (102) | two `mod` lines | +2 |
| `crates/agent/src/answer.rs` (125) | one arm in `why()`, one tuple member | +6 |
| `crates/agent/src/ending.rs` (166) | `pub const UNGROUNDED` + its paragraph | +9 |
| `crates/kernel` | nothing — `EventKind::Custom` already carries it | 0 |
| `crates/agent/src/verify.rs` (165) | → `verify/mod.rs`, unchanged content | rename |
| `crates/agent/src/verify/sheet.rs` | **NEW** — the toolless verify window | ~110 |
| `crates/agent/src/ask.rs` (107) | one branch: VERIFY assembles the sheet, not the paper | +12 |
| `crates/agent/src/brief.rs` (196) | `acts()` drops `VERIFY`; its paragraph rewritten | +6/−1 |
| `public/stages/verify.md` (1) | rewritten: it must not tell a toolless window to run a command (T25's exact defect class) | ~3 lines |
| `public/agents/main/agent.md` (247) | **no change** | 0 |
| `crates/agent/tests/stages.rs` | the pin survives compaction; VERIFY may not act | +40 |
| `crates/agent/tests/ground.rs` | **NEW** — found / not found / zero-checked / short-quote | ~80 |
| `crates/agent/tests/verify_window.rs` | **NEW** — golden: the draft is absent | ~60 |
| `docs/GOAL-AND-LOOP.md` | the "No LLM judge for the verdict" bullet corrected in writing — T13 requires it | ~8 lines |
| `DECISIONS/ADR-011` | **NEW** — the verify window and the mechanical grounder | ~120 |

I12 pressure: `brief.rs` is at 196 of 200 and `verify.rs` at 165. The `brief.rs`
edit is net +5, which lands at 201. **Splitting `brief.rs` is part of S3, not an
afterthought** — the `acts`/`skill_only`/`keyed` trio is a gate, and the loader is
a loader; they are two subjects sharing a file. `verify.rs` becoming a folder
buys the room for `sheet.rs` at the same time.

**Nothing under `crates/adapters_web/` or `web/` changes.** The whole design is
pure core and tests on the host with `cargo test` (I3). No new port, no new
capability, no I6 surface, no I2 traffic.

---

## 8. Objections to my own proposal

**1. The verify sheet is a second paper, and this codebase has already been
burnt by two of anything.**

`window::sheet` exists and is precedent, but precedent is not proof. A second
`State` means a second place components are chosen, and the failure mode is
silent: the sheet forgets to set a block, `assemble` elides it, and the verifier
reasons from a window missing something nobody notices. The compaction sheet gets
away with it because its input is one string. Mine has seven components.

*My answer, partial.* The golden test in S3 is the mitigation and it must assert
the **whole** rendered Document, not the absence of the draft — a test that only
checks what is missing cannot catch what else went missing. But I will not
pretend this is fully answered: a second assembly site is a real cost and I am
paying it to buy one property (no draft in view). If a reviewer can get that
property by masking `History` at *assemble* time — a `Fidelity` or `Form`-shaped
answer inside `crates/context`, with one paper — that is a strictly better design
than mine and I could not find it. **Partly unresolved.**

**2. Taking tools away from `verify` is a capability regression, and I am
justifying it with a mechanism that most agents do not use.**

`brief::acts` lists VERIFY today so the model can run the CHECK command. I remove
that and lean on `goal.check`. But `goal.check` is *declared frontmatter*, and the
only shipped agent that declares one is a fixture. `main` does not. So under my
design, on `main`, the verify stage becomes a call that reads whatever `exec`
happened to run during `work` and can run nothing itself. For a real class of
turns that is strictly weaker than today.

*My answer, and it is a concession.* Two paths and I take the second. (a) Keep
`exec` in the verify sheet's toolbox — but then the sheet needs a tool loop, the
change triples, and the verifier is back to being a small agent. (b) Accept that a
verifier which cannot act is a *reader*, and that reading without acting is
precisely the "split reading and judging, never writing" line — then make the
weakness **loud** rather than quiet: `verify.md` says, in the reply, when nothing
ran and why. That is honest, it is smaller, and it is consistent with ruling 3.
It is still a regression for agents with no `goal.check`, and a reviewer would be
right to demand that S3 ship together with a `goal.check` on `main` or not at all.
**Resolved by conceding it, not by fixing it.**

**3. The grounder grounds against snippets, and its name says pages.**

T38's evidence is Hermes matching quotes against *fetched page text*. We have no
fetch. `search.rs` returns a 180-character snippet. So a model can write a
paragraph about a search result and grounding will find nothing to check — and
`checked: 0` is the most likely outcome in exactly the case (web research) that
motivated the feature. The grounder is genuinely useful for file and command
output, which is not what anyone means by "grounding".

*My answer.* Ship it, and name it for what it does. `Grounding` reports over "this
turn's tool results"; the UI sentence is "quotes checked against what this turn
actually read", not "against the sources". If that sentence feels like a
climb-down from T38, it is — and writing the climb-down down is the point, because
the alternative is the T20/T48 habit: a true-sounding string describing a machine
we do not ship. **Resolved, at the cost of a smaller claim.**

**4. Nothing in this design tests the router, and the router is the mandate's
first sentence.**

Ruling 1 says routing is DONE and not to redesign it. I obeyed. But §4 has a row
I could not fill: a `project` request that gets voted `react` produces no plan, no
verify, no grounding and **no signal whatsoever** that the deep path was skipped.
Every mechanism in this file is downstream of a vote nothing measures. There is no
test in the tree that runs a corpus of messages past `route_of` and asserts a
distribution, and `strategy.rs`'s fail-to-the-middle policy means every failure of
the vote lands in the one route that produces the least evidence.

*Unresolved, and it may be the most important sentence in this document.* Fixing
it is not a design change, it is T12 (no CI) plus a fixture corpus. But the deep
path's real reliability ceiling is the router's accuracy on a local 12B, and
**nobody has measured it.** Everything in §5 could ship green and the mandate
still be unmet, because the vote in front of it is unmeasured. I would put that
row on the tracker before I would build S4 or S5.

**5. I claimed "zero new keys" and that is a rhetorical win, not necessarily a
design one.**

Zero new declaration vocabulary is the strongest possible answer to ruling 2, and
I leaned on it. But the honest reading is that the deep path is **not declarable
at all** — a person cannot ask for "plan and verify but no critique on this
message", because `Route::Project::stages()` is a Rust literal. That is defensible
(the message decides, not the person) and it is also a capability we do not have
and are not admitting we do not have.

*My answer.* It is the right refusal, and it should be *stated* rather than left
as an absence — the lead's own 2026-08-20 ruling: a truth the system holds and
does not state is a defect. The sentence to ship: **the route is chosen per
message and cannot be pinned; if you need a fixed loop, declare `stages:`
yourself and do not declare `strategy`.** That sentence is true today, is written
nowhere, and costs one line in the agent-file skill. **Resolved by writing it
down.**
