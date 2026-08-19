# STATUS — maintained by the lead

The lead does not write code. It holds the goal, names one increment at a time,
spins up the architecture lead, and refuses a go until the bar-raiser gives one.

## The bar (fixed, not re-litigated per increment)

Hermes Agent, Eliza OS, DeepSeek harness. Match them on **how an agent is
defined and gets a task done**, not on feature count. Execution happens inside
the container2wasm Alpine the agent owns.

## The standing architecture goals

1. Abstract core. Nothing about a specific agent is hardcoded anywhere in it.
2. Every agent and its metadata is configuration.
3. Tools are standard, and a tool is a prompt component like anything else.
4. **Everything that reaches the LLM is a component.** Soul, identity, context,
   artifacts, spaces, conversation, tools. Multimodal stays separate.
5. Adding a component is a declaration, not a change to the assembler.
6. One predictable loop. Prompt upgrading is editing a component, not code.
7. An agent can start another agent with a goal, and verify a workflow ran.

## Increments

| # | Increment | State |
|---|---|---|
| 1 | The component architecture standard, written | DONE — `docs/ARCH-COMPONENTS.md` |
| 1b | Gaps 1-8 + 12 coded (deletions, the I13 fix, the wiring) | DONE, green, unshipped |
| 1c | Bar-raiser round 1 | DONE — NO-GO, `docs/CRITIQUE-01.md` |
| 2 | Structural remediation against the 9 exit criteria | DONE, green, awaiting bar-raiser |
| 3 | The Faculty seam + an agent that starts an agent with a goal | DONE, green, unshipped — 496 tests, 4 gates exit 0, `docs/CRITIQUE-03.md` GO |
| 4 | CheerpX deleted; c2w the sole engine | COMMITTED main 51199eb, NOT PUBLISHED |
| 4b | The image: audit measured, recipe repaired, `image/Dockerfile` written | DONE, unshipped |
| 5 | Free size/memory wins: strip DWARF, gzip -9, VM_MEMORY_SIZE_MB | NAMED, needs a build round |
| 6 | The SECOND faculty (`memory`), F4 closed, the spawn workflow verified | DONE, green, unshipped — 517 tests, 4 gates exit 0, `docs/ARCH-COMPONENTS.md` §12 |


## PARITY, MEASURED (`docs/PARITY.md`, 2026-08-19) — the strategic finding

Assessed on the owner's own axis: "define an agent and get the task done".

**We are the BEST of the four at DEFINING an agent, and we fail at GETTING THE
TASK DONE.** One `agent.md` expresses identity, model, engine, role, a declared
loop, a tool allowlist, faculties, a space, compaction budgets, a round ceiling
and a pass budget, and it REFUSES rather than defaults (`spec/yaml.rs:99-157`).
Hermes has no per-agent file at all — an agent is a home directory. DeepSeek's
is a DI wiring list. Eliza cannot express a loop, a budget or verification.
Two things nobody else has: a loop the MESSAGE picks, and a verify gate ON BY
DEFAULT (Hermes ships its better version opt-in; DeepSeek documents the absence
as deliberate).

**The agent we ship is handed a machine that cannot do work.** Stock busybox
Alpine, no network so `apk add` is impossible, no python/node/git/compiler,
tmpfs root (`image/Dockerfile:5-9,25-42`, `c2w.rs:23-28`). Hermes and DeepSeek
run `bash` on the user's real machine. Every architecture round has been
polishing the half that was already ahead.

**Two direct hits on the owner's stated goal:**
- `main` is granted almost nothing — no `web_search` — and NO agent holds
  `role: critic`, so that seam is dead code in production.
- **Stage prompts are Rust constants** (`brief.rs:22-52`). The owner asked for
  configuration-driven agents; the loop's own instructions are compiled in.
  DeepSeek and Hermes both keep theirs in data.

**The three next things, in order:**
1. Make the guest capable and state what it keeps (owner gate on size/storage).
   Nothing else pays off until this lands.
2. Grant what already exists and ship the critic agent.
3. A standing `goal:` with a DATA-DECLARED check — continue on a verification
   command's exit code, not a model's opinion.

## The bar-raiser verdict: GO (`docs/CRITIQUE-02.md`, 2026-08-19)

