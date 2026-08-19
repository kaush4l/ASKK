# ALIGNMENT — eight prior-art reads, one plan

Synthesis of `reference/agents/{devika,open-swe,bolt-diy,agent-zero,hermes,openalice,elizaos,vscode-modes}.md`
against the code as it stands on `main` (2026-08-13). Every claim about HARNESS below is cited
`path:line` and was read, not taken from the reports. Where a report describes HARNESS wrongly, the
code wins and the correction is stated.

A separate UX-critique loop owns `progress.md` and its open defects (rounds 11–13: the dashboard
claiming a run finished 71s early, the corrupt `write_file` stamped `ok`, the stale-service-worker
string worn as agent status). Nothing here duplicates that work; two items below are the substrate
those fixes will want, and say so.

---

## 1. The finding that reframes the project

**Five of the eight have no agent loop.**

- Devika: two straight-line pipelines of single-shot calls; the only feedback is `retries < 2` in
  the runner (`devika.md` §2). "Done" is a bookkeeping flag.
- bolt.diy: "There is **no multi-step agent loop for coding**" — one stream, a resumable parser that
  executes as it parses, and a human for the next turn (`bolt-diy.md` §2).
- OpenAlice: "**There is no agent loop in this codebase.** That is the central architectural
  decision" — it shells out to `claude`/`codex` and supervises the process (`openalice.md` §2).
- Open SWE: no hand-written graph; `get_agent` is a factory returning
  `deepagents.create_deep_agent(...)`, and the loop is somebody else's `create_agent`
  (`open-swe.md` §2).
- VS Code: the whole agent-mode loop is ~25 lines of `_runLoop`; everything else is prompt text,
  tool allowlists and confirmation UI (`vscode-modes.md` §3).

Three have a real one — Agent Zero's monologue (1592-line `agent.py`, no iteration cap), Hermes's
`conversation_loop.py` (7846 lines, 14 named exits), elizaOS's Stage-1 → planner pipeline
(`planner-loop.ts`, 5518 lines).

HARNESS has one, and it is 186 lines, pure, and testable on the host:
`crates/agent/src/step.rs:20` — `pub fn step(mut state: AgentState, input: Event) -> (AgentState, Vec<Effect>)`.
**Nothing in the backlog below rebuilds it.**

**Open SWE deleted the graph split everyone cites.** The Manager → Planner → Programmer → Reviewer
diagram in every write-up is gone from the source. What its authors kept is the one split that is a
*different job with a different toolset* — a read-only reviewer on its own thread with a findings
artifact — and they collapsed plan-vs-implement into a single boolean plus a tool filter
(`open-swe.md` §3, §10: "Copy the conclusion, not the diagram").

**Three independent codebases converged on modes costing zero engine.**

| | mechanism | engine cost |
|---|---|---|
| VS Code | Ask/Edit/Plan/Explore are `.agent.md` files generated at runtime by `buildAgentMarkdown()` — the same function that parses a user's file. "What changes between modes is three things and only three things: the tool allowlist, the markdown body prepended as system prompt, and the handoff buttons." (`vscode-modes.md` §2) | none |
| Open SWE | `plan_mode: bool` + `PLAN_MODE_EXCLUDED_TOOLS` recomputed on every model call (`open-swe.md` §3) | one flag |
| Hermes | "**No plan/ask/agent enum exists anywhere.**" Plan mode is a `SKILL.md`; ask mode is the `clarify` tool. (`hermes.md` §3) | none |

### What this means HARNESS should build

Modes are folders under `public/agents/` plus lines in `public/agents/index.json`. The enforcement
machinery already exists and is already the right shape: `agent.md`'s `tools:` list is resolved by
`subagent::toolbox_for` (`crates/agent/src/subagent.rs:23`), narrowed per phase by
`Toolbox::scoped` (`crates/agent/src/toolbox.rs:36`), and every call is checked against it at
dispatch by `Toolbox::check` (`toolbox.rs:69`) — not by prose the model may ignore, which is the
failure mode `agent-zero.md` §10 and `vscode-modes.md` §2 both name.

One code change is required first, and it is five lines. See backlog item 1.

### What NOT to build

- **No mode enum, no per-mode `PhaseId`, no phase machine expansion.** `ResponseContract::PlanSteps`
  and `Verdict` are unimplemented (`crates/agent/src/reply.rs:33` — `todo!("Plan/Verify contracts")`)
  and `PhaseId::Verify` is documented in the source as unreachable
  (`crates/agent/src/phase.rs:133`). Leave both alone. A plan is a markdown file the next agent
  reads; a verdict is a fold over tool results.
- **No graph, no orchestrator, no middleware stack.** Open SWE's `create_deep_agent` is a 700-line
  function that is almost entirely middleware-list assembly and validation that the exclusion config
  matched something — "infrastructure defending infrastructure" (`open-swe.md` §10).
- **No second calling convention.** bolt.diy runs an XML action protocol *and* MCP JSON tool calls,
  one of which has no result channel at all (`bolt-diy.md` §10). HARNESS has one:
  `name({json})`, layout-scheduled, in `crates/agent/src/calls.rs:19`.
