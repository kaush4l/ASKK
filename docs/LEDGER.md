# Ledger

One line per slice. A slice is one row from `CAPABILITIES.md` that can be judged
on its own. This is a record, not a plan — the queue below is an ordering of
rows that already exist in the ledger, and it is re-cut after every wave.

Every slice is built by one agent, judged by a second that never sees the
first's reasoning, cut by a third that only asks whether deleting a line
changes an output, and then fixed. Nothing is marked done without the gate:

    bun run check
    bun scripts/dryrun.js "<a task that exercises the slice>"

`check` is lint, then tests, then the static export, then a browser — one
definition, in `package.json`, and nothing here restates it. The fourth step
arrived without this sentence noticing, which is the drift the sentence is about. An earlier version of this file
spelled the gate out a second way and immediately drifted from the scripts,
which is the failure it was warning about.

The dry run is the second half and it is not optional. A slice changes what the
model is handed; the transcript is how anyone sees that, and it prints the
prompt byte for byte with a sha256 rather than a summary of it. Output pasted,
both commands, always — **and the task quoted with them.** The prompt contains
the user's sentence, so a sha256 without its task is a number two people cannot
compare. One wave produced four prompt shas nobody could reconcile for exactly
that reason; see "The dry run, re-measured after integration" below.

`test` runs `bun test --isolate ./test`. `--isolate` is not a preference: Bun
1.4.0 segfaults when two or more test files import a module that fails to parse,
which is the ordinary state of the tree while a slice is being written, and it
turns that panic into a named error. `lint` running first is the real guard:
biome catches the parse error before the runner ever sees it.

The path is not a preference either, and the two spellings that lost are worth
recording because the wrong one looks right. Discovery used to be unscoped, on
the argument that a `bunfig` test root silently drops a colocated test file and a
gate that hides a test is worse than one that crashes. Unscoped is now the thing
that *runs foreign* tests, because the benchmark rig writes a workspace whose
paths contain both `test` and `test/` — the `slugify-module` task makes a model
write `test/slugify.test.js`. Re-derived by the accountant with two failing files
planted at once, `bench/work/zz/planted.test.js` and
`bench/work/zz/test/planted.test.js`:

    bun test --isolate test      484 pass  2 fail   (both)
    bun test --isolate test/     484 pass  1 fail   (the second only)
    bun test --isolate ./test    484 pass  0 fail   (neither)

Only `./test` anchors to the directory. **This is the same defect as S30 one step over: the gate's own
targets collide with the rig's output.** `bun test` was fixed and `biome check`
was not.

Status: `open` -> `built` -> `judged` -> `landed` | `rejected`

## Done and in flight

| # | Slice | Row it closes | Status | Verdict |
|---|---|---|---|---|
| 0A | Verification harness — `bun test`, dry-run transcript, scripted model | §5 "every measured number is an assertion" | built | — |
| 0B | Reference study — what agent-zero / bolt.diy / Open SWE / eliza put in the context window | §4 calibration | built | — |
| 1A | `fetch` and `search` tools in the backend worker | Search the web; Fetch a URL | landed | — |
| 1B | Bound and cancel the loop — abort through the envelope, a budget the agent can read | Bound it; Cancel it | landed | — |
| B1 | the bar-raiser survey wave — S1 through S7 | see the survey below | landed | 4 FAIL, all fixed |
| T1 | the sandbox reaches the artifact — derive the image URL, propagate the exit status | Run a command; the new *Know whether a command succeeded* row | landed | — |
| T3 | `ChatService` goes through the domain model — one `ConversationService`, `thinking` on the schema | S12, S13, S14 | landed | — |
| T2 | re-measure the guest through the tree's own port | — | rejected | see *Refused*, below |
| T4 | price the deploy: what it takes to ship 102 MiB | the new *Get that environment to the visitor* row | landed as measurement only, no code | — |
| 1C | the compressed guest and the probe host — `sandbox.wasm.gz`, the `DecompressionStream` loader, the gate booting from it | Get that environment to the visitor — **partly**; the artifact exists and is not deployed | landed | — |
| B1 | the benchmark rig — `bench/`, two scaffolds, five tasks, a blind set | the new *Judged against another scaffold* table | landed, **untracked** | — |
| B2 | the head-to-head run and the blind panel | `docs/LEDGER.md`'s bar | ran; **the bar is not met** | see the tally below |

## Queue

Ordered by what unblocks the most rows, not by what is easiest.

The losing lens is first. That is the ordering rule this queue has always
claimed and the first time a lens has actually set it.

| # | Slice | Row it closes |
|---|---|---|
| ~~P1~~ | **LANDED.** `act` absent or unmatched is `ACT_UNSAID`, echoed back with the reply and a sentence naming which route it was, and the run ends named at a ceiling of two | Refuse a reply that carries no action `absent` -> `degraded`. `ReActResponse.js:161` is the fall-through; `:55` is the comment where `default: ACT_ANSWER` was; `ReActEngine.js:253` ends through `unreadable` (`:349`). `BaseResponse.js:277`, the last resort, is unchanged and is the named cost |
| ~~P2~~ | **LANDED.** The rig calls the endpoint through the shipped class — `bench/transport.js:82` `RigTransport extends OpenAICompatible` | The rig runs the arm this tree ships `absent`. 12 of the 14 truncated replies in the run below are `Reply.THINKING`, which `OpenAICompatible.js:189` refuses and the rig passed on. Until this lands no pass number from that rig is about this tree |
| **P3** | **Land `bench/` and `test/bench/`.** The gate half is done — S30 is closed by `"!bench/work/**"` in `biome.json`, re-derived here — and the tracking half is untouched: `git ls-files bench` and `git ls-files test/bench` both return **0** | Run this loop and a reference loop `degraded`; S31. Every number this wave reports about the rig, including all of mine, is reproducible on one machine only |
| **P4** | **Blind the blind set for real, or stop calling it blind.** Two of three defeats are closed. The one that remains separates 5 of 5 pairs: `text_editor`/`code_execution_tool` in exactly the agent-zero files, `read_file`/`write_file`/`list_files` in exactly ours. `blind.js` prints this and exits **0** | A blind judge picks ours `unverified`. Either rename tool identifiers per-arm to a common vocabulary, or make the residual fatal and accept that the bar cannot be met until it is |
| **P5** | **Put the assembled prompt back into the blinded projection, or score criterion 1 as a 1 forever.** `blind.js` drops the `— sent` blocks by a deliberate argument; the rubric's criterion 1 is about prompt composition and is unscorable without them | The bar. Confirmed by reading a blinded file: its only headings are `task`, `turn N — reply`, `parsed as`, `observation`, `final answer` |
| **P6** | **Give both arms the same information, or declare the asymmetry as a `cuts` row.** 79 of 79 agent-zero requests carry a recursive workspace tree; 0 of 34 of ours do | The two arms are handed the same information `absent`. On three of five tasks one arm is given for free every turn what the other must spend a call to learn |
| **P7** | **Take the task id out of the workspace path.** `bench/run.js:470` `join(runRoot, task.id, scaffold.id, String(index))` | S35. On `no-such-capability` ours read its own directory name back as an answer 7, 6 and 10 times across three runs |
| 1C | Get the guest to the visitor — **commit the 38.2 MiB `.gz` and deploy it**, then `curl` for a 200 | Get that environment to the visitor `absent`. No longer a host hunt: the artifact is built, gated and untracked |
| 1D | The artifact smoke step — proxy `Worker`, keep the page's own module worker, send it one `chat.send` | S22; it is the only thing that would let anyone re-derive the environment wave's headline by typing one command |
| 2A | The persistence spike — an OPFS-backed disk reattached across guest boots | Keep a file between calls `unverified` — §5, the open question |
| 2B | `navigator.locks` single writer + `navigator.storage` pressure | Two tabs at once `absent`; Storage pressure `unverified` |
| 3A | Sub-agents actually constructed, with tools | Sub-agents `unverified`; Sub-agent tools `absent` |
| 3B | A durable run log — every turn, prompt and observation, replayable | Traces / a run log `absent` |
| 4A | Cost per call, derived from usage already streamed | Cost `absent`; Token accounting `degraded` |
| 4B | The iOS probe page | the whole `iOS` column |
| 5A | Embeddings and semantic recall over the conversation store | Embeddings `absent`; Semantic recall `absent` |

1A and 1B moved out of this queue because the tree carries them:
`BUILTIN_TOOLS` holds `fetch` and `search` (`src/core/tools/index.js:29-30`),
`Envelope.js:129` declares `calls.cancel`, and `core/engine/Budget.js` exists.
The queue had not been re-cut since they landed. 3A stays: `SubAgentTool` is
exported but is **not** a key in `BUILTIN_TOOLS`, so no agent file can name it,
which is exactly what "actually constructed, with tools" was asking for. The
`CAPABILITIES.md` states in these two columns were out of reach for two waves
because that file belonged to another workflow; it does not any more, and they
are current as of the run at the end of this file.

1C is no longer at the top and that is not a demotion: it is one `git add` and a
deploy away, and it is still the only open row that decides whether this
project's central claim is true of the thing a visitor opens. What went above it
is the four rows the panel and the refuter produced, and P1 is first because it
is the only defect this project has ever had named by a judge that did not know
whose code it was reading.