All nine criteria MET, verified by the critique against the tree rather than
against the lead's report. It certifies NAVIGABILITY AND COMPREHENSION — not
correctness, not product value.

**The proof it used is better than the criteria it set.** Files at EXACTLY 200
lines fell **23 -> 9** while the tree grew by 26 files. A tree still driven by a
ceiling does not do that. And 252 -> 278 decomposes with no residue: +13 real
`mod.rs` index files, +22 new sources (where the ten oversized functions went —
`transcript` 177 lines became four files split by what each renders), -9
deletions.

**Two findings fixed before commit:**
- The shrink-only function gate existed ONLY on this machine —
  `scripts/function-baseline.txt` was untracked and `check-size.py:181`
  re-seeds wholesale when it is absent. A fresh clone would have silently reset
  it. Now tracked.
- Thirteen doc comments pointed at filenames the round deleted.

**Recorded, not fixed: THERE IS NO CI IN THIS REPOSITORY.** Criterion 4 asked
for the function gate "in CI", which no round could satisfy. Every gate here is
only as good as someone remembering to run it. That is an owner decision.

The three SEVERE findings all say one thing: **I12 relocated bloat rather than
removing it.**
- The function half of I12 was never gated (`scripts/check-size.py:16-26` admits
  it). 85 functions are over 40 lines. `crates/core/src/transcript.rs` passes the
  file gate at exactly 200 lines while holding one 177-line function.
- 95 of 253 source files say in their own doc header that they exist because of
  the 200-line rule. 26 files sit at exactly 200.
- `crates/core/src` is 75 flat files holding seven unmade folders spelled as
  filename prefixes. `crates/core/src/tracerow/` proves directories were always
  available — it holds one file.

## Owner rulings (not the lead's to relitigate)

**CheerpX is deleted. container2wasm is the sole engine.** The owner's reason is
sovereignty: CheerpX streams its disk from Leaning Tech's CDN and is not an image
this project controls. The measured cost was put on the record once — c2w is
13-15x slower on compute (`docs/` c2w measurements, 2026-08-13) — and the owner
chose control over speed. Settled.

**Two consequences the excision must carry, not hide:**
1. `WorkspacePort::durable` SURVIVES. Eight readers across `core` depend on it
   (`dispatch.rs:125`, `filelist.rs:44`, `filegone.rs:70`, `inspector.rs:53`,
   `procpanel.rs:73`, `spacenote.rs:89`). It is the port telling the truth about
   file loss. Only `Engine::keeps_files` and the CHOICE die.
2. Files now NEVER survive a reload — `keeps_files()` was true for CheerpX only.
   That is a product promise changing, and the UI must say so plainly rather
   than letting the warning vanish with the setting.

**The sovereignty hole this exposes.** There is no Dockerfile, no build script,
no recipe of any kind in this repository. `web/c2w/` is 47 MB of binary
(`out.wasm.gzip` 36 MB) that nobody — including its author — can reproduce. The
whole justification for deleting CheerpX was control over the image, and that
control does not exist until the recipe is checked in. Docker is not running on
this machine, so this round designs and audits; it does not build.

## Rulings the lead has made

**The Faculty seam is now sequenced BEHIND the structural repair, not merely
held.** My reason for holding it was a guess that the tree was unnavigable; the
verdict makes it a finding. Faculty adds files, and adding them to 75 flat files
would put the seam in the same hole. It lands into folders that exist.

**I12 is not amended to match reality, and the function gate goes on.** The
honest alternative — raising the limit to what the code does — would make the
invariant true by making it say nothing. The rule was right and the enforcement
was half-built, which is the "setting that looks applied" failure this repo has
a name for.

**Gap 4 overruled — `Form`/`render_in` is not deleted.** The architecture lead
found that nothing at the assembly level ever asks a component for a notation:
`section()` hardcodes `render()`, so the format layer is decoration today. The
diagnosis is right and the remedy was wrong. The owner asked for multiple
formats in the goal, in those words. A capability with no caller is a WIRING
failure, and the fix is to give it its caller, not to delete the thing the owner
asked for. `forms()` stays the honest statement of what a component can actually
do — one form returned, request ignored, which `respond.rs` already models.

