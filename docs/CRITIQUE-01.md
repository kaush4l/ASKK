# CRITIQUE-01 — the shape of `crates/core` and `crates/ui`

Bar-raiser round 1. Scope: every crate under `crates/`, with `core` and `ui` opened file by file.
Standing goal under test: *"easy navigation by naming, folder structure, file structure, and even
the code inside the file being cleanly explainable. Every class has a defined purpose, nothing
bloated, everything following."*

---

## VERDICT: NO-GO

I12 was satisfied by moving line-boundaries, not by removing bloat, and the codebase says so in its
own voice: 95 of 253 source files carry a doc comment whose stated reason for existing is the
200-line rule, and `crates/core/src/lib.rs:24` records the motive as a code comment —
`mod endword; // \`Ending\` and its wordings — \`ending.rs\` was at 200`. The rule's other half was
never enforced at all: `scripts/check-size.py` gates files and leaves functions ungated by default,
so `crates/core/src/transcript.rs` passes the check at exactly 200 lines while containing one
177-line function, and 85 functions across the tree exceed the 40-line limit. The unit a developer
actually reads — the function — is untouched; only the file boundary moved. Meanwhile the cost was
paid in navigation: `crates/core/src` is 75 flat files in which at least seven obvious subsystems
(`proc*` ×6, `file*` ×6, `scroll*`+terminal ×5, board ×5, trace ×6, chat/transcript ×9, failure ×10)
are folders that were never made and are instead spelled as filename prefixes, and 21 of the 75
names cannot be guessed without opening the file. This is not a bad codebase — the per-file doc
comments are the best I have read in a repo this size, and the turn flow is genuinely traceable end
to end — but it is a codebase whose entire navigability lives inside files you must already have
opened, which is the exact failure mode the standing goal names. NO-GO until the directory tells the
truth the doc comments already tell.

---

## The turn flow

The trace does **not** break. I can state it file by file, and I do below — that is a real credit to
the code. What breaks is the *documentation* of it (Finding 3): the only document that claims to
describe this flow, `ARCHITECTURE.md:262-281`, describes a different mechanism that does not exist
in the tree.

One turn, user message in → reply on screen:

| # | File:line | What happens |
|---|---|---|
| 1 | `crates/ui/src/composer.rs:99` | `onsubmit` → `send(...)` (`composer.rs:61-74`) → `on_send.call(text)` |
| 2 | `crates/ui/src/chat.rs:106-113` | the `send` closure builds `Request::post_form("/chat", &[("message", &text)])` |
| 3 | `crates/ui/src/turn.rs:60` | `to()` stamps the `x-agent` header — which agent this utterance is addressed to |
| 4 | `crates/adapters_web/src/seam.rs:24` | `WebApp::handle` — drains Worker reports (`seam.rs:28-48`), then calls the seam |
| 5 | `crates/core/src/lib.rs:171` | **the one seam** `handle(&mut App, Request) -> Response`; `roster::reconcile` (`lib.rs:176`) |
| 6 | `crates/core/src/dispatch.rs:62` | route → registry → tier; `builtin_entry` (`dispatch.rs:42`) maps `"chat"` → `chat::chat` (`dispatch.rs:46`) |
| 7 | `crates/core/src/chat.rs:56` | `("POST", "/chat") => submit` (`chat.rs:66`) |
| 8 | `crates/core/src/chat.rs:153-171` | `submit` pushes `EventKind::UserMessage` into `ctx.emit`; returns the transcript |
| 9 | `crates/core/src/transcript.rs:25` | the response fragment — a 177-line fold reaching `fold.rs`, `calls.rs`, `repeat.rs`, `identity.rs`, `memory.rs`, `failure.rs`, `ending.rs`/`endword.rs`, `steered.rs`, `halted.rs`, `markdown.rs` |
| 10 | `crates/adapters_web/src/seam.rs:55-59` | `spawn_local(core::drive(app))` — the async half starts |
| 11 | `crates/core/src/runtime.rs:42` | `drive` (151 lines) pops the pending event |
| 12 | `crates/core/src/runtime.rs:23` | `pump` — the only runtime caller of `step`; the thinking/doing wall |
| 13 | `crates/agent/src/step.rs:21` | `step` → `advance` (`step.rs:28`) → the `UserMessage` arm (`step.rs:52`) |
| 14 | `crates/agent/src/ask.rs` | `call_model` assembles the paper under the phase budget |
| 15 | `crates/context/src/assemble.rs:86` | `assemble` builds the `Document` (I13/I14) |
| 16 | `crates/agent/src/effect.rs:20` | returns `Effect::CallModel { document, format, endpoint, model, temperature, speaker }` |
| 17 | `crates/core/src/batch.rs:103` | `run_effects` → `single` (`batch.rs:132`); not a tool, so → |
| 18 | `crates/core/src/effects.rs:19` | `execute_effect`: `context::render` (`:35`), `openai_request_body` (`:38`), `model.call` (`:39`) |
| 19 | `crates/adapters_web/src/model.rs` + `model/asked.rs` | resolves the catalogue key against `models.json`, attaches the credential, `fetch` |
| 20 | `crates/core/src/effects.rs:43-81` | reply → `openai_reply_text` → `ModelCalled` + `ModelReplied` facts |
| 21 | back to 11 | fact appended, fed to `pump` → `step` → `crates/agent/src/reply.rs` `parse_reply` |
| 22 | `crates/agent/src/calls.rs` | tool calls parsed → `Effect::InvokeTool` |
| 23 | `crates/core/src/batch.rs:135-163` | **the tool leg**: tries `workspace::run` (`workspace.rs:42`), then `websearch::run` (`websearch.rs:33`), then `space::run` (`space.rs:81`), else `tools::run` (`tools.rs:82`) |
| 24 | back to 11 | `ToolInvoked` fact → `step` → next round, or a reply with no calls |
| 25 | `crates/core/src/lib.rs:121` | `answer` — the last reply that called no tools |
| 26 | `crates/ui/src/watch.rs:51,89` | the pane polls `GET /chat` every 400 ms → step 9 again → `turn.rs:67 show` |