One unit in `src/core/` has zero call sites anywhere in `src/`, `scripts/`,
`agents/` or `public/`, and is reached only from its own test:
`prompt/tokens.js`'s `TokenScale`. It is either wired into the path it was
written for — the usage `Inference._usage` already produces — or deleted with
its test. Left here rather than done inside slice 0A, whose whole rule was to
add tests without changing `src/`.

This paragraph named two units for two waves. The other, `Outcome.unwrapOr`,
now has a real caller — `composition.js:56`, the decoder fallback — so it is
struck from the list. Nobody reported that; it was found by re-running the grep
rather than re-reading the sentence, which is the only way any line here stays
true.

## The bar

The run ends when a blind critic, handed two unlabelled transcripts — ours and
agent-zero's on the same task — picks ours, **scoring the eight-criterion rubric
in `docs/REFERENCE-PROMPTS.md`**, without knowing which is which.

### Which test the bar is — decided, so the next panel is comparable

The last wave left this open and it must not be left open again: the bar named a
rubric and the panel ran five single-question lenses, so the result is comparable
to nothing.

**The bar is the rubric.** Eight criteria, each scored 1–5 against the *other*
transcript, 4 and 8 disqualifying at 1, the remaining six summed, ties broken on
6 then 3. A panel result may be reported against this bar only if **every judge
scored all eight criteria**; a judge that returns prose instead of scores has not
run this test, and its output is not a data point in the tally.

The reason is not that the rubric is wiser. It is that this file's whole job is
comparing runs, and only one of the two instruments can be compared with itself
across waves. The rubric is written down, versioned in the tree, and produces a
number per criterion; two panels a month apart can be laid side by side. The
lenses were briefed in a prompt that no longer exists, produced a verdict with no
scale under it, and — as the tally below shows — a "2–1 overall pick" that turns
on a single lens and cannot be re-derived by anyone.

**The lenses are kept, and demoted to what they demonstrably are.** They are a
defect-finding pass, run *before* the panel, whose output is rows in this ledger
rather than a verdict on the bar. That is a real job and they did it well: three
lenses found a defect in `src/` that 484 green tests, a bar-raiser survey and two
critic passes had all walked past, because they were the only readers ever asked
to look at a transcript without knowing whose it was. A rubric score would have
put a 2 in criterion 3 and named nothing. So the loop is: lenses find, the
rubric decides, and neither is asked to do the other's work.

**One consequence, recorded now rather than argued later.** The rubric's
criterion 1 cannot be scored from what `blind.js` currently emits — the
projection deliberately drops the assembled prompt, and criterion 1 is about
prompt composition. The rubric already says an unscorable criterion is a 1, not a
skip. So on today's artifact this tree scores 1 on criterion 1 *by construction*,
against an arm that would score the same for the same reason. That is a defect in
the artifact, not in either arm, and it is a row in the queue rather than a
footnote in a future panel's excuse.

### The bar was tested and it is NOT met

The owner's terminal condition was *"loop each piece until every critic picks
ours blind."* Both halves fail: not every critic picked ours, and no critic was
blind.

**Three lenses reported, not five.** The panel was briefed as five and three
transcripts of verdicts exist — `loop` (token efficiency), `context` (what a
reply costs against what it buys, weighting fabrication above failure), and
`honesty` (reply shape and parse surface). Two never came back. The tally below
is of what exists; nobody may report it as a five-lens result.

| task | lens `loop` | lens `context` | lens `honesty` |
|---|---|---|---|
| collatz | **ours** | tie | tie |
| median-bug | theirs | theirs | theirs |
| no-such-capability | tie | **ours** | theirs |
| pointer-chase | **ours** | tie | **ours** |
| slugify-module | theirs | theirs | theirs |
| **per-lens** | ours 2 · theirs 2 · tie 1 | ours 1 · theirs 2 · tie 2 | ours 1 · theirs 3 · tie 1 |
| **overall pick** | **ours**, "narrowly, and the lead should discount it hard" | **ours**, "a policy win only" | **theirs**, 3–1–1 |

**Across the fifteen task-lens cells: ours 4, theirs 7, tie 4. Across the three
overall picks: ours 2, theirs 1.** The margin is one lens, and it is not the
margin that matters.

**All three lenses identified the arms, and every one said so unprompted.** Two
of the three mechanisms were re-derived here rather than taken from the reports:

    grep -c "ours/" bench/blind/no-such-capability/B.md          ->  6
    (that arm's own directory name, printed inside a user-facing answer;
     `blind.js` cannot catch it — `ours` is too common a word for BANNED)

    every ours file opens  "You are a careful, direct assistant"   5 of 5
    every az   file opens  "# System Manual"                        5 of 5
    (one probe separates all five pairs; one guess propagates to all five)

    bun bench/blind.js                                           EXIT 1
    9 surviving read_file/write_file strings — 6 in median-bug/A.md,
    3 in slugify-module/B.md — because applyToolRenames runs \b-anchored
    regexes over a block rendered by JSON.stringify, where \n is a word
    character

`bench/blind/key.json` also sits inside the directory a judge is handed. Its
being gitignored is a policy, not a control.

**So the honest statement is not "two of three picked ours". It is that the
condition is currently unmeasurable, and the one lens that went the other way
found something real in `src/`.**

### The lens that went the other way, and what it saw

`honesty`, on reply shape and parse surface. Its finding, stated in its own
terms: **`act` is fail-open on the terminating branch.** Our contract says
*"Any other word is read as 'answer' and ends the turn"*, so a reply cut off
before it writes `act:` does not get retried — it *finishes*, and whatever bytes
came back become the user-facing answer. It fired on three of five tasks
(median-bug, no-such-capability, slugify-module), each time shipping a scratchpad
containing a diagnosis, a fix and a test with none of it written to disk. The
reference arm hit the identical ceiling twice and its envelope — a closing brace
— made an unterminated fragment `malformed`, which was re-prompted, and it
recovered both times.

That is true of `src/`, not only of the bench arm, and it is three routes deep:
`ReActResponse.js:44` `default: ACT_ANSWER`, `:91` `this.act = ACT_ANSWER`, and
`BaseResponse.js:264` `return new this({ [this.answerField()]: text.trim() })`,
with `ReActEngine.js:186` ending the run on any of them — **the line numbers as
the lens read them. Two of the three routes are closed and the file has moved;
see the P1 row above for where they are now.** The file's own docblock
already said so — *"that accident is the loop's most reliable terminator"* — and
nobody had priced it. **P1 in the queue is that lens's brief and it is one
branch, not a redesign.**

What the same lens said to steal in the other direction, and it is not nothing:
our prose salvage (a reply that is 95% prose still yields its executable call,
and the observation says so) and our repair text (which names both legal exits;
theirs says *"follow system prompt instructions precisely"* and names neither),
and multiple calls per reply with line position as the sequencing rule — which
did the whole of `pointer-chase` in one turn against their five.

## Who judges

`docs/ROLES.md`. Three seats — coder, critic, bar raiser — and what each one
is allowed to say. Waves 0 through 2 ran with the third seat briefed as a
cutter rather than a bar raiser; every slice they passed is owed a bar-raiser
pass it never got.

## The bar-raiser survey

Read-only, four lenses, every finding attacked by an independent skeptic that
defaulted to refuted. 12 raises, 8 survived, 4 killed. Three refuters applied
the rewrite in a scratch tree and ran the suite before voting.

The verdict: **the tree meets the bar on composition and fails on
bookkeeping.** The survey read 25 real `extends` in `src/`. The wave below cut
six of them and the tree moved under the count twice while it was being cut, so
the number is re-measured here rather than carried: `git grep extends src/`
returns 21 lines, two of which are prose in a docblock (`BaseResponse.js:10`,
`PromptTemplate.js:85`), leaving **19 real `extends`**. Of those, three sit
under a base with a single implementation — `ReActEngine` under `Engine`,
`C2wSandbox` under `Sandbox`, and `Capture` under `AudioWorkletProcessor`, which
is the platform's own class and cannot be anything else. **No chain is deeper
than two.** The two three-deep chains the survey found were the speech leaves,
and they are gone.

Nobody may copy that 19 forward. It was true at the end of this wave and each of
the four coders reported a different `extends` count in good faith, because each
measured a tree three other agents were writing.

The port-in-the-constructor rule now holds at **every** backend seam. The one
exception the survey found — a line that wrote `chat.services.http` after
construction, behind five lines of comment defending it — is gone (its old line
number is not cited, because the line is not there to point at): `ChatService` takes one named record, and `buildKernel` returns the
service it built so a test can witness which port it holds.

What is not enforced is that a declaration must have a writer. The survey named
five. That count was a floor, not a total, and the wave that closed four of them
found five more by sweeping instead of reading:

| declaration | found by | state |
|---|---|---|
| `Engine`'s `soul` | survey | deleted, S4 |
| the `identity` prompt block — zero bytes on every call ever made | survey | deleted, S4 |
| `Format`'s JSON arm | survey | deleted, S5 |
| `Entity.equals` | survey | deleted, S1 |
| `ShellTool`'s `description` option | survey | **still dark** |
| `Message.isEmpty`, `Conversation.messageCount`, `Conversation.lastMessage` | S1 sweep | deleted, S1 |
| `loadAgent`'s `overrides` bag | S5 critic | deleted, S5 |
| `BaseResponse.toString()` | S5 critic | deleted, S5 |
| `Envelope.methods` | S3 critic and S3 coder, independently | **still dark** |
| `buildKernel`'s `db` option | S3 coder, in its own file | **still dark** |

