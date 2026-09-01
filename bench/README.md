# The rig

Settles whether our agent scaffold drives tools better than a reference one, by
holding the model, the parameters, the tasks, the tools and the turn cap
constant.

**It does not hold everything else constant, and these first four lines used to
say it did.** One arm is handed a recursive file tree in its prompt on every
turn and the other is handed nothing. That is a second variable; it runs
*against* our arm; and the correction to the opening claim sat 190 lines below
the opening claim, which is not where a reader looks. It is measured in "The two
arms are not handed the same information", below, and that section comes before
any result on purpose.

    same model      Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp at http://127.0.0.1:8873/v1
    same params     temperature 0, seed 7, max_tokens 1200
    same tasks      tasks.js, five of them, machine-checked
    same tools      tools.js, four functions, every scaffold ends there
    same cap        12 turns, recorded as an event

`scaffolds/*.js` is the variable this rig is FOR: the system prompt, the tool
contract, the parse, and how an observation re-enters the context.
`test/bench/driver.test.js` drives two scaffolds that differ only in their `id`
and asserts that `model`, `temperature`, `seed` and `max_tokens` are
byte-identical on the wire and that both are offered the same number of turns —
because "everything except the scaffold is held constant" was prose until
something failed when it was not, and it is still prose everywhere that test
does not reach, the file tree included.

**A SINGLE RUN IS A SAMPLE, NOT A MEASUREMENT.** `temperature: 0, seed: 7` does
not make this endpoint reproducible; it is the same class of measured fact as
its `cached_tokens: 0`. The same task, the same code, an hour apart:

    agent-zero  4 turns   9,892 tokens  45s   |  5 turns  13,234 tokens  55s
    ours        2 turns   3,390 tokens  50s   |  4 turns   4,467 tokens  33s

So `-n 3` at least, and quote a spread, for any number anyone repeats.

**`results.json` IS SUPERSEDED, and is kept.** The runs it holds are real and are
the only recorded evidence there is; the comparison they support is not the one
this file claims to make, because one arm was handed a recursive file tree in the
prompt on every turn and the other was handed nothing — see "The two arms are not
handed the same information", below, before any number. The file now says so in a
`superseded` block of its own, and that block carries the md5 it had before the
note was added (`be2c057ef0f810ff01c0b6f989122039`) so that the citation in
`docs/LEDGER.md` still resolves. Today, `md5 bench/results.json` =
`813fde9dbf088c5aaddad3639b7bcc0b`, and `runs`, `config`, `skipped` and `at` are
byte-identical to the version that hashed to the first. **This is the only place
in this file that tells you to run that command, and `test/bench/run.test.js`
re-derives both hashes and refuses any third one**, so a `bun bench/run.js` that
replaces the evidence turns the suite red instead of leaving a reader to find
that the answer does not match. The re-take is due the moment our agent has a
filesystem.

## What a judge is handed, and the rule it is built under

**A panel scores a PROJECTION of both loops, not either loop's own artifact.**
P4 was decided by the lead after two panels were spent on sets the gate
refused: tool identifiers and reply grammar get a common rendering in the
projection, and nothing in `src/` or in either scaffold is renamed. The ledger's
standing argument — that renaming a tool puts the lie in the artifact — is
about the artifact, and the projection is not the artifact. A judge scores what
the loop DID with its tools, not what the tools were called.

