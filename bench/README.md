# The rig

Settles whether our agent scaffold drives tools better than a reference one, by
holding everything except the scaffold constant.

    same model      Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp at http://127.0.0.1:8873/v1
    same params     temperature 0, seed 7, max_tokens 1200
    same tasks      tasks.js, five of them, machine-checked
    same tools      tools.js, four functions, every scaffold ends there
    same cap        12 turns, recorded as an event

The only variable is `scaffolds/*.js`: the system prompt, the tool contract, the
parse, and how an observation re-enters the context. `test/bench/driver.test.js`
drives two scaffolds that differ only in their `id` and asserts that `model`,
`temperature`, `seed` and `max_tokens` are byte-identical on the wire and that
both are offered the same number of turns — because "everything except the
scaffold is held constant" was prose until something failed when it was not.

**A SINGLE RUN IS A SAMPLE, NOT A MEASUREMENT.** `temperature: 0, seed: 7` does
not make this endpoint reproducible; it is the same class of measured fact as
its `cached_tokens: 0`. The same task, the same code, an hour apart:

    agent-zero  4 turns   9,892 tokens  45s   |  5 turns  13,234 tokens  55s
    ours        2 turns   3,390 tokens  50s   |  4 turns   4,467 tokens  33s

So `-n 3` at least, and quote a spread, for any number anyone repeats.

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
| reply parsing | **genuine, and ASYMMETRIC — read this before any turn count.** `BaseResponse.parse` tries TOON, then JSON as a repair, then returns the whole reply as the answer. So this arm **cannot produce a malformed action at all**: a reply agent-zero scores `misformat` and pays a turn for ends this arm's run as an answer. Measured — `"Sure! I think the battery is at 87%."` is `{kind:"answer"}` here and `{kind:"malformed", reason:"misformat"}` there. It is our real production behaviour and is not repaired; it is recorded in `ours.js` `cuts`, so every transcript carries it. |
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
| ours 58,439 tok / 736 s vs agent-zero 237,579 / 1,177 s — 4.065x fewer tokens, 1.60x faster | **Stands as a record of what those runs cost.** It is not reproducible under the fixed rig: a refused reply ends its run, so re-running will produce FEWER tokens and LESS time for our arm and change the ratio. `md5 bench/results.json` = `be2c057ef0f810ff01c0b6f989122039` and all ten rows still re-derive. |
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
    bun run bench:blind               build the blind set and gate it
    bun bench/blind.js --index 2      blind run 2 instead of run 1
    bun bench/blind.js --transcripts /tmp/x --out /tmp/x-blind
                                      blind a run that went somewhere else

`run.js` writes `transcripts/<task>/<scaffold>/<n>.md` (and `.json`) plus
`results.json`, and prints the table. Each transcript carries the scaffold's own
`cuts` — every departure it makes from what it would really send — so a number
never travels without them.

`blind.js` writes `blind/<task>/{A,B}.md` and the key to `blind-key.json`,
which is OUTSIDE `blind/` — a judge is handed `blind/<task>/` and nothing else,
and a key inside that directory is not a key, it is a label. It used to be
`blind/key.json`. The key is gitignored; regenerate it with `bun run bench:blind`.

**`blind.js` is the gate on that directory, and it exits non-zero when a leak
exists.** What a judge sees is a PROJECTION of the run — the task, then per turn
the model's reply, how the harness parsed it, and what the tools answered, then
how the run ended and what it finally said. It reads `<n>.json` and asks
`run.js` `renderBody` for that projection, so the header and the departures block
are structurally absent rather than stripped. Two things it deliberately does
NOT do:

- **it does not rename tools.** `code_execution_tool`, `text_editor`,
  `read_file`, `write_file`, `list_files` survive verbatim. An earlier version
  mapped them onto a neutral vocabulary and called the result blind; a tool's
  name is part of what is being judged, and a judge shown `exec` cannot see that
  one harness routes four capabilities through one tool with an `action`
  argument while the other offers four flat ones. That rename also did not work
  — it was word-bounded, so every occurrence preceded by an escaped newline
  inside a JSON string survived it, which is where the last panel's nine leaks
  came from.