- **No verification phase.** Hermes's best feature is a ledger and a policy check, and it "never runs
  anything" (`hermes.md` §6).

---

## 2. Where HARNESS already leads

Verified in the code, so the plan does not rebuild it.

1. **A pure step function.** `step.rs:20`. `AgentState` is plain serializable data
   (`crates/agent/src/state.rs:23`) — "Serializable because `Persist`ing this IS pause-and-resume".
   No competitor has this. Their loops hold live futures, provider clients and DB handles.
2. **Real sub-agent parallelism, scheduled by layout.** Calls written on one line are one batch;
   a newline means "after everything above" (`calls.rs:19-30`). The batch index rides out on
   `Effect::Delegate { agent, goal, batch }` (`crates/agent/src/effect.rs`), and each agent owns a
   Worker (ADR-008, noted at `crates/kernel/src/ports.rs:15-21`). Compare: Agent Zero has **one**
   subordinate slot, `await`ed synchronously (`agent-zero.md` §6); Hermes caps depth at 1 and 3
   concurrent; Open SWE has "no fan-out node, no scheduler" (`open-swe.md` §6).
3. **Spaces are filesystem and shared memory as one object.** `crates/agent/src/space.rs`: a name, a
   real folder at `/root/spaces/<name>` (`space.rs:66`), settled facts, and a noticeboard, all
   rendered into every prompt by `Space::context` (`space.rs:72`). Naming a space is what grants the
   shell (`subagent.rs:31-34` — "No space, no workspace — default deny"). Hermes: "**No 'spaces'
   concept exists** — grep returns nothing" (`hermes.md` §8), and it warns that its own
   `skip_memory=True` on every subagent forces re-briefing by string, which HARNESS's spaces already
   solve (`hermes.md` §10). elizaOS shares memory by default with subtractive privacy — the opposite
   default (`elizaos.md` §8).
4. **Artifacts with no artifact protocol.** `crates/ui/src/artifacts.rs:1-14`: an artifact is a file
   the agent wrote into `artifacts/` with the `write_file` it already has, rendered by extension,
   HTML in a `sandbox`ed iframe with no `allow-same-origin`. Hermes's artifact gallery is a regex
   scraper over transcripts, which its own report calls a mistake (`hermes.md` §10); Devika's is a
   PDF download link (`devika.md` §8).
5. **Per-agent budgets, declaratively.** `max_rounds` default 64 (`state.rs:63`, `state.rs:115`),
   `compact_at`, `keep_recent` (`spec.rs:29-36`). elizaOS's own head-to-head scores this **HARNESS,
   decisively** on the tool allowlist and **HARNESS** on loop control, noting its equivalents are
   "declared and have zero readers in core" (`elizaos.md` §7).
6. **Mid-turn steering with a defined contract, already shipped.** A user message during a turn is
   appended to history and emits *nothing* (`step.rs:33-37`), and if it arrived while a call was in
   flight the turn takes one more round rather than leaving it unanswered (`step.rs:108-112`). This
   is VS Code's "yield after the current tool execution" (`vscode-modes.md` §8), plus a case they
   don't handle.
7. **Compaction runs before every round, not only at the top of a turn** (`step.rs:174-184`), and a
   failed summarisation costs a compaction, never a conversation (`step.rs:68-74`,
   `crates/agent/src/window.rs:92`).
8. **Refusals that teach.** An unknown tool returns the available list; unreadable arguments return
   the tool's own generated `usage()` line (`toolbox.rs:69-92`); a sub-agent handed no goal is
   refused rather than started empty (`subagent.rs:57-88`). Devika's equivalent is `sys.exit(1)`,
   which kills the server (`devika.md` §10).
9. **One seam, synchronous by design.** `crates/core/src/lib.rs:160`. Reads hit projections; writes
   leave as effects. Hermes's answer to the same problem is ~40 JSON-RPC methods it recommends
   treating as a published catalogue (`hermes.md` §9.22) — HARNESS already has the shape.
10. **Files ≤200 lines, typed errors at every port** (`crates/kernel/src/error.rs`), and an
    append-only log with no edit and no delete (`crates/kernel/src/event.rs:118-154`).

**What every one of the eight lacks:** a pure, host-testable loop; a serializable agent state that
survives reload; deterministic golden-tested context assembly (`crates/context/src/assemble.rs:87`,
I14); and a size discipline. Hermes: `cli.py` 19,269 lines. elizaOS: `services/message.ts` 14,059.
Both reports say the same thing in the same words — steal behaviours, never layout.

---

## 3. Convergent findings (≥2 reports arrived independently)

Highest-confidence items in the document.

**C1 — Verification and grounding receipts.** *Hermes §9.1* (verify_on_stop: when a turn edited code
and tries to finish with no fresh green evidence, inject a synthetic user message and continue; max
2 nudges; evidence in a ledger keyed on `last_edit_at > evidence.created_at`). *elizaOS §9.2*
(reject a reply claiming an action happened when no tool result this turn proves it). *Open SWE §6*
(admits it has none in the loop — "Nothing in the loop asserts tests ran"). *Devika §10* (none at
all). Four reads, one conclusion. **HARNESS shape:** not a phase. The answer path is
`step.rs:100-114`; it inspects nothing. A fold over this turn's `ToolInvoked` events — did a
mutation happen, and did a later command exit 0 — is the whole check, and it is pure.