**Gap 15, the chrome faculty, is held.** It is a user gate under CLAUDE.md §17,
and it is also the acceptance test for the very seam being proposed. Designed
in full, shipped not at all, until the owner rules.

**Gaps 9-11, 13, 14 — the Faculty seam — held for one round.** It is the right
answer to the owner's central requirement. But it ADDS files, and a bar-raiser
is at this moment judging whether I12 bought small files at the price of a tree
nobody can navigate. Authorizing new files into that tree before reading the
judgement would be building on a verdict I have not read.

## Findings the lead owns

**Starting an agent with a goal does not exist.** Delegation today is
sub-agent-as-tool: `toolbox_for(spec, peers)` (`crates/agent/src/subagent.rs:23`)
attaches a peer ONLY when that peer is named in `tools:`. There is no
`spawn_agent` in `crates/agent/src` — grep returns nothing. So an agent can call
an agent that a human already wrote and installed; it cannot start one against a
goal. With the roster now cut to `main` alone (`public/agents/index.json`), main
delegates to nobody at all. This is increment 2 and it is a design question
before it is a coding one: a spawned agent is either a configuration written at
runtime or a goal handed to a copy of an existing configuration, and those are
different products.

## Structural round, verified by the lead (2026-08-19)

`core/src` **75 -> 26** entries, `ui/src` **57 -> 15**. Criterion-3 grep returns
0. `transport.js`/htmx gone from ARCHITECTURE.md. `Effect::Persist`/`Sleep`
gone. Gate: 475 passed / 0 failed, size OK WITH the function gate now active
(82 -> 52 offenders, shrink-only baseline), **zero build warnings**.

The lead volunteered two things that make the rest credible:
- **The critique's own criterion-3 grep is a weak proxy.** It matches three
  phrasings; 26 more excuses were phrased around it. Gating on the literal grep
  would have passed the round with a quarter of the excuses standing.
- **It declined to fix `ui/src/terminal/mod.rs::Terminal` (125 lines)**. The
  alternative was never a new file — it was an in-file extraction, and the one
  on offer is the `submit` closure. `submit` reads or writes SIX `Signal`s
  (`web`, `panel`, `draft`, `running`, `typeable`, `agent`), so lifting it into
  a free `fn` beside the component turns a closure into a six-parameter
  function and moves the complexity from length into signature. That is the
  trade, and the decision to leave it stands on it.

**The number the bar-raiser must rule on: total files went 253 -> 278.** More
files, fewer top-level entries. Either directories legitimately hold files, or
fragmentation rose under cover of the reorganisation. The lead did not address
it; I will not call this round done until that is answered.

## THE ONE THING WAITING ON THE OWNER

`main` is at `51199eb`. **gh-pages was deliberately NOT published.**

This change ships `leftovers.rs` — a control that deletes a person's IndexedDB
database. CLAUDE.md §17 lets an unattended session decide at lowest reversal
cost and never block, with three exceptions that ALWAYS stop: secrets, network
allowlists, and **destructive storage**. This is the third one.

Committing is reversible and keeps 90 files from sitting loose. Publishing is
what puts a delete button in front of the returning visitors who are the exact
population holding that database. That is the owner's press, not the lead's.

Everything else in the round is landed and green.

## The image, measured (docs/IMAGE-AUDIT.md — passed its bar-raiser)

The intuition that "the image" is the thing to shrink is WRONG, and it is now
measured rather than argued.

| | bytes | share |
|---|---:|---:|
| Emulator (`out.wasm.gzip`, `imagemounter`, `dist/`, `vendor/`) | 44,683,544 | **92.07 %** |
| Guest (`img/` — the Linux the agent runs in) | 3,847,875 | **7.93 %** |

Emulator to guest is **11.6 : 1**. Inside `out.wasm`: the emulator itself is
3 MB of `code`; **101.5 MB is a wizer memory snapshot** in 100,000 data segments
(median 40 bytes). 2,287,619 bytes of DWARF `.debug_*` ship to every visitor.

**The real "runs on any device" constraint is not file size.** The declared wasm
memory minimum is 9,244 pages = **577.75 MiB**. That is what excludes a device,
and a smaller guest does not move it.

