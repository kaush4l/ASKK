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
| 3 | The Faculty seam + an agent that starts an agent with a goal | DONE, green, unshipped — 496 tests, 4 gates exit 0, `docs/CRITIQUE-03.md` **split verdict**: GO on the component requirement, NO-GO on its §9.5 file-count claim (`CRITIQUE-03.md:565`) |
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

**Two direct hits on the owner's stated goal:** — BOTH CLOSED 2026-08-20, see
*The T1-T4 round* at the foot of this file. The two bullets are left as they
were measured, because a measurement that gets edited when the world moves
stops being a measurement; the closure is marked, not written over.
- ~~`main` is granted almost nothing — no `web_search` — and NO agent holds
  `role: critic`, so that seam is dead code in production.~~ CLOSED: `main`
  names both, and `public/agents/critic/agent.md` ships holding the role.
- ~~**Stage prompts are Rust constants** (`brief.rs:22-52`). The owner asked for
  configuration-driven agents; the loop's own instructions are compiled in.
  DeepSeek and Hermes both keep theirs in data.~~ CLOSED: they are
  `public/stages/*.md`, loaded like agent files, and a missing one refuses.

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

## THE GATE — six CHECKS, never piped, each read by its own exit code

Read this before every round. Each one exists because something shipped green
past its absence.

    1. cargo test --workspace
    2. cargo check -p adapters_web --target wasm32-unknown-unknown
    3. cargo check -p ui --target wasm32-unknown-unknown
    4. python3 scripts/check-size.py
    5. scripts/check-browser.sh          # the browser suite over adapters_web
    6. ./publish.sh --dry-run            # every publish check, stopping before the push

**EVERY STEP HERE IS A CHECK. NONE OF THEM DEPLOYS.** Step 6 is `--dry-run` and
that is not a detail — the first draft of this section wrote bare `./publish.sh`
into this numbered list and called a green round reaching the phone "the default".
`publish.sh:122` is `git -C "$WT" push origin gh-pages`; T10 records the publish
as an OWNER GATE, and CLAUDE.md §17 says destructive storage always stops. A
numbered list headed "the gate" is what the next agent will run top to bottom, so
putting a push in it inverts an owner gate by formatting. The lead wrote that
brief and the bar-raiser caught it. **A gate step may only ever be something that
can fail; never something that changes the world.**

**Never pipe one of these into anything.** In a pipeline the shell reports the
exit code of the LAST stage, so `cargo test … | grep -E …` reports grep's status
over a plausible list of passing tests while a compile failure sits above it.
That mistake was made twice here. Run the command, let it print, read ITS code.

**Steps 5 and 6 are gate steps, not optional extras.** They were added on
2026-08-21 against four measured facts, and the argument for each is the fact.

*Why 5.* `grep -rn wasm_bindgen_test crates` returned **0**. Every mechanism
behind the owner's three headline goals — parallel agents, agents talking across
threads, an environment that does real work — lives only in `crates/adapters_web`,
and steps 1-4 never RUN that crate; step 2 only proves it compiles. Two
consequences were measured, not argued:

- The host double makes concurrency **unobservable by construction**.
  `crates/adapters_test/src/lib.rs:27-29` is `Box::pin(std::future::ready(value))`
  and `crates/adapters_test/src/agents.rs:46-63` pushes to `seen` synchronously
  before returning, so `join_all` at `crates/core/src/batch.rs:139` drives
  delegation 1 to completion before delegation 2 exists. The test that claims to
  prove parallelism (`crates/core/tests/delegation.rs:180-201`) asserts an ORDER a
  fully serial `for … .await` loop produces identically, under a doc comment
  claiming the opposite of what it measures. 581 green tests measured the half
  that cannot fail in the ways that matter.
- A LIVE WEDGE sat in the untested half. `crates/adapters_web/src/workers/spawn/reply.rs:138`
  is `*waiting.borrow_mut() = Some((resolve, reject))` — ONE slot per peer. Two
  concurrent asks to the same sub-agent overwrite a resolver; the dropped promise
  never settles, `pending_tools` never reaches 0, and the lead's turn hangs
  forever with no timeout and no error card. Reachable two ways: the model names
  one peer twice on a batch line (`crates/agent/src/step.rs:126-141` does not
  dedupe), or a person messages that agent from Threads while the lead delegates
  to it (`crates/core/src/runtime/requests.rs:101`).