**C2 — Progressive skill disclosure.** *Hermes §9.9* (name + a **60-char** description is the whole
index, ~3k tokens for the library; body on `skill_view`; one more level for reference files).
*Open SWE §9.7* (directory + `SKILL.md` + frontmatter, `name` must equal the directory name, index
only in the prompt, ordered sources where last wins). *Agent Zero* (same `SKILL.md` shape).
*elizaOS §9.4* (skills authored from trajectories into `proposed/`, human promotion gate). Four.
**HARNESS shape:** `public/skills/<name>/SKILL.md` mirroring `public/agents/`, an index section in
the paper, one `read_skill` builtin. The owner's stated architecture already names a `skills/`
folder; born with disclosure, not retrofitted.

**C3 — Modes are an allowlist plus a prompt body.** Covered in §1. Three codebases.

**C4 — Tool results return a path, not a payload.** *Open SWE §9.3* (`_sandbox_output.py`: over N
chars goes to chunked JSONL in the sandbox; the tool returns `{path, chars}`). *Hermes §9.6*
(per-tool truncation, spill to `/tmp/hermes-results/{id}.txt` leaving a 1500-char preview, 200k
per-turn aggregate — plus the trap: never spill `read_file`, it creates a persist→read→persist
loop). Two, both ~40 lines. **HARNESS shape:** the workspace exec handler in `crates/core`, spilling
into the space folder the agent can already `read_file`.

**C5 — Compaction that offloads and templates instead of deleting.** *Open SWE §9.2* (evicted turns
written to a file whose path is inside the summary; clip oversized tool *arguments* first, which
often avoids summarising at all). *bolt.diy §9.4* (fixed template with a `Failed Approaches`
section; `simplifyBoltActions` replaces every file body with `...` so contents never re-enter
history). *Hermes §9.11* (named sections, tail cut by *token budget* not message count, never split
a tool call from its result, deterministic fallback if the summariser call fails, anti-thrash: skip
if the last two saved <10%). *Agent Zero §9.4* (tiered budget 50/30/20 with a ladder of cheapening
actions). Four. **HARNESS shape:** `COMPACT_PROMPT` is a `const` at `window.rs:26` — the template
half is a string edit. The anti-thrash and never-split rules are three lines in `window.rs`.