So `blind.js` renders, per file: the task; per turn the four things both reply
formats carry — reasoning, call, result — read off the recorded action rather
than the reply text, with every tool a per-arm slot (`tool_1`, `tool_2`, … in
order of first use across that arm's whole set); every ending in one
vocabulary; and then the assembled prompt for turn 1, once, under the same
slots and the same scrub, plus the lines the turn-2 request added. It drops the
model's private reasoning channel and the transcript header, and it emits a
directory a panel can be handed with nothing beside it: `<task>/{A,B}.md` and
one `outcomes.json` keyed by task and letter, the letters in letter order under
every task. The full argument, the gate, and
what it printed over the recorded runs are under "`blind.js` is the gate",
below. Every number below this line was recorded before that projection
existed, and none of it was judged through it.

## Read this before any number below

**If our arm is our real code and their arm is our paraphrase of their code, the
answer is worthless.** So, per component, here is which side of each arm is
genuine and which is reconstruction. Nothing in this table is a summary of an
intention; each row is checkable in the file it names.

### Our arm — `scaffolds/ours.js`

| component | genuine or reconstruction |
|---|---|
| system text | **genuine.** `agents/main/agent.md`, read by `src/core/agent/AgentFile.js` `parseAgentFile` and built by `AgentSpec.of` — the same two calls `AgentCatalogue.spec` makes in the app. The body is used unedited, including the sentence about an emulator "roughly a hundred times slower", which is not true of this rig. |
| the engine | **genuine.** `src/core/agent/loadAgent.js` `buildAgent`, the builder `ChatService` and `agentWorker` both call. It picks the loop, the response contract and the prompt arrangement; this rig picks none of them. |
| prompt assembly and order | **genuine.** `Engine.blocks` / `Engine.plan` over `PromptTemplate` `DEFAULT_ORDER`. `test/bench/oursScaffold.test.js` asserts the message sent is `engine.plan(...).text`, re-derived, not a pinned string. |
| response contract | **genuine.** `ReActResponse.FIELDS` rendered by `BaseResponse.instructions` / `reminder`. |
| reply parsing | **genuine, and ASYMMETRIC — read this before any turn count.** `BaseResponse.parse` tries TOON, then JSON as a repair, then returns the whole reply as the answer. So a reply that reaches **none** of the contract's fields ends this arm's run as an answer, where agent-zero scores it `misformat` and pays a turn. Measured today — `"Sure! I think the battery is at 87%."` is `{act:"answer"}` here and `{kind:"malformed", reason:"misformat"}` there. A reply that **does** reach the contract and gets it wrong is named rather than waved through: `act: banana`, and a reply cut off before the `act` line, are both `ACT_UNSAID`, echoed back with which of the two it was, and two in a row end the run `unreadable`. This row read "**cannot produce a malformed action at all**" until `ACT_UNSAID` landed and for a wave after — `docs/LEDGER.md` row S37 — and the thirty transcripts already in `transcripts/` carry the old sentence, for which it was true when they were recorded. It is our real production behaviour and is not repaired; it is recorded in `ours.js` `cuts`, so every transcript carries it. |
| tool rendering and listing | **genuine.** `Tool.signature` / `Tool.render`, `Toolbox.render`. |
| tool-call syntax, parse and dispatch | **genuine.** `Toolbox.parse` / `runOne` / `run`. |
| the repeat rule | **genuine.** `ReActEngine.observe`. |
| the budget | **genuine**, including its hard stop. `src/core/engine/Budget.js`, constructed from the agent file's own terms as `ChatService` does, opened / closed / measured at the three moments `Engine.step` and `ReActEngine.run` do it, and `stopped()` refuses a tool call written after the "THIS IS YOUR LAST TURN" sentence the way `ReActEngine.run` does. That refusal was missing, which left our arm reading the sentence with nothing behind it; the file declares no budget, so `Budget`'s own 600 seconds apply and a 12-turn run on this endpoint can reach them. |
| context facts | **genuine.** `Environment.js` `describeEnvironment()`. |
| one user message | **genuine** property, preserved: `OpenAICompatible` sends the whole assembled prompt as a single `user` message, and so does this. In production the class's own `_body` builds that message; here `request()` builds it, because the rig's transport takes a message array so the reference arm can send its two. Same shape, one hop further out. |
| the HTTP call and the reply classifier | **genuine**, and it was not until this slice. `bench/transport.js` is `src/core/inference/OpenAICompatible.js` with two overrides, both argued in that file: a message array instead of one user message, and `seed`. `_state`, `_spent`, `_dumped`, `_cutNote`, the shape guard, the abort handling and the HTTP-error messages are all inherited and none is repeated. Before it, `driver.js` carried a private `callModel` — a fetch and `message.content ?? ''` — so this arm was measured without the one component of ours that decides whether a reply is an answer at all. **See "The transport, and what the recorded run is worth" below, which is the most important paragraph in this file.** |
| the `shell` tool | **genuine.** `src/core/tools/ShellTool.js`, the shipped class, holding a `Sandbox` port that runs the command through `tools.js`. Only its `description` is overridden, through the class's own option. |
| `read_file`, `write_file`, `list_files` | **RECONSTRUCTION, and unavoidable.** The tree has no such tools; it ships `shell`, `search`, `fetch` and whatever MCP offers. They are built here on the real `Tool` base class, so their signature line, argument table and prompt rendering are the tree's code — but the three descriptions are written for this rig. |
| the loop body | **RECONSTRUCTION of the sequencing only.** `ReActEngine.run` owns its own `while (true)` and calls its own inference; the rig's driver owns the HTTP call, the transcript and the turn cap, so importing the loop would be a loop inside a loop. Every decision inside the reconstruction is delegated back: the answer/tool branch reads `parsed.isAnswer`, the scratchpad entries are the shape `Engine.blocks` reads, and the repeat rule and dispatch are the real `observe`. **Our engine has no turn cap of its own.** The 12 is the rig's, imposed identically on both arms — a finding, not a fix. |

### Their arm — `scaffolds/agent-zero.js`

| component | genuine or reconstruction |
|---|---|
| prompt text | **genuine bytes.** Seventeen files vendored verbatim from `frdel/agent-zero` at commit `6a6cecf`, at their upstream paths, hashed in `vendor/agent-zero/PROVENANCE.md` and re-hashed by `test/bench/agentZeroScaffold.test.js`. |
| prompt assembly | **RECONSTRUCTION.** The python that joins them (`agent.py:581-583`, `_10_main_prompt.py`, `_11_tools_prompt.py`) is reimplemented in JavaScript, with every source line cited at the call site. **`agent.py` is now vendored too** — twenty hashed files, not nineteen — because this scaffold cites it fifteen times and `transport.js` rests its single divergence from the shipped transport on one of those lines, and not one of them could be opened from this repository. All ten citations re-derived against the vendored copy hold; the one that did not was `transport.js`'s, which said the two-message shape was `agent.py:583` when 583 is the system-text join and `606-610` is the message array. |
| the cuts | **DELIBERATE DEPARTURES, all listed.** `CUTS` in that file names each one, what it removes and which absent capability forces it. They are applied through a `cut()` helper that records a pattern which no longer matches, and the test fails on a non-empty record — because a silently-missed cut leaves the reference arm promising a tool this rig cannot give it, and that reads as agent-zero wasting turns rather than as this rig drifting. **One such cut was already dead when the rig was moved in**: it spelled `open_in_canvas` where the file says `open_in_canvas: true`, so 112 characters about a canvas/Editor that does not exist survived into every agent-zero prompt the pre-repository version ever sent. |
| the tool-call contract | **RECONSTRUCTION, and STRICTER THAN UPSTREAM — the one cut that makes the reference arm worse.** The aliases, the `actions` wrapper, the `type: "function"` shape and the `tool:action` split are reimplemented faithfully, and so is the OUTER strictness: a reply that is not one complete JSON object and nothing else is a misformat upstream too. The INTERIOR is not: upstream parses the object with `DirtyJson`, so a **trailing comma, single quotes or unquoted keys** are a tool call there and a `misformat` here. Every misformat, turn and token count this arm produces is therefore inflated by an unmeasured amount. It is a row in `CUTS` rather than a port, because a hand-written tolerant parser is a reconstruction the gate cannot check; the oracle is vendored at `vendor/agent-zero/helpers/extract_tools.py` and the shapes are pinned in `test/bench/agentZeroScaffold.test.js`. **No misformat rate may be quoted from this rig without citing that row.** |
| history and the extras block | **RECONSTRUCTION** of `agent.py:594-609` and `helpers/history.py`: dict contents serialised compactly, adjacent same-role messages merged, extras rebuilt every call and never stored. |
| the circuit breaker | **RECONSTRUCTION** of `_90_stop_unusable_response_loop.py`, limit 5. Ours has no equivalent, which is a finding the rig reports rather than a gap it fills. |
| the tool implementations | **neither arm's.** `code_execution_tool` and `text_editor` are adapters onto the same four functions in `tools.js` that our arm reaches. The naming is agent-zero's because naming is part of the scaffold; the behaviour behind the name is nobody's. |

### The transport, and what the recorded run is worth

**Until this slice, the rig did not use this project's transport.**

    grep -rn OpenAICompatible bench/   ->  3 hits, ALL PROSE IN COMMENTS

`bench/driver.js` had its own `callModel`. So the arm labelled "ours" ran without
`src/core/inference/OpenAICompatible.js`, which is the class that classifies a
reply into four states and REFUSES two of them. Replayed through
`OpenAICompatible._state` over every reply the runs in `transcripts/` recorded:

    ours        34 replies   whole 20 · thinking 12 · cut 2
    agent-zero  79 replies   whole 76 · cut 3

Ten of our arm's fifteen runs contain at least one reply the shipped transport
refuses; **four of those ten were scored PASS.** All three
`no-such-capability` runs — the one cell where our arm beat the reference — are
among them.

All twelve refusals are the same state: `finish_reason: length`, an answer
channel carrying several thousand characters, and **no `reasoning_content` at
all**. That is `_state`'s last line, the one its own comment says can be wrong:
with `thinking` on, a truncated reply that never routed its scratchpad is called
a dump. It is called that here because `thinking` is on here, because
`agents/main/agent.md` declares no `thinking:` line and `DEFAULT_SETTINGS.thinking`
is `true` — i.e. because that is what the app runs. None of the twelve is a
positively identified dump (`content === reasoning`); the refusal rests on the
inference, and `driver.js` `DEFAULTS.thinking` is where a reader can see it was
not quietly flipped.

The rig's `max_tokens` is **1,200**, below the app's `DEFAULT_SETTINGS.maxTokens`
of 2,048, so this rig truncates more often than the app does. That ceiling is
held constant across both arms and is not moved to make either look better.

**What this costs the recorded run.** `results.json` and `transcripts/` are the
output of a rig that let those twelve replies through, and they are LEFT EXACTLY
AS THEY ARE — evidence is not edited to agree with a later instrument. Read them
with this:

| what the recorded run says | what stands |
|---|---|
| ours 58,439 tok / 736 s vs agent-zero 237,579 / 1,177 s — 4.065x fewer tokens, 1.60x faster | **Stands as a record of what those runs cost.** It is not reproducible under the fixed rig: a refused reply ends its run, so re-running will produce FEWER tokens and LESS time for our arm and change the ratio. All ten rows still re-derive from the file, which is the `superseded` block's `fileMd5BeforeThisNote` version plus that block — see the banner at the top for the hash to check it against, which is not this row's business to quote. |
| ours 8/15 passed | **SUPERSEDED.** At most 4/15 survives: four of the eight passes contain a reply this project's own transport refuses. |
| the `no-such-capability` cell, ours 3/3 | **SUPERSEDED.** All three runs are refusals under the fixed rig. |
| the blind panel's 15 task-lens cells (ours 4, theirs 7, tie 4) | **VOID**, and not because of the transport — no judge was blind. See `blind.js`. |

Under the fixed rig, one live pairing re-run (`--task median-bug --out` a scratch
directory, so the repository's evidence was untouched), 2026-09-01:

    agent-zero  PASS  10 turns  answered           42,111 tok  224s
                completion tokens per reply — n 10, min 137, median 278, max 1200
                reply states {"whole":9,"cut":1}
    ours        FAIL   2 turns  transport-refused   3,264 tok   48s
                completion tokens per reply — n 2, min 226, median 713, max 1200
                reply states {"whole":1,"thinking":1}
    both arms answered by Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp

One pairing is a sample and not a measurement — `-n 3` at least, per the rule at
the top of this file — and it is here to show the instrument working, not to
replace the table above.

**The refusal is applied to BOTH arms.** That is what makes it a constant rather
than a thumb on the scale, and it is also a component of our harness that the
reference arm does not have upstream, so it is listed as a departure in
`scaffolds/agent-zero.js` `CUTS` as a row.

**That row is not in the fifteen transcripts in `transcripts/`.** They were
produced before it existed and carry twelve `cuts`, not thirteen — measured,
`jq '.cuts|length' transcripts/median-bug/agent-zero/1.json` → 12, against a
live `scaffold.cuts.length` of 13 — and a recursive grep for the row's own text
over every agent-zero transcript matches none of them. `renderTranscript` writes
every `cuts` entry, so the row travels from the next run onward; this sentence
said "stamped into every agent-zero transcript", in the present tense, about an
artifact where it appears nowhere, which is the defect this repository keeps
shipping and had just been briefed to hunt. Regenerating `transcripts/` is what
makes it present tense.

On the evidence so far the refusal costs that arm nothing: zero of its 79
replies are refused.

### Which model answered

The rig sends the model it wants. **This endpoint serves four:**

    curl -s http://127.0.0.1:8873/v1/models
    Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp · gemma-4-12B-it-qat-mxfp8
    mlx-community--Qwen3.8-27B-8bit · MarkItDown

Until this slice the rig recorded only the one it asked for, so "the same model
for both arms" was an assumption about a server made by code that was discarding
the server's answer to that exact question. `json.model` is now recorded per
reply, listed per run in `results.json` as `models`, and printed per arm as
`answered by …`. Anything but one expected id there means the run measured
something else. (The repository keeps a real capture of this happening:
`test/support/fixtures/spent-in-think.json` was answered by
`gemma-4-12B-it-qat-mxfp8`.)

### Statistics come out of the instrument, not out of the reader

A report of this rig's own numbers gave our arm's 34 completion-token values a
"median" of **1,083**. 34 is even; 1,083 is `sorted[n/2]`, the UPPER MIDDLE. The
median is **896**, the mean of 709 and 1,083. Nothing in the rig could catch it,
because the rig printed rows and left the statistic to whoever read them.

`run.js` now publishes the statistic. Every run prints, and the `results.json`
a run writes carries under `summary`, per arm: `runs`, `passed`, `refused`,
`tokens`, `ms`, `turns`, `completionTokens {n, min, median, max}`, `replyStates`
and `models`, plus a `replies` row per run so any of it is re-derivable.

**The `results.json` in this directory has none of that** — `jq .summary
bench/results.json` is `null`, and its thirty rows have no `replies` key,
because it predates this slice. It is kept as the record of the runs the
transcripts beside it came from. `summarise` reads it without a `replies` column
rather than throwing, which is how the omission was found: it used to crash on
the instrument's own evidence file.

`median` is exported from `run.js` and its even case is pinned in
`test/bench/run.test.js` at the exact pair the wrong number came from; the row
projection that writes all of the above is `resultRow`, pinned in the same file
against a run driven through the repository's own recorded reply bodies.

### The two arms are not handed the same information, and this one is in our favour to state

**One arm is told what is in the working directory, every turn, for free. The
other has to spend a tool call to find out.** That is not a controlled variable;
it is the rig failing its own opening claim that only `scaffolds/*.js` differs.
It is stated here, before any result, because an asymmetry that is stated is a
finding and an asymmetry that is silent is a fraud — and because this one runs
*against* our arm, so leaving it out would be the flattering omission.

Counted over the 30 runs in `transcripts/`, and re-derivable from the JSON beside
them rather than from this paragraph:

| | agent-zero | ours |
|---|---|---|
| requests carrying a recursive workspace tree | **79 of 79** | **0 of 34** |
| …of those, trees that were not empty | 76 | – |
| tool-calling turns spent finding out what exists | 4 of 60 | **9 of 19** |

The third row is the one that is rule-sensitive, so here is its rule: a `tool`
action whose CALL, as issued, matches `/\bls\b|\bfind\b|\blist_files\b/` — which
is `action.call` for our arm and `tool(JSON.stringify(args))` for the reference
arm, because the two record a call differently. Matching the model's whole reply
instead gives **10 of 60**, which is what this row used to say, by counting three
`text_editor` reads of a file named in the previous turn as asking what exists.
All three rows are re-derived from the JSON in `test/bench/run.test.js`; before
they were, this row was the only one of the three that did not re-derive at all.

The tree arrives as `project_file_structure` in agent-zero's `[EXTRAS]` block —
`docs/REFERENCE-PROMPTS.md:91`, `_75_include_workdir_extras.py` — regenerated per
turn to depth 5. Our arm has `list_files` and nothing else, so on the three tasks
that begin by not knowing what exists, it opens by paying a turn for what the
other arm was given. **Nearly half our arm's tool turns go on looking; a
fifteenth of theirs do.** Any turn count, and any per-turn cost, has to be read
with that.

**What this asymmetry does NOT explain is the token gap, and the obvious guess is
wrong by a factor of thirty.** Decomposing the 807,129 prompt characters
agent-zero sent across its 79 requests:

    system manual, re-sent unchanged every turn   580,297   71.9%
    the workspace tree                             22,041    2.7%
    the clock and the agent-number block           15,721    1.9%
    the task, the dialogue and the observations    189,070   23.4%

Ours sent 117,913 characters over 34 requests, in a single `user` message with no
system role at all. So the file tree is **2.7%** of what the reference arm spends,
and the 6.62x prompt-token ratio in `docs/LEDGER.md` is very nearly all the
system manual paid for on every one of 79 turns. Giving our agent a file tree
should be expected to change **which tasks it can do**, not what it costs — and
anyone who quotes the cost result as "they pay for a file tree" is quoting a
number this file measured and refuted.

**The next run must be re-taken.** Another slice is giving our agent a
filesystem; the moment it lands, our arm can be handed the same tree and this
whole section becomes a `cuts` row about a rig that no longer needs it. Until
then `results.json` is superseded — see the top of this file.

### A second asymmetry, now closed, that every recorded transcript still carries

**The reference arm has always been told what runtimes the host has. Ours was
told nothing.** `scaffolds/agent-zero.js` `environmentSection` writes
`python3 and node are installed and on PATH` into its system manual on every
turn — a line this rig wrote, not a line agent-zero shipped, so it is a fact the
RIG handed one side. Our arm's shell description, written in the same file that
argues for faithfulness, said only where the workspace was and how long a command
may run. Measured on 2026-09-01 by assembling both arms' first request: the
string `python3` appeared in agent-zero's prompt and in **none** of ours.

That is a rig-invented difference on exactly the axis the tasks are scored on,
and it also measured an arm this tree does not ship: `src/core/tools/ShellTool.js`
states the same kind of fact about the browser guest — `BusyBox, the Alpine base
tools and python3 are available` — and the rig replaces that whole sentence
through the class's own `description` option.

It is closed. `ourTools` now names the host's runtimes, **derived with
`Bun.which` rather than asserted**, in agent-zero's own wording so the two arms
read one sentence and not two paraphrases; a host with neither gets no sentence
instead of a false one. `test/bench/oursScaffold.test.js` holds the two arms to
the same SENTENCE rather than to the word `python3` — theirs read back off its
own line, ours derived — and then builds our arm's prompt through a lookup that
finds neither runtime and reads what it says. That last assertion is the one
that matters, and it is the one that did not exist first: with only the function
covered, replacing the call in `ourTools` with the literal sentence left the
suite at 670 pass / 0 fail and left the derivation with no caller. Two things
are left rather than fixed, and both are rows for whoever owns those files:
agent-zero's copy of the sentence is still asserted rather than derived, and the
runtime the SHIPPED description names is the guest's, which no rig on a
developer's machine can reproduce.

**Every transcript in `transcripts/` was recorded under the asymmetry**, along
with the runs in `results.json`, which is superseded for other reasons already
stated at the top of this file. Any turn count quoted from them is a count taken
while one arm knew it had an interpreter and the other did not.

### One number a reader should have before the results, and where to get it

Prompt size is **printed by the run that produced the results** and written into
every transcript — it is not written down here, because the three figures that
used to be were all wrong against the transcripts beside them, and could not
have been right for any other reader: **the workspace path is inside both
prompts**, so every figure moves with the length of the checkout directory.

    bun bench/run.js --task pointer-chase
    …
    agent-zero: first request N–M characters in 2 message(s), system message S
    ours: first request N–M characters in 1 message(s)

    head -8 bench/transcripts/<task>/<scaffold>/1.md     the same line, per run
    jq '.runs[].promptSize' bench/results.json           the same, machine-readable

What is stable and worth carrying: `docs/PROMPT-AUDIT.md:213` measures
agent-zero's UNCUT system prompt at 16,657 characters. What this rig sends is
roughly half of that, because the cuts take out every tool it cannot provide. So
this is **not** a comparison against agent-zero at full size, and nobody may
quote a token ratio from here as one. It is a comparison of two scaffolds
offered the same four capabilities.

**Both arms therefore carry a reconstruction in the same place: the loop.**
Ours reconstructs its sequencing, theirs reconstructs its prompt assembly and its
parser. Neither reconstruction chooses what the model reads — that is vendored on
their side and imported on ours. That is the most honest statement this rig can
make, and any result should be read with it.

## Where this lives, and why `bench/` at the root

Not `src/`: nothing here ships to the browser, and `src/` is the artifact.
Not `scripts/`: those are build and gate tooling, and `bun run check` runs them.
Not `test/`: `bun test` runs that directory, and this takes minutes and needs a
model. `bench/` is a fourth thing — a measuring instrument, versioned with the
thing it measures — and it is at the root because that is where a reader looks
for one.

It is in the gate's world without being in the gate's way:

    bun run lint    biome over `bench/**/*.js`, MINUS `bench/work/**`  — see below
    bun run test    the pure parts, in `test/bench/`, 8 files
    bun run check   NEVER runs the rig. There is no path from check to a model call.
    bun run bench   the rig, explicitly, by hand

**Running the benchmark used to turn the gate red, and the gate could not tell
that from a real fault.** `bun run bench` fills `bench/work/` with files two
models wrote, `biome.json` has no `vcs` block so biome never reads `.gitignore`,
and `package.json` names `bench` as a lint target. `biome.json` now carries
`"!bench/work/**"` beside its other negations — the same shape as the fix on the
other instrument, which was scoping `bun test` to `./test` rather than teaching
it about `.gitignore`. A list of paths this gate is about beats a list of files
some other tool decided not to track. Measured on this tree, after a benchmark
run, with six model-written files under `bench/work/`:

    with    "!bench/work/**"     133 files checked, 0 errors
    without "!bench/work/**"     139 files checked, 6 errors
                                 all six in bench/work/slugify-module/agent-zero/*/
                                 — files the REFERENCE ARM's model wrote

And it still catches a real fault in the same run. Both planted at once, an
unused binding in `bench/driver.js` and a badly formatted file at
`bench/work/planted/planted.js`:

    bench/driver.js:66:7 lint/correctness/noUnusedVariables
    Checked 133 files. Found 1 error.

One error, in the owned file, naming it. Both removed afterwards; `bun run lint`
back to 133 files, 0 errors. `docs/LEDGER.md`, row S30.

**`bun run test` is `bun test --isolate ./test`, and every character of that
matters.** Bun's positional argument is a **path-substring filter, not a
directory root**, and the `slugify-module` task has the agent write
`test/slugify.test.js` into its own workspace. Measured, with a failing test
planted under `bench/work/`:

    planted at bench/work/zz/planted.test.js
      bun test --isolate            467 pass  1 fail   36 files
      bun test --isolate test       467 pass  1 fail   36 files   <- every path contains "test"
      bun test --isolate test/      467 pass  0 fail   35 files
    planted at bench/work/zz/test/planted.test.js   (what slugify-module produces)
      bun test --isolate test/      467 pass  1 fail   36 files   <- and "test/" too
      bun test --isolate ./test     467 pass  0 fail   35 files

So `test` and `test/` both let a 27B's output decide the gate's colour, and the
second one is defeated by exactly the task this paragraph is about.
`bench/work/` is gitignored for the same reason; `bench/transcripts/` and
`bench/results.json` are NOT, because they are the evidence a run produces and
evidence outside the repository is not evidence.

## Run it

    bun run bench                     both scaffolds, all five tasks, once
    bun bench/run.js --scaffold ours  one scaffold
    bun bench/run.js --task collatz   one task
    bun bench/run.js -n 3             three runs of each pairing — the minimum
                                      for a number anyone quotes
    bun bench/run.js --out /tmp/x     transcripts AND results.json elsewhere,
                                      leaving the repository's evidence alone
    bun run bench:blind               build the panel directory and gate it
    bun bench/blind.js --index 2      run 2 instead of run 1, with its own A/B map
    bun bench/blind.js --transcripts /tmp/x --out /tmp/x-blind --key /tmp/elsewhere.json
                                      blind a run that went somewhere else, and put
                                      the key where the panel is not

`run.js` writes `transcripts/<task>/<scaffold>/<n>.md` (and `.json`) plus
`results.json`, and prints the table. Each transcript carries the scaffold's own
`cuts` — every departure it makes from what it would really send — so a number
never travels without them. **Its workspace is `work/<n>`, a number** —
`workspaceName` — and `results.json` carries which run each number was. It was
`work/<task>/<scaffold>/<n>`, handed to both arms in the prompt, and on
`no-such-capability` our arm read `no-such-capability/ours/1` back off its own
cwd and quoted it as an answer key seven, six and ten times across three runs
(`docs/LEDGER.md` row S35, P7). The thirty runs under `runs/2026-09-01-s53-n3`
and the thirty under `transcripts/` were recorded under the old path; `blind.js`
scrubs that fragment out of them, and the next run will not produce it.

`blind.js` writes the directory a panel is handed — `blind/<task>/A.md`,
`blind/<task>/B.md` and `blind/outcomes.json` — and the key to
`blind-key.json`, which is OUTSIDE it. The panel is handed `blind/` and not its
parent: the last panel was unblinded by the key sitting beside the set in a run
directory that was handed over whole, and by the lead's own prompt carrying the
map. `--key` puts it further away. `bench/blind-key.json` is gitignored;
regenerate it with `bun run bench:blind`. **That is the only key path
ignored**: the default `--key` is `<out>-key.json`, so `--out` under a run
directory puts the key beside the set inside the directory that was handed
over whole last time, and `runs/2026-09-01-s53-n3/blind{,-2,-3}/` with their
three keys are tracked at `c00b830` — the projection the gate refused, tool
names and all. They are to be deleted, not regenerated in place; the panel
directory for that run is built with `--out` and `--key` pointing elsewhere.

### `blind.js` is the gate, and what it emits is a projection

What a judge sees is ONE rendering of both loops. It reads `<n>.json`, never
the named markdown, so the header — the arm's label, the verdict, the check
list, the departures — is structurally absent rather than stripped. Then, per
file:

- **the task.**
- **per turn: `reasoning:`, `call:`, `result:`.** `thoughts` + `headline` and
  `think` + `plan` are both a reasoning list; one JSON envelope and one call
  line are both `call: <slot>` with its arguments beneath it, a multi-line
  argument as an indented block; the observation is `result:`. This is read off
  the recorded ACTION, not the reply text. **The reply as the model wrote it is
  not rendered**: the two grammars separated 5 of 5 pairs on sight, and the
  grammar is in the prompt below for a judge who wants to score it. A reply
  the token ceiling cut inside its envelope — the harness scores it a
  misformat — still yields every thought that closed: the one such turn in the
  recorded set holds the model's whole diagnosis of the bug and rendered
  `reasoning: (none)` until the reader was made to look.
- **tool names as slots.** `tool_1`, `tool_2`, … per arm, in order of first use
  across that arm's whole set, then the listed-but-unused in listing order, so
  the same tool has the same slot in every file of one arm and a judge can
  follow a tool across turns without learning its name. The mapping is applied
  to the whole file — reasoning, observation text, the prompt — as an identifier
  match that also sees through an escaped newline inside a JSON string, which
  is where the first panel's nine leaks came from. A tool used only as the
  ANSWER (`response`) is rendered as an ending rather than mapped: rewriting
  every English "response" in one arm's files would make the word's absence a
  separator in the other's.
- **every ending in one vocabulary** — `ENDINGS`: `answered`, `ran out of
  tokens in its scratchpad`, `cut mid-reply`, `refused`, `stopped at a
  ceiling`, `the endpoint failed`. The transport's own refusal text signs itself
  and names its levers; only the state is rendered.
- **the prompt, once, after the turns** — P5. Every message of the first
  request by role, under the same slots and the same scrub, then the lines the
  turn-2 request added over it, so the way an observation re-enters the context
  is visible once per file. Criterion 1 is about prompt composition and zero of
  eight judges across two panels could score it on a projection that dropped
  the prompt; three marked it withheld and two scored it from the raw
  transcripts and said that doing so ended their own blindness.

Two things it drops, with the argument:

- **the private reasoning channel.** No harness ever reads `reasoning_content`;
  it is where the model rehearses its output format verbatim — `think: [...]
  plan: [...] act: tool` on one side, `"tool_name"` on the other — and it is
  where one run read its own workspace path back seven times. The reasoning a
  judge sees is the reasoning the harness asked for and received.
- **the header.** The verdict is the answer; handing it to the judge is
  prompting. What a judge scoring grounding does need — whether the thing the
  run said it did was done — travels as `outcomes.json`: per task, per LETTER,
  the machine check's names and booleans, the turn count, the ending in the
  vocabulary above and the token total. No arm name, no workdir, no detail
  string — and the letters in LETTER order under every task. They were written
  in arm order, so the first key under every task was the same arm and the
  file carried the whole A/B map in the order of its keys.

**The prompt's prose is residue honest stripping cannot remove, and it is
declared rather than hidden.** A reader who has read either project will
recognise `# the agent System Manual` or `You are a careful, direct assistant`;
so will anyone who has read the previous panel's write-up. The disclosure at
the top of every file says so, asks the judge to score the pair alone, and asks
one who recognises a harness to say so in the verdict rather than score around
it. The gate prints how much of it there is — see below — so a verdict can be
read knowing by how much.

### What exits 1

1. a `BANNED` term — the project names, the user's name, absolute paths,
   `bench/work`, `scaffold`, the transport's class label — surviving anywhere
   in an emitted file. `test/bench/blind.test.js` holds every banned term to a
   scrub rule behind it.
2. an arm's own directory name surviving as a word. The names are read off
   `transcripts/<task>/`, so a third scaffold is covered the day it is added.
3. **a tool name of either arm surviving anywhere in an emitted file.** This
   is the control the whole of P4 rests on: `findTools` scans the emitted
   bytes with the mapper's own boundary rule, so a name the mapper missed is a
   name the verifier finds. Each arm's files are scanned for that arm's whole
   vocabulary plus the other arm's, minus a name this arm's own prompt uses as
   an ordinary word — `shell` is our tool and the reference manual's "the shell
   is /bin/sh".
4. **a string `blind.js` itself wrote — `REPLACEMENTS` — sorting the TURNS of
   more pairs one way than the other**, unless both arms were handed it in that
   pair's prompts. A replacement reaches only the files whose identifying token
   it replaced, so a token that named an arm becomes a replacement that names
   it. Every path now scrubs to ONE word, `/project`: an earlier version sent
   temp paths to `/workspace` and home paths to `/project`, and `/workspace`
   then sat in one arm's file and no other. A bare `<task>/<arm>/<n>` — what a
   model reads back off its own cwd — goes to the same word before the arm rule
   can turn it into `<task>/this harness/<n>`, which is what it did.

**S60 is closed: separation counts per pair.** The old rule dropped any term
present in both arms anywhere in the set, so a block present in 11 of one arm's
runs and 4 of the other's was invisible to it while `grep -l` sorted three
pairs by it. A separator is anything a grep can sort pairs by; the unit is the
pair, a term sorts a pair when it is in exactly one arm's turns, and every term
is reported with how many pairs it sorts each way. There is ONE definition of
"sorts" — `leaning` — and the gate and the residue inventory both call it; the
two used to carry their own copy, and the copies disagreed.

**S59 is closed: the A/B map hashes the task AND the index.** `letterFor`
hashed the task alone, so `blind-key.json`, `blind-2-key.json` and
`blind-3-key.json` were one map three times over. The first replacement hash
was `h * 31 + c`, whose parity is the parity of the character SUM (31 is odd),
and the codes of `1` and `3` are both odd, so those two indices were still one
map. It is the first byte of SHA-1 over `<task>/<index>` now — a standard's
output is pinned by the standard, not by this file — and the test pins that
the three maps differ.

Two kinds of thing sort pairs and are REPORTED, NOT FATAL, because they are
what happened rather than who:

- **slots.** `tool_3` in an arm that used three tools and not in an arm that
  used two. The number of tools is the design under judgment.
- **endings.** A run that ran out of tokens in its scratchpad did. Our arm did
  so in 11 of 15 runs against the reference arm's 4 (`docs/LEDGER.md` P8); the
  ending sorts pairs because the loops behaved differently, and a projection
  that hid that would be hiding the finding.

### What it printed over the recorded runs

`bun bench/blind.js --transcripts bench/runs/2026-09-01-s53-n3/transcripts
--out <dir>`, 2026-09-01, pasted as the program emitted it with only the
directory prefix cut from the first two lines, then `echo EXIT=$?`:

    wrote 10 transcripts and outcomes.json to <dir> — hand over THAT directory and nothing else
    key written to <dir>-key.json — outside it, and the judging step must not read it
    slots for agent-zero: tool_1=text_editor tool_2=code_execution_tool
    slots for ours: tool_1=list_files tool_2=read_file tool_3=shell tool_4=write_file
    
    RESIDUE: 517 token(s) sort three or more of 5 pair(s) by the prompt — its own prose, declared in every file and not listed. 28 token(s) sort three or more pairs from the turns alone:
       "runtime" [word] in agent-zero's turns, 5 of 5 pair(s)
       "verified" [word] in agent-zero's turns, 4 of 5 pair(s)
       "Verifying" [word] in agent-zero's turns, 4 of 5 pair(s)
       "Writing" [word] in agent-zero's turns, 4 of 5 pair(s)
       "->" [word] in ours's turns, 3 of 5 pair(s)
       ")." [word] in agent-zero's turns, 3 of 5 pair(s) (1 the other way)
       "\\" [word] in agent-zero's turns, 3 of 5 pair(s)
       "%" [word] in agent-zero's turns, 3 of 5 pair(s)
       "answered" [ending] in agent-zero's turns, 3 of 5 pair(s)
       "confirm" [word] in agent-zero's turns, 3 of 5 pair(s) (1 the other way)
       "echo" [word] in agent-zero's turns, 3 of 5 pair(s) (1 the other way)
       "ended" [ending] in ours's turns, 3 of 5 pair(s)
       "First" [word] in agent-zero's turns, 3 of 5 pair(s)
       "generated" [ending] in ours's turns, 3 of 5 pair(s)
       "here" [ending] in ours's turns, 3 of 5 pair(s)
       "Let" [word] in agent-zero's turns, 3 of 5 pair(s)
       "need" [word] in agent-zero's turns, 3 of 5 pair(s)
       "none" [ending] in ours's turns, 3 of 5 pair(s)
       "Now" [word] in agent-zero's turns, 3 of 5 pair(s)
       "out" [ending] in ours's turns, 3 of 5 pair(s)
       "ran" [ending] in ours's turns, 3 of 5 pair(s)
       "reached" [ending] in ours's turns, 3 of 5 pair(s)
       "scratchpad" [ending] in ours's turns, 3 of 5 pair(s)
       "Task" [word] in agent-zero's turns, 3 of 5 pair(s)
       "tokens" [ending] in ours's turns, 3 of 5 pair(s)
       "Verified" [word] in agent-zero's turns, 3 of 5 pair(s)
       "verify" [word] in agent-zero's turns, 3 of 5 pair(s) (1 the other way)
       "wrote" [word] in agent-zero's turns, 3 of 5 pair(s)
    
    verified: no banned term, arm name or tool name survives in any emitted file
       "answered" [ending] sorts 3 of 5 pair(s) toward agent-zero — what happened, not who
       "ran out of tokens in its scratchpad" [ending] sorts 3 of 5 pair(s) toward ours — what happened, not who
       "tool_3" [slot] sorts 2 of 5 pair(s) toward ours — what happened, not who
    blind: no string this file wrote sorts one arm's turns from the other's, across 5 pair(s)
    EXIT=0

Indices 2 and 3 of the same run: EXIT=0 both, 522 and 518 prompt tokens, 9 and
15 turn-only, three different A/B maps. The same command over `transcripts/` —
the superseded run this directory's `blind/` is built from — EXIT=0, 497 prompt
tokens, 23 turn-only. Before this projection the same recorded set exited 1
with six terms sorting 5 of 5 pairs, five of them tool names.

**What the residue is made of.** The inventory is the fresh grep, built in:
every token — a word of `[A-Za-z_][A-Za-z0-9_]{2,}`, case sensitive, or a run
of punctuation — that sorts three or more pairs one way, minus any token both
arms were handed in that pair's prompts, **filed by where it SORTS**. It used to
file any token that appeared in ANY prompt under "prompt prose", and `runtime`
— 5 of 5 pairs from the turns alone — was inside the count nobody reads.

- **517 tokens reach three pairs only once the prompt is counted**: the
  reference manual's and our agent file's own prose, the reply-format
  sections, `# the agent System Manual`, `You are a careful, direct assistant`,
  and two that are not prose: `shell`, which is our tool's name and the
  manual's English word for `/bin/sh` (an arm's own prompt makes a name
  English to that arm, so it is not mapped there), and `LLM: openai_compatible/local`,
  a provider label in the reference arm's extras block. A judge who can sort by
  any of them can sort by the prompt, which is declared in every file.
- **28 tokens sort three or more pairs from the turns alone**, and they are of
  four kinds. *The contracts' own argument names and observation frames*:
  `runtime` (`runtime: terminal` on every reference call row, 5 of 5) and
  `->` (our `tool_1 -> …` observation frame, 3 of 5) — rendered as recorded,
  because the argument names and the frame are the design under judgment and
  mapping them would hide what the loop was handed. *This script's own ending
  sentence*, nine words on the runs that ran out of tokens, and `answered` —
  the P8 finding wearing its own name. *The reference model's habits under its
  prompt*: its headlines open `Verifying …` and `Writing …`, its thoughts
  `Let's …`, `Now …`, `First …`, `confirm …`, `verify` / `verified`. *Fragments
  of the shell and Python it ran*: `echo`, `%`, `\`, `).`. An independent
  grep, tokenising on whitespace instead, agrees in kind: 670 tokens at three
  or more pairs by any presence, 41 by the turns alone, led by `runtime:`,
  `terminal`, `code:` at 5 of 5 and `[exit` / `0]` at 3 — the reference arm's
  `[exit code 0]` frame, which the word-only tokeniser could not see.

**The controls.** The one that matters is over the RECORDED set and mutates
data, not the instrument: a copy of the thirty runs with ` I have no
text_editor here.` appended to the task text of `collatz/ours/1.json` —
`!! 1 identifying string(s) survived the scrub: …/collatz/B.md:35 "text_editor"`,
EXIT=1. The same control lives in `test/bench/blind.test.js` in both
directions, so it survives the next refactor of the verifier. The rest are
one-line mutations of the instrument, each run and then restored byte for
byte with the md5 compared (the value is not quoted here — a hash in prose is
a confident lie the next time the file is touched):

    the tool-name scan deleted from the gate         test/bench: 1 fail — "a tool name of the OTHER arm … exits 1"
    the other arm's names dropped from the scan      test/bench: 1 fail — the same test
    residue() returning nothing                      test/bench: 6 fail
    residue filed by appearance, not by sorting      test/bench: 2 fail — `runtime` filed as prose
    outcomes.json written in arm order               test/bench: 3 fail — letter order, the tracked set
    a cut envelope's thoughts left unread            test/bench: 3 fail
    separation back to set-wide presence             test/bench: 1 fail — "a term in both arms set-wide still sorts…"
    letterFor hashing the task alone                 test/bench: 3 fail, both S59 tests among them
    the private reasoning channel put back           test/bench: "never the reply as written" fails
    the ending in the transport's own words          test/bench: 2 fail, `openai-compatible` reaches the file
    `plan` dropped from our arm's reasoning          test/bench: 1 fail
    run.js joining `<task>/<arm>/<n>` at the call    test/bench/run.test.js: 1 fail

**`bun run check` does not run this gate, and must not.** `transcripts/` is
written by a run that needs a model for twenty minutes, and a gate over a set
that is not there is not a gate. What `bun run check` runs instead is
`test/bench/blind.test.js`, which drives this script as a subprocess over two
hand-written records — one in each arm's action shape — and pins every class
above: two shapes into one grammar with no tool name left and exit 0; the
panel directory holding exactly the transcripts and `outcomes.json`, letters
in letter order; the emitted file byte-identical to `blindTranscript`; the key
outside it; two indices giving two maps; an arm name in a model's sentence
scrubbed and the set still green; the OTHER arm's tool name in a model's
sentence exiting 1 by file and term; a replacement reaching one arm's turns
exiting 1 by name; a banned term surviving exiting 1 by file and line. It also
regenerates `blind/` from `transcripts/` and compares the bytes, because the
ten files a panel reads are tracked AND generated and a mutation run once left
a laundering disclosure in them while the suite was green.

**The exit code is a claim, not a refusal.** The files are written whether the
gate passes or fails — a gate that deletes the evidence of its own failure
cannot be audited — and the disclosure travels inside each file because it is
the one channel between this script and a judge that cannot be dropped.

(`bench/` *is* tracked — `git ls-files bench` counts the ten `blind/<task>/{A,B}.md`,
`blind/outcomes.json`, the sixty files under `transcripts/` and `results.json`;
`blind-key.json` is the one file deliberately ignored. `docs/LEDGER.md` row S38.)

**And the set in `blind/` is built from `transcripts/`, which is the superseded
run** — the one produced before the rig used this project's transport. The
thirty runs a panel should be handed are `runs/2026-09-01-s53-n3/transcripts`,
which `docs/LEDGER.md` row S61 says are not yet promoted into this directory;
blinding them is one command, above.

## What it needs

    a model      Qwen3.8-27B-… at http://127.0.0.1:8873/v1, OpenAI-compatible, no key
    python3      tasks a, b and c are graded by running python
    node         task e is graded by running node

Nothing else, and nothing outside this repository. The agent-zero prompts are
vendored; there is no clone to find. The `bun run check` path needs none of
these — no test here runs python, node or a model.

## Files

| file | what it is |
|---|---|
| `driver.js` | the loop. Knows nothing about any scaffold and nothing about HTTP. |
| `transport.js` | the HTTP call: `src/core/inference/OpenAICompatible.js`, subclassed for a message array and a seed. Two overrides, both argued in the file. |
| `tools.js` | ONE implementation of `read_file`, `write_file`, `list_files`, `run`. |
| `tasks.js` | five tasks, each with a check that inspects the temp directory. |
| `scaffolds/agent-zero.js` | agent-zero's real prompt bytes, assembled here, every cut in `CUTS`. |
| `scaffolds/ours.js` | our real modules, imported from `src/`. |
| `vendor/agent-zero/` | the seventeen prompt files verbatim, plus two python files nothing runs — the oracle for the parser divergence — all hashed in `PROVENANCE.md`. |
| `run.js` | runs the matrix, writes transcripts and `results.json`. |
| `blind.js` | renders both arms' loops into one grammar with per-arm tool slots, puts the prompt back once under the same mapping, emits the panel directory and `outcomes.json`, and exits non-zero on a banned term, an arm name, a surviving tool name, or a string it wrote that sorts one arm's turns from the other's. Over the recorded runs: exit 0, with the residue printed. |

Adding a third scaffold is a file in `scaffolds/` and a line in `run.js`.
Nothing else changes.

## Standing rules this rig obeys

- A check never asks a model anything.
- A scaffold is never weakened to make a comparison flattering; every departure
  from what a scaffold would really send is listed in that file's `CUTS`, and a
  departure that stops applying is a failing test rather than a silence.
- A result that cannot be reproduced from a clean checkout is not a result.
- **The rig calls the model through the tree's own transport.** Not a copy of
  it, not something that agrees with it: `bench/transport.js` extends
  `src/core/inference/OpenAICompatible.js` and
  `test/bench/transport.test.js` asserts the `instanceof` and that `_state` is
  the class's own function object. Anything that cannot be inherited is
  overridden in that one file with the argument written beside it. A
  reimplementation is what made this comparison a lie the first time.
- **Every statistic a reader is asked to carry is computed by the instrument.**
  The rig prints and records `median`, spread, reply states and refusal counts,
  because a rig that prints only rows invites a reader to roll their own and one
  did, wrongly.
- **The rig records what answered, not what it asked for.**