**THE LEVER FOR "RUNS ON ANY DEVICE" IS A BUILD FLAG, NOT THE IMAGE.**
`VM_MEMORY_SIZE_MB` moves the declared wasm memory minimum almost one-for-one —
**586.12 MiB at 512, 201.50 MiB at 128** (measured, e1 vs e5 in `Dev/wasmbox`) —
while the file size barely moves. Without wizer the floor is 51 MiB. Today's
577.75 MiB is what excludes 32-bit browser builds and iOS/iPadOS. Shrinking the
guest does not move it; this flag does.

**~986 KB is free today, with no Docker and no rebuild** (all verified, not
asserted): `wasm-tools strip -a` removes 857,408 bytes of DWARF and
`wasm-tools validate` still passes (they are the only custom sections, so no
`name` section is lost); and both shipped artifacts are **gzip -6, not -9**,
worth another 475,298. With the guest trim, ~3.68 MB / 7.6 %.

**The `apk` escape-hatch argument is dead, and that flipped the recommendation.**
Keeping `apk` was justified as the last way to add something to a networkless
guest. There is no network (`c2w.js:92` boots `/bin/sh` with no net flag) AND the
rootfs is `root=/dev/sr0 … ro`. `apk` cannot install anything from anywhere onto
anything.

**The provenance was recovered.** Both image docs called the build command
unknowable; it is on this machine.
`Dev/wasmbox/out/e9-extbundle-wizer.wasm` is byte-identical to the decompressed
shipped artifact, and `logs/e9-extbundle-wizer.log:1` holds the full arg list
(`EXTERNAL_BUNDLE=true`, `VM_MEMORY_SIZE_MB=512`, `OPTIMIZATION_MODE=wizer`,
2026-08-13). The sovereignty the CheerpX deletion was justified by does not
exist until that is checked in, and it now can be.

## The finding that most changes what comes next

A coding agent implemented `space` with `floor: Summarized` exactly as
`ARCH-COMPONENTS.md` §2 specified, and the suite went red. `assemble` starts a
partless section at `Elided`; `Fidelity` orders `Full < Summarized < Pointer <
Elided`; `law.rs:31` rejects `fidelity > floor`. So every spaceless agent's paper
was an illegal document. The architecture was wrong and the code proved it.

Generalised into §5.5: **any component that can be absent must floor at
`Elided`.** With §5.4's slot-stability rule that is TWO hard constraints on a
component author, neither discoverable from the trait, both enforced by
`validate` rather than by the type system — so both arrive as a failing test,
never as a compile error.

That is now the case for the Faculty seam, and it is a better one than the
document's original: slot, stability and floor become declared data the harness
checks once, instead of three methods every author reimplements and gets wrong.

## The product was lying to its own agent

`crates/agent/src/components/space.rs:83` — the AGENT'S OWN PROMPT — said:
"What you WRITE there survives a reload; the Linux does not." False, and the
exact opposite of all six user-facing wordings. Every human surface was being
corrected for truth while the model was told the reverse.

Nobody was asked to look for this; a repair agent found it while fixing the
human copy and reported it as "the same defect". It was the SEVENTH wording of
the durability fact and the only one that was wrong.

The lesson for the roadmap: **prompt text is product copy and needs the same
truth gate.** A component renders a promise to a model exactly as a pane renders
one to a person, and only one of the two had anyone checking it.

## THE GATE WAS INCOMPLETE, and the lead owns it

`cargo test --workspace` builds `adapters_web` and `ui` FOR THE HOST, where the
browser paths are compiled out. A wasm-only break therefore passes the workspace
gate in silence.

Proven, not theorised: the CheerpX excision landed a new `adapters_web` module
calling `w.local_storage()` without web-sys feature `"Storage"` in `Cargo.toml`.
**The crate did not compile for its own target.** Every gate I ran was green
across it. A later agent found it only because its own fix could not be verified
until the crate built.

THE GATE IS NOW THREE COMMANDS, not one:
    cargo test --workspace                                  # exit code, unpiped
    cargo check -p adapters_web --target wasm32-unknown-unknown
    cargo check -p ui --target wasm32-unknown-unknown
plus `python3 scripts/check-size.py`.