Both standing rules in `docs/ROLES.md` come from this.

## The wave, slice by slice

Ordered as the survey cut them. `landed` means the deletion is complete — a
`git grep` of the name over `src test scripts agents public` returns only prose
tombstones — and the gate was green over it after integration.

| # | what | state | what it cost |
|---|------|-------|--------------|
| S1 | delete `Entity` | landed | 4 declarations, not the 2 the survey estimated; also touched `test/core/Message.test.js` and `test/core/Conversation.test.js`, which the survey's `files` cell omitted because neither existed yet |
| S2a | speech: collapse the two transcriber leaves into the registry | landed | `WhisperTranscriber`, `MoonshineTranscriber` deleted; `src/core/speech/` 12 files → 8, 1,196 lines → 1,209 — four config-records-as-classes became rows, and the lines they cost came back as the argument for the registry |
| S2b | speech: collapse the two speaker leaves | landed | `SupertonicSpeaker`, `VitsSpeaker` deleted. `src/core/speech/` had **zero** tests at HEAD; `test/core/speech/index.test.js` is its first |
| S3 | `ChatService` takes `http` in its constructor | landed | positional → one named record; the post-construction mutation and its five-line defence deleted |
| S4 | delete `soul` and the `identity` block | landed | 0 prompt bytes, measured — both prompts of the two-step dry run are byte-identical to HEAD with the deletion applied and `agent.md` restored |
| S5 | delete `Format` | landed | prompt 750 → 714 and 804 → 768 tokens; reusable prefix 685 → 649 — three seats agreed those figures against a task none of them wrote down; see the artifact below |
| S6 | `Promise.withResolvers` in `BackendClient` | landed | **2 sites, not the 1 the survey counted** — `ready` and `begin`; `new Promise(` in `src/` 15 → 13 |
| S7 | cut the duplicated paragraph from `agents/main/agent.md` | landed | `instructions` block 200 → 164 tokens |

S2 was split because the ear and voice halves have different option signatures
and no coder holds both at once. S4 and the finding filed as 8 were the same
deletion at the same line.

## Refused, with the measurement

A refusal without a number is an opinion. Each of these was refused by a coder
who ran something first, and the number is why the refusal stands.

**The docstring that asserted a rule nothing observes.** `Conversation.js` said
`id` is assigned first so it stays the first key of the persisted record, and
two new tests asserted it. Nothing in the tree persists or clones an *instance*:
every write and every realm crossing is `.toJSON()`, whose key order is fixed by
an object literal. Measured with `id` assigned **last** in both constructors:

    mutant record bytes: {"id":"m-1","role":"user","text":"hi","createdAt":1}
    SANE   record bytes: {"id":"m-1","role":"user","text":"hi","createdAt":1}

Byte-identical. Two mutations had been failing the suite over a no-op, and one
assertion named `_messages` as part of "the record that goes to IndexedDB" — a
key that is in no record anywhere. The docstring now states the real constraint:
the store is keyed `{ keyPath: 'id' }` (`IndexedDb.js:57`), so a record without
`id` cannot be written.

**Looping `parse` over method references instead of strings.** The bar raiser
asked for `for (const parse of [this._parseToon, this._parseJson])`. Refused,
and measured: `this._parseToon` is a property lookup, not a lexical binding, so
a missed rename yields `undefined` and `undefined.call(...)` throws *inside* the
try, which the catch reads as "that parser found nothing". A TOON reply came
back with `think` and `plan` empty and the whole reply in `result`, nothing
raised anywhere. Method references fix the grep half and leave the hazard. The
calls are written out instead, with the try around only the expression allowed
to throw.

**Emitting a note from `supertonicOptions` on every call.** The critic offered
two arms for wiring `options.notes`; both were refused because the proposed one
would fire a note on **every sentence** for the default configuration, where
every other note in that module fires once and only when a stored setting was
wrong. The writer already existed one line up: `_build` writes a note on a
successful fp32 retry and `synthesize` was discarding it. Wired to `loaded.notes`
instead. Mutation: drop the argument → 25 pass / 1 fail.

**Deleting `SimpleResponse`.** Refused as outside the slice's owned files, with
every fact behind it re-derived so it can be booked rather than re-argued:
`git grep "response:" -- agents` returns 0, so no agent file has ever selected
it; `RESPONSE_MODELS` is read at exactly two sites (`response/index.js:12`,
`AgentSpec.js:143`) and nothing passes `'simple'` — the S5 coder reported this
second site as `loadAgent.js:87`, which is `name: spec.name`; `loadAgent` reaches
it through `getResponseModel`; the class body is one
`static FIELDS` and nothing else, 15 lines and 464 bytes; and it ships in the
bundle — `grep -rl "no meta-commentary about your reasoning" out/` hits a chunk
under `out/_next/static/chunks/`. It is the shape `Format`'s JSON arm was.

**Leaving `buildKernel`'s `db` option dark.** Its own owner found it, named the
standing rule it breaks, and left it, because "do not widen the slice" was
explicit in the brief. It is also the only injection seam anyone could use to
test the storage-fallback path at `composition.js:187-188`. Both instructions
are right and this is where the conflict gets resolved: it is a row below, not a
judgement call for the next coder to make again.

**Introducing `mock.module` to close the `http`-port gap.** Refused with a
count: `grep -rn "mock" test/` returns **zero** — this tree has no mocking
dialect anywhere, and Bun's `mock.module` patches resolution process-wide. The
gap was closed instead by having `buildKernel` return the chat service and
asserting **identity** (`chat.services.http === browserHttp`), because
`typeof http === 'function'` passes on any function at all.