Twenty-six hops, five crates, and roughly twenty-five files. Nothing in the repository states this.
Step 23 is where a cold developer stops: "where does a tool run" has four answers and the only way to
learn which is to read all four (Finding 4).

---

## Findings

### F1 — SEVERE. The function half of I12 was never enforced, so the bloat was relocated, not removed.

**Observation.** `scripts/check-size.py:16-26` states the position outright: *"THE FILE CHECK IS THE
GATE; THE FUNCTION CHECK IS `--functions`, OFF BY DEFAULT … It is off because a gate that fails on
the tree it ships with is not a gate."* Running it reports **85 functions over the 40-line limit**.
The largest are the exact places a reader most needs help:

| Function | Lines | Limit |
|---|---|---|
| `crates/ui/src/authoring.rs:17` `AgentEditor` | 183 | 40 |
| `crates/ui/src/launch.rs:20` `TaskLauncher` | 181 | 40 |
| `crates/core/src/transcript.rs:25` `transcript` | 177 | 40 |
| `crates/ui/src/chat.rs:27` `ChatPane` | 174 | 40 |
| `crates/ui/src/stage.rs:23` `Stage` | 163 | 40 |
| `crates/ui/src/artifacts.rs:48` `Artifacts` | 153 | 40 |
| `crates/core/src/boardrow.rs:15` `row` | 152 | 40 |
| `crates/ui/src/tools.rs:45` `ToolTrace` | 152 | 40 |
| `crates/core/src/runtime.rs:42` `drive` | 151 | 40 |
| `crates/ui/src/files.rs:21` `Files` | 151 | 40 |

`crates/core/src/transcript.rs` is the clean proof of the failure: the file is exactly 200 lines and
passes the gate; it contains one 177-line function. `crates/core/src/boardrow.rs` is 192 lines
containing one 152-line function. Nothing was made smaller. The file boundary moved.

**Cost.** The developer reads functions, not files. A rule that shrinks files while leaving a
177-line function intact buys the *appearance* of smallness at the price of a directory nobody can
navigate — it is a net loss of legibility, which is the one axis this project says it is judged on.

**Fix (smallest).** Do not turn `--functions` into a hard gate yet — that would trigger 85 more
splits and make F2 worse. Instead: (a) add the current 85 to a checked-in baseline file and gate on
*"no new violations, and the baseline only shrinks"*; (b) fix the ten above by extraction, which for
the `rsx!` components means pulling each named region into its own `#[component]` in the same file —
no new files.

---

### F2 — SEVERE. 95 files exist because a sibling hit 200 lines, and they say so.

**Observation.** Grepping the doc headers of `crates/*/src`, **95 of 253 files** open by naming the
line rule as their reason to exist. By crate: core 43/75, ui 27/72, adapters_web 11, agent 8,
adapters_test 4, module 1, context 1. Representative, verbatim:

