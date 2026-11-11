# 006 Goal statements: how to hand a stage to Opus or Sonnet

## What a goal is, mechanically

From Claude Code's documentation for `/goal` (checked 2026-11-10):

- After every turn, a **small fast model** is given the condition and the conversation so far,
  and answers: met, not met (with a reason that steers the next turn), or impossible.
- That judge **runs nothing and opens no file.** It knows only what was shown in the
  conversation.
- The condition may be up to 4,000 characters. There is no turn limit unless the condition
  states one. Several turns with no tool use stop the loop.
- Judging is skipped while subagents or background commands run.
- A goal does not change the permission mode.
- `claude -p "/goal …"` runs one to its end without a window.

Everything below follows from the second point.

## The five rules

1. **Write the end state, not the wish.** "Perfectly built", "T3-like" and "composable" cannot
   be seen in a conversation. A test that passes can.
2. **Name the proof and ask for it to be shown last.** The judge can only believe output it
   can read: the last lines of `cargo test`, a `git diff --stat`, the text of a page.
3. **Say what must stay true.** Walls are part of the end state: a path whose diff is empty, a
   dependency list that did not grow.
4. **Point at the vision; do not paste it.** The decisions live in this folder. A goal that
   re-explains them invites the model to re-decide them.
5. **One stage, and a bound.** A goal across stages ends when a summary sounds finished.

The paragraph that started this report was the right shape for research (a wide wish, many
sources) and the wrong shape for building: it held the vision, the method and seven deliverables
at once, and "perfectly" was the only test. It is now split into what each part should be:
vision in `000`–`004`, order in `005`, and one checkable sentence per stage below.

## The shape

```text
/goal Stage <n> of docs/sessions/005-drive.md is done: <the end state, one sentence>.

Proof, shown as the last thing in the conversation:
- `cargo test --features server` ends with "0 failed" and its output includes <test names>.
- <the live run, if the stage has one, with what it printed or what the page showed>.

Must stay true:
- `git diff --stat -- <paths that are not this stage's>` prints nothing.
- <a wall from 004, as a command whose output shows it>.

Read first: docs/structure.md, docs/sessions/004-architecture.md, this stage in 005-drive.md.
Check a harness's wire against the installed program (`--help`, a generated schema, a captured
run), not from memory.
If the port in src/core/session.rs must change, or a decision in 002-decisions.md looks wrong,
stop and say so; do not work around it.
Stop after <n> turns if it is not done, and say what is left.
```

Why each line is there:

| line | what it prevents |
| --- | --- |
| the stage and one sentence | the model choosing its own scope |
| proof shown last | a goal that is met but cannot be seen to be |
| must stay true | a stage that passes by moving a wall |
| read first | the design being re-derived, slightly differently |
| check against the installed program | a wire format remembered from a year ago |
| stop and say so | S11: a silent redesign |
| a bound | a loop with no end |

## The first three, written out

**Stage 0**

```text
/goal Stage 0 of docs/sessions/005-drive.md is done: a recorded session replays through the
Harness port into the cards of a `sessions` element, with no real harness and no new screen.

Proof, shown as the last thing in the conversation:
- `cargo test --features server` ends with "0 failed" and its output includes
  a_recorded_session_replays_into_the_same_cards, no_harness_is_named_outside_its_adapter,
  a_card_holds_nothing_the_harness_can_give_back,
  an_unknown_harness_kind_is_refused_with_the_reason, every_kind_obeys_the_contract,
  an_envelope_carries_its_cause_set_in_code, two_envelopes_at_once_make_one_turn.
- `git diff --stat` for the stage.

Must stay true:
- `git diff --stat -- src/core/flow.rs src/core/engine.rs src/ui src/shells` prints nothing.
- Cargo.toml [dependencies] is unchanged.

Read first: docs/structure.md, docs/architecture.md, docs/sessions/004-architecture.md.
The signatures in 004 are a proposal: settle them, and write down each place you departed
from it and why. If Event::Session cannot be added without changing a Component method,
stop and say so. The envelope gains `cause` ({kind: person|wake|handoff, id}), set where it is
posted, never by a model (008 G1); a member takes one turn at a time (008 G5).
Stop after 30 turns if it is not done, and say what is left.
```

**Stage 1**

```text
/goal Stage 1 of docs/sessions/005-drive.md is done: in the running app a person opens a
Claude Code session, talks to it, answers its permission ask on the Asks page, and finds the
conversation again after the host restarts.

Proof, shown as the last thing in the conversation:
- `cargo test --features server` ends with "0 failed" and its output includes
  the_claude_wire_becomes_the_recorded_items, an_ask_whose_process_is_gone_says_so,
  a_lost_card_resumes_by_its_native_id, a_control_shows_only_when_the_harness_can,
  a_lost_session_with_an_open_tool_call_resumes_cleanly, every_ask_and_answer_is_in_the_audit_log.
- The live run in 005, driven through the web UI of the sandboxed host, with the text each
  page showed at each step, and `ls` of projects/try showing hello.txt.
- `wc -l src/host/harness/claude.rs`.