A `cargo check` cannot fail either of those. Only a suite that runs in a browser
can, which is why running it is a step and not a suggestion. Worker C owns the
runner and therefore its exact name; `scripts/check-browser.sh` is the path this
file points at until C's lands, and this line gets corrected to match it rather
than the other way round.

*Why 6, and why only its dry run.* `origin/gh-pages` is `81d2826 deploy 187dc39`;
`main` is `de10ca8`. Six increments — including the fix that stops the default
model path failing silently on a phone (T28) — exist only on a developer's
machine. "On gh-pages" is in the owner's first sentence, so a round that is green
and unshipped has not finished; it has only stopped.

But the thing that was UNCHECKED is not the push, it is everything `publish.sh`
verifies before it: assets present, manifest and folders in agreement, the engine
wasm floor, the 99MB cap, the relative-URL rule. Those can all fail, and until now
nothing ran them until the moment somebody was already deploying. `--dry-run` runs
every one and stops before git. That is the half that belongs in a gate.

The push itself stays where T10 put it: **the owner's call, asked for each time.**
A green gate is the evidence that the answer COULD be yes. It is not the answer.

`publish.sh` is at the REPO ROOT, not under `scripts/`.

**Why steps 1-4 exist**, kept from when this section was three commands:
`cargo test --workspace` builds `adapters_web` and `ui` FOR THE HOST, where the
browser paths are compiled out, so a wasm-only break passes it in silence. Proven,
not theorised: the CheerpX excision landed an `adapters_web` module calling
`w.local_storage()` without web-sys feature `"Storage"` in `Cargo.toml`. **The
crate did not compile for its own target**, and every gate the lead ran was green
across it. Steps 2 and 3 are that failure, written down as commands. Step 4 is
I12.

**What the six still cannot settle.** There is no CI in this repository; every
step here is only as good as someone remembering to run it. And step 5 checks the
browser we point it at, not every browser — the twelve claims in T51 need a real
Chrome and a real Safari against a served build. Both gaps are stated rather than
papered over, which is what I17 asks for.

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

---

# The T1–T4 round (2026-08-20) — briefs became data, the loop got an exit code

Architecture lead's record. Four mandates, five coding subagents, one bar-raiser that
returned **NO-GO**, three remediation subagents against its blocking findings, and one
instruction violation that had to be repaired centrally.

## RULING — a brief is a property of the STAGE, not of the AGENT

The owner asked for configuration-driven agents and the loop's own prompts were Rust
constants (`brief.rs:22-52`). Moving them to data settles nothing until you say *whose*
data they are: does an AGENT declare how it plans, or does PLANNING mean one thing for
everyone? **They are the stage's.** Three reasons, in the order they decided it:

1. **A stage name is a closed vocabulary whose meaning belongs to the machine.**
   `brief::acts`, `brief::skill_only`, `stages::verify_ahead` and `passes::again` all
   branch on the name. If two agents could mean different things by `verify`, the machine
   would be reasoning about a word it no longer knows the meaning of. The machine's
   contract with the stage is the whole reason a stage is worth having.
2. **The agent's own voice already reaches the model, in full, through `Soul`** — its
   `agent.md` body. An agent that wants to plan differently edits its soul. Per-agent
   briefs would be a SECOND place an agent's instructions live, competing with the first,
   and `main`'s body already describes all four stages in prose.
3. **The verify brief is coupled to the machine, not to the agent.** A per-agent copy
   could quietly stop naming the thing the harness looks for while the harness kept
   looking.

The counter-argument, recorded because it is real: the owner said "every agent and its
metadata is configuration". A stage brief is not the agent's metadata — it is the LOOP's.
Making it per-agent hands every agent file four more blocks of prose to keep in agreement
with a machine it cannot see.

**The two hard constraints, both verified by the bar-raiser against the tree.** The core
PARSES NONE OF THE BRIEF — the only operations anywhere on brief text are trim, non-empty
and clone; greps for the words the prose itself contains (`CHECK`, `OUTCOME`, `done_when`)
return nothing in `crates/*/src`. And a missing or blank brief FAILS LOUDLY — no
`CallModel` is emitted, the turn ends, and the sentence names the file to create.
`include_str!` of a brief appears only under `crates/*/tests`, which
`crates/agent/tests/common/mod.rs` states as an exception and confines.

`durable` is its own key rather than a section of `plan.md`, because the alternative is
core splitting a file on a separator — which is core parsing a brief.

## RULING — the `critique` STAGE and the `role: critic` AGENT are two different jobs