- `crates/core/src/lib.rs:24` — `mod endword; // \`Ending\` and its wordings — \`ending.rs\` was at 200`
- `crates/core/src/lib.rs:65` — `mod stage; // … \`fold.rs\` and \`boardrow.rs\` were both at 200`
- `crates/core/src/endword.rs:1-5` — *"Split from `ending.rs` … that file was at exactly 200 lines
  (I12) before a fifth ending needed a word … and at exactly 200 again before the pass loop needed a
  sixth"*
- `crates/core/src/dispatch.rs:15` — *"the type moved to `ctx.rs` for the line count, not for a new address"*
- `crates/ui/src/chat/ctl.rs:2` — *"Split out of `chat.rs`, which was at exactly 200 lines (I12)"*
- `crates/ui/src/stage/intro.rs:1-3` — a whole module for **two string constants**, split for the rule
- `crates/core/src/loopline.rs:1-3` — **29 lines**, one function returning a sentence, split from `origin.rs`
- `crates/core/src/rowwords.rs:1-4` — **36 lines**, two functions returning adjectives, split from `boardrow.rs`
- `crates/core/src/form.rs:1-2` — **39 lines**, one function that percent-decodes a form key

**Cost.** Twenty-six files sit at exactly 200 lines and 47 sit between 190 and 200. That distribution
is not what cohesion produces; it is what a ceiling produces. A developer cannot use file boundaries
as a signal of meaning, because the boundaries encode arithmetic.

**Fix (smallest).** Not a rewrite and not a re-merge. Change what the boundary *means* by giving the
splits a home — see F3. A file named `board/words.rs` inside `board/` is a legitimate small file;
`rowwords.rs` at the top of a 75-file directory is debris.

---

### F3 — SEVERE. `crates/core/src` is 75 flat files containing seven folders that were never made.

**Observation.** The subsystems are already there and are spelled as filename prefixes rather than
directories:

| Cluster | Files | Members |
|---|---|---|
| process supervision | 6 | `process.rs`, `processes.rs`, `procstart.rs`, `proctable.rs`, `procwatch.rs`, `procpanel.rs` |
| file browser | 6 | `files.rs`, `filelist.rs`, `filerows.rs`, `filegone.rs`, `findfiles.rs`, `browsable.rs` |
| terminal / scrollback | 5 | `terminal.rs`, `scrollback.rs`, `scrollrows.rs`, `scrollpanel.rs`, `spacenote.rs` |
| agent board | 5 | `board.rs`, `boardrow.rs`, `rowwords.rs`, `tiles.rs`, `stage.rs` |
| tool trace | 6 | `trace.rs`, `tracerow.rs`, `tracerow/traceargs.rs`, `asked.rs`, `reported.rs`, `inflight.rs` |
| chat / transcript | 9 | `chat.rs`, `transcript.rs`, `fold.rs`, `clear.rs`, `memory.rs`, `markdown.rs`, `steered.rs`, `calls.rs`, `repeat.rs` |
| failure / ending | 10 | `failure.rs`, `failed.rs`, `remedy.rs`, `told.rs`, `pointer.rs`, `ending.rs`, `endword.rs`, `halted.rs`, `vouch.rs`, `steered.rs` |

That is 44 of 75 files in seven unmade folders. The decisive evidence that directories were available
and simply not used: **`crates/core/src/tracerow/` exists and contains exactly one file**
(`traceargs.rs`, 82 lines). The project knows how to make a folder; it made one, for one file, and
left the other 44 flat.

The only index is the `mod` list at `crates/core/src/lib.rs:5-77`, and it is not even sorted —
`agents` after `asked` (`lib.rs:7`), `boot` after `calls` (`lib.rs:16`), `filerows` after `findfiles`
(`lib.rs:31`), `procpanel` after `procstart` (`lib.rs:50`), `terminal` after `tracerow` (`lib.rs:75`).
`crates/ui/src/main.rs:8-58` has the same defect at lines 43, 44 and 52. An append-only, unsorted
list of 75 names is not navigation.

**Cost.** A developer asked to change what the Processes pane shows must first discover that the
answer is distributed over six files whose only relationship is a three-letter prefix, and must read
the `mod` list to learn they exist at all.