## Gate state (run by the lead, 2026-08-18)

`cargo test --workspace` — **470 passed, 0 failed**, 95 test binaries, cargo's own
exit code 0. Baseline before this round was 463. `check-size.py` — 250 files,
longest 200. Nothing committed; nothing pushed.

**A verification error I made, recorded because it would have shipped a lie.**
I first ran `cargo test --workspace 2>&1 | grep -E ...`. In a pipeline the exit
code is GREP's, not cargo's, so a compile failure anywhere would have reported
"exit 0" over a plausible list of passing tests. The tell was arithmetic: 40 test
binaries against 78 test files on disk. Gate runs capture the command's own exit
code and are never piped.

## Risk the lead owns right now

**Two fan-outs are editing one tree at the same time** — the architecture lead's
coders (gaps 1-8, 12) and the CheerpX excision workflow. 61 files are dirty. One
coding agent already saw a failing test in `crates/core` caused by a DIFFERENT
agent's in-flight prose change, and correctly refused to claim or fix it.

**HEAD is not rustfmt-clean in `crates/context`** (proven: `rustfmt --check` on a
scratch copy of the HEAD version of `openai.rs` reproduces the hunk byte for
byte). Consequence during a concurrent fan-out: `cargo fmt -p <crate>` silently
rewrites files the agent does not own and folds them into its diff. Standing
order issued — format only the file you own, and no `git checkout/restore/
stash/clean` by anyone while the tree is dirty.

The hazard is misattribution, not corruption: an adversarial verifier that finds
a red test will blame whatever diff is nearest. Nothing ships on a partial tree.
The gate is one clean `cargo test --workspace` after BOTH fan-outs are quiet,
run by me, not by an agent inside either one.

Independently confirmed by a second agent that had not read the critique:
`check-size.py --functions` reports 83 offenders repo-wide (80 after its fix),
which is bar-raiser finding F1 arrived at from a different direction.

## Open, unresolved

- `crates/agent/src/paper.rs` is at **199 lines** — one edit from the ceiling.
  Flagged by the architecture lead precisely so the next increment does not
  quietly spawn a file to dodge it, which is CRITIQUE-01 finding F2.
- `render_chat` is a pre-existing function-length offender, widened 94 -> 96.
- `crates/context/src/slot.rs` `ENVIRONMENT` doc still says "Time, locale,
  device, the shared space". The shared space left that block in gap 8, so the
  comment is now false. The agent that made it false declined to fix it because
  its brief forbade touching anything else in that file, and reported it instead
  — correct, and the next edit in that file owns it.
- `docs/ARCH-COMPONENTS.md` had TWO wrong floors (`space`, `artifacts`); fixed,
  and generalised into a rule. The architecture was corrected BY the code.

- The execution environment leg is MET: `C2wWorkspace` implements `WorkspacePort`
  (`crates/adapters_web/src/c2w.rs:52`) and is now the SOLE engine — CheerpX was
  deleted 2026-08-18 and there is no engine setting. The agent owns its Alpine,
  and this repo serves the image. The price is stated where a person can read
  it: the root is tmpfs in guest RAM, so files in an agent's folder do not
  survive a reload and nothing can be switched on to keep them
  (`docs/ALIGNMENT.md` §7.1, decided (c), with (b) as the route back).
- `crates/core/src` is 75 flat files, `crates/ui/src` is 57. I12 bought small
  files with a directory nobody can navigate. This is the first thing the
  bar-raiser is pointed at.

## CRITIQUE-01 round: the naming-table decisions (exit criterion 2)

Criterion 2 requires every rename in `docs/CRITIQUE-01.md`'s naming table to be
applied, or **declined in writing**. This is that written record.

**`crates/ui/src` — 19 of 19 applied, none declined.** Including the two F9
calls the critique said were not judgement calls: `stage.rs` -> `centre/` and
`tools.rs` -> `trace/`. Six further renames were made beyond the table for the
same reason (the name did not say what was inside): `processes.rs` ->
`proc/mod.rs`, `procrows.rs` -> `proc/row.rs`, `runstatus.rs` ->
`board/launch/outcome.rs`, `receipt.rs` -> `board/launch/receipt.rs`,
`settings_view.rs` -> `settings/view.rs`, `fileedit.rs` -> `files/openfile.rs`.

