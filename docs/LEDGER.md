# Ledger

One line per slice. A slice is one row from `CAPABILITIES.md` that can be judged
on its own. This is a record, not a plan — the queue below is an ordering of
rows that already exist in the ledger, and it is re-cut after every wave.

Every slice is built by one agent, judged by a second that never sees the
first's reasoning, cut by a third that only asks whether deleting a line
changes an output, and then fixed. Nothing is marked done without the gate:

    bun run check
    bun scripts/dryrun.js "<a task that exercises the slice>"

`check` is lint, then tests, then the static export — one definition, in
`package.json`, and nothing here restates it. An earlier version of this file
spelled the gate out a second way and immediately drifted from the scripts,
which is the failure it was warning about.

The dry run is the second half and it is not optional. A slice changes what the
model is handed; the transcript is how anyone sees that, and it prints the
prompt byte for byte with a sha256 rather than a summary of it. Output pasted,
both commands, always — **and the task quoted with them.** The prompt contains
the user's sentence, so a sha256 without its task is a number two people cannot
compare. One wave produced four prompt shas nobody could reconcile for exactly
that reason; see "The dry run, re-measured after integration" below.

`test` runs `bun test --isolate`. Not a preference: Bun 1.4.0 segfaults when two
or more test files import a module that fails to parse, which is the ordinary
state of the tree while a slice is being written. `--isolate` turns that panic
into a named error and keeps discovery unscoped — a `bunfig` test root was
measured to silently drop a colocated test file, and a gate that hides a test is
worse than one that crashes, because a crash is visible. `lint` running first is
the real guard: biome catches the parse error before the runner ever sees it.

Status: `open` -> `built` -> `judged` -> `landed` | `rejected`

## Done and in flight

| # | Slice | Row it closes | Status | Verdict |
|---|---|---|---|---|
| 0A | Verification harness — `bun test`, dry-run transcript, scripted model | §5 "every measured number is an assertion" | built | — |
| 0B | Reference study — what agent-zero / bolt.diy / Open SWE / eliza put in the context window | §4 calibration | built | — |
| 1A | `fetch` and `search` tools in the backend worker | Search the web; Fetch a URL | landed | — |
| 1B | Bound and cancel the loop — abort through the envelope, a budget the agent can read | Bound it; Cancel it | landed | — |
| B1 | the bar-raiser survey wave — S1 through S7 | see the survey below | landed | 4 FAIL, all fixed |

## Queue

Ordered by what unblocks the most rows, not by what is easiest.

| # | Slice | Row it closes |
|---|---|---|
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
`CAPABILITIES.md` states in these two columns are the ones this file is not
allowed to edit — see the note at the end of the survey.

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
agent-zero's on the same task — picks ours, on the rubric in
`docs/REFERENCE-PROMPTS.md`, without knowing which is which.

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
exception the survey found — `composition.js:219`, which wrote
`chat.services.http` after construction behind five lines of comment defending
it — is gone: `ChatService` takes one named record, and `buildKernel` returns the
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