**Fix (smallest).** `git mv` the seven clusters into seven directories with a `mod.rs` that re-exports
what crosses the boundary. Call-site churn is mechanical (`crate::filelist::x` → `crate::files::list::x`)
and can be done cluster by cluster. No logic changes, no re-merging, no rewrite. This single change
takes `core/src` from 75 entries to ~38.

---

### F4 — HIGH. Tool execution is a four-way fallthrough chain with no dispatch table, in a crate whose thesis is that dispatch happens in one file.

**Observation.** `crates/core/src/dispatch.rs:1-5` states the rule: *"THE one dispatch point … No code
outside this file may call module logic … The CI check is one grep."* Tools do not follow it.
`crates/core/src/batch.rs:135-163` executes a tool by trying four handlers in sequence, each returning
`Option<EventKind>` meaning "not mine, try the next":

```
crates/core/src/workspace.rs:42   pub(crate) async fn run(...)  -> Option<EventKind>
crates/core/src/websearch.rs:33   pub(crate) async fn run(...)  -> Option<EventKind>
crates/core/src/space.rs:81       pub(crate) async fn run(...)  -> Option<EventKind>
crates/core/src/tools.rs:82       pub(crate) fn run(...)        -> EventKind   // the fallback
```

The same four-line append-and-push body is repeated five times in that block
(`batch.rs:140-145`, `147-152`, `154-158`, `160-163`).

**Cost.** "Where does tool X run?" has no answer short of reading four files, and the answer changes
with the tool. This is the single worst navigation cost in the turn flow (step 23 of the trace) and
it contradicts the crate's own stated discipline.

**Fix (smallest).** One `fn handler_for(tool: &ToolId) -> Handler` in `tools.rs`, matching tool name
to the four existing `run` functions, mirroring `dispatch::builtin_entry`. The four functions stay
where they are; only the chain is replaced by a table, and the repeated body collapses to one call.

---

### F5 — HIGH. `ARCHITECTURE.md` §6 describes a transport that does not exist, and it is the only flow document.

**Observation.** `ARCHITECTURE.md:264-270` describes the flow as: *"the htmx extension
(`transport.js`) intercepts, posts `{method, path, headers, body}` to the core Worker. `adapters_web`
builds a `kernel::Request` …"*. There is no `transport.js` in the repository. There is no htmx. The
actual path is a Dioxus event handler calling `WebApp::handle` in-process with no JSON hop —
`crates/adapters_web/src/seam.rs:1-2` says so explicitly: *"`ui`'s Dioxus handlers call `core::handle`
through here with no JSON hop and no second wire format (I4)."*

`ARCHITECTURE.md:3` still carries *"Status: intended architecture, pending spike evidence"* although
G4 shipped and increment 28 is on `main`. `MODULES/core.md:4` describes *"the ≤40-line effect
runtime"*; `crates/core/src/runtime.rs:42` `drive` is 151 lines.

**Cost.** The one document a new developer would read to learn the flow will send them looking for a
file that isn't there, and the crate spec understates a function by 4×. Stale documentation is worse
than none: it costs the reader the time to disbelieve it.

**Fix (smallest).** Replace `ARCHITECTURE.md:262-281` §6 with the 26-row table above, and correct
`MODULES/core.md:4`. Drop the "pending spike evidence" banner or date it.

---

### F6 — HIGH. Twenty-one of 75 core filenames cannot be guessed, and the naming convention is the cause.

**Observation.** The split fragments are consistently named for *the sentence they render* — a
past-tense verb or a compound noun — rather than the subsystem they belong to: `told.rs`, `asked.rs`,
`steered.rs`, `halted.rs`, `reported.rs`, `vouch.rs`, `endword.rs`, `rowwords.rs`, `spacenote.rs`,
`loopline.rs`, `pointer.rs`, `fold.rs`, `repeat.rs`, `calls.rs`, `typed.rs`. Two are actively
misleading to a Rust reader: `crates/core/src/typed.rs:1` is *"WHAT A PERSON'S GESTURE RUNS"* (keyboard
input), not type definitions; `crates/core/src/pointer.rs:14` defines `struct Where` — which view a
row is in — not memory. Three pairs are confusable and a developer will pick wrong:
`failure.rs`/`failed.rs`, `process.rs`/`processes.rs`, `logs.rs`/`logbook.rs`.

Compounding it: none of these words appear in `GLOSSARY.md`, which defines 14 terms (Environment,
Capability, Affordance, Module, Section, Document, Phase, Agent, Forge, Session, Event, Effect,
Policy, Memory). The project passed a G1 glossary gate and then named 75 files outside its own
vocabulary.