- **it does not reformat replies.** The response contract is the variable under
  test.
- **it does not rewrite a sentence the model wrote.** Dropping the request block
  removes both system prompts AS SENT, at every turn, in every file. It does not
  remove them where a model quoted its own instructions back into its reasoning,
  and one file does exactly that: `blind/no-such-capability/B.md` carries `You
  are a careful, direct assistant` five times. That text is the model's speech;
  scrubbing it would put a fabrication in the artifact, which is the trade this
  script refuses everywhere else. So it is declared instead — and it was NOT,
  until this slice: the gate exited 0 over that file and the header of `blind.js`
  claimed dropping the request block was "the whole identity leak", while one
  `grep -l` separated that pair.

Which means **the set is not blind, and the script says so in its own output**,
per file, with counts — measured on the set now in `blind/`:

    NOT BLIND: 137 line(s) carrying one of 7 declared identifying term(s)
    remain, in 10 of 10 file(s).
       …/no-such-capability/B.md  read_file×3
                                  You are a careful, direct assistant×5
                                  write_file×5

The unit is the line, not the occurrence: a term twice on one line is one place
to look, and the leak report beside it names line numbers.

`RESIDUAL` is that declared list and never fails the run; `BANNED` — the project
names, the user's name, absolute paths, `bench/work`, `scaffold`, and
`openai-compatible` — must not survive, and one hit exits 1. That last one is
our own transport's class label, which opens every refusal message it writes:
the refusal block is a run's ending so it stays, but the runs in `transcripts/`
predate the transport and contain none, and once they are regenerated the
classifier refuses 12 of one arm's 34 replies and 0 of the other's 79 — one
`grep -l`, every pair, the same one-probe separation that made the last panel's
verdict worth nothing. It is banned before the first regenerated set can carry
it to a judge, not after. **The arms' own directory names are fatal too, and
they are read off the run rather than typed in:** `transcripts/<task>/` names
the arms that ran, so the set is exact and a third scaffold is covered the day
it is added. `no-such-capability/ours/1` was printed six times inside one
model's reasoning, and the previous conclusion — that `ours` is "too common a
word to put in BANNED" — was a mismatch rather than a word problem: the scrub
was `\b`-anchored and correctly left `yourself` alone, while the verifier was a
substring scan and disagreed with it. Both halves are fixed and both are pinned. `test/bench/blind.test.js` holds both halves of the
rule: every banned term must have a scrub rule behind it, and every residual term
must survive the scrub, or one of the two lists is lying.

**`bun run check` does not run this gate, and cannot.** `bench/` is not tracked
(`git ls-files bench` → 0) and `transcripts/` is written by a run that needs a
model for twenty minutes, so on any fresh checkout `bun bench/blind.js` exits 1
on a missing directory — a gate step that is red for everyone who has not run
the benchmark is not a gate, it is a broken build. What `bun run check` runs
instead is `test/bench/blind.test.js`, which drives this script as a subprocess
over fixtures and pins both leak classes it has actually shipped: an arm's own
directory name in a model's prose, and our transport's signature in a refusal
block. Running `bun run bench:blind` is the panel's first step and its exit code
is the claim.

**And the set now in `blind/` is built from `transcripts/`, which is the
superseded run** — the one produced before the rig used this project's
transport. It is a valid artifact for judging how each loop reads and acts, and
it is NOT a source of pass/fail: three of its five `ours` transcripts end on a
reply the shipped transport refuses, and they read as answers because at the
time they were treated as answers. Regenerate it after the next full run.

**The panel that ran before this file was rewritten was not blind by any of
these measures** — 5 of 5 files of each arm opened with that arm's own system
prompt, nine tool identifiers survived, and the key sat inside the directory. No
verdict from it about which arm is better is worth anything.

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
| `blind.js` | projects the loop out of each transcript, scrubs what can be removed, declares what cannot, and exits non-zero on a leak. |

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