Must stay true:
- `grep -rn '"claude"' src --include=*.rs` shows matches only under src/host/harness/.
- No session is started with permissions skipped.
- `git diff --stat -- src/core/flow.rs` prints nothing.

Read first: docs/structure.md, docs/sessions/004-architecture.md, stage 1 in 005-drive.md.
Permission asks reach the host through Claude Code's `PermissionRequest` hook (a command that
posts to the host and blocks for the answer, its timeout above the host's own decision limit),
as Terax does (009); stream-json carries the items. Before writing the adapter, capture one real
exchange from the installed `claude`, the hook's input and output included, and keep it under
tests/sessions/claude/; build the adapter against that. Asks, answers and acted tool calls are
appended to audit.jsonl by the adapter (008 G3).
Start and stop only processes you started, by their pid.
If src/core/session.rs must change, list each change with its reason.
Stop after 60 turns if it is not done, and say what is left.
```

**Stage 2**

```text
/goal Stage 2 of docs/sessions/005-drive.md is done: an engine that carries sessions can open
one, hear its turn end, and report, while every permission ask still reaches the person.

Proof, shown as the last thing in the conversation:
- `cargo test --features server` ends with "0 failed" and its output includes
  an_engine_opens_a_session_and_hears_its_turn_end, no_tool_answers_an_ask_without_a_rule,
  stage_is_derived_never_stored, the_work_outlives_the_session,
  an_answer_for_the_thread_is_not_asked_again, no_rule_opens_a_protected_kind.
- The live run in 005, with askk's final message and the session's card pasted.

Must stay true:
- `git diff --stat -- src/host/harness src/core/flow.rs` prints nothing.
- The engine's loop is unchanged: sessions reach it only as tools, a prompt section and a wake.

Read first: docs/sessions/002-decisions.md (D5, D6, D9), 004-architecture.md (the element),
008-openbot.md (G2: answer scope once|thread|always; order placement is a protected kind).
Stop after 40 turns if it is not done, and say what is left.
```

Stages 3 and 4 are the same shape with the harness's name changed and one more wall:
`git diff --stat -- src/ui src/api src/elements` prints nothing.

## Which model

Anthropic's documentation gives no rule for Opus against Sonnet on long unattended work. This
is a judgement:

| stage | model | effort | why |
| --- | --- | --- | --- |
| 0 contract | Opus | high | few lines, each one a decision the next six stages inherit |
| 1 Claude | Opus | medium | the first adapter sets the pattern, and parts of the wire must be found out |
| 2 engine drives | Opus | high | touches `Event`, waking, and who may answer |
| 3 Codex | Sonnet | medium | a generated schema mapped onto a contract, checked by a recording; go to Opus only if the contract must move |
| 4 ACP | Sonnet | medium | the same, a third time |
| 5 one face | Opus | medium | changes what the chat is |
| 6 packs | Opus for the store, Sonnet for the pages | medium | the layering is the design; the rest is forms |

`opusplan` (Opus plans, Sonnet carries out) suits stages 3 and 4. Raise effort when a stage
stalls on a subtle fault; lower it for the mechanical ones.

## How to run one

- **A fresh session per stage.** These files are the memory. A long session carries the last
  stage's dead ends into the next.
- **Auto permission mode** for the stretch that is tests and code; be at the desk for the live
  run of stages 1 and 2, because an ask reaching a person is the thing being proved.
- **Commit at the end of each stage,** so the next stage's "must stay true" is a clean diff.
- **Ask for a review after, not during:** `/code-review` on the stage's diff with a different
  model from the one that wrote it.
- **When a stage ends "impossible" or at its bound,** do not lengthen the goal. Read what it
  says is left, fix the doc that was wrong (usually `004`), start a fresh session.

## Standing rules belong in `AGENTS.md`, once

`AGENTS.md` today is the Dioxus starter text. What every session in this repository should know
without being told again is short:

```markdown
# askk

Read `docs/structure.md` before changing anything: the folders are the map, and
`src/structure.rs` fails the tests when a line sits in the wrong one.

- Dependencies point inward: shells → ui → api → host → elements → core. Core uses the
  language only.
- State reaches disk only through `Store`; nothing outside `host/` touches the machine.
- Customization is a checked value inside a fixed structure. No plugin code, no workflow graph.
- Do not change the loop (`src/core/flow.rs`) or add a restart feature without asking.
- Tests are sentences. A new rule gets a test named for what it keeps true.
- Check a harness's wire against the installed program, never from memory.
- Stop only processes you started, by pid. Another session may be working in this checkout.
- Commit when asked.
```

Keep the Dioxus 0.7 reference below it; it is still needed for `ui/`.

## What not to write

| in a goal | why it fails | write instead |
| --- | --- | --- |
| "perfectly", "clean", "robust" | the judge cannot see it | a test by name |
| "like T3 Code" | the model has its own idea of T3 Code | the stage in `005` |
| "make it composable so setups can be shared" | a platform appears (S7) | stage 6, after a yes |
| "research X, then design, then build" | three goals, the first one's summary ends all three | three sessions |
| the method ("first create a trait, then…") | the judge checks the method, not the result | the result |
| capitals and "must" on every line | newer models over-apply it | the reason, once |