**Cost.** The doc comment inside each file is excellent — but you must already have opened the file
to read it, and the filename is what decides whether you do.

**Fix (smallest).** The renames in the table below, applied as part of the F3 folder move so it is one
mechanical pass, not two.

---

### F7 — MEDIUM. `boardcell.rs` holds code that nine call sites reach through `runstatus.rs`, so the owning file is invisible to search.

**Observation.** `crates/ui/src/runstatus.rs:16-18`: *"The reads themselves moved next door; six
callers name them here, so they are re-exported rather than renamed across six files for one line
count"* — `pub(crate) use crate::boardcell::{cell, live, progress, since};`. Nine call sites across six
files say `runstatus::…` (`wait.rs:59,117`, `roster.rs:22`, `artifacts.rs:102`, `examples.rs:56,57`,
`launch.rs:46,81,88`, `processes.rs:127`). Grepping `boardcell::` returns three hits, two of which are
inside `runstatus.rs` itself. And `crates/ui/src/thread.rs:27` uses `boardcell::cell` **directly** — so
the same function is reached by two different paths depending on the file.

**Cost.** A file's cap was bought with a permanently misleading import path. Jump-to-definition works;
grep, which is how a cold developer explores, does not.

**Fix (smallest).** Delete the re-export at `runstatus.rs:18` and rewrite the nine call sites to
`boardcell::`. It is one `sed`.

---

### F8 — MEDIUM. Verified duplication that the source itself documents rather than removes.

1. **`fn listed` is byte-identical in two files.** `crates/core/src/filegone.rs:57-63` and
   `crates/core/src/procpanel.rs:54-60` — same signature, same `split_last()` match, same
   `format!("{} and {last}", rest.join(", "))`. `filegone.rs:54-56` *documents the duplication*:
   *"The same shape `procpanel::listed` builds, because the two panes say the same kind of sentence."*
   Noticing a duplicate and writing a comment about it is not removing it.
2. **Duration formatting duplicated.** `crates/core/src/observe.rs:119-127` (`fn secs`) and
   `crates/core/src/proctable.rs:114-121` (`fn ago`) share three identical arms
   (`<60 → "{n}s"`, `<3600 → "{}m{:02}s"`, else `"{}h{:02}m"`). Worse, `proctable.rs:102` also defines
   a `fn secs` that is the *inverse parser* — so `secs` means two opposite things inside one cluster.
3. **The same three failure headers parsed in three files**: `crates/ui/src/trouble.rs:130-135`,
   `crates/ui/src/endpointform.rs:44-48`, `crates/ui/src/frame.rs:174-177` each hand-parse
   `x-failed`/`x-failed-agent`/`x-failed-turn`.
4. **`/files` requested from five files** — `crates/ui/src/listing.rs` was created specifically to
   dedupe this (`listing.rs:4-7`), yet `crates/ui/src/rail.rs:22` and `crates/ui/src/enginecost.rs:36`
   still hand-roll their own.

**Fix (smallest).** One `words.rs` (or `crates/kernel`) home for `listed` and the duration formatter;
rename `proctable.rs:102` `secs` to `parse_secs`; route the three header parses through
`boardcell::cell`; route the two stray `/files` reads through `listing::read`.

---

### F9 — MEDIUM. `stage` means two unrelated things, and three crates use the word.

**Observation.** `crates/core/src/stage.rs:1` — *"WHICH PART OF THE TURN IS RUNNING"* (plan / work /
verify / critique). `crates/ui/src/stage.rs:1` — *"WHAT you are doing — the centre column, routed by
`View`"*, i.e. a region of the screen, the theatre sense. `crates/agent/src/stages.rs:1` — *"THE LOOP A
TURN RUNS."* `crates/ui/src/stage.rs:19` imports `tiles`, `tabs` and `terminal` and never touches
`core::stage`, so the two are genuinely unrelated despite the identical path suffix.

Ten of the eleven shared `core`/`ui` basenames are an honest projection/renderer mirror (`board`,
`chat`, `files`, `processes`, `terminal`, `tiles`, `space`, `authoring`, `roster`, `tools`) and that
convention is good — but it is nowhere written down, and three of those pairs mislead:
`crates/core/src/tools.rs:1` is *the executor* while `crates/ui/src/tools.rs:45` is `ToolTrace`, whose
real mirror is `crates/core/src/trace.rs` (the core file says so on line 1);
`crates/core/src/roster.rs:24` is a precedence algorithm while `crates/ui/src/roster.rs:47` is a panel;
`crates/core/src/authoring.rs` is mirrored by `crates/ui/src/agentfile.rs`, not by
`crates/ui/src/authoring.rs`.