**`crates/core/src` — applied except the four below.** Three of the four were
declined because the file was **deleted outright**, which is a stronger outcome
than the rename the table proposed:

| Table entry | Decision | Reason (one line) |
|---|---|---|
| `form.rs` -> `form_value.rs` | DECLINED — **merged and deleted** | 39 lines, one fn; its own header said it was split out of `builtins.rs`, so it went back there. |
| `rowwords.rs` -> `board/words.rs` | DECLINED — **merged and deleted** | 37 lines, two fns, one caller; merged into `board/row/reading.rs` and both fns demoted to private. A folder of 30-line fragments is the same failure with better signage. |
| `loopline.rs` -> `agents/loop_sentence.rs` | DECLINED — **merged and deleted** | 29 lines, one fn, one caller; it *is* a card sentence, so it merged into `agents/card_sentences.rs`. |
| `fold.rs` -> split into `chat/ownership.rs` + `chat/notices.rs` | DECLINED — kept whole | Every symbol in it is called from `board/`, `failure/` and `chat/` alike: it is the shared reading-of-the-log, not four private jobs. Splitting doubles cross-folder imports and changes no logic. The table's premise was that it sat at top level; inside `chat/` the name is guessable. |

Two renames were made beyond the table, both name collisions of the same kind
the table exists to fix: `filelist.rs::listed` -> `files/listing.rs::newest_listing`
(it collided with `words::listed`, which writes "a, b and c"), and
`observe.rs::secs` -> `observe.rs::uptime` (its opposite number is already
`proc/table.rs::parse_secs`).

## CRITIQUE-01 round: what the file-count rule cost, and what it bought back

The critique's charge was that I12 was met by RELOCATING bloat, not removing it.
Recorded here so the next round can check the claim rather than take it:

- `crates/core/src` 77 -> 26 top-level entries; `crates/ui/src` 61 -> 15.
- Files **deleted**, not moved: `core/src/form.rs`, `core/src/rowwords.rs`,
  `core/src/loopline.rs`, `ui/src/stage/intro.rs` (a module for two string
  constants), `adapters_web/src/warmth.rs`, `module/src/install.rs`.
- Re-export facades deleted: `ui/src/runstatus.rs`'s (F7, nine call sites
  rewritten) and one inside `core/src/failure/` of the same kind.
- Duplicates removed: one `listed`, one duration formatter, one failure-header
  read, one `/files` read, one `POST /files` builder, and one DOM read whose own
  comment admitted it was "copied not shared".
- Doc comments citing the line rule as a reason to exist: **89 -> 0**. Note the
  critique's grep (`"200-line rule|was at 200|for the line count"`) is a PROXY:
  26 further excuses were phrased so that grep missed them (`"because that file
  was full (I12)"`, `"cannot gain a module"`, `"split out for"`). Those were
  purged too. Statements of the form "its own fn so X stays one job (I12)" were
  KEPT — that is a cohesion claim, not an origin story.

## Increment 6, run by the lead (2026-08-19) — the three unfinished things, closed

Base `9368d7e`, nothing committed. Gates run by the lead on a quiet tree, unpiped,
each command's own exit code: `cargo test --workspace` **517 passed / 0 failed /
5 ignored, 98 binaries, TEST_EXIT=0** (baseline 496); `cargo check -p adapters_web
--target wasm32-unknown-unknown` **WEB_EXIT=0**; same for `ui` **UI_EXIT=0**;
`check-size.py` **SIZE_EXIT=0**, 289 files, longest 200, 52-entry function baseline
untouched. **Zero warnings** across all three cargo runs.

**1. The host path is proven by a faculty now, not by an equivalent seam.** `memory` —
one agent's own durable lines, a `## memory` block plus `keep`/`discard`, resting on
`StorePort` which is already per-agent in the browser. `keep` is in no table in `core`,
so a call to it reaches `faculty::run_hosted` or a refusal with a signature the tests
rule out. Declared by config, rendered before every call, called by the model, run by
the host, back as a `ToolInvoked`, still there after a reboot on the same store. The
shipped `main` declares it, and against the real 12B the model reached for `keep` 4/4
when the message said the line was private.