`brief.rs:44-48` claimed the critic agent had become the stage; `critic.rs:1-21` argued a
stage is exactly what a separate agent exists to fix. Two files in one tree disagreeing.
Resolved in favour of `critic.rs`, and `brief.rs` corrected:

- The **stage** is REFLECTION — the same model, in the same window, still holding every
  belief it held while doing the work. It produces prose for the person, `answer::why`
  never reads it, and it improves the ANSWER. It cannot gate one, because nothing
  mechanical reads it.
- The **agent** is a VERDICT — its own Worker, its own prompt, no sight of the caller's
  conversation. Its first line is read mechanically and a non-pass forces
  `CRITIC_FAULTED`. It gates the answer and cannot improve it.

A model marking its own homework is worth having and is not a gate, for the same reason
`passes` never asks a model whether it is finished. Neither replaces the other; both ship.

## RULING — we do NOT widen `EventKind::ToolInvoked` to carry an exit status

The obvious move for T2 was a `status: i32` on the fact, since the code is "narrowed to
`ok: bool`". Refused. `gate.rs:85` computes `ok` as `ran.status == 0` off the port's own
`Execution.status` — so `ok` IS the observed exit code, collapsed to the one bit the
continue condition needs, and it is not a model's report or a parse of output. The numeral
survives in the output (`gate::said` appends `(exit status N)`). Widening a deliberately
closed vocabulary for a number nothing branches on is speculative generality across ~15
construction sites. **What would change it: a continue condition that must tell exit 1
from exit 2.** Recorded so the next round can reverse it on evidence.

The real gap was never the bit — it was telling the HARNESS's check apart from the MODEL's
own `exec` calls. That is a `checking` flag, correlated by the same `pending_tools == 0`
precondition the loop already relies on, and asserted directly in a test.

## What landed