**Fix (smallest).** Rename `crates/ui/src/stage.rs` → `centre.rs` and `crates/ui/src/tools.rs` →
`trace.rs`. Add one line to `MODULES/core.md`: *"For every pane P, `core/src/P.rs` serves the fragment
and `ui/src/P.rs` mounts it."*

---

### F10 — LOW. `Effect::Persist` and `Effect::Sleep` have no emitter — speculative generality in a closed enum.

**Observation.** `crates/agent/src/effect.rs:45` and `:47` declare `Persist` and `Sleep`. Grepping the
whole tree for `Effect::Persist` / `Effect::Sleep` returns exactly one hit —
`crates/core/src/effects.rs:96`, the arm that says `todo!("G5: first emitter of this effect")`. Nothing
constructs them.

**Cost.** The project's code standard is *"no speculative generality"*. Two of six variants of the
closed set at the heart of the architecture are aspirational, and a reader of `execute_effect` cannot
tell which effects are real. Compounding: `effects.rs:93` declares `InvokeTool` and `Delegate`
`unreachable!("executed by batch::run_effects")` — so of six variants, the function named
"execute_effect" actually executes two.

**Fix (smallest).** Delete `Persist` and `Sleep` until something emits them (I10 makes it reversible);
rename `execute_effect` → `execute_port_effect`, or move the tool/delegate arms into it so the name is
true.

---

### F11 — LOW. Doc comment attached to the wrong function.

**Observation.** `crates/core/src/transcript.rs:13-16` is a `///` block reading *"The whole conversation
with ONE agent, in log order. A turn is in flight when the last message-shaped fact is a `UserMessage`
— also the `x-turn: pending` header…"*. It is attached to `fn announced` at `transcript.rs:17`, which
does none of that. The function it describes, `pub(crate) fn transcript` at `transcript.rs:25`, has no
doc comment at all. This is collateral damage from the split that created the file.

**Fix (smallest).** Move the three lines to `transcript.rs:24`.

---

## The naming table

Every file whose name does not tell you what is inside. Proposed names assume the F3 folder move, so
several stop needing a distinguishing prefix at all.