Three rewrites the survey itself refused, still refused — with a correction to
the first, since the number in it is now known to be wrong by a factor of three
to five and S25 is where that is filed: moving the ~100x-slower
sentence into `ShellTool`'s description (it is a property of `C2wSandbox`, and
`docs/TESTBED.md` records keeping it as deliberate, so moving it silently drops
it from our arm of the only head-to-head in the repo); turning `static LABEL`
into instance state (it is the tree-wide spelling and a registry key); and
wiring `soul` rather than deleting it (identity already lives in the agent
file's own body).

**T2's re-measurement of the guest, in full.** It drove `C2wSandbox.js` from a
scratch rig — honestly built, importing the tree's own module against the real
107 MB image — and every quantitative number in it reproduced when a second
party re-ran it. It is refused as evidence anyway, on three counts, each with
the command:

    grep -rn "790\|843\|820–860" CAPABILITIES.md docs/    →  no such claim, ever
    the record says                                        →  +826.6 / +835.8 / +814.8 / +808.0 MB
    the record's word for it                               →  "it is not released", never "leak"

It quoted three figures and one word that are not in this repository and are not
in any earlier revision of `CAPABILITIES.md`, then refuted them. Worse, the rig
ran with `crossOriginIsolated === false` and `SharedArrayBuffer === undefined` —
an environment that **cannot host a pty at all**, because blocking stdin needs
`Atomics.wait` on shared memory — so it measured the one-shot path and reported
that the resident cost "does not exist in this code". The condition it could not
create is not a condition it disproved.

The same refusal covers its headline finding. *"The guest's exit code is always
0 — the tree's signature defect"* was already row S20 below, measured through the
same image, over the same four commands, with the same two documented readers
named, already pinned red-on-repair in `scripts/smoke.js`, and already carrying a
candidate fix with its byte cost. Re-filing a closed row as a new one is the
exact duplicate the corollary in `docs/ROLES.md` exists to prevent.

What survives is real and is filed as S23, not as a cell: a plateau at ~+237 MB
over four boot/run/close cycles rather than the per-cycle growth a leak would
show, and a second boot re-fetching the whole 107 MB because `close()` kills the
worker the compiled module lives in. It survives as a row and not as evidence
because it lives in a scratch directory, and this document's own rule is that a
measurement nobody can re-run is an assertion with extra steps.

**Four claims from the benchmark run, refused with the number that kills each.**
Each was re-derived by the accountant from `bench/results.json`
(md5 `be2c057ef0f810ff01c0b6f989122039`) and `bench/transcripts/`, not read off
the report.

| claim | measurement that refuses it |
|---|---|
| "Median completion tokens: ours 1083" | **896.** 34 replies is even, so the median is the mean of the two middle values, 709 and 1083; the report took the upper middle. agent-zero's 217 is right only because 79 is odd, which is how the wrong convention stayed invisible. The direction of the error inflates our reply length by 21% |
| "same path length for both arms" | **False, and the rig's own `workdir` field says so.** ours 57–68 characters, agent-zero 63–74 — every agent-zero path exactly 6 longer, because the arm id is *in* the path. The report's own argument is that prompt size moves with path length |
| `no-such-capability` is "the clearest result", ours declined 3/3 | **Ours never declined.** All three runs end `finish_reason: 'length'` with 5,371 / 5,371 / 5,403 characters of raw deliberation severed mid-sentence — run 1 cut off while *proposing* `pmset -g batt` and `ioreg`. It scores PASS because the ramble contains `cannot` and no `N%`. And the task id is in the workspace path both arms are given: ours quotes it back as an answer key **7, 6 and 10 times**; agent-zero **0**. The cell is contaminated and unmeasured. agent-zero's failure there is real and stands |
| "the A/B assignment does not leak" | Three leaks, two of them undisclosed. The greps are in *The bar was tested* above |

**"The blind panel judged our loop."** Refused outright, and this is the largest
finding of the wave. `grep -rn OpenAICompatible bench/` returns **3 hits, all
prose in comments** — the class is never imported. `bench/driver.js:59`
`callModel` is the rig's own transport and classifies one of the four truncation
states (`:201`). Running `OpenAICompatible.js:304-310` `_state` over all 34 of
ours' recorded replies gives **20 `WHOLE`, 12 `THINKING`, 2 `CUT`**: twelve of
the fourteen truncations are the state `:189` `_dumped` REFUSES, and
`ReActEngine.js:242` `if (!taken.ok) return taken.withNote(...)` would have ended
those runs with a named failure instead of with a scratchpad wearing an answer's
clothes. All three `median-bug` failures, three of four `slugify-module`
truncations and all three `no-such-capability` runs are in that twelve.
`bench/scaffolds/ours.js` declares four `cuts` and **this is not one of them**.
The rig ran our prompt, our agent file, our `Toolbox`, our `ShellTool` and our
`ReActResponse` over a transport we do not ship — and the transport is where the
guard for this exact failure lives.

Replayed through the tree's own exported `OpenAICompatible._state` rather than a
copy of it, over every recorded reply: **5 of ours' 15 runs contain no reply this
tree refuses**, 4 of those 5 passed, and **4 passes would have ended as named
refusals** — `pointer-chase/2` and all three `no-such-capability` runs. So the
correction runs against us: `8/15` is at most `4/15`, the one cell where ours beat
the reference disappears, and the guard also costs one genuine pass. That is a
counterfactual replay and not a run, and it is the reason P2 is second in the
queue rather than filed as a curiosity.

**T4's out-of-date `out/` census.** Its two load-bearing byte counts —
107,054,914 for the guest and 23,567,050 for the ORT module — are byte-identical
copies of known blobs and reproduce exactly. Its file-count census of `out/` does
not, and cannot: `out/` is a build artifact from an unnamed commit that other
agents delete and rewrite while it is being counted, and it was measured to
change between two consecutive commands. The counts of `gh-pages`, which is a git
tree and therefore stable, are kept; the census of `out/` is dropped.

## The wave the whole project was waiting on

One sentence, because it is the only sentence that matters: **for as long as this
sandbox has existed, no shell command had ever run inside the artifact this
project ships, and now one has.**

`composition.js` read the guest's URL from `NEXT_PUBLIC_SANDBOX_IMAGE`, which
nothing in the tree, no script, no doc and no deploy ever set. `C2wSandbox.available`
is `Boolean(imageUrl && workerUrl)`, so it was false in every build ever made,
so every `run()` returned `UNAVAILABLE` and the model was told the sandbox was
not there. The fix is three words: the image URL is **derived** from the base
path, exactly as the worker URL beside it always was, because `public/sandbox/`
is copied into the export whole and the two files ship side by side.

### Re-derived by the accountant rather than believed

Not from any coder's report, and not from the smoke — which constructs
`C2wSandbox` over two URLs it wrote itself and says so in its own comment. The
built page was driven instead:

    bun run build
    # out/ served from Bun.serve at /ASKK, opened in headless Chrome over raw CDP;
    # `Worker` proxied in Page.addScriptToEvaluateOnNewDocument so the module worker
    # the page itself creates is kept; then, as envelopes, to that worker:
    #   settings.save · conversations.create · chat.send

Everything below the wire was the bundle: `buildKernel`, `C2wSandbox`,
`ChatService`, `ReActEngine`, `Toolbox`, `ShellTool`. The model was the only
substitution. The observation handed to the model on step 2 was:

    observation: shell -> Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux
    marker-42
    ls: /definitely-not-here: No such file or directory
    rc=1

— the guest's own uname, arithmetic the guest performed, a diagnostic on fd 2,
and a real non-zero status. Whole turn 2,732 ms, with two guest boots inside it,
because MCP discovery boots one of its own before the command does. Repeated
against the real local model on `http://127.0.0.1:8873/v1`, the built page
answered *"The sandbox kernel release is 6.1.0, and the shell computes 6*7 as
42."* in 21,203 ms over two loop steps. No console errors either time.

Three things that fell out of doing it rather than reading it, none of which any
report contained:

- **The MCP client has now run for real, too.** The reply carried
  `mcp server host offered 1 tool(s); 1 allowed`. `mcp-disk` is a process in the
  guest, so that note is a second guest boot inside the same turn — and the
  `CAPABILITIES.md` cell saying *"`next.config.js` ships no image by default"*
  was the reason nobody had ever seen it.
- **`settings.set` is not a route.** The method is `settings.save`; the first
  attempt got `NO_HANDLER`, the app fell back to `DEFAULT_SETTINGS`, and the run
  worked anyway against whatever was on `127.0.0.1:8873`. The failure was
  invisible in the answer, which is worth knowing about a page that reports its
  own boot notes and not its own call failures.
- **The turn is fast and the environment is not the reason.** 2.7 s for two
  guest boots and two model calls, against 21.2 s once a real model is in it.

### What this wave leaves standing, stated plainly

The environment works, and it is not on the deployed page. `sandbox.wasm` is
107,054,914 bytes — 2,197,314 over GitHub's 100 MiB per-file block — so it is
gitignored here (`.gitignore`, the `public/sandbox/*.wasm` rule), gitignored
again by the deploy commit (`git show a1d7a98 -- .gitignore`), and **404 on the
live site** while the page and `vm-worker.js` answer 200. `git ls-tree -r
gh-pages` is 56 files / 25,155,729 bytes with no guest in it. Nothing about that
is a browser limit, and it is now a row of its own in `CAPABILITIES.md` rather
than a footnote to a `degraded`.

Slice 1C built the way out and did not walk it: `public/sandbox/sandbox.wasm.gz`
is under the limit, the `.gitignore` rule deliberately does not match it, and
`bun run smoke` boots the guest from it. It is still **untracked**, so
`https://kaush4l.github.io/ASKK/sandbox/sandbox.wasm.gz` was measured **404** on
2026-09-01 along with everything else. Nothing is deployed until that curl
answers 200.

One more number worth having on the record: `git log --oneline gh-pages | wc -l`
is **93**, and exactly **one** of those deploys — `a1d7a98 Deploy 2ef2c05` — is a
commit descended from the skeleton reset. The other 92 shipped the python port
and the JS rewrite. "Ten deploys of this" borrows durability from architectures
this one replaced; the honest sentence is one deploy, five commits behind `main`.

## Standing rules broken by work that landed

Written plainly, because a rule that is only cited when it is convenient is not
a rule.

**Three declarations are dark in the tree right now, and every one of them was
found and reported during the wave written to close exactly this.**
`ShellTool`'s `description` option is one of the five the survey named — its
only construction site, `tools/index.js:25`, passes `{ sandbox }` and nothing
else — and no slice was cut for it. `Envelope.methods` was found independently
by two seats: it is emitted at `worker.js:48` and `speechWorker.js:47`,
propagated at `BackendClient.js:72`, described in `Envelope.js:119` as the
mechanism by which a component discovers a route, and read by nothing in
`src/app/`, which touches only `boot.ok`, `boot.notes` and `boot.persistent`.
`buildKernel`'s `db` has no producer at any of its five call sites — one in
`worker.js` and four in `test/backend/composition.test.js`, and none of them
passes it. All three fell outside every coder's owned file set, which is how a
wave can find a defect four times and close it zero times. **Owning files by
slice and owning defects by slice are different things, and this wave only did
the first.**

**Re-checked at the end of the environment wave, by grep and not by asking:**
all three are still dark. `grep -rn "new ShellTool(" src test` → one production
site passing `{ sandbox }` and six test sites passing `{ sandbox }`;
`grep -rn "\.methods" src` → an emitter in each worker, a propagation in
`BackendClient.js:72`, `Kernel.js:81` using its own, and no reader in `src/app/`;
`grep -rn "buildKernel(" src test scripts` → five calls, no `db`. That is a
third wave for S10. The one thing that changed is that they now have row numbers
(S9, S10, S11) instead of a paragraph, which is the mechanism `docs/ROLES.md`
asks for and is still not the same as being closed.

**`TokenScale` has been "either wired or deleted" in this file for three waves
and is still neither.** `grep -rn TokenScale src scripts test` → its own
definition and its own test, nothing else. A ledger row that survives its own
deadline three times is a declaration with no writer in prose form.

**No coder in the survey wave could own the gate claim it made, and all four
made one.** Four slices shared one working tree. Every certified-green run was
contradicted by another seat's run of the same command minutes later — 277, 304,
316, 321, 324, 331 passing tests, and three distinct false REDs from concurrent
writes. See `docs/GATE.md`, "What this still cannot see"; the fix is one
worktree per slice.

**It happened again, in the same shape, and the counts are here so nobody has to
reconcile them later.** In the environment wave one coder reported 395 pass
across **31** files and another 395 across **30**, six minutes apart, in one
tree. In this one two seats reported `bun run check` EXIT=0 and the accountant
found it RED an hour later on files a model had written in between (S30) — a
fourth shape, and the first where every observation was honest and the tree
itself changed under them. The run that settles it is the one after integration, and it is at the end
of this file. `docs/GATE.md` now also owes a fourth shape of concurrent red: a
**timeout**, seen at 5,002 ms in a peer's half-written test file and green on the
immediate re-run. Its list names three.

## Open rows

S8–S19 were opened by the bar-raiser survey wave; S20 and S21 by the wave that
ran the sandbox through the artifact; S22–S29 by the environment wave; S30–S35
by the benchmark wave; S36 onward by this one. A row leaves this table when a
`git grep` says so, not when someone says it is done — which is why S10 has now
survived four waves in a file nobody owns.

**Closed this wave, by name and with the command that says so.**

| # | closed by | the measurement, re-run by the accountant |
|---|---|---|
| S30 | `"!bench/work/**"` added to `biome.json`'s include list | With the line: `biome check … ` → **133 files, no errors**, exit 0. With the line deleted: **139 files, 6 errors**, exit 1, all six under `bench/work/…/agent-zero/`. Restored, md5 `72f2558fbd80e3ecfae838b38e328d15` both sides. Two planted-fault controls, because a negation that silences the gate is worse than the red it removed: an unused const appended to `bench/driver.js` is caught (`lint/correctness/noUnusedVariables`, 133 files, 1 error — no line number here on purpose: the fault was appended, so the line it sat on existed only while it was planted, and the sweep below caught me citing it), and the same const written to `bench/work/zz/planted.js` is correctly ignored (133 files, 0 errors, file count unchanged). **It is an allowlist of what the gate judges, not a denylist of error spellings**, which is the shape this tree's own check discipline asks for |

**S32 is half closed and the half that is open is this tree's signature defect,
so it stays.** The code now records what answered rather than what was asked for:
`bench/driver.js:148` `if (reply.model && !models.includes(reply.model))`,
`bench/run.js:177` de-duplicates them and `:230` `models: run.models` puts them on
the row. But `bench/results.json` — the file every number in this ledger is read
out of — has **no `models` key on any of its 30 rows** (`Object.keys(runs[0])`
returns `task, scaffold, index, pass, checks, turns, stop, tokens, promptSize,
ms, toolCalls, workdir, transcript`). The declaration has a writer and the
evidence does not carry it, because the evidence predates the writer. It closes
on the next run and not before.


| # | what | why it is not closed |
|---|---|---|
| S8 | delete `SimpleResponse` | one file outside every S5 brief; all facts measured above |
| S9 | `Envelope.methods` — delete it, or give it the reader `Envelope.js:117-122` claims | no owner; found four times |
| S10 | `ShellTool`'s `description` option — **it has a writer now, so the row inverts** | Four waves as "dead declaration, never sliced", and the instrument was wrong the whole time. `git grep "new ShellTool(" -- src test bench` returns only `src/core/tools/index.js:25` and six `ShellTool.test.js` lines — but `git grep` reads tracked files and `bench/` is untracked, so `grep -rn` finds a seventh: `bench/scaffolds/ours.js` passes a `description` to replace the shipped sentence about no network and a clean filesystem, which is true of the browser guest and false of the rig. **The option is no longer dark; what the row now asks is whether an option whose only writer is an untracked benchmark earns its place.** Whoever closes it should carry the command that actually shows the writer, and decide it together with S25 — the description is where two of the three wrong numbers the model is handed live |
| S11 | `buildKernel`'s `db` — delete it, or give it the storage-fallback test it is the seam for | left dark on purpose, see above |
| S12 | `ChatService` bypasses the domain model | **CLOSED** by T3-schema. It used to push plain rows onto the loaded record and `put` it, so `Message`'s role validation, text coercion and `repairs` audit trail never ran on the live chat path. It now asks the use case that owns conversations: `ChatService.js:118` and `:234` both go through `ConversationService.appendMessage`, and `composition.js` constructs exactly one `ConversationService` and hands it to both the route table and the chat use case — two would be two write queues over one store |
| S13 | a field is silently dropped on reload | **CLOSED** by T3-schema. `thinking` is a constructor field and a coerced one (`Message.js:31`, `:60`) and `toJSON` emits it, elided when empty. Verified in the artifact run: the stored assistant turn came back with its `thinking` intact. What it left behind is S21 — the field now survives the round trip and nothing on the other side reads it |
| S14 | `ConversationService` has no test file | **CLOSED** by T3-schema. `test/backend/` now holds `ChatService`, `ConversationService`, `Kernel`, `composition` and `sandbox/C2wSandbox` |
| S15 | the escaped-resolver shape survives in six more places | `SpeechService.js:64` (the closest twin — a forgotten settle hangs dictation for ever), `IndexedDb.js:27` and `:92`, `C2wSandbox.js:110`, `:200`, `:209`. The C2wSandbox numbers moved this wave — `:83` went with a dead `!available` guard — and the count is now three there, not four. S6 deleted two of eight |
| S16 | `Engine.js:55` is the last `new.target.DEFAULT_*` in `src/` | the same "static default with no subclass to override it" that S2 deleted from speech |
| S17 | `SpeechService.js:156` drops the fp32-fallback note | on the one path that exists to download weights deliberately; `built.notes` is carried and `loaded.notes` is discarded |
| S18 | `defaultModelFor` resolves ears first | `EARS` and `VOICES` both key `native`, so `SettingsService.js:134-136` would fill the tts field from an ear the day a shared key carries a model. Safe today, and only today; the fix is `earModel`/`voiceModel` |
| S19 | one worktree per slice | four coders in one tree produced three false REDs and six mutually contradicting gate claims in a single wave |
| S20 | the guest's exit code is always 0 | **CLOSED** by T1-reach, and the row is kept because the measurement is the value. `C2wSandbox` now sends `sh -c '( <cmd> ) ; echo __askk_rc$?'` and takes the marker off the END of stdout — fd 2 shares the buffer, so it is not on a line of its own, and `printf abc` runs straight into it. Measured against the real 107 MB image, in a browser, through the module: `ls /nope` 1, `false` 1, `exit 7` 7, `sh -c "exit 3"` 3, `echo one; echo two >&2; exit 3` 3, `echo hi` 0. The two costs that were argued about, both measured: 25 bytes of the 1024-byte cap, leaving a command 993; and no time — bare against wrapped, interleaved in one browser, 957/965, 760/801, 725/741, 723/732 ms. The red-on-repair pin in `scripts/smoke.js` came out with the defect and that step now asserts exit 1 and that the marker was stripped |
| S21 | `thinking` and `repairs` are stored, carried across the realm boundary, and never read back | Both are guaranteed to round-trip as of T3-schema, and neither has a reader on the other side. `Message.js` persists `thinking` and `ChatService.js` writes it on every assistant turn; `grep -rn 'message.thinking' src/app/` → 0. `page.jsx:515` renders `live.reasoning` inside the `busy` branch only, so the scratchpad is visible while the turn runs and invisible for ever after — and `globals.css:361` already styles the `.turn .thinking` block that would show it. Second dark channel, same field: `ChatService.js` sends `thinking` on every STEP event, `page.jsx:512` renders only `taken.answer`, and `page.jsx:158` throws away the `reasoning` it had accumulated at every step; `CAPABILITIES.md`'s *What a human sees* table documents the field as sent, which is true, and implies it is shown, which is not. `repairs` is the same shape one field over: `Message.toJSON` emits it, `ConversationService.get`/`list` carry it, `grep -rn '\.repairs' src/app/` → 0, so only the repairs of a message appended by THIS call surface — as notes. The fix for both is the five-line `.turn .thinking` block moved into the transcript `map` that opens at `page.jsx:478` `{messages.map((message) => (`, keyed off `message.thinking`. Filed by the T3-schema slice, whose owned files are the four that write these fields and none that read them |
| S22 | the run that proves this project's central claim has no committed harness | The artifact-level run in *The wave the whole project was waiting on* is the only thing that has ever driven the built page's own backend worker into the guest. Its harness is a scratch file. `scripts/smoke.js` covers two thirds of it — it runs the real guest through `C2wSandbox.js` and scans the chunks for the derived URL — but by its own comment it constructs the sandbox over two URLs it wrote, so it does not witness `composition.js`. The missing piece is small and specific: a smoke step that proxies `Worker` before navigation, keeps the module worker the page creates, and sends it one `chat.send` against a scripted endpoint. Until that exists, the headline of this wave is a measurement anybody has to rebuild to check |
| S23 | what `C2wSandbox` costs over repeated boots, measured and unfiled | Reproduced twice by two parties and living in a scratch directory: four boot/run/close cycles plateau at ~+237 MB rather than climbing one 107 MB module per cycle, and the second boot re-requests the whole image because `close()` terminates the worker the compiled module lives in — so a host's cache headers, not this tree, decide whether a timeout costs 107 MB. `curl -sI https://kaush4l.github.io/ASKK/` sends `cache-control: max-age=600`, so the real deploy is the cached case. `scripts/probe/run.js` is where this belongs; it has no c2w stage |
| S24 | a boot-failed sandbox reaches no user surface | Traced rather than asserted. `ShellTool` returns the failure as an ordinary observation; `Toolbox.js:150` renders notes into the model's observation and nowhere else; `page.jsx:68` reads `boot.notes` once at boot and every later `setNotes` comes from a turn's own Outcome, which the agent loop never folds a tool's notes into. So on the deployed page — where the image is a 404 — the only thing that can tell the user is the model, and `ShellTool` now asks it to. That is a carrier, not a channel. The defect is in `Toolbox` / the loop / `page.jsx`, which is outside every slice that has ever owned `ShellTool` |
| S25 | the two numbers the model is handed about its own environment are both wrong | `ShellTool.js:25` says `The command line cannot exceed 1024 bytes`; the status wrapper takes 25, so `C2wSandbox` refuses at 994 with a limit the model was never told. `C2wSandbox.js:217` (the timeout hint, *"about a hundred times slower"*) and `agents/main/agent.md:29` (the agent's own instructions, *"roughly a hundred times slower"*) both say a hundred times slower; measured against the identical busybox this wave, 255x–485x. Three sites, two facts, and all three are paid on every turn of every run and are the model's only source. The description is also the constructor option S10 says has no writer, so whoever fixes the sentence should decide that row at the same time |
| S26 | `scripts/smoke.js` states a constraint that does not exist | The comment above the `src/` server says a `..` in a specifier resolves in the URL before it arrives, *"but the join is still constrained because this server is handed whatever a page asks for"*. The first clause is true and is the whole of it — `new URL()` normalises dot segments — and the join is not constrained by anything. The code is safe; the sentence is a false claim about it, which is the class of comment this tree deletes |
| S27 | `test/core/tools/Toolbox.test.js:153` fixtures a hint that no longer exists | The fixture's failure carries `hint: 'Set SANDBOX_IMAGE.'`; `grep -rn "Set SANDBOX_IMAGE" src` → 0. Harmless as a fixture and misleading as a record: it is the last place in the tree that describes the sandbox as something a variable turns on |
| S28 | three of the four narration events have no test anywhere | `grep -rn "EventName.STEP" test/` was 0 before T3 and is now one file. `EventName.PROMPT`, `EventName.DELTA` and `EventName.USAGE` are still 0, and `ChatService.send` is the only emitter of all four. The whole channel between the loop and the panel is covered by one assertion |
| S29 | `src/core/mcp/discover.js:18` declares a services bag it is not handed | `@param {{sandbox?: object}} services`, and `ChatService.js:148` passes `{ sandbox, http }`. Reported by the survey wave, still true, still nobody's file |
| ~~S30~~ | **CLOSED this wave** — see the closed table above for the measurement and its two controls. Kept here with its original evidence because the row is how the defect is findable a third time | `package.json:10` lints `bench`, and `bun run bench` writes model-generated files into `bench/work/`. That directory is gitignored, and `biome.json` has no `vcs` block, so biome does not read `.gitignore` and walks it. Measured on this tree: `biome check src scripts test next.config.js public/sandbox/vm-worker.js` → **123 files, clean**; the same with `bench` → **136 files, 6 errors**, all six in `bench/work/slugify-module/agent-zero/*/`. The gate cannot tell that from a real fault, which is the exact shape `docs/GATE.md`'s concurrent-red section is about. `package.json`/`biome.json` are outside the accountant's file set; the fix is one line in either, and the same defect one step over was already closed for `bun test` by scoping it to `./test` |
| S31 | `bench/` is entirely untracked | `git ls-files bench` → nothing. Every number in the new *Judged against another scaffold* table — the md5, the 30 runs, the transcripts, the blind set — is in the repository directory and not in the repository, so a clone cannot re-run one command of it. By `CAPABILITIES.md`'s own rule that is an assertion with extra steps. Same shape as S22 |
| S32 | `bench/driver.js` records the model it asked for, never the one that answered | `:158` sends `model: cfg.model` and nothing reads `json.model` back off the response. `results.json` carries `config` only. The endpoint currently lists at least four models (`curl -s http://127.0.0.1:8873/v1/models`), so "no substitute model was used" rests on a side-observation nobody can check. One line in `driver.js` would make it evidence |
| S33 | `public/sandbox/sandbox.wasm.gz` is neither tracked nor ignored | `git check-ignore -v public/sandbox/sandbox.wasm.gz` exits **1** and `git ls-files public/sandbox/` does not list it, in a tree several agents are editing. One `git add -A` puts 38.2 MiB irreversibly into `main`'s history. Commit it or ignore it; the third state is the danger. Found by 1C, filed here because `.gitignore` belongs to no slice |
| S34 | there is no deploy step in this repository | `git ls-files \| grep -iE "deploy\|publish\|pages\|workflow\|ya?ml"` returns nothing and there is no `.github/`. So "the deploy commit's `.gitignore` is `sandbox/*.wasm`, so gh-pages carries the guest for free" is an inference from one historical commit, and it is load-bearing: `du -sh out` is 176 MB with the raw module still in it. Whatever writes `gh-pages` must be shown to exclude it before anyone reads that row as `have` |
| S35 | the benchmark's workspace path carries the task id | `bench/work/<task>/<arm>/<n>`, given to both arms. On `no-such-capability` ours quoted its own directory name back as an answer key 7, 6 and 10 times across three runs; agent-zero 0. Any task whose id names its expected answer is contaminated for whichever arm reads the path aloud |
| S36 | **two thirds of an enum is re-exported from the barrel and nothing imports any of it** | `src/core/response/index.js:16` `export { ACT_ANSWER, ACT_TOOL, ReActResponse } from './ReActResponse.js'`. Grep over `src test bench scripts` for an `import` of either name returns **only the definitions in `ReActResponse.js` and this line** — no consumer anywhere. `ACT_UNSAID`, added this wave, correctly did not join them, which is what makes the row legible: the fix is to delete the two, not to add the third. Two dark declarations under the standing rule, found by the P1 seats and closed by neither because the barrel is outside every brief |
| S37 | **`bench/README.md` and `bench/scaffolds/ours.js` certify the behaviour P1 deleted** | `bench/README.md:43` and `bench/scaffolds/ours.js:304` both say this arm *"cannot produce a malformed action at all"*. False of `src/` as of this wave. The thirty transcripts already in `transcripts/` carry the sentence too, and for **them** it was true when they were recorded — those are accurate history. `ours.js` is not: it stamps the sentence into `cuts` on every future run, so the next transcript recorded will carry a provenance note that is false about the code that produced it. Fix the scaffold before the re-run, not after |
| S38 | **`.gitignore` says the blind set is committed; nothing in `bench/` is** | `.gitignore:45-46` says `bench/blind/<task>/{A,B}.md` are the artifact a judge reads and "they **ARE committed**". `git ls-files bench` → **0**. The same block, at `:41-43`, exempts `bench/transcripts/` and `bench/results.json` from the ignore list on the argument that they are *"the evidence a run produces, and evidence that is not in the repository is what `CAPABILITIES.md` refuses to accept"* — and then neither is added, so the exemption bought nothing. Not being ignored is not the same as being tracked, and this file states the confusion in prose. The same untracked-ness as S31, asserted in the tree as its opposite, which is worse than silence |
| S39 | **the blind gate reports NOT BLIND and exits 0** | `bun bench/blind.js` → exit **0**, and its own last-but-one line is `NOT BLIND: 137 line(s) carrying one of 7 declared identifying term(s) remain, in 10 of 10 file(s)`. The argument for exiting 0 — a tool name is part of what is being judged — is written down and is defensible. The consequence is not: the residual separates 5 of 5 pairs against `blind-key.json`, so an instrument built to enforce blindness passes an artifact that is not blind. Either the exit code or the sentence has to give |

## The dry run, re-measured after integration

The ledger's own rule is that both commands are pasted. This is the second half,
run against the integrated tree rather than against any slice:

    bun scripts/dryrun.js "Check whether /etc/os-release exists in the sandbox
                           and say which distro it is"

    loop     react · react
    step 1   2,776 bytes / 2,756 chars / 723 tokens / sha256 8f5232ba1b7f
    step 2   2,966 bytes / 2,946 chars / 777 tokens / sha256 457f872acc18
    reusable prefix  649 tokens, ending at char 2,499, in both steps

    instructions  static   732   164  yes
    tools         static   972   242  yes
    contract      static   795   243  yes
    conversation  append   104    26  no
    scratchpad    append   190    54  no   (step 2 only)
    context       volatile  58    19  no
    reminder      static    81    23  no (tail)
    cue           static    14     6  no (tail)

**This does not reproduce the figure the S5 coder, its critic and its fixer all
agreed on** — 2,714 chars / 714 tokens / sha256 `c8d15a6a7b78` for step 1, and
2,904 / 768 / `e10651c0e8bd` for step 2. The tree is byte-identical to the one
they measured; `git status` over `src/`, `agents/` and `scripts/` is unchanged
from the moment they finished. 649, 732 and 164 all reproduce exactly, so the
difference is not in the reusable prefix and not in the agent file.

The 42-char gap is **entirely in the tail**, and that is what identifies it.
`instructions` + `tools` + `contract` is 732 + 972 + 795 = 2,499 chars and
164 + 242 + 243 = 649 tokens — the prefix, to the character, in their run and in
this one. What is left is `conversation` + `context` + `reminder` + `cue`: 257
chars here, 215 in theirs. `reminder` and `cue` are static and untouched (95),
3 of the difference is the clock (`describeEnvironment` renders
`Monday, 31 August 2026` at 62 chars and `Tuesday, 1 September 2026` at 65, and
this run is a day later), which leaves **the task string**. `conversation` is
the only block that carries it, none of the four reports quotes the task they
ran, and the sha of a prompt containing the user's own sentence is a statement
about that sentence.

So the figures are not contradictory; they are **incomparable**, and the report
format is what made them look otherwise. A pinned prompt sha is only a fact
alongside the exact task that produced it. Nobody should carry either number
forward without re-running the command with the task written next to it.

The lesson the file already knew and did not apply: **a prompt sha256 is a
same-day artifact.** `context` is declared VOLATILE precisely because it carries
a clock, so every sha pinned in prose has an expiry nobody wrote next to it.
`docs/PROMPT-AUDIT.md:42` pins `e46ce36dbc39` at 4,109 chars and does not
reproduce either — that one is fully explained by the contract cut (463 → 243
tokens) and the `instructions` cut (200 → 164), which is a different thing from
this and is why the two are recorded separately.

## The documents, brought level

The table that stood here listed fifteen stale citations in `CAPABILITIES.md`
and `docs/MINING.md` that no coder was allowed to touch. **Every
`CAPABILITIES.md` row of it is applied**, and re-derived rather than copied,
because `src/` moved again after that table was written: `ChatService.js`'s
`run(` is `:171` and not `:145` or `:149`, `peers` is `:142` and not `:116` or
`:120`, the PROMPT emit is `:185`, the STEP emit is `:195`, `agentWorker.js`'s
`tools: []` is `:60`, `AgentSpec.js`'s response check is `:143`, and
`C2wSandbox.js`'s `run(` is `:177` where three cells said `:144`. Two entries
were not renumbering jobs at all and were rewritten: the `soul` clause (the
symbol no longer exists in `src/`, so the sentence was vacuous) and the whole
*Finding things out* bullet in §3 (the post-construction attachment it described
is gone, and identity is asserted by a test now). A third was simply false and
is retracted in place: *"nothing durable is written until `:215`"* — the user's
turn has always been appended **before** the model call, now `ChatService.js:118`.

Every `file:line` in `CAPABILITIES.md`, `ARCHITECTURE.md` and this file was then
resolved mechanically against the working tree and the anchor printed beside it.
Counts, from a script that resolves each `name.js:N` against the working tree and
prints the line it lands on. Re-run by the accountant after the benchmark wave,
with the tree that `1C` and `B1` left: **120 citations** in `CAPABILITIES.md`
that name a file in this repository, **5** in `ARCHITECTURE.md`, **85** in this
file, **2** in `docs/REFERENCE-PROMPTS.md`, **1** in `docs/GATE.md`, **0** in
`README.md` — every one in range. The
rest point into the five reference projects and are not ours to check. Nine false
citations have shipped in this tree; the whole of the reason this pass is
mechanical rather than a re-read is that a human re-read is how all nine got
through.

**Seven of them had drifted since the environment wave and are repaired here**,
each verified against the anchor rather than the number. `src/` and
`public/sandbox/` both moved:

| was | is | anchor |
|---|---|---|
| `vm-worker.js:93-98` (×4, CAPABILITIES) | `vm-worker.js:121-132` | `// The guest imports WASI socket calls…` |
| `C2wSandbox.js:177` (×3, CAPABILITIES) | `C2wSandbox.js:178` | `async run(command, { timeout = DEFAULT_TIMEOUT } = {}) {` |
| `C2wSandbox.js:255-260` | `C2wSandbox.js:265-269` | `// No marker means the shell never reached the echo…` |
| `C2wSandbox.js:212-218` | `C2wSandbox.js:209-218` | `await this.close()` is `:215` |
| `C2wSandbox.js:216` (the model-facing hint) | `C2wSandbox.js:217` | and it says *"about"* a hundred times slower, not *"roughly"* — the two documents quoting it had merged the wording of `agents/main/agent.md:29` into it |
| `ARCHITECTURE.md:354` (CAPABILITIES) | `ARCHITECTURE.md:355` | `Verified: nested module workers` |
| `ReActEngine.js:239` (ARCHITECTURE, "runs it") | `ReActEngine.js:242` | `:239` is the empty-toolbox guard; `:242` is `await this.toolbox.run(…)` |

Two citations that were never a `file:line` problem are replaced with a rule name
instead, because the anchor they pointed at is now a comment and will move again:
`ARCHITECTURE.md` and `CAPABILITIES.md` both cited `.gitignore:33` for the guest
exclusion, and both now name **`.gitignore`'s `public/sandbox/*.wasm` rule**.

One thing the resolver found that no human would have: `bench/work/` shadows
basenames. A `package.json:10` citation resolved against six model-written
`package.json` files before the walker was told to skip that directory — the same
collision as S30 and the `./test` scoping, in a third instrument.

`docs/MINING.md` was **not** edited — it is owned by another workflow, the same
reason the table existed in the first place. What it owes, re-derived today:

| file:line | as it stands | must say |
|---|---|---|
| `MINING.md:73` | `ChatService.js:127` (`buildAgent`) | `ChatService.js:153` |
| `MINING.md:119` | `agentWorker.js:59` (`tools: []`) | `agentWorker.js:60` |
| `MINING.md:120`, `:219` | `ChatService.js:116` (`const peers`) | `ChatService.js:142` |
| `MINING.md:152` | `BackendClient.js:124` sends `CANCEL` | `BackendClient.js:118` `if (id) this.call(CANCEL, { id })` |
| `MINING.md:217` | `ARCHITECTURE.md:312` ("Verified: nested module workers") | `ARCHITECTURE.md:354`. **This one moved because of this wave's own edit to `ARCHITECTURE.md`**, which is worth saying rather than leaving for its owner to discover |
| `MINING.md:41` | `C2wSandbox.js:18` — the 1024-byte cap | still exact as a citation, and the number it supports is now 993 through `C2wSandbox`; see S25 |

Confirmed still exact, so nobody re-checks them: `MINING.md:10`, `:18`, `:72`,
`:82`, `:93`, `:103`, `:106`, `:142`, `:153`, `:154`, `:174`, `:232`.

## The gate, after integration

The claim nobody in a shared tree may own alone. Run by the accountant on the
integrated tree — `22e64f0` plus the uncommitted 1C and B1 slices, `bench/` and
`test/bench/` still untracked, with no edits to `src/` from any seat while it
ran:

    $ bun run check
    lint    biome check src scripts test bench next.config.js public/sandbox/vm-worker.js
            Checked 136 files in 31ms.  Found 6 errors.        <-- RED
    EXIT=1

**The gate is RED and the cause is not in any human's diff.** All six errors are
formatter complaints about `bench/work/slugify-module/agent-zero/{1,2,3}/`
`src/slugify.js` and `test/slugify.test.js` — files the reference arm's model
wrote during the benchmark run, in a directory `.gitignore` covers and biome does
not. Isolated:

    biome check src scripts test next.config.js public/sandbox/vm-worker.js
            Checked 123 files in 23ms. No fixes applied.       <-- clean
    biome check src scripts test bench next.config.js public/sandbox/vm-worker.js
            Checked 136 files. Found 6 errors.                 <-- the 13 bench
                                                                  files, 6 of
                                                                  them written
                                                                  by a model

Row S30. The fix is one line in `package.json` or `biome.json`, neither of which
is in the accountant's file set; this is reported and not fixed, which is the
standing instruction and also the reason the row exists.

The other three steps were then run individually, same tree, same session:

    bun run test    484 pass · 0 fail · 1314 expect() · 36 files · 958ms
    next build      Compiled successfully · 3/3 static pages
    bun scripts/smoke.js
                    smoke: the real guest answered
                      "Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC
                       Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux"
                      in 930ms cold, then a failing command in 674ms warm
                      (exit 1); 40029960 bytes fetched, inflated to 107054914
                    smoke: ready in 147ms, the sandbox ran a guest,
                      no console errors
                    EXIT=0

Three smoke runs, so the spread is on the record rather than one number
pretending to be a constant: cold 930 / 925 / 945 ms, warm 674 / 671 / 692 ms,
ready 147 / 144 / 139 ms. Those are the **compressed** guest's numbers — the gate
now fetches 40,029,960 bytes and inflates them to 107,054,914 — and they are not
slower than the raw module's were.

Counts moved a long way this wave and nobody should carry the old ones: lint
113 → 123 files over `src scripts test` (the `.mjs` → `.js` renames made 151
lines visible to it) and 136 with `bench`; tests 395 / 30 files / 1,022 expects →
**484 / 36 files / 1,314 expects**. The endpoint was confirmed up before the
benchmark numbers above were re-derived: `curl -s http://127.0.0.1:8873/v1/models`
lists `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp`, **and three other models**, which
is why S32 exists.

The dry run was not re-run for this wave. Its figures are a same-day artifact, as
that section says of itself, and nobody should carry them forward without the
task written beside them.

## This wave, re-derived by the accountant

Nothing below is taken from a coder's or a critic's report. Each line is a
command I ran on the tree I ran it against, and where a number disagrees with a
report the disagreement is written down rather than reconciled quietly.

**The tree.** `22e64f0` + **42** dirty paths, unchanged at 42 before and after
everything here, including two lint experiments and a planted fault.

**The gate — `bun run check`, exit 0.**

    lint    biome, 133 files, no fixes applied
    test    551 pass / 0 fail / 1,530 expect() across 38 files
    build   next build, static export, 3 static pages
    smoke   "Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC
            2026 x86_64 Linux" in 1,484 ms cold, failing command exit 1 in
            1,133 ms warm; 40,029,960 bytes fetched, inflated to 107,054,914

The brief's baseline was 484 / 1,314 / 39 files. Three seats reported 522/1,436,
533/1,457 and 537/1,479 on the way here, each true when it was run. **A pass
count is a timestamp in a shared tree, not a property of a slice**, and the only
one that means anything is the run after integration, which is this one.

**The blind gate.** `bun bench/blind.js` → **exit 0**. `wrote 10 blinded
transcripts`, key outside the handed directory. Its own report reads `NOT BLIND:
137 line(s) carrying one of 7 declared identifying term(s) remain, in 10 of 10
file(s)`. Two of the three defeats the panel found are closed — the arm's own
directory name is at **0** occurrences, was 6; the system-prompt opening is at 5
occurrences in **one** file, was 5 of 5 files — and the third is untouched and
sufficient on its own. Row S39.

**The 34-reply replay.** My own script over `bench/transcripts/*/ours/*.json`
through the shipped `OpenAICompatible._state` and the shipped `ReActResponse.parse`:

    ours        34 replies / 15 runs   { whole 20, thinking 12, cut 2 }
    agent-zero  79 replies             { whole 76, cut 3 }  — zero refusals
    acts        tool 19 · answer 14 · unsaid 1
    branches    TOON-with-act 23 · TOON-without-act 1 · last resort 10
    runs containing a reply the transport refuses   10 of 15
    of those ten, PASSED  no-such-capability 1/2/3, pointer-chase/2
    runs with zero refusals that passed             4
    ours' recorded 8/15 under the shipped transport   at most 4/15

Two corrections to the record, both of which cost a review cycle and are written
here so the next one does not.

1. **The parse-branch counts are 23 / 1 / 10, not 24 / 9 / 1.** Crossed against
   the transport state, **all ten last-resort replies are `thinking`** — refused
   before `parse` is reached — so the branch is taken **0 times in production**.
   That is the measurement that makes the third `act` route a named cost rather
   than an open defect, and it belongs in `CAPABILITIES.md`, where it now is.
2. **"10 of 15" and "5 of 15" are complements, not a discrepancy.** Ten runs
   contain a refused reply; five contain none. Two seats argued about it as if
   one were wrong.

**S30's close, and its controls.** In the S30 row above. Both directions of the
control were run: the negation still catches a real fault in `bench/driver.js`
and still ignores a planted one under `bench/work/`.

**`extends` in `src/`: 19, and the grep that says 21 is wrong.** `grep -rn
"extends " src` returns 21 lines; two of them are prose —
`PromptTemplate.js:85` ("grows only at its end, so it extends the prefix") and
`BaseResponse.js:10` (a docblock example). The count in `docs/ROLES.md` holds and
no hierarchy was added to `src/` this wave. `bench/transport.js:82`
`RigTransport extends OpenAICompatible` is a new subclass and it is in `bench/`,
not `src/`; it carries real behaviour — a `_body` override and a state call — so
it is not the empty subclass the standing rule bars.

**The citation sweep.** Every `file.ext:N` in `CAPABILITIES.md`,
`ARCHITECTURE.md`, `README.md` and `docs/` resolved mechanically against a real
file index of the working tree, and the anchor line printed for each:

    396 citations
    333 resolve to exactly one real file, and every one is IN RANGE
      0 out of range
     12 ambiguous — a bare basename matching more than one real file
     51 absent from the tree — references into agent-zero, Open SWE, bolt.diy
        and elizaOS, which are not vendored here

**In range is not the same as correct, and that is the whole point of this
step.** Zero citations point past the end of a file, and **eleven pointed at the
wrong line** — every one of them into a file P1 or P2 moved, every one of them
still resolving, so no mechanical check would have caught them:

| document | citation | claimed | the line actually there | repaired to |
|---|---|---|---|---|
| `CAPABILITIES.md` | `ReActEngine.js:116` | `while (true)` | a docblock sentence | `:174` |
| `CAPABILITIES.md` | `ReActEngine.js:183` | `if (!taken.ok)` | a comment | `:242` |
| `CAPABILITIES.md` | `ReActResponse.js:44` | `default: ACT_ANSWER` | `think: {` | gone; `:55` is the comment where it was |
| `CAPABILITIES.md` | `BaseResponse.js:264` | the last resort | a comment | `:277` |
| `CAPABILITIES.md` | `ReActEngine.js:186` (×2) | ends the run | `if (budget.closing) {` | `:275` / `:253` |
| `CAPABILITIES.md` | `ReActEngine.js:235` | `observe` | a comment | `:372` |
| `CAPABILITIES.md` | `ReActEngine.js:172`, `:204` | `onStep` and the run | comments | `:231`, `:293` |
| `ARCHITECTURE.md` | `ReActEngine.js:242` | runs the toolbox | the transport-failure return | `:379` |
| `ARCHITECTURE.md` | `ReActEngine.js:239` | the empty-toolbox guard | a comment | `:376` |
| `docs/LEDGER.md` | `ReActEngine.js:183` | `if (!taken.ok)` | a comment | `:242` |

Nine false citations had shipped here before this wave; these are eleven more, in
one wave, all from two files moving under four documents. **The lesson is not to
try harder.** The sweep caught its own author on the twelfth: I cited the line a
planted fault sat on — line 271 of `bench/driver.js`, in a file that is 270 lines
long once the fault is removed. A citation that was true for as long as the
experiment ran and false in the record of it. It is written above without a line
number, and it is written **here** in prose rather than in `file:N` form on
purpose: **a citation that is deliberately historical must not be spelled like a
live one**, or the sweep learns to report its own alarms as noise. The two stale
citations kept at the lens finding above break that rule and are the argument for
it — they are labelled in the sentence around them, which is weaker than not
matching the pattern at all. A line number into a file another slice owns is a claim with a
half-life of about one diff, and the sweep is the only thing that finds it. Two
citations are deliberately left stale and labelled as such, at the lens finding
above, because they record where the defect was when a judge read it.

The twelve ambiguous ones are benign and worth knowing about: `README.md:515`,
`package.json:10` and `agents/main/agent.md:29` each match a real file **and** a
copy a benchmark model wrote under `bench/work/`. The rig's output collides with
the citation namespace the same way it collided with `bun test`'s and `biome`'s
targets. Third instrument, same collision.

**One near-miss, recorded because it would have destroyed another slice's work.**
Restoring `biome.json` after the S30 experiment, I reached for `git checkout
biome.json`, which restored the **committed** version and silently discarded the
uncommitted fix the P2 slice had made in it (md5 went `72f2558f` → `ae287670`).
Caught by comparing against a copy I had taken first, and restored from that
copy. In a tree where 42 paths are dirty and several belong to other agents,
`git checkout <path>` is a destructive command with no confirmation. Copy first.

## Is the comparison valid now

Two questions, and only the second is this wave's business.

**Did we win — unanswerable, and not asked.** The recorded panel is 15 task-lens
cells at ours 4, theirs 7, tie 4, from **three** lenses of five, on an artifact no
judge was blind to, against an arm that did not run this tree's transport. Every
one of those four defects is disqualifying on its own. Nobody may quote that
tally as a result, in either direction.

**Is the experiment worth running again — yes, and it is closer than it has ever
been, and it is not ready.** The blocker changed in kind, which is the real
progress this wave made:

| | before | now |
|---|---|---|
| the arm | **not ours** — the rig had its own `callModel` | **ours** — `RigTransport extends OpenAICompatible` |
| the judge | could separate every pair five ways | can separate every pair **one** way, and the gate says so and exits 0 |
| the loop's honesty | `act` fail-open ended runs with a scratchpad | `ACT_UNSAID`, retried, ends named at a ceiling |
| the tasks | id in the workspace path; one arm gets a free file tree | unchanged |
| reproducibility | untracked | unchanged |

What was wrong before invalidated *our arm*: the thing being measured was not the
thing that ships, and no amount of re-reading the transcripts could fix it. What
is wrong now invalidates the *judge* and the *task* — the blinding does not blind
and one arm is handed information the other must buy. Those are cheaper defects
and they are fixable without touching `src/`.

So: **not valid yet, and the next run is worth setting up rather than the next
argument.** P4 through P7 are what stand between here and a number anyone may
quote. Until then the only figures in this file that survive are the ones the
transport cannot move — 58,439 tokens / 736 s against 237,579 / 1,177 s, 4.065×
fewer tokens and 1.60× faster, from `bench/results.json`, md5
`be2c057ef0f810ff01c0b6f989122039`, unchanged by this wave — and even those are
reproducible on one machine only until S31 closes.

**And the cost result is sharper than the headline states it, which is worth
fixing because the sharper version is also the more defensible one.** Splitting
the same file by usage field:

    prompt tokens       ours  31,939   agent-zero  211,531   6.62x fewer
    completion tokens   ours  26,500   agent-zero   26,048   1.02x MORE
    total               ours  58,439   agent-zero  237,579   4.065x fewer

The two arms' models wrote **the same amount** — within two percent — and the
entire difference is in what each harness sent. That is a cleaner claim than
"4.065x fewer tokens", because completion tokens are the half a harness does not
control, and their being equal is what rules out the obvious alternative
explanation that one arm simply did less. It is also the one result in this file
that no defect above touches: it is counted from the endpoint's own `usage` on
every reply, in whatever state that reply arrived, for both arms.
