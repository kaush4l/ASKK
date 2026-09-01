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
| T1 | the sandbox reaches the artifact — derive the image URL, propagate the exit status | Run a command; the new *Know whether a command succeeded* row | landed | — |
| T3 | `ChatService` goes through the domain model — one `ConversationService`, `thinking` on the schema | S12, S13, S14 | landed | — |
| T2 | re-measure the guest through the tree's own port | — | rejected | see *Refused*, below |
| T4 | price the deploy: what it takes to ship 102 MiB | the new *Get that environment to the visitor* row | landed as measurement only, no code | — |

## Queue

Ordered by what unblocks the most rows, not by what is easiest.

| # | Slice | Row it closes |
|---|---|---|
| 1C | Get the guest to the visitor — a host that will serve 102 MiB, `SANDBOX_IMAGE` pointed at it, and the deployed page asked to run a command | Get that environment to the visitor `absent`; Point a deploy at a guest on another host `unverified` |
| 1D | The artifact smoke step — proxy `Worker`, keep the page's own module worker, send it one `chat.send` | S22; it is the only thing that would let anyone re-derive this wave's headline by typing one command |
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

1C is at the top because it is the only open row that decides whether this
project's central claim is true of the thing a visitor opens. Everything below it
is true of a tree on a developer's machine either way.

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
gitignored here (`.gitignore:33`), gitignored again by the deploy commit
(`git show a1d7a98 -- .gitignore`), and **404 on the live site** while the page
and `vm-worker.js` answer 200. `git ls-tree -r gh-pages` is 56 files /
25,155,729 bytes with no guest in it. Nothing about that is a browser limit, and
it is now a row of its own in `CAPABILITIES.md` rather than a footnote to a
`degraded`.

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
tree. The run that settles it is the one after integration, and it is at the end
of this file. `docs/GATE.md` now also owes a fourth shape of concurrent red: a
**timeout**, seen at 5,002 ms in a peer's half-written test file and green on the
immediate re-run. Its list names three.

## Open rows

S8–S19 were opened by the bar-raiser survey wave; S20 and S21 by the wave that
ran the sandbox through the artifact; S22 onward by this one. A row leaves this
table when a `git grep` says so, not when someone says it is done — which is why
S10 has now survived three waves in a file nobody owns.


| # | what | why it is not closed |
|---|---|---|
| S8 | delete `SimpleResponse` | one file outside every S5 brief; all facts measured above |
| S9 | `Envelope.methods` — delete it, or give it the reader `Envelope.js:117-122` claims | no owner; found four times |
| S10 | `ShellTool`'s `description` option — delete it | the survey's fifth dead declaration, never sliced |
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
| S25 | the two numbers the model is handed about its own environment are both wrong | `ShellTool.js:25` says `The command line cannot exceed 1024 bytes`; the status wrapper takes 25, so `C2wSandbox` refuses at 994 with a limit the model was never told. `C2wSandbox.js:216` (the timeout hint) and `agents/main/agent.md:29` (the agent's own instructions) both say *"roughly a hundred times slower"*; measured against the identical busybox this wave, 255x–485x. Three sites, two facts, and all three are paid on every turn of every run and are the model's only source. The description is also the constructor option S10 says has no writer, so whoever fixes the sentence should decide that row at the same time |
| S26 | `scripts/smoke.js` states a constraint that does not exist | The comment above the `src/` server says a `..` in a specifier resolves in the URL before it arrives, *"but the join is still constrained because this server is handed whatever a page asks for"*. The first clause is true and is the whole of it — `new URL()` normalises dot segments — and the join is not constrained by anything. The code is safe; the sentence is a false claim about it, which is the class of comment this tree deletes |
| S27 | `test/core/tools/Toolbox.test.js:153` fixtures a hint that no longer exists | The fixture's failure carries `hint: 'Set SANDBOX_IMAGE.'`; `grep -rn "Set SANDBOX_IMAGE" src` → 0. Harmless as a fixture and misleading as a record: it is the last place in the tree that describes the sandbox as something a variable turns on |
| S28 | three of the four narration events have no test anywhere | `grep -rn "EventName.STEP" test/` was 0 before T3 and is now one file. `EventName.PROMPT`, `EventName.DELTA` and `EventName.USAGE` are still 0, and `ChatService.send` is the only emitter of all four. The whole channel between the loop and the panel is covered by one assertion |
| S29 | `src/core/mcp/discover.js:18` declares a services bag it is not handed | `@param {{sandbox?: object}} services`, and `ChatService.js:148` passes `{ sandbox, http }`. Reported by the survey wave, still true, still nobody's file |

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
prints the line it lands on: **108 citations** in `CAPABILITIES.md` that name a
file in this repository, **3** in `ARCHITECTURE.md`, **53** in this file — every
one in range and every one read against its anchor. The rest point into the five
reference projects and are not ours to check. Nine false citations have shipped
in this tree; the whole of the reason this pass is mechanical rather than a
re-read is that a human re-read is how all nine got through.

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
integrated tree — `334736f` plus the T1 and T3 slices, uncommitted, with no
further edits to `src/` from any seat while it ran:

    $ bun run check
    biome check …                     Checked 113 files in 22ms. No fixes applied.
    bun test --isolate                395 pass · 0 fail · 1022 expect() · 30 files · 296ms
    next build                        Compiled successfully · 3 static pages
    bun scripts/smoke.js              smoke: the real guest answered
                                        "Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC
                                         Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux"
                                        in 965ms cold, then a failing command in
                                        749ms warm (exit 1)
                                      smoke: ready in 141ms, the sandbox ran a guest,
                                        no console errors
    EXIT=0

Three runs, so the spread is on the record rather than one number pretending to
be a constant: cold 1015 / 951 / 965 ms, warm 764 / 751 / 749 ms, ready 151 / 140
/ 141 ms, lint and test identical every time. The line above is the last of the
three.

Two seats reported 395 across 31 files and 395 across 30 six minutes apart; 30 is
what the integrated tree has. The dry run above was not re-run for this wave; its figures are a same-day
artifact, as that section says of itself, and nobody should carry them forward
without the task written beside them.