| Current | What it actually is (`path:line`) | Proposed |
|---|---|---|
| `core/src/typed.rs` | a person's UI gesture routed into the agent's own tool (`typed.rs:1-8`) | `workspace/gesture.rs` |
| `core/src/form.rs` | percent-decodes one key from a form body; 39 lines, one fn (`form.rs:5`) | `form_value.rs` (or inline into `kernel::http`) |
| `core/src/fold.rs` | message-ownership predicate + 3 copy constants + token count + trailing line (`fold.rs:15-181`) | split by job: `chat/ownership.rs`, `chat/notices.rs` |
| `core/src/calls.rs` | accumulator producing one announcement line per round of tool calls (`calls.rs:18-92`) | `chat/call_announcement.rs` |
| `core/src/repeat.rs` | collapses identical repeated failure cards into "Same error (×n)" (`repeat.rs:25-45`) | `failure/dedupe.rs` |
| `core/src/memory.rs` | the "what this agent still holds" indicator line (`memory.rs:121`) | `chat/memory_line.rs` |
| `core/src/identity.rs` | the two-line heading above a conversation (`identity.rs:16`) | `chat/heading.rs` |
| `core/src/steered.rs` | which messages were mid-turn steers + the notice text (`steered.rs:24,47`) | `chat/steer_notice.rs` |
| `core/src/told.rs` | a sub-agent's failure after crossing `postMessage` (`told.rs:1-4`) | `failure/from_worker.rs` |
| `core/src/failed.rs` | failures *inside* a turn that ended well (`failed.rs:36-140`) | `failure/within_turn.rs` |
| `core/src/remedy.rs` | maps a typed error to the sentence telling the user what to do (`remedy.rs:74`) | `failure/what_to_do.rs` |
| `core/src/endword.rs` | the `Ending` enum + its display strings (`endword.rs:15-101`) | `failure/ending_kind.rs` |
| `core/src/halted.rs` | the sentence + trace row for a user-stopped run (`halted.rs:20,36`) | `failure/stopped_notice.rs` |
| `core/src/vouch.rs` | may the UI print "ok" beside a tool call its output contradicts (`vouch.rs:26-91`) | `trace/trustworthy.rs` |
| `core/src/pointer.rs` | `struct Where` — which view a failing call's row is in (`pointer.rs:14`) | `trace/row_location.rs` |
| `core/src/asked.rs` | who requested a tool call: page / agent / sub-agent (`asked.rs:64-128`) | `trace/requested_by.rs` |
| `core/src/reported.rs` | a sub-agent's trace + the clock its rows read (`reported.rs:14-22`) | `trace/from_worker.rs` |
| `core/src/rowwords.rs` | status adjectives + provenance words for a board row (`rowwords.rs:13,28`) | `board/words.rs` |
| `core/src/loopline.rs` | one sentence naming the loop an agent runs (`loopline.rs:14`) | `agents/loop_sentence.rs` |
| `core/src/origin.rs` | sentence generators for an agent card (`origin.rs:28-163`) | `agents/card_sentences.rs` |
| `core/src/filegone.rs` | the four empty/missing states of a folder + copy (`filegone.rs:20-107`) | `files/empty_states.rs` |
| `core/src/filerows.rs` | one line per folder entry as `<name>\t<path>` (`filerows.rs:39`) | `files/rows.rs` |
| `core/src/browsable.rs` | may this pane show a folder at all (`browsable.rs:44`) | `files/permitted.rs` |
| `core/src/scrollrows.rs` | *which* scrollback rows to show (`scrollrows.rs:54`) | `terminal/row_selection.rs` |
| `core/src/scrollpanel.rs` | the scroller container + empty state (`scrollpanel.rs:127`) | `terminal/panel.rs` |
| `core/src/spacenote.rs` | the footnote under the scrollback (`spacenote.rs:18`) | `terminal/footnote.rs` |
| `core/src/inspector.rs` | the Space pane; its route fn is literally `fn space` (`inspector.rs:38`) | `space/pane.rs` |
| `core/src/processes.rs` | the pane routes (vs `process.rs`, the convention) (`processes.rs:38-70`) | `proc/pane.rs` (and `process.rs` → `proc/convention.rs`) |
| `core/src/logs.rs` | the I/O half of log persistence (`logs.rs:59-138`) | `log/store.rs` (and `logbook.rs` → `log/decisions.rs`) |
| `ui/src/adopt.rs` | first `GET /` + `/agents` at boot, roster fallback (`adopt.rs:26-61`) | `shell/boot_reads.rs` |
| `ui/src/agentkeys.rs` | prose explaining each YAML key beside the editor (`agentkeys.rs:44,67`) | `authoring/key_help.rs` |
| `ui/src/boardcell.rs` | scrapes `data-*` attributes off rendered `/board` HTML (`boardcell.rs:15-63`) | `board/read_attrs.rs` |
| `ui/src/credit.rs` | one paragraph of engine attribution copy (`credit.rs:22`) | `terminal/attribution.rs` |
| `ui/src/crumbs.rs` | breadcrumb path split + two components (`crumbs.rs:19-74`) | `files/breadcrumbs.rs` |
| `ui/src/frame.rs` | sandbox-readiness pill **and** the 2 s page-wide poll (`frame.rs:41,143`) | split: `shell/warmth.rs`, `shell/heartbeat.rs` |
| `ui/src/meter.rs` | token meter + digit grouping (`meter.rs:27,51`) | `shell/token_meter.rs` |
| `ui/src/recover.rs` | retry / open-Settings actions after a failure (`recover.rs:28-151`) | `chat/retry_actions.rs` |
| `ui/src/spacegap.rs` | three empty states for the space card (`spacegap.rs:27,64`) | `space/empty_states.rs` |
| `ui/src/wait.rs` | the in-flight row + stop/halt presses (`wait.rs:58,103`) | `chat/inflight_row.rs` |
| `ui/src/watch.rs` | the 400 ms poller + stall counter (`watch.rs:31,51`) | `chat/poller.rs` |
| `ui/src/turn.rs` | the state types the chat pane shows (`turn.rs:16,40`) | `chat/state.rs` |
| `ui/src/trouble.rs` | `Fleet` + run pill + failure pill (`trouble.rs:37-141`) | `shell/status_pills.rs` |
| `ui/src/tabs.rs` | the agent switcher, not generic tabs (`tabs.rs:65`) | `shell/agent_switcher.rs` |
| `ui/src/engine.rs` | CheerpX-vs-c2w picker; collides with LLM "engine" (`engine.rs:97`) | `settings/linux_engine.rs` |
| `ui/src/endpointform.rs` | health line, save copy, URL validation — **not** the form (`endpointform.rs:58-156`) | `settings/endpoint_copy.rs` |
| `ui/src/chat/ctl.rs` | pane heading string + clear-conversation row (`ctl.rs:44`) | `chat/header.rs` |
| `ui/src/stage.rs` | the centre column (collides with `core::stage`) — F9 | `centre.rs` |
| `ui/src/tools.rs` | `ToolTrace`; mirrors `core/src/trace.rs`, not `core/src/tools.rs` — F9 | `trace.rs` |