- **T1** — `public/stages/{strategy,plan,verify,critique,durable}.md`, loaded like agent
  files, fetched at boot and forwarded into every sub-agent Worker. Unknown frontmatter
  keys now REFUSE instead of being silently dropped (`yaml.rs`'s `_ => {}`).
- **T2** — a standing `goal.outcome` / `goal.check` / `goal.done_when`, two-phase because
  `WorkspacePort::exec` is async and `step` is pure (I7): `passes::again` returns an
  `InvokeTool`, `step::advance` folds the result and re-enters. Continue-or-stop is the
  command's observed exit code; `acted` is not consulted. Four loud refusals. Declared on
  the `builder` fixture, deliberately NOT on `main` — a greeting arrives there.
- **T3** — `web_search` and `critic` granted to `main`; the critic ships. I2 verified at
  four points: `FetchNet::new()` empty, `allow` removes a blank entry, the settings
  suggestion is placeholder text only. `web_search` ships REFUSING until a person
  configures an endpoint, and that is the design.
- **T4** — the delegated goal and answer on the board, both in `activity_since`, the
  failed-callee `postMessage` no longer stranding its tool calls, and a separate
  `last_delegated_failure` rather than widening `last_failure` (a callee's cause must not
  appear in the page's own failure card naming an endpoint the page never called).

## The bar-raiser said NO-GO, and it was right

`docs/CRITIQUE-04.md` holds both passes in full — written to disk because the first draft
of this section cited them as `CRITIQUE-03`, which is the *Faculty seam* review and carries
a **GO**, so this file called one document both a GO and a NO-GO seventeen lines apart. The
second pass caught it. Summarised: it confirmed both of T1's hard constraints
survived every attack it made, cleared I2 independently, and confirmed the negative-control
tests were preserved rather than weakened. Then it found:

- **The critic's whole tool grant is inert in every path this build has, and its own file
  claimed a path where the tools work.** Chatting to a non-entry agent routes through
  `run_on` into its own Worker, whose workspace port refuses. The agent was functionally
  the `engine: base` shape its own frontmatter argued against — "a setting that looks
  applied", inside the increment whose thesis is deleting those.
- **The I12 measure went backwards.** Files at exactly 200 lines: 11 at HEAD → 17. Not one
  new one landed at 197–199. The ceiling, not the subject, was ending those files.
- **T4's board fold worked for a model-delegated run and not a person-launched one**, since
  only `delegate()` appends the goal record and the Dashboard path calls `run_on` directly.
- **`last_delegated_failure` was public API with no production caller**, and its test drove
  a fake sending a different shape than production sends.

Its answer to "what did the tests not catch" is the finding worth carrying forward:
**the brief refusal is erased from the screen by the next roster reconcile**, because
`install_briefs` PUSHES onto `agent_problems` while `roster::reconcile` ASSIGNS it — so the
first `write_agent` silently deletes the message telling a person which file to add. And
`agent_problems` has zero test coverage anywhere. The loud-failure channel is not reliably
loud. **Not fixed this round; named here so it is the next one's.**

## THE INCIDENT — `rustfmt` on a crate root reformatted 43 files, and nobody meant to

**The first diagnosis was wrong and the corrected one is the point.** It looked like an
agent had run `cargo fmt` over the crate against an explicit prohibition. It had not.
An agent ran, on five files it genuinely owned:

    rustfmt --edition 2021 crates/core/src/board/errand.rs crates/core/src/lib.rs \
        crates/core/src/failure/from_worker.rs crates/core/src/trace/from_worker.rs \
        crates/core/tests/spawn.rs

**One of those five is the crate root, and `rustfmt` FOLLOWS `mod` DECLARATIONS.** Measured
after the fact, non-destructively: `rustfmt --edition 2021 --check -l crates/core/src/lib.rs`
names **43 files**. Naming the crate root formats the entire crate. The agent then
hand-reverted every hunk in the five files it had named and reported honestly that it had
cleaned up after itself — it had, for the five. It never knew about the other thirty-eight.

So the standing instruction in every brief, *"format only files you own"*, is **not
achievable with rustfmt** whenever one of the files you own is a crate root or a `mod.rs`.
The agent obeyed the letter and the tool silently expanded the blast radius. **The brief was
wrong, not just the agent.** Future briefs must say: run no formatter at all, and if you
must, never name a `lib.rs`, a `main.rs` or a `mod.rs`, because the argument list is not the
blast radius.

It broke gate 4: 12 files over the 200-line limit and 9 new over-40-line functions against a
shrink-only baseline, including files in nobody's mandate.

This is not a formatting nit. HEAD is deliberately not rustfmt-clean *because* this
codebase's line style is hand-set so its long doc comments and prose strings fit inside
I12; rustfmt's defaults inflate them straight past the ceiling. The formatter mechanically
attacks the invariant, across hundreds of lines the round never touched, and it would have
destroyed the measure the bar-raiser judges rounds by.

**Repaired without `git checkout`, `restore`, `stash` or `clean`** — see the lesson below
for the technique and why its first pass under-reported.

**AND THE FIRST REPAIR WAS NOT THE LAST.** A second bar-raiser pass found **nine more files**
still carrying rustfmt output (+53 lines), and found that the method used to verify the first
repair could not possibly have seen them: `rustfmt --check -l` lists the files rustfmt *would
change* — that is, the correctly restored ones. A file left in rustfmt's output is ABSENT from
that list, so the command named 43 files before the repair and 43 after, and was worthless as
evidence either way. The detector that works compares each file's token stream against HEAD
with whitespace and commas stripped **and `use` lines compared as a sorted set**; without that
last clause rustfmt's import reordering hides the file.

**The measure was satisfied by the bug it was measuring.** `crates/core/src/agents/authoring.rs`
(200 → 199) was the ONLY file that had left the exact-200 list, and its whole diff was
unrepaired reformat. So the round's first headline — "10 exact-200 files, below HEAD's 11" —
was an artifact of the incident, and on a restored tree it read **11, level with HEAD**.
**Always restore the tree before reading a line-count measure.**

**The final number is 10, and this time it is audited rather than asserted.** The last repair
split `crates/core/src/faculty.rs` (200) into `faculty/mod.rs` (103, the SEAM a host is handed)
and `faculty/run.rs` (132, the loop that walks an agent's faculties), to make room for
`Sensing.tools`. Set-differenced against HEAD rather than counted:

    at HEAD, not now (left the ceiling):  crates/core/src/faculty.rs   — split by subject
    now, not at HEAD (grew into it):      (none)

That second line is the one that matters and it is the claim `docs/CRITIQUE-02.md` cares
about: **no file in this round ended on the ceiling.** The residue detector also reports zero
remaining reformatted files, so the number is measured on a clean tree.

**AND THAT SENTENCE WAS FALSE WHEN FIRST WRITTEN — a third pass proved it.** The detector
above is WHOLE-FILE, and residue also lives in HUNKS inside files that carry real changes,
where a whole-file comparison is blind by construction. Worse, the "compare `use` lines as a
sorted set" clause classifies a no-op import edit (`use x as x;` -> `use x;`) as a real
change, which pushed a fully-reformatted file into the "has real changes" bucket where it was
never examined. A per-hunk sweep found **22 more pure-format hunks across 14 files, +86 net
lines** — more than the +53 that produced the standing NO-GO, merely distributed where the
first detector could not look. **The detector must run per HUNK, not per file.**

**AND THAT WAS STILL NOT THE END — a fourth pass proved the per-hunk sweep wrong too, twice.**
`git diff -U3` MERGES adjacent changes into one hunk, so a pure-format change sitting near a
real one is absorbed into a "mixed" hunk and skipped; `-U0` isolates each change. And the
normaliser stripped whitespace, commas and semicolons but **not braces** — while rustfmt ADDS
braces, wrapping closure bodies and match arms (`|o| f(x)` -> `|o| { f(x) }`). That blind spot
hid seven more files from every sweep in this round, the lead's and both bar-raisers'.

So the rule, in the form that finally held: **`git diff -U0`, and normalise away whitespace,
commas, semicolons AND braces.** Under that detector the tree reads zero at both hunk and
whole-file granularity, and that was measured AFTER the last revert rather than asserted
before it — which is the failure this section describes four times over.

**One flagged hunk was not residue at all, and the GATE is what proved it.**
`crates/agent/src/step.rs`'s one-line `ToolResult` literal reads as a pure-format hunk to any
text comparison. Restoring it to six lines put `fn advance` at 41 and I12's function gate
refused it; extracting the arm into its own function put the file at 201. It was a DELIBERATE
hand-collapse holding the exit table under the gate. It stays, and it now carries a comment
saying why it is one line. **A text-level detector cannot tell a deliberate hand-collapse from
formatter residue** — no better regex fixes that, and writing the intent down does.

**The lesson for the fan-out, corrected.** The first version of this section blamed an
agent for ignoring a prohibition. That was the easy reading and it was false: three of the
four agents asked answered honestly and none had run `cargo fmt`. What actually happened is
that a tool's blast radius did not match its argument list, and no instruction could have
prevented it because the instruction itself assumed a file-scoped tool.

The generalisation worth keeping: **when a brief constrains a subagent by naming files, the
constraint only holds for tools that are actually file-scoped.** `rustfmt` is not, and
neither is anything else that walks a module tree, a workspace, or a config's `include`s.
Two defences follow, and neither is an instruction: a check that runs AFTER the fan-out
rather than a rule before it (there is still no CI — T12), and the classification technique
this repair used, which is reusable — compare each changed file's token stream against HEAD
with whitespace and commas stripped to separate reformat from real change mechanically. Note
the first pass under-reported, because rustfmt ALSO reorders imports and that changes token
order; the survivors needed a whitespace-insensitive diff. 31 files were restored this way,
and the two carrying exactly one real change each were restored and had that change
re-applied by hand.

---

# The T28–T29–T26 round (2026-08-20) — the default path, two tabs, and a default that leaked

## T28 — our own discipline, turned on our own default

`model: local` pointed at `http://127.0.0.1:8873/v1`. From the hosted origin that is a
public page calling a loopback address: Chrome 142+ governs it with Local Network Access,
and Safari has never allowed it at all. The failure was **silent and indistinguishable from
a closed port** — which is `CRITIQUE-04`'s through-line in the product's front door.

Two of the three changes the research named were wrong against this tree, and verifying
before implementing is the only reason we know:

- **"Put the first call behind a user gesture instead of a boot probe."** There is no boot
  probe. `ondevice::probe()` is a `Reflect` lookup with no network, `fetch_models()` is
  same-origin, `boot` never pushes to `pending`, and `restore_log` deliberately does not
  resume a turn. The first model call is always a `POST /chat`. **Already true — recorded,
  not built.**
- **"Surface it through `ModelPort::resolves`."** `resolves` returns `Option<(entry, model)>`.
  It is a fact accessor, not an error channel. A misreading from outside the code.
- **What the research missed is worse than what it found:** a sub-agent's turn runs in a Web
  Worker, and **a Worker never has user activation**, so a delegated agent can never answer
  a permission prompt even on a page that was granted one. Structural. It is told, not
  worked around.

**The value had to be verified externally and the guess was wrong in a dangerous way.** The
LNA spec's `IPAddressSpace` is `public | local | loopback`, renamed from PNA's
`public | private | local`. So `"local"` still parses and now means the local NETWORK —
declaring it for `127.0.0.1` would name the wrong space and fail silently. `"loopback"` is
the value. That check was the difference between fixing this defect and reproducing it
inside the fix.

**The fact is computed BEFORE the call, not guessed after it.** A denied prompt and a closed
port are the same `TypeError` and always will be. But "this call is loopback from a
non-loopback origin" is deterministic and ours. That is `NoKey`'s doctrine — hold the fact,
do not parse a stranger's error string.

**A predicate's correctness is a function of what DEPENDS on it.** `is_loopback` was
`url.contains("localhost")`, and that was genuinely fine while it only chose which paragraph
of advice to print. T28 promoted it to gating a real network declaration, and the same eleven
characters became a security-relevant bug — `https://localhost.evil.example/` is not a string
anyone types by accident. That it fails CLOSED is Chrome re-checking the declaration, which
is Chrome's defence and not ours. Fixed to a host test, and **proved by reverting it and
watching the new test fail (exit 101)**.

## T29 — Web Locks: one mechanism, two payoffs

`log/store.rs::drain` writes `<agent>/<index>`; two tabs wrote the same keys, and a
compaction's `replace_prefix` clobbered whatever the other appended. The lock is **per
agent**, not per origin, because `main` (page) and `critic` (Worker) write disjoint ranges
and one origin-wide lock would make every Worker a follower of its own page.

A follower **refuses to take turns**, on one predicate, because taking a turn IS writing.
"Run but persist nothing" was rejected: the window would diverge from a log it can never
reconcile and the work would vanish at reload with nothing having said so.

Freeze-exemption needs CONTENTION — a lock nobody wants exempts nothing. The page holds
`askk/awake`; every agent Worker queues on it forever; **the queue is the mechanism.** And
the honest limit is written into the file: a roster trimmed to `main` alone has no Worker, so
no waiter, so no exemption, silently. That is `tracker.md` T52 and it is this round's own
new instance of the standing defect.

## T26 — a default-ALLOW list in a default-deny codebase

`acts` read `!matches!(stage, STRATEGY | PLAN | CRITIQUE | ANSWER)` where both its siblings
list what is INCLUDED. A sixth entry in `STAGES` would have taken the whole toolbox by
omission. It now lists what MAY act, and **the test pins the DIRECTION, not a case**: every
named-stage assertion in it passed under the old spelling too, and only the unlisted-name one
fails. Proved by reverting `acts` and watching it fail on `"grounder"` (exit 101).

## THE FIFTH WAY TO MEASURE THE WRONG THING — a count is not a count until you know its unit

The last round found four: the wrong command (`rustfmt --check -l` lists what it WOULD
change, the complement of what needed checking), the wrong granularity (`-U3` merges adjacent
hunks), the wrong normalisation (rustfmt ADDS braces), and the wrong moment (claimed before
re-running). This round found a fifth, and it is the subtlest of them.

A subagent reported `cargo test --workspace` → exit 0, **"103 passed"**. The last accepted
green was 548. A Web Locks change and a one-line predicate cannot delete 445 tests, so the
green looked like a filtered or mis-rooted run — the failure family this file already names
as law.

**It was none of those. The command was right, the moment was right, the tree was right, and
the number was true — of a different thing.** `103` is the count of `test result:` LINES,
i.e. test BINARIES. The tests were 565. `103` was never wrong; it became a false statement
only when it was reported under the word *passed*.

Two things follow, and the second is the one to keep:

1. **A count is not a count until you know its unit.** Reconcile arithmetic to the change
   that caused it: 548 + 6 (`lna28` + the impostor test) + 10 (`writership` + `locks29`) + 1
   (the direction test) = 565, each delta named against the file that added it. A number that
   cannot be reconciled to a cause is not evidence, whatever its exit code.
2. **A REPORT is a place a measurement can go wrong even when the measurement did not.** The
   gate output was correct the entire time. The error entered in the summary written on top of
   it — and every previous lesson in this file is about the measurement itself. This one is
   about the sentence describing it, which is a larger surface and a less guarded one.

## Two smaller things, recorded because they are habits and not events

**Gates 2–4 predated the `tracker.md` and `docs/` edits in this round.** Neither path is
compiled nor under `crates/*/src`, so the gates do describe the shipped code — but that is an
ARGUMENT, not a measurement, and it was handed over labelled as one. The label is the point.

**Five instances of one defect are now open** — T20, T25, T48, T50, T52 — and the count has
stopped being a list and started being an argument. They are one round, not five patches.