**2. F4 closed the way it was asked to be — impossible, not caught.** `pub const ALL`
and the `match` in `of` were two lists that could disagree; there is now one `TABLE` and
both are derived from it. Registering IS adding a row.

**3. The spawn workflow is verified with a second agent that really runs** — its own
`App`, its own log, `core::drive` on its own loop, which is what a Worker does minus the
`postMessage`. `crates/core/tests/spawn.rs`.

### THE NUMBER THE LEAD OWES THE OWNER, MEASURED

The bar was "if a developer touches more than two files, the architecture has failed."
Building the second faculty touched **six new files and five existing files, eleven
lines**. **It did not meet the bar, and the doc's "two files, zero core edits" claim is
retracted in place** (`docs/ARCH-COMPONENTS.md` §11.4 and §12.4). A browser faculty
genuinely costs zero `core` edits; `memory` costs three because its capability is a core
port, and stating that as a property of the seam was the error.

### What an operator looks at to know a workflow ran — ONE pane, and it is not the obvious one

`GET /tools` with `x-agent: <the CALLER>`. It carries the goal in full and the answer in
full. Three gaps, asserted as true behaviour rather than smoothed over: the CALLEE's own
trace pane is empty, the board carries status and a turn count but never the goal or the
answer, and `core::last_failure` on the caller is `None` after a delegated failure
(`refused` logs `core.agent_error`; `last_failure` folds `core.error`). None fixed here.

### The defect the gate caught, which is the best thing that happened this round

`render_agent_file` never wrote `faculties:` — the stated inverse of `parse_agent_file`,
whose own comment promises every key is written. Invisible for a whole increment because
no shipped agent declared a faculty, so the round-trip test compared two empty fields and
agreed. `main` declaring one turned the workspace red. A model calling `write_agent`
could not have authored an agent with a faculty. `passes:` was missing identically.
Fixed, and pinned by a test that sets EVERY field to a non-default value so the next
field fails on the day it is added.

### Product changes an owner may want to reverse, in one file each

- `public/agents/main/agent.md` now grants `write_agent` and `spawn_agent`. Without them
  the whole delegation path was unreachable in the shipped build (CRITIQUE-03 F8), so it
  could not be demonstrated at all. It is a real capability widening and it is one line
  each to revert.
- The same file declares `faculties: [memory]` and grants `keep`/`discard`.

### The bar-raiser: GO on the faculty and on F4, QUALIFIED GO on the spawn work

Eleven findings, all actioned or refused in writing (`docs/ARCH-COMPONENTS.md` §12.10).
**The one that mattered was HIGH and the tests were green over it.** `run_on` appended a
`Working` FACT for an agent name the roster never had; the refusal then tidied the board
ROW away with `Board::forget`. The row went, the fact stayed, and `install::replayed`
counts a `Working` fact as a turn — so the phantom came back on the next reload, one turn
richer. The test that was supposed to catch it asserted on rendered HTML, which is the
surface the in-memory tidy-up had repaired. Fixed at the fact: `Working` is announced only
for a loaded name, and the test now asserts the log holds no status fact at all.

That is the round's own lesson repeating: a test that asserts on a projection cannot see a
defect in the log behind it.

Two findings are recorded and NOT fixed, both with reasons rather than intentions:
`ToolHost::run` gets no `Sensing` context where `Sense::read` does — so memory's store
prefix cannot be keyed by agent without a trait change — and `Slot::USER` describes the
content the prompt teaches the model to put in `Slot::MEMORY`, which is a taxonomy ruling
and not a repair.

**Also recorded, because this round should have said it first:** the live suite is not
green. `a_project_turn_plans_before_it_works` fails against the real model. Pre-existing,
unrelated to memory, `#[ignore]`d so no gate sees it.

### Two things the lead did NOT do

- **Nothing committed, nothing pushed.** The ship decision is the owner's.
- **`docs/PARITY.md` and this file's PARITY section are NOT increment 6's work.** A
  concurrent session wrote them while this round ran. Recorded so nobody credits the
  wrong round; the hazard STATUS already names — two fan-outs in one tree — was live
  again and this time it was two SESSIONS.