---

## What is genuinely good

Four things, and I am not padding this list.

1. **The per-file doc comments are the best I have seen in a repo this size.** They state the subject
   in a headline, then the finding or bug that forced the design.
   `crates/core/src/vouch.rs:1-9` reconstructs the exact false "ok" it exists to prevent, with the
   real bytes. `crates/core/src/repeat.rs:5-9` explains why the dedupe key is not the payload.
   `crates/core/src/lib.rs:181-192` explains why a successful GET is not logged, with the measured
   cost of the alternative. Every finding in this critique about naming is a finding about the
   *outside* of files whose *insides* are exemplary.
2. **The seam is real and it is protected.** `crates/core/src/lib.rs:171` is the only entry;
   `crates/adapters_web/src/seam.rs:24` is the only Rust caller; `crates/core/src/dispatch.rs:42`
   is the only built-in table. I looked for a bypass and did not find one. I4 holds.
3. **`crates/agent` is what `crates/core` should look like.** Forty-five files whose names are the
   domain's own words — `step`, `stages`, `phase`, `verify`, `window`, `toolbox`, `spec`, `yaml`,
   `subagent` — plus a real `components/` folder (`crates/agent/src/components/`, 7 files). Only 8 of
   its 45 files cite the line rule. The convention this project needs already exists one directory
   over.
4. **The thinking/doing wall is structural, not advisory.** `crates/agent/src/step.rs:21` returns
   effects and cannot do I/O; `crates/core/src/runtime.rs:23` is the single runtime caller. That is
   the design decision at `ARCHITECTURE.md:82-107` actually delivered, and it is why the whole core
   tests on the host (I3).

---

## Exit criteria

A future round flips this to GO when all nine hold. No partial credit.

1. **`crates/core/src` has at most 40 top-level entries**, with the seven clusters of F3 as
   directories. `crates/ui/src` has at most 25, with the five clusters named in the UI inventory as
   directories.
2. **Every rename in the naming table is applied**, or a one-line written justification exists for
   each one declined. `crates/ui/src/stage.rs` and `crates/ui/src/tools.rs` are renamed regardless
   (F9) — a name that means two things is not a judgement call.
3. **No source file's doc comment cites the line rule as its reason to exist.** Currently 95. The
   target is 0: after F3, a small file inside a named folder needs no excuse, and any file that still
   needs one is in the wrong place. Check: `grep -rn "200-line rule\|was at 200\|for the line count" crates/*/src`
   returns nothing.
4. **`scripts/check-size.py --functions` runs in CI against a checked-in baseline that only shrinks**,
   and the ten functions listed in F1 are under 40 lines. The other 75 may remain on the baseline.
5. **Tool execution has one dispatch table.** `crates/core/src/batch.rs:135-163` no longer contains a
   fallthrough chain, and a single function maps tool → handler the way
   `crates/core/src/dispatch.rs:42` maps module → handler.
6. **`ARCHITECTURE.md` §6 contains the real turn trace** — file and line, in order — and the
   `transport.js`/htmx paragraph is gone. `MODULES/core.md:4` no longer claims a "≤40-line effect
   runtime".
7. **A `crates/core/src/README.md` (or the `MODULES/core.md` body) names every top-level directory in
   one line each**, and states the `core`/`ui` pane-pairing convention from F9.
8. **The verified duplicates in F8 are removed** — one `listed`, one duration formatter, one
   failure-header read, one `/files` read — and `runstatus.rs:18`'s re-export façade is deleted with
   its nine call sites rewritten (F7).
9. **`Effect::Persist` and `Effect::Sleep` are deleted or emitted** (F10), and
   `crates/core/src/transcript.rs:13-16`'s doc comment sits on the function it describes (F11).