Three rewrites the survey itself refused, still refused: moving the ~100x-slower
sentence into `ShellTool`'s description (it is a property of `C2wSandbox`, and
`docs/TESTBED.md` records keeping it as deliberate, so moving it silently drops
it from our arm of the only head-to-head in the repo); turning `static LABEL`
into instance state (it is the tree-wide spelling and a registry key); and
wiring `soul` rather than deleting it (identity already lives in the agent
file's own body).

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
`buildKernel`'s `db` has no producer at either of its two call sites. All three
fell outside every coder's owned file set, which is how a wave can find a defect
four times and close it zero times. **Owning files by slice and owning defects
by slice are different things, and this wave only did the first.**

**`TokenScale` has been "either wired or deleted" in this file for two waves and
is still neither.** A ledger row that survives its own deadline twice is a
declaration with no writer in prose form.

**No coder in this wave could own the gate claim it made, and all four made
one.** Four slices shared one working tree. Every certified-green run was
contradicted by another seat's run of the same command minutes later — 277, 304,
316, 321, 324, 331 passing tests, and three distinct false REDs from concurrent
writes. See `docs/GATE.md`, "What this still cannot see"; the fix is one
worktree per slice.

## Rows this wave opened

| # | what | why it is not closed |
|---|---|---|
| S8 | delete `SimpleResponse` | one file outside every S5 brief; all facts measured above |
| S9 | `Envelope.methods` — delete it, or give it the reader `Envelope.js:117-122` claims | no owner; found four times |
| S10 | `ShellTool`'s `description` option — delete it | the survey's fifth dead declaration, never sliced |
| S11 | `buildKernel`'s `db` — delete it, or give it the storage-fallback test it is the seam for | left dark on purpose, see above |
| S12 | `ChatService` bypasses the domain model | it never constructs a `Message` or a `Conversation`; it pushes plain rows onto the loaded record (`ChatService.js:99`, `:217`) and `put`s it, so `Message`'s role validation, text coercion and `repairs` audit trail never run on the live chat path |
| S13 | a field is silently dropped on reload | `ChatService` writes `thinking` on the assistant message (`:215`); `Message.toJSON()` does not emit it, so the first round-trip through `ConversationService` erases it from storage. A consequence of S12: two writers, two schemas, last one wins |
| S14 | `ConversationService` has no test file | `test/backend/` holds `ChatService`, `composition`, `Kernel` and nothing else, and `ConversationService` is the only caller of `Conversation` |
| S15 | the escaped-resolver shape survives in six more places | `SpeechService.js:64` (the closest twin — a forgotten settle hangs dictation for ever), `IndexedDb.js:27` and `:92`, `C2wSandbox.js:83`, `:161`, `:168`. S6 deleted two of eight |
| S16 | `Engine.js:55` is the last `new.target.DEFAULT_*` in `src/` | the same "static default with no subclass to override it" that S2 deleted from speech |
| S17 | `SpeechService.js:156` drops the fp32-fallback note | on the one path that exists to download weights deliberately; `built.notes` is carried and `loaded.notes` is discarded |
| S18 | `defaultModelFor` resolves ears first | `EARS` and `VOICES` both key `native`, so `SettingsService.js:134-136` would fill the tts field from an ear the day a shared key carries a model. Safe today, and only today; the fix is `earModel`/`voiceModel` |
| S19 | one worktree per slice | four coders in one tree produced three false REDs and six mutually contradicting gate claims in a single wave |

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

## Two files this wave could not edit, and what they need

`CAPABILITIES.md` and `docs/MINING.md` were owned by another workflow for the
whole wave, so their citations went stale unattended. Every line below was
opened and read against the tree that shipped; the "must say" column is
re-derived, not copied from a coder's report. Apply without rereading anything.

| file:line | as it stands | must say |
|---|---|---|
| `CAPABILITIES.md:29` | ``never `soul` (`loadAgent.js:86` against `Engine.js:33`)`` | `soul` no longer exists in `src/`. The clause is vacuous, not mis-numbered — delete it. Both anchors also moved: `:86` is `loop: spec.engine` and `Engine.js:33` is `inference` |
| `CAPABILITIES.md:32`, `:451` | `ChatService.js:145` (`run(`) | `ChatService.js:149` |
| `CAPABILITIES.md:33` | ``Engine.js:210` `multimodal = []`` | `Engine.js:199` |
| `CAPABILITIES.md:35`, `:424`, `:536`; `MINING.md:120`, `:219` | `ChatService.js:116` (`const peers`) | `ChatService.js:120` |
| `CAPABILITIES.md:45` | ``response/index.js:6` through `AgentSpec.js:139`` | `:6` is exact; `AgentSpec.js:139` is `engine = DEFAULT_LOOP` — the response check is `AgentSpec.js:143` |
| `CAPABILITIES.md:137` | ``huggingface.co` at `SupertonicSpeaker.js:35`` | ``huggingface.co` at `src/core/speech/index.js:113``. The file is deleted; the host list and the count of four are unchanged |
| `CAPABILITIES.md:364` | ``loadAgent.js:83-84` — the loop comes from a file's `engine:` field`` | `loadAgent.js:85-86` |
| `CAPABILITIES.md:379` | ``port attached `composition.js:219`` | ``port passed to the constructor, `composition.js:212-219` (the `http:` line is `:218`)``. Nothing is attached any more |
| `CAPABILITIES.md:428` | ``discover.js:21` from `ChatService.js:122`` | `discover.js:21` is exact; `ChatService.js:126` |
| `CAPABILITIES.md:451` | `nothing durable is written until `:215`` | `:219` |
| `CAPABILITIES.md:471` | `ChatService.js:159` → `EventName.PROMPT` | `ChatService.js:163`. `page.jsx:134` is still exact |
| `CAPABILITIES.md:483` | ``ChatService.js:167-175` sends `{step, answer, isAnswer, thinking}`` | `ChatService.js:173-178`; the `emit` is `:173` |
| `CAPABILITIES.md:522-532` | the whole "Finding things out" bullet: *"attached at `:219`"*, *"The attachment is a post-construction mutation"*, and the quoted comment *"Unguarded on purpose…"* at `composition.js:214-219` | `composition.js:123` is still exact for where `browserHttp` is built. Everything after it describes code that no longer exists: there is no attachment, no mutation and no such comment, and `:214-219` is now the middle of the `new ChatService({…})` call. The paragraph needs rewriting, not renumbering — the new fact is that `buildKernel` returns the chat service, so `test/backend/composition.test.js:196` asserts `chat.services.http === browserHttp` by identity, and the port is checked rather than argued for |
| `MINING.md:152` | ``src/client/BackendClient.js:124` sends `CANCEL`` | `src/client/BackendClient.js:118` |
| `MINING.md:73` | `ChatService.js:127` (`buildAgent`) | `ChatService.js:131` |

Confirmed still exact, so nobody re-checks them: `CAPABILITIES.md:393`
(`test/backend/composition.test.js:64`, `describe('browserHttp'`),
`CAPABILITIES.md:379`'s `SearchTool.js:28` and `tools/index.js:30`,
`MINING.md:142`'s `composition.js:18-19`. `MINING.md:127`'s "structural
overrides" is a reference implementation's, unrelated to the `overrides` bag
this wave deleted — leave it.

`CAPABILITIES.md` also owes two state changes this file has already made in its
own queue: `Search the web` / `Fetch a URL` and `Bound it` / `Cancel it` are no
longer `absent`.

One source line, reported here because it is neither a doc nor in any coder's
owned set: `src/core/mcp/discover.js:18` declares
`@param {{sandbox?: object}} services` and is handed `{ sandbox, http }`.