**C6 — Snapshot tied to the turn, filesystem and conversation moving together.** *VS Code §9.5*
(snapshot before each request; **Restore Checkpoint** rolls back the workspace *and removes every
later request from history*). *Open SWE §9.1* (turn snapshot into a git ref — "the only way to catch
edits made through `execute`"). *bolt.diy §9.2* (snapshot files into IndexedDB, restore by
synthesising a hidden assistant message the ordinary parser replays; `?rewindTo=` falls out for
free). *Hermes* (shadow-git checkpoints; `/rollback N` also undoes the conversation turn "so the
agent's context matches the filesystem"). Four. **HARNESS needs this most:** under container2wasm
the root is tmpfs in guest RAM, and the port states it —
`WorkspacePort::durable` (`crates/kernel/src/workspace.rs:104-114`).

**C7 — Repairable versus fatal, as loop policy not just as a type.** *Agent Zero §9.6*
(`RepairableException` → the error is appended to history and the model retries; anything else kills
the loop). *Hermes §9.15* (`ClassifiedError` carries `retryable / should_compress /
should_rotate_credential / should_fallback` so the retry site never re-classifies). *Open SWE §11*
(a 20-line transient/permanent classifier). *Devika §9.1* (attribute a failure to the *command* or
the *code* before repairing — one narrow call, capped at 2). Four. **HARNESS has the types
(`kernel/src/error.rs`) and no policy:** `on_tool_result` appends every result identically
(`step.rs:147-148`) and `ok: false` is prose the model may ignore.

**C8 — Named exits and one counter per pathology.** *Hermes §9.3* (14 named `_turn_exit_reason`).
*elizaOS §9.1* (seven named budgets — repeated identical *failures*, repeated identical *successes*,
unavailable-tool retries, terminal-only continuations — each raising one typed
`TrajectoryLimitExceeded {kind, max, observed}`; `maxRepeatedToolCalls` exists because a model was
observed re-issuing an identical **successful** fetch 17 times). Two. **HARNESS today has one named
stop** (`core.note`, `step.rs:157-171`) and one silent one (`state.task = None`, `step.rs:113`).
`public/agents/main/agent.md` *asks* the model: "Never call the same tool twice with the same
arguments." A prompt sentence is not an invariant (`hermes.md` §9.5).

**C9 — Asking the user is a tool, not a mode.** *Devika §9.2* (`ask_user` as a field of a structured
response; the pipeline suspends). *Hermes §9.13* (`clarify`: a question, ≤4 ordered choices with the
recommendation first, `multi_select`, and the one tool never run in parallel). *VS Code*
(`vscode/askQuestions` is in every read-only mode's toolset). Three. HARNESS has nothing: an agent
that needs input can only end its turn with prose and hope.

**C10 — Model roles, not model ids.** *elizaOS §9.3* (20 `ModelType` roles bound late — "the
portability HARNESS says it wants and `model: local` defeats"). *Agent Zero §9.3* (chat / utility /
embedding; the utility model does summarisation, memory queries, chat naming — "the expensive model
never does bookkeeping"). *VS Code* (`model:` is a string **or an ordered fallback array**).
*Hermes* (fallback provider chains inherited by children). Four. **Correction to the reports:**
HARNESS's `model:` is a *catalogue key*, not a URL or a model id (`spec.rs:23`,
`public/models.json`), which is half the win already. What is missing is a role indirection and a
cheap tier: compaction is sent to `state.summarizer_model` (`window.rs:118`), which is whatever the
summarizer's file happens to name.

**C11 — Layered instruction files under every agent.** *VS Code §9.7* (`*.instructions.md` with
`applyTo` globs, always-on project rules). *Open SWE §9.6* (ancestor `AGENTS.md` appended to
`read_file` results, once per path per run — "scoped rules without paying for them up front").
*Hermes §4* (context files, first match wins, subdirectory hints discovered lazily and appended to
*tool results*). *OpenAlice §9.4* (persona + instruction written byte-identically to both
`CLAUDE.md` and `AGENTS.md`). Four — **but** VS Code's own report flags the mistake: four accepted
filenames with "no specific order is guaranteed" (`vscode-modes.md` §10). Take one file, one order.

**C12 — Already solved, worth not regressing.** *elizaOS §9.6* warns that a narrowed toolset can
produce a phase with no legal exit, so `REPLY`/`IGNORE`/`STOP` are appended to every planner call.
HARNESS is safe: prose is always a legal reply and always ends the turn (`reply.rs:31`,
`step.rs:100-114`). Do not add a `finish` tool.

### Where two reports contradict

- **Devika §9.5** proposes a one-shot LLM classifier to route the follow-up turn, calling it "the
  cheapest implementation" of plan/ask/agent modes. **Open SWE, VS Code and Hermes all disagree by
  construction** — the mode is the user's pick of an allowlist, decided before any call.
  **Pick the three.** A classifier is a model call, a latency, and a new failure mode, bought to
  decide something the user already decided by picking an agent.
- **bolt.diy §9.1** ranks execute-while-streaming first. **ARCHITECTURE.md:109-112 already resolved
  this** (ADR-002): streaming is core-driven chaining, deltas never enter the event log, only the
  completed message becomes an Event. `step` consumes `ModelReplied` as a completed fact
  (`step.rs:76`). Executing on partial output means a tool runs before the reply is a fact, which
  breaks the replay property the loop exists to have. **Reject the execution half.** The display
  half is a separate, cheaper question.
- **Agent Zero §9.1** calls a per-file prompt override chain (eight search roots, `{{ include
  original }}`) "the single highest-leverage item in the report". **Hermes §10 and elizaOS §10 both
  name config sprawl as their worst trait**, and VS Code's own docs admit unordered merge.
  **Pick one layer**: a single `public/instructions.md` composed into every agent's prompt, and
  skills for everything else. Eight-root resolution is a debugging tax paid forever.

---

## 4. The gap table

| Capability | HARNESS today | Best of the eight | Smallest honest version | Size |
|---|---|---|---|---|
| skills folder | none — no `skill` symbol in `crates/` | Hermes (3-level disclosure, 60-char cap) | `public/skills/<n>/SKILL.md` + an index section + one `read_skill` builtin | M |
| plan / ask / agent modes | none; `PlanSteps` is `todo!()` (`reply.rs:33`), `Verify` unreachable (`phase.rs:133`) | VS Code (modes *are* agent files) | two new folders under `public/agents/` + the allowlist fix (item 1) | S |
| goal→plan→implement→test→verify | no; one `Work` phase (`phase.rs:122-132`) | Hermes `/goal` (contract, gates, judge) | a plan file the build agent reads + C1's ledger; **not** a phase machine | L |
| verification / evidence | none; the answer path checks nothing (`step.rs:100-114`) | Hermes `verify_on_stop` | fold this turn's `ToolInvoked`; one synthetic nudge, cap 2 | M |
| spaces (fs + shared memory as ONE) | **yes** — `space.rs` + workspace tools attached with the space (`subagent.rs:31-34`) | HARNESS | nothing to build; gap is per-space instructions + a locked-files line | done |
| artifacts as user-visible windows | **yes** — `ui/artifacts.rs`, file rendered by extension, sandboxed iframe | HARNESS | gap is durability (C6) and PDF = browser print-to-PDF from an HTML artifact | S |
| multiwindow | 6 nav views, one at a time (`crates/ui/src/views.rs:46`) | none of the eight (bolt.diy's editor+preview+terminal is closest) | a two-pane split on Workspace only. Not a window manager | M / YAGNI |
| streaming execution | no — completed replies only (ADR-002, `step.rs:76`) | bolt.diy (resumable parser) | display-only token streaming; never execute-on-partial | M, gated |
| reload / persistence | conversation **yes** (log segments, I11); workspace **no** under c2w (`workspace.rs:104-114`) | bolt.diy snapshot-as-message; VS Code checkpoints | snapshot the space folder to `BlobStore` at turn end; restore at boot | M |
| model portability (roles not ids) | half — `model:` is a catalogue key (`spec.rs:23`), no role, no fallback list | elizaOS (`ModelType`) | two reserved catalogue names, `fast` and `main`; bookkeeping calls use `fast` | S |
| sync | none | **nobody.** OpenAlice syncs by being a git repo on a desktop; Hermes by SQLite on a host | export/import the event log + `agents/` as one file the user moves | M |
| voice (STT→agent→TTS) | none | **nobody.** OpenAlice: zero, verified by grep (`openalice.md` §8). Hermes ships TTS/STT among 87 tools its own report calls "surface area, not capability". elizaOS's character has `voice.model` with no loop integration | Web Speech API in the UI layer only: recognition fills the composer, synthesis reads the answer | S + a gate |

**Voice, plainly: there is no prior art in these eight.** The gold standard the owner named does not
exist in any of them. The honest smallest version does not touch the loop, the seam or any port — it
is a browser API in `crates/ui`, and its only real cost is that it is the first deliberate exception
to I5 (no application logic in JS). That makes it a decision, not a task (§7).

---

## 5. The ranked backlog

Ordered by value per line of code. **[GATE]** marks an ADR-level or user decision that stops per
`CLAUDE.md`.

**1. The space must not out-grant the allowlist.** *(S)*
`crates/agent/src/subagent.rs:46` — `tools.extend(space)` appends all three space tools **and all
ten workspace tools** (`workspace.rs:22-89`, including `exec` and `write_file`) *after* the
declared-list filter runs. So today **a read-only agent that can see the repo is unrepresentable**:
naming a space to get `read_file` also grants `exec`. Fix: when `spec.tools` is non-empty, filter
the space set by it too, exactly as builtins are filtered. Why: VS Code §9.2 — the allowlist *is*
the mode, and Plan is safe because it has no write tool, not because it was told not to write.
Breaks: `main` names `space: research` with an explicit `tools:` list and would silently lose its
shell — its list must gain the workspace tools in the same commit. Verify: a host test asserting
`toolbox_for` on a spec with `tools: [read_file]` and `space: research` yields exactly one tool.

**2. Two mode agents.** *(S)*
`public/agents/scout/agent.md` and `public/agents/ask/agent.md` + two lines in `index.json`. Zero
Rust. Why: VS Code §9.1 (highest ratio in that document), Open SWE §9.4, Hermes §3. Note the
existing default already helps: `builtin_tools()` is only four tools (`tools.rs:107-135`), so an
`ask` agent with no space is read-only by construction. Breaks: nothing, once item 1 lands — before
it, a scout agent cannot both read files and be unable to write them. Verify: ask the scout agent to
edit a file; it declines, and the Tool trace shows no `exec` because `exec` is not in its toolbox.

**3. Verification evidence and the stop-gate.** *(M)*
New `crates/agent/src/verify.rs` (pure) + one arm in `step.rs`'s answer path. Record per turn: did a
mutating tool succeed, and did any later `exec` exit 0. If the model answers after a mutation with
no fresh green evidence, append one synthetic turn and continue. Cap at 2, then let the answer
through with the gap stated. Why: Hermes §9.1, elizaOS §9.2, Open SWE §6, Devika §10. Breaks: some
turns get one round longer; a turn that would have ended can now hit `max_rounds`, so the nudge cap
must be lower than the round cap. Verify: host test — `ToolInvoked{write_file, ok:true}` then a
prose `ModelReplied` yields one `CallModel`; a second prose reply ends the turn. This is also the
substrate the UX loop's "corrupt write stamped ok" defect (round 13 P0-2) will want; it is not that
fix.

**4. Tool-result spill.** *(S)*
The exec/read handlers in `crates/core/src/workspace.rs`. Output over N chars is written into the
space as `.harness/out/<n>.txt`; the result is a preview plus the path and one sentence telling the
model to `read_file` it. Why: Hermes §9.6, Open SWE §9.3. Copy Hermes's trap: **never spill
`read_file`** — that is a persist→read→persist loop. Breaks: nothing; the model already has
`read_file`. Verify: `exec cat` on a large file leaves the assembled document under budget and the
trace shows a path.

**5. Named exit reasons.** *(S)*
An `ExitReason` on `AgentState` (`state.rs`), set at every `break` in `step.rs`, projected in
`crates/core/src/logbook.rs`. Hermes has 14 (`hermes.md` §9.3); HARNESS has one named and one
silent. Why: Hermes §9.3, elizaOS §9.1. Breaks: `AgentState` is serialized, so the field needs
`#[serde(default)]` like every other addition there. Verify: every `return` in `step.rs` sets one —
enforceable by making the field non-`Option` and letting the compiler ask.

**6. Loop guardrails as counters.** *(S)*
`crates/agent/src/toolbox.rs` or a `guard.rs`: hash `(tool, args_json)` per turn; count exact
repeats, same-tool failures, and identical *successes*. Warn into the tool result at 2/3/2; end the
turn with a named reason at 5/8/5. Why: Hermes §9.5, elizaOS §9.1 (whose `maxRepeatedToolCalls`
exists because a model repeated an identical successful fetch 17 times). Replaces the prose rule in
`public/agents/main/agent.md`. Breaks: nothing; it is state plus a check. Verify: a scripted model
that loops on one failing call terminates in ~5 rounds, not 64.

**7. Skills with progressive disclosure.** *(M)*
`public/skills/<name>/SKILL.md` (frontmatter `name` = folder name, `description`), a `skills`
section seeded in `crates/agent/src/seed.rs` holding only `name: <60-char description>`, and one
`read_skill(name)` builtin in `tools.rs` + `crates/core/src/tools.rs`. Why: Hermes §9.9, Open SWE
§9.7, Agent Zero, elizaOS §9.4. **Ship "plan mode" as a skill file too** — Hermes's plan skill body
is the exact prose, and it costs zero engine. Breaks: the paper's section list is canonical and
`assemble` rejects duplicates and interleaved stability classes (`assemble.rs:151-182`); adding a
section touches the golden tests (I14). Verify: 20 skills cost under 400 tokens of index; an agent
asked to do X reads exactly one body.

**8. Repairable-vs-fatal tool failures.** *(S)*
`kernel/src/error.rs` + `on_tool_result` in `step.rs`. A repairable failure is already handled
correctly by accident (the message goes back to the model); what is missing is the *other* half —
a failure the model cannot fix must end the turn with a named reason instead of burning 64 rounds.
Why: Agent Zero §9.6, Hermes §9.15, Open SWE §11. Pairs with items 5 and 6. Verify: a
`WorkspaceError::Unavailable` (`kernel/src/workspace.rs:33`) ends the turn saying so, rather than
being handed to the model as text it will retry against.

**9. Compaction template, never-split, anti-thrash.** *(S)*
`window.rs:26` (`COMPACT_PROMPT` is a `const` — the template is a string edit) and `window.rs:72`.
Named sections including **Failed approaches** (bolt.diy §9.4); never split a tool call from its
result (Hermes §9.11); skip if the last two compactions each saved under 10% (Hermes §9.11); never
let a written file body re-enter history, only the fact of the write (bolt.diy's
`simplifyBoltActions`). Breaks: the compaction disclosure in `crates/core/src/memory.rs` renders
the summary — it will change shape. Verify: compact a synthetic 80-entry window twice and assert the
second summary retains the first's sections.

**10. A `clarify` tool.** *(S)*
`tools.rs` descriptor + executor in `crates/core` + a UI affordance. A question, up to four ordered
choices with the recommendation first. It **ends the turn** — the question is the answer — which is
the browser-honest version of Devika's blocking poll (`devika.md` §9.2, §10: "keep the contract, drop
the mechanism"). Why: Hermes §9.13, Devika §9.2, VS Code. Breaks: nothing; it is one more tool.
Verify: a sub-agent in its own Worker asks and the question reaches the page attributed to it.

**11. A `fast` model role.** *(S)*
Two reserved names in `public/models.json` (`main`, `fast`) and `window.rs:118` sending compaction
to `fast`. No new type, no port change — the catalogue key *is* the indirection. Why: elizaOS §9.3,
Agent Zero §9.3. Verify: a compaction with `fast` pointed at a different entry hits that endpoint.

**12. One instructions file.** *(S)*
`public/instructions.md`, composed into the `operating_rules` section for every agent in
`seed.rs`/`paper.rs`. **One file, one order** — the deliberate rejection of Agent Zero's eight roots
and VS Code's four filenames. Why: VS Code §9.7, Hermes §4, OpenAlice §9.4. Verify: assembling any
agent's document contains it exactly once.

**13. Per-space instructions and locked files.** *(S)*
Two lines in `Space::context` (`space.rs:72`): a `SPACE.md` from the space folder if present, and a
locked-paths list the write tools refuse against. Why: Open SWE §9.6, bolt.diy §9.9. Verify:
`write_file` on a locked path is refused with the same shape as a `..` path today
(`workspace.rs:134-152`).

**14. Turn snapshot of the space.** *(M)* **[GATE — ADR]**
Snapshot the space folder into `BlobStore` at turn end and restore at boot, so the c2w workspace
survives a reload; the restore path is the same `write_file` the agent uses, so there is no second
implementation (bolt.diy §9.2's best property). Why: Open SWE §9.1, VS Code §9.5, bolt.diy §9.2,
Hermes. Gate because it is a storage-shape and quota decision, and a prior measurement put c2w
persistence at ~79 KB/s. Breaks: quota — OPFS has failed at KB scale in preview before. Verify:
write a file, reload, the file is there and the Files pane and the event log agree.

**15. `max_rounds` as a negotiable budget.** *(S)*
`step.rs:157-171` currently stops with a note telling the user to edit a file. VS Code emits a
confirmation carrying `round(limit * 3/2)` and resumes on accept (`vscode-modes.md` §9.4). Hermes
adds a **grace call** so the last iteration writes a summary instead of leaving a truncated tool
trace (`hermes.md` §9.16). Do both; the grace call first, it is three lines.

**16. Handoffs.** *(M)*
`handoffs: [{label, agent, prompt}]` in frontmatter, buttons after a response, and the click is one
`Request` through the existing seam. This is goal→plan→implement with no orchestrator
(`vscode-modes.md` §9.3, "the biggest gap"). Deferred behind item 2 — a handoff needs somewhere to
hand to.

**17. Voice.** *(S)* **[GATE — I5 exception]** See §7 decision 2.

**18. Sync.** *(L)* **[GATE — I1 risk]** See §7 decision 3.

---

## 6. Explicitly rejected

Each with the one line that kills it.

- **The Manager/Planner/Programmer/Reviewer graph split.** Its authors deleted it (`open-swe.md` §10).
- **LangGraph / deepagents / Pregel / StateGraph / checkpointers / `Command`+`Send` / reducer state
  channels.** ~12.6k lines of platform, and the seam is one function (`core/src/lib.rs:160`).
- **A middleware stack as a growth strategy.** 16 order-sensitive layers with load-bearing ordering
  comments is a permanent debugging tax (`open-swe.md` §10).
- **Handlebars or any template engine.** elizaOS's silently drops every `{{#if}}` under a no-`eval`
  CSP — the exact environment HARNESS ships to (`elizaos.md` §10).
- **A vector store / FAISS / embeddings for memory recall.** `agent-zero.md` §9.11 concedes HARNESS
  has none; in a tab it is a dependency tree and a model call per turn to solve a problem spaces and
  skills already address.
- **Execute-while-streaming.** Breaks the replay property (I8) that makes the loop a fold; ADR-002
  already resolved streaming as completed-reply-only (`ARCHITECTURE.md:109-112`).
- **A second tool-calling convention alongside the existing one.** bolt.diy runs two, one with no
  result channel (`bolt-diy.md` §10).
- **A `mode:` frontmatter enum, or a `PhaseId` per mode.** The allowlist is the mode; three
  codebases converged on it.
- **An LLM classifier routing the follow-up turn** (`devika.md` §9.5). A model call to decide what
  the user decided by picking an agent.
- **Enforcing capability by omitting the tool from the prompt** (`agent-zero.md` §5). HARNESS
  enforces at dispatch (`toolbox.rs:69`), which is strictly better; keep it.
- **A per-file prompt override chain with eight search roots.** One layer, per §3's contradiction
  ruling.
- **Out-of-band human-in-the-loop** — dashboard page, human, newly dispatched run (`open-swe.md`
  §10). Needs a server.
- **Anything else needing a server:** Slack/Linear/GitHub webhooks, a cron daemon, a loopback tool
  gateway (`openalice.md` §5), stdio MCP, a scan-everything scheduler, LangSmith sandboxes.
- **Cloud budget numbers:** `recursion_limit: 9999`, 5000 model calls, 45-minute wrap-up, 15-minute
  per-call timeout. A browser tab is not that.
- **Durable domain objects in thread metadata / a metadata-as-database pattern** (`open-swe.md`
  §10). HARNESS has an event log; the two would fight.
- **Profiles as the unit of agent identity** — a whole home directory per agent, unshareable, with
  the rule "never point two processes at one profile" (`hermes.md` §10). `agent.md` already wins.
- **Per-agent `hooks:` that shell out** (`vscode-modes.md` §10). No shell to hook, and it is
  arbitrary execution in a config file.
- **Assisted permissions — an LLM judging tool-call risk.** VS Code's own docs walk it back
  (`vscode-modes.md` §10).
- **Ten escape hatches per component**, and a `.strict()` schema shipping a file that fails it
  (`elizaos.md` §10). This is what "no speculative generality" exists to prevent.
- **Regex-scraping transcripts to build an artifact gallery** (`hermes.md` §10). HARNESS's artifacts
  are files.
- **Config sprawl:** a 94KB config example, 150+ fields, `maxSteps` in a schema with no reader
  (`openalice.md` §10). Nine frontmatter keys is the correct number.
- **Unbounded autonomy** — elizaOS's 30s timer with no goal, Agent Zero's no-iteration-cap monologue.
  `max_rounds` exists (`state.rs:63`).
- **One subordinate slot, awaited synchronously** (`agent-zero.md` §10). Worker-per-agent is already
  better; do not regress.
- **"Always call a tool every turn"** (`open-swe.md` §10) — a prompt forbidding the one thing that
  ends a run, plus a middleware to undo it when it happens anyway.
- **Whole-repo-in-every-prompt** (`devika.md` §10). `compact_at` exists.
- **`.chatmode.md` as a name or shape.** Deprecated in its own source.
- **PDF via a rendering dependency.** An HTML artifact plus the browser's print-to-PDF is the whole
  feature, and `ui/artifacts.rs` already renders HTML artifacts.

---

## 7. The three decisions only the owner can make

**1. Does the workspace survive a reload, and at what cost?**
**DECIDED 2026-08-18 by the owner: no, it does not — (c), and (b) is the way back.**
This was written when it depended on the engine: CheerpX kept its overlay in IndexedDB,
container2wasm's root is tmpfs in guest RAM. CheerpX is deleted — container2wasm is the sole
engine, chosen for sovereignty over an image this project hosts itself — so the answer is no
longer conditional and neither is the sentence the product has to say. **Files in an agent's
folder do not survive a reload, there is no setting that changes that, and any copy still
offering the other engine as the way to keep them is a lie.** The port still tells the truth
about it: `WorkspacePort::durable` stays and is now uniformly false, which is exactly the point
of having asked the port rather than the engine.

What this costs, unchanged: every honest verification, artifact and plan-then-implement story
assumes files persist, and none of them can any more.

The route back, unchanged and now the ONLY route: (b) snapshot the *space folder* into
`BlobStore` at each turn end (backlog 14). The prior ~79 KB/s measurement was for the whole
image; a space folder is kilobytes and the restore path is the `write_file` that already exists.
It is an ADR, and it is no longer competing with an engine choice — it is the whole feature.
Option (a), "make CheerpX the default and accept the CDN/licence dependency", is off the table:
the CDN and the licence are what the owner deleted.

**2. Is voice in scope now, and is it worth an I5 exception?**
No prior art exists in any of the eight (§4). The cheap version — `SpeechRecognition` filling the
composer, `speechSynthesis` reading the answer — is browser API in `crates/ui` and touches neither
the loop nor the seam, but I5 says "no application logic in JS. A behavior needing JS needs a reason
in writing."
(a) Ship the UI-only version now with the I5 exception written into `INVARIANTS.md`.
(b) Do it properly as `ModelPort` roles for transcription and speech, so voice is portable and
BYO-endpoint like everything else — larger, and a port change.
(c) Defer entirely until the coding loop is honest.
**Recommendation: (a) now, with (b) recorded as the upgrade path.** The value is demonstrating the
Jarvis sequence end-to-end; the risk of (a) is confined to one crate and one paragraph.

**BUILT (increment 19), as (a).** `crates/ui/src/composer/voice.rs` and its one child: a *Dictate*
button that appends finished phrases to the composer's draft, and a *Read the answer aloud* button
that speaks the last `.msg.assistant` in the pane. Nothing sends by itself; nothing new crosses the
seam. The I5 exception is written into `INVARIANTS.md`, and I2 carries a note too — which was not
in the recommendation and should have been, because dictation is outbound traffic to an endpoint
nobody configured.

*What the screen says.* The mic control carries an unfolded paragraph next to it saying that
dictation hands microphone audio to the browser's speech service — in Chrome, Google's — that this
is the only part of HARNESS leaving the browser apart from the model endpoint the user configured,
and that the page cannot tell whether a given browser does it on the device, so assume it does not.
The synthesis control carries the same caution about network voices. This product's pitch is that
it runs in your browser; a mic that quietly ships audio to a third party under that sentence is the
worst thing in the product to get wrong, so it is said where the button is and not in a fold.

*What was not built, and why.*
- **(b), the port version.** Transcription and speech as `ModelPort` roles, so voice is
  BYO-endpoint like every other model call, portable across browsers, and no longer an exception to
  I2 or I5. That is the upgrade path and it retires the exception rather than adding to it. It is a
  port change and a larger piece of work; it should be taken the first time someone wants voice
  against their own endpoint, or the first time Firefox users matter.
- **transformers.js / Whisper in the tab.** The owner named it and it is genuinely the honest
  answer to "runs in your browser" — recognition with no audio leaving the device at all. It is not
  this increment because the smallest useful Whisper build is tens of megabytes of model weights
  fetched before the first word can be transcribed, on a page whose entire value proposition is
  that it *loads*: the current bundle plus agents is a fraction of that, and a voice button that
  costs a 40–75 MB download on first press is not a cheaper version of the feature, it is a
  different product decision about page weight. It belongs behind the same `ModelPort` seam as (b) —
  a local in-tab transcription endpoint is then just one more configured endpoint — and behind an
  explicit "download the model" gate the person presses, with the size on the button. Recorded, not
  built.
- **On-device detection.** Recent Chrome exposes whether recognition can run locally; `web-sys`
  0.3.98 has no binding for it, and this page does not reach around `web-sys` to guess. So the
  wording states what is known and claims nothing about the local case.

**3. What does "sync, works from anywhere, no specific dependency" mean?**
No one of the eight solves this browser-only: OpenAlice syncs by being a git repo on a desktop,
Hermes by a SQLite file on a host, Open SWE by being a cloud deployment.
(a) Export/import: one file containing the event log plus the `agents/` folder, moved by the user.
Static, I1-safe, ships in a week.
(b) Replicate the event log to a configured remote endpoint the user runs — the first non-static
dependency, and it argues with I1.
(c) Nothing; "anywhere" means the app is a URL and the state is per-browser.
**Recommendation: (a).** It satisfies "no specific dependency" literally and keeps I1 intact. (b)
should not be attempted before the loop is worth syncing.
